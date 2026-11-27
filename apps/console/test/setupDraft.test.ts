import { formatRupees } from "@pmp/contracts";
import { fare } from "@pmp/domain";
import { describe, expect, it } from "vitest";
import { tryFare } from "../src/lib/fareTryIt";
import {
  analyse,
  buildTariffs,
  draftTariffId,
  draftToJson,
  emptyDraft,
  exampleDraft,
} from "../src/lib/setupDraft";

const TODAY = "2026-10-29";

describe("setup wizard analysis", () => {
  it("accepts the example configuration with no errors or warnings", () => {
    const a = analyse(exampleDraft(TODAY), TODAY);
    expect(a.stepErrors).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 });
    expect(a.capacityWarning).toBeNull();
    expect(a.classProblems).toEqual([]);
    expect(a.classWarnings).toEqual([]);
    expect(a.tariffs.every((t) => t.tariff !== undefined)).toBe(true);
  });

  it("builds tariffs in the shared IC-04 shape", () => {
    const [car, bike] = buildTariffs(exampleDraft(TODAY));
    expect(car.tariff).toMatchObject({
      model: "HOURLY_SLABS",
      vehicleClass: "Car",
      graceMinutes: 15,
      dayCapPaise: 30000,
      slabs: [
        { upToMinutes: 60, pricePaise: 4000 },
        { upToMinutes: 180, pricePaise: 7000 },
      ],
      repeat: { everyMinutes: 60, pricePaise: 2000 },
      night: { fromHHMM: "2200", toHHMM: "0600", surchargePaise: 5000 },
    });
    expect(bike.tariff).toMatchObject({ model: "FLAT", flatPaise: 2000 });
  });

  it("gives every draft tariff a distinct placeholder uuid, as the contract requires", () => {
    const ids = buildTariffs(exampleDraft(TODAY)).map((t) => t.tariff?.id);
    expect(ids).toEqual([draftTariffId(0), draftTariffId(1)]);
    for (const id of ids)
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    expect(new Set(ids).size).toBe(2);
  });

  it("lets the shared schema reject bands that do not get longer", () => {
    const d = exampleDraft(TODAY);
    d.tariffs[0].slabs = [
      { upTo: "120", price: "40" },
      { upTo: "60", price: "70" },
    ];
    const t = analyse(d, TODAY).tariffs[0];
    expect(t.tariff).toBeUndefined();
    expect(t.fieldErrors.schema.join(" ")).toMatch(/sorted/);
  });

  it("flags a bad price, a day cap below a band, and a missing tariff class", () => {
    const d = exampleDraft(TODAY);
    d.tariffs[0].slabs[0].price = "abc";
    expect(analyse(d, TODAY).tariffs[0].fieldErrors.slabs[0]).toMatch(/rupees/);
    const e = exampleDraft(TODAY);
    e.tariffs[0].dayCap = "50";
    expect(analyse(e, TODAY).tariffs[0].fieldErrors.dayCap).toMatch(/below the highest/);
    const f = exampleDraft(TODAY);
    f.tariffs = f.tariffs.slice(0, 1);
    expect(analyse(f, TODAY).classProblems).toEqual([
      "Zones allow Bike, but there is no tariff for it.",
    ]);
  });

  it("treats a capacity mismatch as a warning, not an error", () => {
    const d = exampleDraft(TODAY);
    d.slotCount = "200";
    const a = analyse(d, TODAY);
    expect(a.capacityWarning).toMatch(/180/);
    expect(a.stepErrors[1]).toBe(0);
  });

  it("checks grace, night window, night value, start date and overstay", () => {
    const d = exampleDraft(TODAY);
    d.grace = "-1";
    d.nightEnd = "22:00";
    d.nightValue = "";
    d.effectiveFrom = "2026-10-01";
    d.overstay = "10";
    const a = analyse(d, TODAY);
    expect(a.grace).toBeDefined();
    expect(a.night).toBeDefined();
    expect(a.nightValue).toBeDefined();
    expect(a.effectiveFrom).toMatch(/past/);
    expect(a.overstay).toMatch(/30/);
    expect(a.stepErrors[3]).toBe(4);
    expect(a.stepErrors[4]).toBe(1);
  });

  it("reports a blank start date once, on the Time rules step, not as a raw schema message", () => {
    const d = exampleDraft(TODAY);
    d.effectiveFrom = "";
    const a = analyse(d, TODAY);
    expect(a.effectiveFrom).toMatch(/Choose/);
    expect(a.tariffs[0].fieldErrors.schema).toEqual([]);
    expect(a.stepErrors[2]).toBe(0);
    expect(a.stepErrors[3]).toBe(1);
  });

  it("an empty draft has errors but crashes on nothing", () => {
    const a = analyse(emptyDraft(), TODAY);
    expect(a.stepErrors[1]).toBeGreaterThan(0);
    expect(a.effectiveFrom).toMatch(/Choose/);
  });

  it("the downloadable draft has valid tariffs, no PIN, and says it is not saved", () => {
    const out = draftToJson(exampleDraft(TODAY), TODAY);
    expect(out.note).toContain("Not saved to any facility");
    expect(out.tariffs.every((t) => t !== null)).toBe(true);
    expect(JSON.stringify(out).toLowerCase()).not.toContain("pin");
  });
});

describe("try a fare uses the shared fare engine", () => {
  const car = buildTariffs(exampleDraft(TODAY))[0].tariff!;

  it("agrees with the engine for a day stay", () => {
    const r = tryFare(car, "Car", `${TODAY}T10:00`, `${TODAY}T12:30`);
    const expected = fare(car, `${TODAY}T10:00:00+05:30`, `${TODAY}T12:30:00+05:30`, "Car");
    expect(r).toMatchObject({ ok: true, fare: formatRupees(expected), stay: "2 h 30 min" });
    expect(expected).toBe(7000);
  });

  it("includes the night surcharge when the stay touches the night window", () => {
    const r = tryFare(car, "Car", `${TODAY}T21:30`, `${TODAY}T22:30`);
    const expected = fare(car, `${TODAY}T21:30:00+05:30`, `${TODAY}T22:30:00+05:30`, "Car");
    expect(r.ok && r.fare).toBe(formatRupees(expected));
    expect(r.ok && r.steps.some((s) => s.label === "Night surcharge")).toBe(true);
  });

  it("explains errors in plain words", () => {
    expect(tryFare(car, "Car", `${TODAY}T12:00`, `${TODAY}T10:00`)).toEqual({
      ok: false,
      message: "The exit time must be after the entry time.",
    });
    expect(tryFare(car, "Car", "2026-10-01T10:00", "2026-10-01T11:00")).toMatchObject({
      ok: false,
      message: expect.stringMatching(/start date/),
    });
    expect(tryFare(car, "Car", "", "")).toMatchObject({ ok: false });
  });
});
