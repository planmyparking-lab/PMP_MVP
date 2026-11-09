/** CON-09: smallest overstay threshold a facility may configure, in minutes. */
export const MIN_OVERSTAY_MINUTES = 30;

export type OverstayCheck = { ok: true; minutes: number } | { ok: false; message: string };

/** Validates a configured overstay threshold (whole minutes, at least 30). */
export function validateOverstayMinutes(minutes: unknown): OverstayCheck {
  if (typeof minutes !== "number" || !Number.isInteger(minutes)) {
    return { ok: false, message: "Enter a whole number of minutes." };
  }
  if (minutes < MIN_OVERSTAY_MINUTES) {
    return {
      ok: false,
      message: `The threshold must be at least ${MIN_OVERSTAY_MINUTES} minutes.`,
    };
  }
  return { ok: true, minutes };
}

/**
 * CON-09 evaluation of open sessions against a threshold. The inputs mirror what `open_sessions` holds
 * (`entry_time`, `pass_id`; migration 0005). `toOpenSessionLike` in `openSessions.ts` converts a row.
 *
 * OQ-46 (resolved by Afzal in the PR #23 review): a session exactly at the threshold counts ("at or over", as in
 * T-CLD-07-U1), and there is one threshold per facility for now; per-vehicle-class is a later version.
 */
export interface OpenSessionLike {
  sessionId: string;
  /** device_time of the ENTRY event: ISO 8601 with Z or an offset. */
  entryTime: string;
  /** Pass holders are excluded from overstay (CON-09 rules). */
  passId?: string | null;
}

export interface OverstayRow {
  sessionId: string;
  entryTime: string;
  ageMinutes: number;
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function instantMs(value: string): number {
  const ms = INSTANT.test(value) ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(ms)) {
    throw new RangeError(`Invalid instant (expected ISO 8601 with Z or an offset): ${value}`);
  }
  return ms;
}

/** Whole minutes elapsed since entry (rounded down). A clock that is behind the entry time gives 0, never negative. */
export function sessionAgeMinutes(entryTime: string, nowIso: string): number {
  return Math.max(0, Math.floor((instantMs(nowIso) - instantMs(entryTime)) / 60_000));
}

/** At or over the threshold (OQ-46). The threshold must already be valid (see validateOverstayMinutes). */
export function isOverstay(ageMinutes: number, thresholdMinutes: number): boolean {
  const check = validateOverstayMinutes(thresholdMinutes);
  if (!check.ok) throw new RangeError(check.message);
  return ageMinutes >= thresholdMinutes;
}

/** Open sessions at or over the threshold, oldest first. Pass sessions are left out. */
export function findOverstays(
  sessions: readonly OpenSessionLike[],
  nowIso: string,
  thresholdMinutes: number,
): OverstayRow[] {
  return sessions
    .filter((s) => !s.passId)
    .map((s) => ({
      sessionId: s.sessionId,
      entryTime: s.entryTime,
      ageMinutes: sessionAgeMinutes(s.entryTime, nowIso),
    }))
    .filter((row) => isOverstay(row.ageMinutes, thresholdMinutes))
    .sort((a, b) => b.ageMinutes - a.ageMinutes);
}
