/**
 * Open-session lookup for the exit screen (GATE-02 sequence 4.2, tests T-GATE-02-U3/E3/E4/N1).
 *
 * Search paths from the sheet: by short code, by plate, or by vehicle class plus an entry-time
 * window ("default: last 6 hours, adjustable"). One match, many matches (list), or none.
 *
 * The merged IC-01 `ENTRY` payload carries class, zone, short code and (optional) plate, so the
 * searchable attributes are representable in stored events; the entry instant is the envelope's
 * `device_time`. This module is nevertheless parametric: it takes `OpenSessionRecord` view inputs
 * that the caller builds from IC-02's read surface (FakeSync's local view today, the synced
 * `open_sessions` snapshot / an events read from Afzal once OQ-45 is resolved). No rule here
 * touches the IC-01 schema, so it needs no contract change.
 *
 * Inputs are pre-normalized: the screen normalizes typed short codes with
 * `normalizeShortCode` (token.ts) and plates with `normalizeVehicleNo` (plates.ts) BEFORE calling,
 * so a non-normalizable input is a screen-level error, not a lookup outcome. Lookup itself does
 * exact comparisons. Lossy normalization here would silently swallow "wrong" codes as "not found".
 */

/** A locally visible open session: synced snapshot (Afzal, SYNC-03) plus this device's own
 * entries. `enteredAt` is the session's ENTRY instant (UTC ISO). */
export type OpenSessionRecord = {
  sessionId: string;
  shortCode: string;
  vehicleClass: string;
  /** Normalized plate when one was recorded (mandatory for pass holders, not required otherwise). */
  vehicleNo?: string | null;
  enteredAt: string;
  zoneId?: string;
};

/** One match, many (sorted by entry time, oldest first, per T-GATE-02-E4 "list sorted by entry
 * time"), or none. */
export type FindOutcome =
  | { kind: "one"; session: OpenSessionRecord }
  | { kind: "many"; sessions: OpenSessionRecord[] }
  | { kind: "none" };

/** Default lost-token window from the sheet (GATE-02 expected behaviour): last 6 hours. */
export const DEFAULT_WINDOW_MINUTES = 360;

function oneOrMany(sessions: OpenSessionRecord[]): FindOutcome {
  if (sessions.length === 0) return { kind: "none" };
  if (sessions.length === 1) return { kind: "one", session: sessions[0] as OpenSessionRecord };
  return { kind: "many", sessions: [...sessions] };
}

/**
 * Exact match on an already-normalized 5-char Crockford short code. A duplicate short code
 * among open sessions must not happen (acceptance criterion GATE-01 (d)); if data is corrupted
 * and two sessions share a code, the outcome is `many` (screen shows the list) rather than an
 * arbitrary pick.
 */
export function findSessionByShortCode(
  normalizedShortCode: string,
  sessions: readonly OpenSessionRecord[],
): FindOutcome {
  return oneOrMany(sessions.filter((s) => s.shortCode === normalizedShortCode));
}

/** Exact match on a normalized plate (only recorded plates can match; entry allowed plateless). */
export function findSessionByPlate(
  normalizedVehicleNo: string,
  sessions: readonly OpenSessionRecord[],
): FindOutcome {
  return oneOrMany(sessions.filter((s) => s.vehicleNo === normalizedVehicleNo));
}

/**
 * Lost-token path: same class, entered within the window ending at `nowIso` (inclusive). The
 * window is `windowMinutes` back from now (default 360; the sheet allows adjusting it).
 * Results are sorted by ascended entry time, oldest first, so a human scanning the list reads
 * natural chronological order. Future-dated entries (skewed clock) fall outside the window;
 * the CLOCK_SKEW hint is a screen/banner concern (GATE-02 rule 8 / GATE-12).
 */
export function findSessionsByClassWindow(
  vehicleClass: string,
  sessions: readonly OpenSessionRecord[],
  nowIso: string,
  windowMinutes: number = DEFAULT_WINDOW_MINUTES,
): FindOutcome {
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(nowMs) || !Number.isFinite(windowMinutes) || windowMinutes < 0) {
    return { kind: "none" }; // fail closed: garbage inputs never match
  }
  const fromMs = nowMs - windowMinutes * 60_000;
  const matches = sessions
    .filter((s) => s.vehicleClass === vehicleClass)
    .filter((s) => {
      const entered = Date.parse(s.enteredAt);
      return !Number.isNaN(entered) && entered >= fromMs && entered <= nowMs;
    })
    .sort((a, b) => Date.parse(a.enteredAt) - Date.parse(b.enteredAt));
  return oneOrMany(matches);
}
