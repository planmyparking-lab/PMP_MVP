import { describe, expect, it } from "vitest";
import { deviceHealthStatus } from "../src/lib/deviceHealth";
import { can, canMutateEvents, switcherFacilities, type Role } from "../src/lib/permissions";
import { validatePin } from "../src/lib/pinPolicy";
import { canOpenFacility, resolveSessionContext } from "../src/lib/session";
import {
  activationBlockers,
  classesWithoutTariff,
  tariffClassesWithoutZone,
  validateEffectiveFrom,
  validateGraceMinutes,
  capacityWarning,
  dayCapBelowSlab,
  validateNightWindow,
  validateSlabs,
  validateZoneCapacity,
} from "../src/lib/tariffRules";

describe("T-CON-02-U1 PIN policy", () => {
  it.each(["1234", "0000", "1111", "4321", "1234567", "123", "12a4", ""])("rejects %s", (pin) => {
    expect(validatePin(pin).ok).toBe(false);
  });
  it.each(["4826", "12345", "048260"])("accepts %s", (pin) => {
    expect(validatePin(pin)).toEqual({ ok: true });
  });
  it("rejects non-strings and never echoes the PIN", () => {
    expect(validatePin(4826).ok).toBe(false);
    expect(JSON.stringify(validatePin("1111"))).not.toContain("1111");
  });
});

describe("T-CON-02-U2 / X1 permission matrix", () => {
  const roles: Role[] = ["owner", "manager", "guard", "device", "anonymous"];
  it("allows only owner and manager on their own facility", () => {
    for (const role of roles) {
      const allowed = role === "owner" || role === "manager";
      expect(can(role, "view_dashboard", { ownFacility: true })).toBe(allowed);
      expect(can(role, "manage_setup", { ownFacility: false })).toBe(false);
    }
  });
  it("never allows event mutation", () => {
    expect(canMutateEvents()).toBe(false);
  });
  it("switcher: owner all, manager one, others none", () => {
    const m = ["a", "b", "c"];
    expect(switcherFacilities("owner", m)).toEqual(m);
    expect(switcherFacilities("manager", m)).toEqual(["a"]);
    expect(switcherFacilities("guard", m)).toEqual([]);
  });
});

describe("T-CON-01 wizard rules", () => {
  const s = (a: number, b: number, p = 1000) => ({ fromMinute: a, toMinute: b, pricePaise: p });
  it("U1 accepts contiguous slabs", () => {
    expect(validateSlabs([s(0, 60), s(60, 120), s(120, 240)])).toEqual([]);
  });
  it("U2 names a gap and an overlap", () => {
    expect(validateSlabs([s(0, 60), s(90, 120)]).map((p) => p.code)).toEqual(["gap"]);
    expect(validateSlabs([s(0, 90), s(60, 120)]).map((p) => p.code)).toEqual(["overlap"]);
  });
  it("rejects empty, reversed and fractional slabs", () => {
    expect(validateSlabs([s(60, 60)])[0].code).toBe("invalid");
    expect(validateSlabs([s(0, 60, 10.5)])[0].code).toBe("invalid");
  });
  it("flags a day cap below the highest slab", () => {
    expect(dayCapBelowSlab([s(0, 60, 5000)], 4000)).toBe(true);
    expect(dayCapBelowSlab([s(0, 60, 5000)], 5000)).toBe(false);
  });
  it("U3 night window may cross midnight", () => {
    expect(validateNightWindow("22:00", "06:00")).toBe(true);
    expect(validateNightWindow("22:00", "22:00")).toBe(false);
    expect(validateNightWindow("24:00", "06:00")).toBe(false);
  });
  it("U4 capacity must be an integer of at least 1", () => {
    for (const bad of [0, -1, 2.5, "a"]) expect(validateZoneCapacity(bad)).toBe(false);
    expect(validateZoneCapacity(1)).toBe(true);
  });
  it("U5 capacity sum mismatch is a warning only", () => {
    expect(capacityWarning([100, 80], 200)).toMatch(/180/);
    expect(capacityWarning([100, 100], 200)).toBeNull();
  });
});

describe("T-CON-10-U1 device health status", () => {
  const base = {
    queueDepth: 0,
    oldestUnsyncedMinutes: 0,
    heartbeatAgeMinutes: 1,
    duringOpeningHours: true,
  };
  it("queue 200 is not red, 201 is", () => {
    expect(deviceHealthStatus({ ...base, queueDepth: 200 })).not.toBe("red");
    expect(deviceHealthStatus({ ...base, queueDepth: 201 })).toBe("red");
  });
  it("oldest unsynced 29 is not red, 31 is", () => {
    expect(deviceHealthStatus({ ...base, oldestUnsyncedMinutes: 29 })).not.toBe("red");
    expect(deviceHealthStatus({ ...base, oldestUnsyncedMinutes: 31 })).toBe("red");
  });
  it("stale heartbeat is red in opening hours and ignored outside", () => {
    expect(deviceHealthStatus({ ...base, heartbeatAgeMinutes: 31 })).toBe("red");
    expect(
      deviceHealthStatus({ ...base, heartbeatAgeMinutes: 31, duringOpeningHours: false }),
    ).toBe("green");
    expect(deviceHealthStatus({ ...base, heartbeatAgeMinutes: null })).toBe("red");
  });
  it("healthy device is green", () => {
    expect(deviceHealthStatus(base)).toBe("green");
  });
});

describe("T-CON-01 remaining form rules", () => {
  it("grace minutes are whole numbers of 0 or more", () => {
    for (const ok of [0, 15]) expect(validateGraceMinutes(ok)).toBe(true);
    for (const bad of [-1, 1.5, "5", NaN, null]) expect(validateGraceMinutes(bad)).toBe(false);
  });
  it("effective-from may not be in the past", () => {
    expect(validateEffectiveFrom("2026-10-29", "2026-10-29")).toBe(true);
    expect(validateEffectiveFrom("2026-10-30", "2026-10-29")).toBe(true);
    expect(validateEffectiveFrom("2026-10-28", "2026-10-29")).toBe(false);
    expect(validateEffectiveFrom("29-10-2026", "2026-10-29")).toBe(false);
  });
  it("every allowed class needs a tariff, and a tariff needs an allowing zone", () => {
    const zones = [
      { vehicleClass: "CAR" },
      { vehicleClass: "TWO_WHEELER" },
      { vehicleClass: "CAR" },
    ];
    expect(classesWithoutTariff(zones, [{ vehicleClass: "CAR" }])).toEqual(["TWO_WHEELER"]);
    expect(classesWithoutTariff(zones, [])).toEqual(["CAR", "TWO_WHEELER"]);
    expect(tariffClassesWithoutZone([{ vehicleClass: "CAR" }], [{ vehicleClass: "BUS" }])).toEqual([
      "BUS",
    ]);
  });
  it("activation needs steps 1 to 5 valid (T-CON-01-I2)", () => {
    const all = { 1: true, 2: true, 3: true, 4: true, 5: true } as const;
    expect(activationBlockers(all)).toEqual([]);
    expect(activationBlockers({ ...all, 4: false })).toEqual([4]);
  });
});

describe("T-CON-03 session context", () => {
  const m = (role: "owner" | "manager" | "guard", facilityId: string | null, orgId = "o1") => ({
    orgId,
    facilityId,
    role,
  });
  it("denies a user with no console membership, including guards", () => {
    expect(resolveSessionContext([])).toEqual({ access: "denied", reason: "no_access" });
    expect(resolveSessionContext([m("guard", "f1")]).access).toBe("denied");
  });
  it("owner is organisation-wide, manager only on their facility", () => {
    const owner = resolveSessionContext([m("owner", null)]);
    const manager = resolveSessionContext([m("manager", "f1")]);
    expect(canOpenFacility(owner, { id: "f9", orgId: "o1" })).toBe(true);
    expect(canOpenFacility(owner, { id: "f9", orgId: "o2" })).toBe(false);
    expect(canOpenFacility(manager, { id: "f1", orgId: "o1" })).toBe(true);
    expect(canOpenFacility(manager, { id: "f2", orgId: "o1" })).toBe(false);
  });
  it("a manager row with no facility does not open every facility", () => {
    expect(
      canOpenFacility(resolveSessionContext([m("manager", null)]), { id: "f1", orgId: "o1" }),
    ).toBe(false);
  });
  it("a denied context opens nothing", () => {
    expect(canOpenFacility(resolveSessionContext([]), { id: "f1", orgId: "o1" })).toBe(false);
  });
});
