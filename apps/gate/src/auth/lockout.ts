/**
 * PIN lockout rules (GATE-09 sequence 5, tests T-GATE-09-U3/U5; the R file `src/auth/lockout.ts`).
 *
 * Sheet rules: five wrong tries lock the device for 5 minutes; the counter resets on success;
 * the state survives app restarts (the caller persists this plain record in secure storage,
 * keyed by device — never MMKV). Edge case 10: store the lock end as a MONOTONIC elapsed value
 * plus wall time so clock tampering cannot shorten a lockout; if the elapsed source moves
 * backwards the lock simply holds (still locked, U5).
 *
 * Pure state-over-record module: no secure-store import, no Date.now — the caller supplies an
 * injected monotonic clock (`elapsedMs()`), following the D.15 fake-clock convention. PIN
 * verification itself (`verifyPin`) stays outside this module: the hash algorithm/parameters
 * are agreed with Akanksha in IC-06 (PBKDF2 or scrypt via a vetted library) and are not decided
 * yet, so there is nothing correct to compare against — this file never touches PIN material.
 */

export const LOCKOUT_MAX_FAILS = 5;
export const LOCKOUT_DURATION_MS = 5 * 60_000;

export type LockoutRecord = {
  failCount: number;
  /** Monotonic-elapsed unlock time; null while not locked. */
  lockEndElapsedMs: number | null;
};

export function createLockoutRecord(): LockoutRecord {
  return { failCount: 0, lockEndElapsedMs: null };
}

/** One more wrong attempt: on the 5th consecutive failure the 5-minute lock starts. */
export function recordFailedAttempt(record: LockoutRecord, elapsedMsNow: number): LockoutRecord {
  if (isLocked(record, elapsedMsNow)) return record;
  const failCount =
    record.lockEndElapsedMs !== null && elapsedMsNow >= record.lockEndElapsedMs
      ? 1 // lock expired, then another failure: fresh counter (sheet: unlocked after 5 min)
      : record.failCount + 1;
  if (failCount < LOCKOUT_MAX_FAILS) {
    return { failCount, lockEndElapsedMs: null };
  }
  return { failCount, lockEndElapsedMs: elapsedMsNow + LOCKOUT_DURATION_MS };
}

/** Successful login clears the counter (rule 5). */
export function recordSuccessfulLogin(): LockoutRecord {
  return createLockoutRecord();
}

export function isLocked(record: LockoutRecord, elapsedMsNow: number): boolean {
  if (record.lockEndElapsedMs === null) return false;
  // Backwards clock-jumps cannot shorten the lock: any elapsed read below the end stays locked.
  return elapsedMsNow < record.lockEndElapsedMs;
}

/** Remaining lock time in ms (screen shows the remaining time on failure, rule 9). */
export function lockRemainingMs(record: LockoutRecord, elapsedMsNow: number): number {
  if (!isLocked(record, elapsedMsNow)) return 0;
  return (record.lockEndElapsedMs as number) - elapsedMsNow;
}
