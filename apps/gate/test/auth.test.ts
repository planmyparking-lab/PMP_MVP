import { describe, expect, it } from "vitest";

import {
  LOCKOUT_DURATION_MS,
  LOCKOUT_MAX_FAILS,
  createLockoutRecord,
  isLocked,
  lockRemainingMs,
  recordFailedAttempt,
  recordSuccessfulLogin,
} from "../src/auth/lockout";
import {
  BANNER_THRESHOLDS,
  MAX_VISIBLE_BANNERS,
  deriveBanners,
  visibleBanners,
} from "../src/ui/deriveBanners";
import type { HealthSnapshot } from "../src/data/ic02";

/**
 * Pure-rule tests for GATE-09 lockout (T-GATE-09-U3/U5 style) and GATE-12 banners
 * (SYNC-06 threshold table). verifyPin itself is pending the IC-06 hash agreement with
 * Akanksha — see the module docs.
 */

const BASE = 1000; // monotonic-ish elapsed baseline for the fake clock

function healthy(): HealthSnapshot {
  return {
    queueDepth: 0,
    oldestUnsyncedAgeMs: 0,
    lastSyncAt: null,
    online: true,
    quarantinedCount: 0,
    syncBlocked: false,
  };
}

describe("lockout (T-GATE-09-U3/U5)", () => {
  it("locks after the 5th wrong attempt and unlocks after 5 minutes", () => {
    let record = createLockoutRecord();
    for (let i = 1; i <= 4; i += 1) {
      record = recordFailedAttempt(record, BASE + i);
      expect(isLocked(record, BASE + i)).toBe(false);
      expect(record.failCount).toBe(i);
    }
    record = recordFailedAttempt(record, BASE + 5);
    expect(record.failCount).toBe(LOCKOUT_MAX_FAILS);
    expect(isLocked(record, BASE + 5)).toBe(true);
    expect(lockRemainingMs(record, BASE + 5)).toBe(LOCKOUT_DURATION_MS);
    // unlocked exactly at the end (half-open window like everything else in this repo)
    expect(isLocked(record, BASE + 5 + LOCKOUT_DURATION_MS)).toBe(false);
    expect(lockRemainingMs(record, BASE + 5 + LOCKOUT_DURATION_MS)).toBe(0);
  });

  it("success resets the counter immediately", () => {
    let record = createLockoutRecord();
    record = recordFailedAttempt(record, BASE + 1);
    record = recordFailedAttempt(record, BASE + 2);
    expect(record.failCount).toBe(2);
    record = recordSuccessfulLogin();
    expect(record).toEqual(createLockoutRecord());
    // two more failures after a success must NOT lock until 5 consecutive
    record = recordFailedAttempt(record, BASE + 3);
    record = recordFailedAttempt(record, BASE + 4);
    expect(isLocked(record, BASE + 5)).toBe(false);
  });

  it("a failure after the lock expired starts a fresh counter", () => {
    let record = createLockoutRecord();
    for (let i = 0; i < 5; i += 1) record = recordFailedAttempt(record, BASE + i);
    expect(isLocked(record, BASE + 4)).toBe(true);
    // after lock expiry a new failure counter restarts at 1
    record = recordFailedAttempt(record, BASE + 5 + LOCKOUT_DURATION_MS + 1);
    expect(record.failCount).toBe(1);
    expect(record.lockEndElapsedMs).toBeNull();
  });

  it("a backwards clock movement never shortens the lock (T-GATE-09-U5)", () => {
    let record = createLockoutRecord();
    for (let i = 0; i < 5; i += 1) record = recordFailedAttempt(record, BASE + i);
    const end = record.lockEndElapsedMs as number;
    // elapsed reads jumping backwards stay locked
    expect(isLocked(record, end - 1000)).toBe(true);
    expect(isLocked(record, Math.max(0, BASE - 5000))).toBe(true);
  });

  it("a failed attempt during an active lock cannot extend or alter the lock", () => {
    let record = createLockoutRecord();
    for (let i = 0; i < LOCKOUT_MAX_FAILS; i += 1) {
      record = recordFailedAttempt(record, BASE + i);
    }
    const activeLock = record;
    record = recordFailedAttempt(record, BASE + 1000);
    expect(record).toBe(activeLock);
    expect(record.lockEndElapsedMs).toBe(BASE + 4 + LOCKOUT_DURATION_MS);
  });
});

describe("banner derivation (GATE-12 + SYNC-06 thresholds)", () => {
  const deviceDefaults = {
    offlineForMs: 0,
    batteryPercent: 80,
    freeStorageMb: 2000,
    clockSkewMs: 0,
  };

  it("offline only shows after the 10-second grace", () => {
    const offline = { ...healthy(), online: false };
    expect(deriveBanners(offline, { ...deviceDefaults, offlineForMs: 9_999 })).toEqual([]);
    const banners = deriveBanners(offline, { ...deviceDefaults, offlineForMs: 10_000 });
    expect(banners.map((b) => b.kind)).toEqual(["OFFLINE"]);
  });

  it("old queue needs online AND at least 30 minutes unsynced", () => {
    const old = { ...healthy(), oldestUnsyncedAgeMs: BANNER_THRESHOLDS.queueAgeSupervisorMs };
    expect(deriveBanners(old, deviceDefaults).map((b) => b.kind)).toEqual(["QUEUE_OLD"]);
    const offlineOld = { ...old, online: false };
    expect(deriveBanners(offlineOld, deviceDefaults).map((b) => b.kind)).toEqual([]);
  });

  it("syncBlocked wins over offline (the update banner is the actionable one)", () => {
    const blocked = { ...healthy(), syncBlocked: true, online: false };
    const banners = deriveBanners(blocked, { ...deviceDefaults, offlineForMs: 60_000 });
    expect(banners.map((b) => b.kind)).toEqual(["OLD_BUILD"]);
  });

  it("battery, storage and skew thresholds fire at the documented bounds", () => {
    const low = {
      ...deviceDefaults,
      batteryPercent: 14,
      freeStorageMb: 299,
      clockSkewMs: 5 * 60_000 + 1,
    };
    expect(deriveBanners(healthy(), low).map((b) => b.kind)).toEqual([
      "LOW_BATTERY",
      "LOW_STORAGE",
      "CLOCK_SKEW",
    ]);
    const at15 = {
      ...deviceDefaults,
      batteryPercent: 15,
      freeStorageMb: 300,
      clockSkewMs: 5 * 60_000,
    };
    expect(deriveBanners(healthy(), at15)).toEqual([]);
  });

  it("limits visible banners to the highest-priority two", () => {
    const banners = deriveBanners(healthy(), {
      ...deviceDefaults,
      batteryPercent: 10,
      freeStorageMb: 100,
      clockSkewMs: BANNER_THRESHOLDS.clockSkewMs + 1,
    });
    expect(banners).toHaveLength(3);
    expect(visibleBanners(banners)).toEqual(banners.slice(0, MAX_VISIBLE_BANNERS));
    expect(visibleBanners(banners).map((banner) => banner.kind)).toEqual([
      "LOW_BATTERY",
      "LOW_STORAGE",
    ]);
  });

  it("dismisses only the selected active banner before applying the existing two-banner cap", () => {
    const banners = deriveBanners(healthy(), {
      ...deviceDefaults,
      batteryPercent: 10,
      freeStorageMb: 100,
      clockSkewMs: BANNER_THRESHOLDS.clockSkewMs + 1,
    });
    expect(visibleBanners(banners, ["LOW_BATTERY"])).toEqual(banners.slice(1, 3));
    expect(visibleBanners(banners, ["LOW_BATTERY", "LOW_STORAGE"])).toEqual([banners[2]]);
  });
});
