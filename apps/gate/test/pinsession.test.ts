import { describe, expect, it } from "vitest";

import {
  createLockoutRecord,
  isLocked,
  lockRemainingMs,
  recordFailedAttempt,
  type LockoutRecord,
} from "../src/auth/lockout";
import {
  LOGIN_STALENESS_MS,
  loginStalenessGate,
  persistableLockout,
  pinShapeError,
  restoredLockout,
} from "../src/auth/pinSession";

/**
 * GATE-09 persistence + staleness rules (T-GATE-09 style): PIN shape, the 14-day sync-staleness
 * gate (U6), the wall-terms lockout record (restart-survivable) and its rollback rule (U5 — a
 * backwards wall clock never shortens a lock; the promised remainder is re-served).
 */

const DAY_MS = 24 * 60 * 60_000;
const BASE = 10_000;

function lockedRecord(fails = 5, at = BASE): LockoutRecord {
  let record: LockoutRecord = createLockoutRecord();
  for (let i = 0; i < fails; i += 1) record = recordFailedAttempt(record, at + i);
  return record;
}

describe("loginStalenessGate (T-GATE-09-U6 style)", () => {
  const now = 1_900_000_000_000; // fixed "today"

  it("refuses never-synced and corrupt stamps", () => {
    expect({ ...loginStalenessGate(null, now) }).toEqual({
      ok: false,
      reason: "NEVER_SYNCED",
      daysOld: 0,
    });
    expect({ ...loginStalenessGate("not-a-date", now) }).toEqual({
      ok: false,
      reason: "NEVER_SYNCED",
      daysOld: 0,
    });
  });

  it("accepts a fresh-enough sync and refuses beyond 14 days", () => {
    expect(loginStalenessGate(new Date(now - 13 * DAY_MS).toISOString(), now)).toEqual({
      ok: true,
    });
    const stale = loginStalenessGate(new Date(now - (LOGIN_STALENESS_MS + 1)).toISOString(), now);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toBe("STALE");
      expect(Math.floor(stale.daysOld)).toBe(14);
    }
  });
});

describe("pinShapeError (rule 7)", () => {
  it("takes 4-6 digits only", () => {
    expect(pinShapeError("123")).toBe("TOO_SHORT");
    expect(pinShapeError("1234")).toBeNull();
    expect(pinShapeError("123456")).toBeNull();
    expect(pinShapeError("1234567")).toBe("TOO_LONG");
    expect(pinShapeError("12a4")).toBe("NOT_DIGITS");
    expect(pinShapeError("")).toBe("NOT_DIGITS");
  });
});

describe("persistableLockout + restoredLockout (T-GATE-09-U5 wall-pair rules)", () => {
  const record = lockedRecord();
  const remainingMs = lockRemainingMs(record, BASE + 10);

  it("refuses to persist an unlocked record", () => {
    expect(persistableLockout(createLockoutRecord(), 0, Date.now())).toBeNull();
  });

  it("expresses the lock's promised remainder in wall terms at save time", () => {
    const persisted = persistableLockout(record, BASE + 10, 950_000);
    expect(persisted).toEqual({
      failCount: 5,
      lockEndWallMs: 950_000 + remainingMs,
      wallSampleMs: 950_000,
    });
  });

  it("persists sub-limit failures and restores them across a restart", () => {
    let record: LockoutRecord = createLockoutRecord();
    for (let i = 0; i < 3; i += 1) record = recordFailedAttempt(record, BASE + i);

    const persisted = persistableLockout(record, BASE + 3, 950_000);
    expect(persisted).toEqual({
      failCount: 3,
      lockEndWallMs: null,
      wallSampleMs: 950_000,
    });
    expect(persisted).not.toBeNull();
    if (persisted === null) return;

    const restored = restoredLockout(persisted, 42_000, 950_500);
    expect(restored.record).toEqual({ failCount: 3, lockEndElapsedMs: null });
    let afterRestart = recordFailedAttempt(restored.record, 42_001);
    afterRestart = recordFailedAttempt(afterRestart, 42_002);
    expect(afterRestart.failCount).toBe(5);
    expect(isLocked(afterRestart, 42_002)).toBe(true);
  });

  it("restores the same remainder onto a new session's monotonic clock", () => {
    const persisted = persistableLockout(record, BASE + 10, 950_000);
    expect(persisted).not.toBeNull();
    if (persisted === null || persisted.lockEndWallMs === null) return;
    const restored = restoredLockout(persisted, 42_000, 950_500);
    expect(restored.rollbackDetected).toBe(false);
    expect(restored.record.failCount).toBe(5);
    expect(restored.record.lockEndElapsedMs).toBe(42_000 + (persisted.lockEndWallMs - 950_500));
    expect(isLocked(restored.record, 43_000)).toBe(true);
  });

  it("serves the full promised remainder after a wall-clock rollback (U5)", () => {
    const persisted = persistableLockout(record, BASE + 10, 950_000);
    expect(persisted).not.toBeNull();
    if (
      persisted === null ||
      persisted.lockEndWallMs === null ||
      record.lockEndElapsedMs === null
    ) {
      return;
    }
    // Wall went backwards BELOW the save sample: the lock may not be cut short.
    const restored = restoredLockout(persisted, 42_000, 900_000);
    expect(restored.rollbackDetected).toBe(true);
    expect(restored.record.lockEndElapsedMs).toBe(
      42_000 + (persisted.lockEndWallMs - persisted.wallSampleMs),
    );
    expect(lockRemainingMs(restored.record, 42_000)).toBe(record.lockEndElapsedMs - (BASE + 10));
  });

  it("lands on ground state when the lock expired while closed (counter served)", () => {
    const persisted = persistableLockout(record, BASE + 10, 950_000);
    expect(persisted).not.toBeNull();
    if (persisted === null || persisted.lockEndWallMs === null) return;
    const restored = restoredLockout(persisted, 42_000, persisted.lockEndWallMs + 1);
    expect(restored.record).toEqual(createLockoutRecord());
    expect(restored.rollbackDetected).toBe(false);
  });

  it("absent storage → ground state", () => {
    expect(restoredLockout(null, 0, 0)).toEqual({
      record: createLockoutRecord(),
      rollbackDetected: false,
    });
  });
});
