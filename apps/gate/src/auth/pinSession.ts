import { createLockoutRecord, isLocked, lockRemainingMs, type LockoutRecord } from "./lockout";
import type { SecureKv } from "./secureIdentity";

/**
 * PIN-login session rules (GATE-09 sequences 6-7; D.9-U3/U4/U5/U6) — the pure half. The device
 * half (SecureStore adapter wiring) lives in the PortProvider; this module never touches PIN
 * material and never reads a clock.
 *
 * - Staleness gate (U6): `lastSyncAt` older than 14 days refuses login with an explanation; a
 *   device that has never synced is refused even harder (the sheet: initial sync must arrive
 *   once before the login screen unlocks).
 * - PIN shape (rule 7): 4 to 6 digits at entry. The Console enforces the same at set time — the
 *   shape check filters impossible submissions early, it does NOT verify anything.
 * - Lockout persistence (U4/U5): the LockoutRecord in lockout.ts is expressed on a monotonic
 *   clock, which does not exist across process restarts. The persisted form therefore records
 *   the lock end AND the wall-clock sample at save time:
 *
 *       remaining-at-load ≈ lockEndWall − wallNow          (normal path)
 *       wallNow < wallSample  → clock moved BACKWARDS → still locked for the stored remaining
 *                               (counted from the sample: rollback cannot shorten a lock)
 *
 *   The restored remaining is mapped back onto the in-session monotonic clock so lockout.ts's
 *   semantics (failCount expiry → fresh counter, monotonic lockEnd) stay the single authority.
 *   Pure and injectable for the D.15 fake-clock rule.
 */

const DAY_MS = 24 * 60 * 60_000;

/** GATE-09 rule 2: 14-day unsynced device refuses login (S). */
export const LOGIN_STALENESS_MS = 14 * DAY_MS;

export type LoginStaleness =
  { ok: true } | { ok: false; reason: "NEVER_SYNCED" | "STALE"; daysOld: number };

export function loginStalenessGate(lastSyncAt: string | null, nowMs: number): LoginStaleness {
  if (lastSyncAt === null) return { ok: false, reason: "NEVER_SYNCED", daysOld: 0 };
  const ms = Date.parse(lastSyncAt);
  if (Number.isNaN(ms)) return { ok: false, reason: "NEVER_SYNCED", daysOld: 0 }; // corrupt: refuse
  const daysOld = (nowMs - ms) / DAY_MS;
  if (daysOld > 14) return { ok: false, reason: "STALE", daysOld };
  return { ok: true };
}

/** PIN shape at entry (rule 7): 4..6 digits; null when the shape is acceptable. */
export function pinShapeError(pin: string): "TOO_SHORT" | "TOO_LONG" | "NOT_DIGITS" | null {
  if (typeof pin !== "string") return "NOT_DIGITS";
  if (!/^\d+$/.test(pin)) return "NOT_DIGITS";
  if (pin.length < 4) return "TOO_SHORT";
  if (pin.length > 6) return "TOO_LONG";
  return null;
}

export type PersistedLockout = {
  failCount: number;
  /** Absolute wall end of the lock (epoch ms); null while failures have not reached the limit. */
  lockEndWallMs: number | null;
  /** Wall sample at save; rollback detection anchor (U5). */
  wallSampleMs: number;
};

/** Express the in-session monotonic record in restart-survivable wall terms, at save time. */
export function persistableLockout(
  record: LockoutRecord,
  elapsedMsNow: number,
  wallNowMs: number,
): PersistedLockout | null {
  if (record.failCount <= 0) return null;
  const locked = isLocked(record, elapsedMsNow);
  if (record.lockEndElapsedMs !== null && !locked) return null;
  const remaining = locked ? lockRemainingMs(record, elapsedMsNow) : null;
  return {
    failCount: record.failCount,
    lockEndWallMs: remaining === null ? null : wallNowMs + remaining,
    wallSampleMs: wallNowMs,
  };
}

export type RestoredLockout = { record: LockoutRecord; rollbackDetected: boolean };

export type LockoutStorage = Pick<SecureKv, "get" | "set"> & {
  delete(key: string): Promise<void>;
};

export type LockoutLoadResult =
  { ok: true; value: RestoredLockout } | { ok: false; reason: "STORAGE_UNAVAILABLE" | "CORRUPTED" };

function isPersistedLockout(value: unknown): value is PersistedLockout {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const failCount = candidate.failCount;
  const wallSampleMs = candidate.wallSampleMs;
  const lockEndWallMs = candidate.lockEndWallMs;
  if (
    typeof failCount !== "number" ||
    !Number.isInteger(failCount) ||
    failCount < 1 ||
    failCount > 5 ||
    typeof wallSampleMs !== "number" ||
    !Number.isFinite(wallSampleMs)
  ) {
    return false;
  }
  return failCount < 5
    ? lockEndWallMs === null
    : typeof lockEndWallMs === "number" && Number.isFinite(lockEndWallMs);
}

/** Read lockout state without conflating a missing record with a failed or corrupt read. */
export async function loadPersistedLockout(
  storage: Pick<SecureKv, "get">,
  key: string,
  elapsedMsNow: number,
  wallNowMs: number,
): Promise<LockoutLoadResult> {
  let raw: string | null;
  try {
    raw = await storage.get(key);
  } catch {
    return { ok: false, reason: "STORAGE_UNAVAILABLE" };
  }
  if (raw === null) {
    return { ok: true, value: restoredLockout(null, elapsedMsNow, wallNowMs) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "CORRUPTED" };
  }
  if (!isPersistedLockout(parsed)) return { ok: false, reason: "CORRUPTED" };

  return {
    ok: true,
    value: restoredLockout(parsed, elapsedMsNow, wallNowMs),
  };
}

/** Persist a lockout record; storage failures are deliberately allowed to reach the caller. */
export async function savePersistedLockout(
  storage: LockoutStorage,
  key: string,
  record: LockoutRecord,
  elapsedMsNow: number,
  wallNowMs: number,
): Promise<PersistedLockout | null> {
  const persisted = persistableLockout(record, elapsedMsNow, wallNowMs);
  if (persisted === null) {
    await storage.delete(key);
    if ((await storage.get(key)) !== null) {
      throw new Error("Lockout reset did not persist");
    }
  } else {
    const serialized = JSON.stringify(persisted);
    await storage.set(key, serialized);
    if ((await storage.get(key)) !== serialized) {
      throw new Error("Lockout state did not persist");
    }
  }
  return persisted;
}

/** Map a persisted record back onto the in-session monotonic clock (at load time). */
export function restoredLockout(
  persisted: PersistedLockout | null,
  elapsedMsNow: number,
  wallNowMs: number,
): RestoredLockout {
  if (persisted === null) return { record: createLockoutRecord(), rollbackDetected: false };
  if (
    !Number.isInteger(persisted.failCount) ||
    persisted.failCount < 1 ||
    persisted.failCount > 5 ||
    !Number.isFinite(persisted.wallSampleMs) ||
    (persisted.failCount < 5 && persisted.lockEndWallMs !== null) ||
    (persisted.failCount === 5 &&
      (persisted.lockEndWallMs === null || !Number.isFinite(persisted.lockEndWallMs)))
  ) {
    throw new Error("Invalid persisted lockout record");
  }
  if (persisted.lockEndWallMs === null) {
    return {
      record: { failCount: persisted.failCount, lockEndElapsedMs: null },
      rollbackDetected: false,
    };
  }
  const rollback = wallNowMs < persisted.wallSampleMs;
  // Rollback: count the lock from the sample forward (the remaining the record promised).
  const remaining = rollback
    ? persisted.lockEndWallMs - persisted.wallSampleMs
    : persisted.lockEndWallMs - wallNowMs;
  if (remaining <= 0) {
    // Lock expired while the app was closed: counter resets (lock served; next failure starts 1).
    return { record: createLockoutRecord(), rollbackDetected: rollback };
  }
  return {
    record: { failCount: persisted.failCount, lockEndElapsedMs: elapsedMsNow + remaining },
    rollbackDetected: rollback,
  };
}
