import { describe, expect, it } from "vitest";
import { buildTariffs, exampleDraft } from "../src/lib/setupDraft";
import {
  DraftPayload,
  describeSaved,
  istDateOf,
  istMidnight,
  planSave,
  ruleFingerprint,
} from "../src/lib/setupSave";
import type { ExistingTariff, ExistingZone, ValidDraft } from "../src/lib/setupSave";

const FACILITY = { id: "11111111-1111-4111-8111-111111111111", name: "Old Name", slotCount: 100 };
const START = "2026-12-01";

function validDraft(over: Partial<ValidDraft> = {}): ValidDraft {
  const d = exampleDraft(START);
  return {
    name: "Example Mall",
    slotCount: 180,
    zones: [
      { name: "Basement A", capacity: 100, vehicleClass: "Car" },
      { name: "Two-wheeler bay", capacity: 80, vehicleClass: "Bike" },
    ],
    tariffs: buildTariffs(d).flatMap((t) => (t.tariff ? [t.tariff] : [])),
    effectiveFrom: START,
    ...over,
  };
}

let n = 0;
const ids = () => `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`;

const plan = (
  over: {
    draft?: ValidDraft;
    role?: "owner" | "manager";
    zones?: ExistingZone[];
    tariffs?: ExistingTariff[];
  } = {},
) =>
  planSave({
    draft: over.draft ?? validDraft(),
    facility: FACILITY,
    role: over.role ?? "owner",
    zones: over.zones ?? [],
    tariffs: over.tariffs ?? [],
    newId: ids,
  });

describe("CON-01 save plan", () => {
  it("example draft builds two valid tariffs (fixture check)", () => {
    expect(validDraft().tariffs).toHaveLength(2);
  });

  it("an empty facility gets every zone, a tariff version per class, and the owner's facility details", () => {
    const r = plan();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.facilityUpdate).toEqual({ name: "Example Mall", slot_count: 180 });
    expect(
      r.plan.zoneInserts.map((z) => [z.name, z.capacity, z.vehicle_class, z.facility_id]),
    ).toEqual([
      ["Basement A", 100, "Car", FACILITY.id],
      ["Two-wheeler bay", 80, "Bike", FACILITY.id],
    ]);
    expect(r.plan.tariffInserts).toHaveLength(2);
  });

  it("a tariff row's id and facility match the ids inside its rule (EXIT.payload.tariff_id traces to the row)", () => {
    const r = plan();
    if (!r.ok) throw new Error("plan failed");
    for (const t of r.plan.tariffInserts) {
      expect(t.rule_json.id).toBe(t.id);
      expect(t.rule_json.facilityId).toBe(FACILITY.id);
      expect(t.facility_id).toBe(FACILITY.id);
      expect(t.id).not.toMatch(/^00000000-0000-4000/); // never the wizard's placeholder id
    }
  });

  it("a tariff starts at 00:00 IST on the chosen date, the IC-04 meaning of effectiveFrom", () => {
    const r = plan();
    if (!r.ok) throw new Error("plan failed");
    expect(r.plan.tariffInserts[0].effective_from).toBe("2026-12-01T00:00:00+05:30");
    expect(istDateOf(istMidnight(START))).toBe(START);
  });

  it("a manager's save keeps the facility row and says why; zones and tariffs are still saved", () => {
    const r = plan({ role: "manager" });
    if (!r.ok) throw new Error("plan failed");
    expect(r.plan.facilityUpdate).toBeNull();
    expect(r.plan.facilitySkipped).toMatch(/only an owner/);
    expect(r.plan.zoneInserts).toHaveLength(2);
    expect(r.plan.tariffInserts).toHaveLength(2);
  });

  it("no facility update when name and slot count are unchanged", () => {
    const r = plan({ draft: validDraft({ name: "Old Name", slotCount: 100 }), role: "manager" });
    if (!r.ok) throw new Error("plan failed");
    expect(r.plan.facilityUpdate).toBeNull();
    expect(r.plan.facilitySkipped).toBeNull();
  });

  it("zones: a known name (any case) updates capacity, never inserts a second zone, never deletes others", () => {
    const zones: ExistingZone[] = [
      { id: "z1", name: "basement a", capacity: 60, vehicleClass: "Car" },
      { id: "z9", name: "Roof", capacity: 20, vehicleClass: "Car" },
    ];
    const r = plan({ zones });
    if (!r.ok) throw new Error("plan failed");
    expect(r.plan.zoneUpdates).toEqual([{ id: "z1", name: "basement a", capacity: 100 }]);
    expect(r.plan.zoneInserts.map((z) => z.name)).toEqual(["Two-wheeler bay"]);
  });

  it("zones: same capacity means no write", () => {
    const zones: ExistingZone[] = [
      { id: "z1", name: "Basement A", capacity: 100, vehicleClass: "Car" },
    ];
    const r = plan({ zones });
    if (!r.ok) throw new Error("plan failed");
    expect(r.plan.zoneUpdates).toEqual([]);
  });

  it("zones: changing a known zone's vehicle class stops the save and asks for a new name", () => {
    const zones: ExistingZone[] = [
      { id: "z1", name: "Basement A", capacity: 100, vehicleClass: "Bus" },
    ];
    const r = plan({ zones });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(" ")).toMatch(/Basement A.*cannot be changed/);
  });

  it("two zones with one name, or two tariffs for one class, are refused", () => {
    const d = validDraft();
    const r1 = plan({
      draft: {
        ...d,
        zones: [...d.zones, { name: " basement A ", capacity: 5, vehicleClass: "Car" }],
      },
    });
    expect(r1.ok).toBe(false);
    const r2 = plan({ draft: { ...d, tariffs: [d.tariffs[0], d.tariffs[0]] } });
    expect(r2.ok).toBe(false);
  });

  it("tariffs: an identical rule already starting that day is skipped, so a second click saves nothing twice", () => {
    const first = plan();
    if (!first.ok) throw new Error("plan failed");
    const saved: ExistingTariff[] = first.plan.tariffInserts.map((t) => ({
      vehicleClass: t.vehicle_class,
      effectiveFrom: "2026-11-30T18:30:00+00:00", // how Postgres returns 00:00 IST
      ruleJson: t.rule_json,
    }));
    const zones: ExistingZone[] = first.plan.zoneInserts.map((z, i) => ({
      id: `z${i}`,
      name: z.name,
      capacity: z.capacity,
      vehicleClass: z.vehicle_class,
    }));
    const again = planSave({
      draft: validDraft({ name: "Old Name", slotCount: 100 }),
      facility: FACILITY,
      role: "owner",
      zones,
      tariffs: saved,
      newId: ids,
    });
    if (!again.ok) throw new Error("plan failed");
    expect(again.plan.tariffInserts).toEqual([]);
    expect(again.plan.tariffsAlreadySaved.sort()).toEqual(["Bike", "Car"]);
    expect(describeSaved(again.plan)).toMatch(/Nothing new to save/);
  });

  it("tariffs: a different rule for the same class and start day stops the save (ambiguous for the fare engine)", () => {
    const first = plan();
    if (!first.ok) throw new Error("plan failed");
    const car = first.plan.tariffInserts.find((t) => t.vehicle_class === "Car");
    if (!car) throw new Error("no car tariff");
    const r = plan({
      tariffs: [
        {
          vehicleClass: "Car",
          effectiveFrom: "2026-11-30T18:30:00+00:00",
          ruleJson: { ...car.rule_json, graceMinutes: 99 },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(" ")).toMatch(/Car tariff already starts on 2026-12-01/);
  });

  it("tariffs: a version on another day never blocks or replaces anything; a new version is inserted", () => {
    const r = plan({
      tariffs: [{ vehicleClass: "Car", effectiveFrom: "2026-01-01T00:00:00+05:30", ruleJson: {} }],
    });
    if (!r.ok) throw new Error("plan failed");
    expect(r.plan.tariffInserts.map((t) => t.vehicle_class).sort()).toEqual(["Bike", "Car"]);
  });

  it("rule fingerprints ignore the row id, facility id and key order", () => {
    expect(ruleFingerprint({ id: "a", facilityId: "f", b: 1, a: { y: 2, x: 1 } })).toBe(
      ruleFingerprint({ a: { x: 1, y: 2 }, b: 1, id: "z", facilityId: "g" }),
    );
    expect(ruleFingerprint({ a: 1 })).not.toBe(ruleFingerprint({ a: 2 }));
  });

  it("the toast sentence lists what was written and the owner-only note", () => {
    const r = plan({ role: "manager" });
    if (!r.ok) throw new Error("plan failed");
    expect(describeSaved(r.plan)).toBe(
      "Saved: 2 zones added, 2 tariff versions added. The facility name and slot count were not changed: only an owner can edit them.",
    );
  });
});

describe("CON-01 draft payload", () => {
  it("accepts the wizard's own draft and rejects unexpected shapes or oversized input", () => {
    expect(DraftPayload.safeParse(exampleDraft(START)).success).toBe(true);
    expect(DraftPayload.safeParse({ ...exampleDraft(START), zones: [] }).success).toBe(false);
    expect(DraftPayload.safeParse({ ...exampleDraft(START), name: "x".repeat(201) }).success).toBe(
      false,
    );
    expect(DraftPayload.safeParse({ ...exampleDraft(START), nightKind: "other" }).success).toBe(
      false,
    );
  });
});
