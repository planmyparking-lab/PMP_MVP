import { describe, expect, it } from "vitest";

import { DEV_APP_CONFIG, configIssues, tariffForView } from "../src/data/appConfig";

/**
 * DEV seed honesty (dev-mode config comes from here, never from a synced snapshot): the seed
 * must be internally consistent for the REAL current time (empty issues list) — the frozen
 * GATE-03 fixture windows are widened for the dev view only (documented in the module header).
 */
describe("DEV_APP_CONFIG seed", () => {
  it("is internally consistent at 'now' (no config problems surfaced)", () => {
    expect(configIssues(DEV_APP_CONFIG, "2026-10-25T05:00:00Z")).toEqual([]);
  });

  it("prices every class at now from the frozen fixture values", () => {
    for (const cls of DEV_APP_CONFIG.classes) {
      expect(tariffForView(DEV_APP_CONFIG, cls, "2026-10-25T05:00:00Z")).not.toBeNull();
    }
    const car = tariffForView(DEV_APP_CONFIG, "Car", "2026-10-25T05:00:00Z");
    expect(car?.id).toBe("CAR-A");
    expect(car?.effectiveFrom).toBe("2026-01-01"); // widened window (fixture: 2026-11-01)
  });

  it("flags TARIFF_NOT_EFFECTIVE per class before the widened window (surfaced, not hidden)", () => {
    const issues = configIssues(DEV_APP_CONFIG, "2025-12-31T00:00:00Z");
    expect(issues.filter((issue) => issue === "TARIFF_NOT_EFFECTIVE")).toHaveLength(
      DEV_APP_CONFIG.classes.length,
    );
    expect(tariffForView(DEV_APP_CONFIG, "Car", "2025-12-31T00:00:00Z")).toBeNull();
  });

  it("carries the demo facility's demo-only surfaces", () => {
    // Well-known demo uuid: every IC-01 envelope field (facility_id) must be a uuid.
    expect(DEV_APP_CONFIG.facilityId).toBe("fac11111-0000-7000-8000-000000000001");
    expect(DEV_APP_CONFIG.classes).toEqual(["Car", "Bike", "Truck"]);
    expect(DEV_APP_CONFIG.zones.map((zone) => zone.id)).toEqual([
      "2b111111-1111-7111-8111-111111111101",
      "2b222222-2222-7222-8222-222222222202",
      "2bbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbb303",
    ]);
    expect(DEV_APP_CONFIG.varianceThresholdPaise).toBe(500);
    expect(DEV_APP_CONFIG.shiftLengthMinutes).toBeNull(); // exercise the 480 default
    expect(DEV_APP_CONFIG.minSupportedVersion).toBe(1);
    expect(DEV_APP_CONFIG.passes.map((pass) => pass.vehicle_no)).toEqual([
      "DL01AB1234",
      "KA05EF5678",
      "HR26DK9090",
    ]);
    expect(
      DEV_APP_CONFIG.staff.every((staff) => staff.role === "GUARD" || staff.role === "SUPERVISOR"),
    ).toBe(true);
  });
});
