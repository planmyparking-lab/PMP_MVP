import { z } from "zod";
import type { Tariff } from "@pmp/contracts";
import type { Role } from "./permissions";
import { VEHICLE_CLASSES } from "./setupDraft";
import type { SetupDraft } from "./setupDraft";

/** The only classes the gate app records and looks tariffs up with; enforced here too, not only in the form. */
const VehicleClass = z.enum(VEHICLE_CLASSES);

/**
 * CON-01 "Save to this facility": turns a valid wizard draft into the rows to write, given what the facility already
 * has. Pure, so every rule below is unit-tested; the server action (app/setup/actions.ts) only reads and writes.
 *
 * Rules (sheet C1 steps 2-3 and edge cases; the choices the sheet leaves open are OQ-67):
 * - The target is always the session's selected facility. A new facility cannot be created: no role may insert into
 *   `facilities` (0010).
 * - Facility name and slot count are written only by an owner; 0010 lets a manager edit zones and tariffs but not the
 *   facility row. A manager's save keeps the facility row as it is and says so.
 * - Zones are matched by name (trimmed, case-insensitive). A new name is inserted; a known name with a new capacity is
 *   updated. Zones are never deleted, and a known zone's vehicle class is never changed (open sessions and past events
 *   point at it); such a difference stops the save so the user can rename the zone instead.
 * - Tariffs are never updated: every save inserts a new version (sheet C1 edge case "never overwrites history"). Its
 *   start is the draft's IST start date at 00:00 IST, the IC-04 meaning of `effectiveFrom`. If the facility already
 *   has a tariff for that class starting the same day, an identical rule is skipped (a repeated click saves nothing
 *   twice) and a different rule stops the save, because two versions starting on one day are ambiguous to the fare
 *   engine.
 */

/** The wizard draft as sent by the browser; every field is re-checked on the server by `analyse`. */
export const DraftPayload = z.object({
  name: z.string().max(200),
  slotCount: z.string().max(10),
  zones: z
    .array(
      z.object({
        name: z.string().max(100),
        capacity: z.string().max(10),
        vehicleClass: VehicleClass,
      }),
    )
    .min(1)
    .max(50),
  tariffs: z
    .array(
      z.object({
        vehicleClass: VehicleClass,
        model: z.enum(["HOURLY_SLABS", "FLAT", "PER_ENTRY"]),
        slabs: z.array(z.object({ upTo: z.string().max(10), price: z.string().max(20) })).max(24),
        repeatEvery: z.string().max(10),
        repeatPrice: z.string().max(20),
        flat: z.string().max(20),
        dayCap: z.string().max(20),
        minimum: z.string().max(20),
      }),
    )
    .min(1)
    .max(10),
  grace: z.string().max(10),
  nightOn: z.boolean(),
  nightStart: z.string().max(5),
  nightEnd: z.string().max(5),
  nightKind: z.enum(["surcharge", "multiplier"]),
  nightValue: z.string().max(20),
  effectiveFrom: z.string().max(10),
  overstay: z.string().max(10),
});

export interface ExistingZone {
  id: string;
  name: string;
  capacity: number;
  vehicleClass: string;
}
export interface ExistingTariff {
  vehicleClass: string;
  /** `tariffs.effective_from` as stored (ISO timestamp). */
  effectiveFrom: string;
  ruleJson: unknown;
}
export interface FacilityRow {
  id: string;
  name: string;
  slotCount: number;
}
export interface ValidDraft {
  name: string;
  slotCount: number;
  zones: { name: string; capacity: number; vehicleClass: string }[];
  /** Valid IC-04 tariffs from `buildTariffs`, still carrying placeholder ids. */
  tariffs: Tariff[];
  /** IST calendar date, yyyy-mm-dd. */
  effectiveFrom: string;
}

export interface SavePlan {
  facilityUpdate: { name: string; slot_count: number } | null;
  /** Set when the draft changes the facility row but the user is not an owner. */
  facilitySkipped: string | null;
  zoneInserts: { facility_id: string; name: string; capacity: number; vehicle_class: string }[];
  zoneUpdates: { id: string; name: string; capacity: number }[];
  tariffInserts: {
    id: string;
    facility_id: string;
    vehicle_class: string;
    rule_json: Tariff;
    effective_from: string;
  }[];
  /** Classes whose identical tariff for the same start day is already saved. */
  tariffsAlreadySaved: string[];
}

export type PlanResult = { ok: true; plan: SavePlan } | { ok: false; problems: string[] };

const key = (s: string) => s.trim().toLowerCase();

/** 00:00 IST on an IST calendar date, the instant IC-04's `effectiveFrom` date starts. */
export const istMidnight = (date: string): string => `${date}T00:00:00+05:30`;

/** The IST calendar date of a stored timestamp. */
export const istDateOf = (iso: string): string | null => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t + 330 * 60_000).toISOString().slice(0, 10);
};

/** A tariff rule with the row identity removed, keys sorted, so two saves of one rule compare equal. */
export function ruleFingerprint(rule: unknown): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([k]) => k !== "id" && k !== "facilityId")
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, strip(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(strip(rule));
}

export function planSave(input: {
  draft: ValidDraft;
  facility: FacilityRow;
  role: Role;
  zones: readonly ExistingZone[];
  tariffs: readonly ExistingTariff[];
  newId: () => string;
}): PlanResult {
  const { draft, facility, role } = input;
  const problems: string[] = [];

  const seen = new Set<string>();
  for (const z of draft.zones) {
    if (seen.has(key(z.name)))
      problems.push(`Two zones are called "${z.name.trim()}". Give each zone its own name.`);
    seen.add(key(z.name));
  }
  const classes = new Set<string>();
  for (const t of draft.tariffs) {
    if (classes.has(key(t.vehicleClass)))
      problems.push(`There are two tariffs for ${t.vehicleClass}. Keep one per vehicle class.`);
    classes.add(key(t.vehicleClass));
  }

  const byName = new Map(input.zones.map((z) => [key(z.name), z]));
  const zoneInserts: SavePlan["zoneInserts"] = [];
  const zoneUpdates: SavePlan["zoneUpdates"] = [];
  for (const z of draft.zones) {
    const existing = byName.get(key(z.name));
    if (!existing) {
      zoneInserts.push({
        facility_id: facility.id,
        name: z.name.trim(),
        capacity: z.capacity,
        vehicle_class: z.vehicleClass,
      });
    } else if (key(existing.vehicleClass) !== key(z.vehicleClass)) {
      problems.push(
        `Zone "${existing.name}" already exists for ${existing.vehicleClass}. Its vehicle class cannot be changed here; use a new zone name for ${z.vehicleClass}.`,
      );
    } else if (existing.capacity !== z.capacity) {
      zoneUpdates.push({ id: existing.id, name: existing.name, capacity: z.capacity });
    }
  }

  const tariffInserts: SavePlan["tariffInserts"] = [];
  const tariffsAlreadySaved: string[] = [];
  for (const t of draft.tariffs) {
    const sameDay = input.tariffs.filter(
      (e) =>
        key(e.vehicleClass) === key(t.vehicleClass) &&
        istDateOf(e.effectiveFrom) === draft.effectiveFrom,
    );
    if (sameDay.some((e) => ruleFingerprint(e.ruleJson) === ruleFingerprint(t))) {
      tariffsAlreadySaved.push(t.vehicleClass);
      continue;
    }
    if (sameDay.length > 0) {
      problems.push(
        `A different ${t.vehicleClass} tariff already starts on ${draft.effectiveFrom}. Choose a later start date for the new version.`,
      );
      continue;
    }
    const id = input.newId();
    tariffInserts.push({
      id,
      facility_id: facility.id,
      vehicle_class: t.vehicleClass,
      rule_json: { ...t, id, facilityId: facility.id },
      effective_from: istMidnight(draft.effectiveFrom),
    });
  }

  if (problems.length > 0) return { ok: false, problems };

  const changesFacility =
    draft.name.trim() !== facility.name || draft.slotCount !== facility.slotCount;
  const isOwner = role === "owner";
  return {
    ok: true,
    plan: {
      facilityUpdate:
        changesFacility && isOwner
          ? { name: draft.name.trim(), slot_count: draft.slotCount }
          : null,
      facilitySkipped:
        changesFacility && !isOwner
          ? "The facility name and slot count were not changed: only an owner can edit them."
          : null,
      zoneInserts,
      zoneUpdates,
      tariffInserts,
      tariffsAlreadySaved,
    },
  };
}

/** One sentence for the toast after a successful save. */
export function describeSaved(p: SavePlan): string {
  const parts: string[] = [];
  if (p.facilityUpdate) parts.push("facility details updated");
  if (p.zoneInserts.length)
    parts.push(`${p.zoneInserts.length} zone${p.zoneInserts.length === 1 ? "" : "s"} added`);
  if (p.zoneUpdates.length)
    parts.push(
      `${p.zoneUpdates.length} zone capacit${p.zoneUpdates.length === 1 ? "y" : "ies"} changed`,
    );
  if (p.tariffInserts.length)
    parts.push(
      `${p.tariffInserts.length} tariff version${p.tariffInserts.length === 1 ? "" : "s"} added`,
    );
  if (parts.length === 0 && p.facilitySkipped)
    return "Nothing was saved: the zones and tariffs are already up to date, and only an owner can change the facility name and slot count.";
  const head = parts.length
    ? `Saved: ${parts.join(", ")}.`
    : "Nothing new to save; this facility already has these settings.";
  return [head, p.facilitySkipped].filter(Boolean).join(" ");
}

/**
 * What the save does to the facility row, spelled out with the old and new values so a typo in the name or slot
 * count is visible before it is written (review of #66).
 */
export function facilityDetailsLine(
  draft: SetupDraft,
  currentName: string,
  currentSlots: number,
  isOwner: boolean,
): string {
  const changes: string[] = [];
  if (draft.name.trim() !== currentName)
    changes.push(`name "${currentName}" to "${draft.name.trim()}"`);
  if (draft.slotCount.trim() !== String(currentSlots))
    changes.push(`slot count ${currentSlots} to ${draft.slotCount.trim()}`);
  if (changes.length === 0) return "The facility name and slot count stay as they are.";
  return isOwner
    ? `This changes the facility ${changes.join(" and ")}.`
    : `The facility ${changes.join(" and ")} is not changed: only an owner can do that.`;
}
