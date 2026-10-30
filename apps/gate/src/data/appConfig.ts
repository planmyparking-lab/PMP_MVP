import type { Tariff } from "@pmp/contracts";
import fixtureTariffs from "@pmp/domain/src/fixtures/tariffs.json";
import { tariffFor as pickTariffForClass } from "../domain/tariffFor";
import type { GateZone } from "../domain/suggestZone";
import type { PassRow } from "../domain/pass";

/**
 * DEV-MODE facility configuration (app-layer seed data — NOT synced config).
 *
 * Until Akanksha's config sync (CON-01/IC-04) and Afzal's read tables deliver a real facility
 * row, the shell needs *something* to run against. This file is that seed and it is labelled as
 * demo everywhere it surfaces (status screen, login screen, entry screen header). It must never
 * masquerade as real facility data:
 *
 * - `-demo-1` below is a fixed well-known UUID so every IC-01-tagged id (facility/staff/zone)
 *   is schema-valid; it names the GATE-03 fixture facility (packages/domain fixtures have
 *   `fac-demo-1`), so the frozen test tariffs can price demo exits without touching fixture
 *   VALUES — the seeded tariffs remap the facility id to this uuid and keep all values;
 * - tariff VALUES (slabs, repeat, day cap, grace) are copied unmodified from the frozen GATE-03
 *   fixtures; only the demo effective window is widened (2026-01-01 →) so fares price on any
 *   today-like date, and per class exactly the FIRST fixture row is kept so the dev price view
 *   is unambiguous (overlapping windows are a Console-wizard config error in production);
 * - zones/capacities/zonal membership are invented DEMO facility shape (any production zone
 *   layout comes from the wizard) — zone ids are UUIDs because IC-01 ENTRY/ZONE_COUNT payloads
 *   require `zone_id: uuid`;
 * - staff rows carry NO PIN hash parameters at all (IC-06 pending with Akanksha): the verified
 *   part of identity does not exist until then, and the PIN path cannot verify anything without
 *   the agreed hash parameters — login stays verify-free and the dev bypass is explicit. Staff
 *   ids are UUIDs because the IC-01 envelope requires `staff_id: uuid` on every event;
 * - passes are demo rows to exercise the four lookup states (VALID, EXPIRED, NOT_FOUND, DUES).
 */

export type StaffSeed = {
  staffId: string;
  name: string;
  /** GATE-06 role gate + GATE-07 supervisor rule; exact role vocabulary is IC-06/IC-05's owner. */
  role: "GUARD" | "SUPERVISOR";
};

export type GateAppConfig = {
  readonly facilityId: string;
  readonly facilityName: string;
  readonly classes: readonly string[];
  readonly zones: readonly GateZone[];
  /** Live-at-boot dev price view (see header note). */
  readonly tariffs: readonly Tariff[];
  /** Demo pass rows (NOT synced data). */
  readonly passes: readonly PassRow[];
  /** Demo staff (no hashes; IC-06 pending). */
  readonly staff: readonly StaffSeed[];
  /** GATE-06 variance threshold (null → sheet default 0 + reason on any variance). */
  readonly varianceThresholdPaise: number | null;
  /** GATE-08 shift length when unknown (null → zoneReminders default 480). */
  readonly shiftLengthMinutes: number | null;
  /** SYNC-03 version-gate seed used by the status screen + isSyncBlocked. */
  readonly minSupportedVersion: number;
};

/** Consistency problems for the status screen / tests (empty = fine). Surfaced, never hidden. */
export type ConfigIssue =
  | "ZONE_CLASS_UNKNOWN"
  | "CLASS_WITHOUT_ZONE"
  | "TARIFF_FACILITY_MISMATCH"
  | "TARIFF_NOT_EFFECTIVE"
  | "PASS_PLATE_INVALID"
  | "STAFF_ROLE_UNKNOWN";

export function configIssues(config: GateAppConfig, nowIso: string): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const known = new Set(config.classes);
  for (const zone of config.zones) {
    for (const cls of zone.vehicle_class) {
      if (!known.has(cls)) issues.push("ZONE_CLASS_UNKNOWN");
    }
  }
  for (const cls of config.classes) {
    if (!config.zones.some((z) => z.vehicle_class.includes(cls))) issues.push("CLASS_WITHOUT_ZONE");
  }
  for (const tariff of config.tariffs) {
    if (tariff.facilityId !== config.facilityId) issues.push("TARIFF_FACILITY_MISMATCH");
  }
  for (const cls of config.classes) {
    if (tariffForView(config, cls, nowIso) === null) {
      // Not priced at the checked instant: surfaced, not hidden (waive/manager covers exits).
      issues.push("TARIFF_NOT_EFFECTIVE");
    }
  }
  for (const pass of config.passes) {
    const normalized = pass.vehicle_no.replace(/[\s-]/g, "").toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(normalized)) issues.push("PASS_PLATE_INVALID");
  }
  for (const staff of config.staff) {
    if (staff.role !== "GUARD" && staff.role !== "SUPERVISOR") issues.push("STAFF_ROLE_UNKNOWN");
  }
  return issues;
}

/** The demo facility id as a well-known uuid (shared by the seed and the remapped tariffs). */
export const DEMO_FACILITY_ID = "fac11111-0000-7000-8000-000000000001";

/** The DEV seed consumed by PortProvider in dev mode (labeled on every screen that shows it). */
export const DEV_APP_CONFIG: GateAppConfig = {
  // Well-known demo uuid (names the GATE-03 fixture facility; see the header note above).
  facilityId: DEMO_FACILITY_ID,
  facilityName: "Demo facility — DEV SEED, not synced",
  classes: ["Car", "Bike", "Truck"],
  zones: [
    { id: "2b111111-1111-7111-8111-111111111101", vehicle_class: ["Car", "Bike"], capacity: 8 },
    { id: "2b222222-2222-7222-8222-222222222202", vehicle_class: ["Car"], capacity: 10 },
    { id: "2bbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbb303", vehicle_class: ["Truck"], capacity: 4 },
  ],
  tariffs: seedTariffs(),
  passes: [
    {
      id: "38411111-1111-7111-8111-111111111101",
      facility_id: "fac11111-0000-7000-8000-000000000001",
      vehicle_no: "DL01AB1234",
      valid_to: "2027-12-31",
      dues: 0,
    },
    {
      id: "38422222-2222-7222-8222-222222222202",
      facility_id: "fac11111-0000-7000-8000-000000000001",
      vehicle_no: "KA05EF5678",
      valid_to: "2026-10-01",
      dues: 0,
    },
    {
      id: "38433333-3333-7333-8333-333333333303",
      facility_id: "fac11111-0000-7000-8000-000000000001",
      vehicle_no: "HR26DK9090",
      valid_to: "2027-06-30",
      dues: 5000,
    },
  ],
  staff: [
    {
      staffId: "s1a11111-1111-7111-8111-111111111101",
      name: "Demo guard (dev)",
      role: "GUARD",
    },
    {
      staffId: "s2a22222-2222-7222-8222-222222222202",
      name: "Demo supervisor (dev)",
      role: "SUPERVISOR",
    },
  ],
  // Demo facility threshold; the D-table example (T-GATE-06-U3) exercises 500.
  varianceThresholdPaise: 500,
  shiftLengthMinutes: null, // exercise the zoneReminders 480-minute default
  minSupportedVersion: 1,
};

/** Effective tariff for a class at an instant (same rule the exit screen prices with). */
export function tariffForView(
  config: GateAppConfig,
  vehicleClass: string,
  entryAtIso: string,
): Tariff | null {
  try {
    return pickTariffForClass(config.tariffs, vehicleClass, entryAtIso);
  } catch {
    return null;
  }
}

/** Frozen GATE-03 fixture rows for the demo facility, mapped to the live dev price view. */
function seedTariffs(): Tariff[] {
  const rows = fixtureTariffs as unknown as Tariff[];
  const firstPerClass = new Map<string, Tariff>();
  for (const row of rows) {
    if (row.facilityId !== "fac-demo-1") continue;
    if (!firstPerClass.has(row.vehicleClass)) firstPerClass.set(row.vehicleClass, row);
  }
  return [...firstPerClass.values()].map((tariff) => {
    // Window widened + facility-id remapped for the dev view ONLY (fixture dates/id: 2026-11
    // onward, "fac-demo-1"); slab/price VALUES untouched.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { effectiveTo: _dropped, ...rest } = tariff as Partial<Tariff> & Tariff;
    return {
      ...rest,
      effectiveFrom: "2026-01-01",
      facilityId: DEMO_FACILITY_ID,
    };
  });
}
