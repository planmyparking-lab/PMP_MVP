// Occupancy per zone (SYNC-04). Pure function, no I/O. Counts are always derived from records, never stored as an
// incremented counter, so a lost or repeated update cannot make them drift.
//
// With a physical ZONE_COUNT baseline for a zone: count = counted + entries after the baseline - exits after it,
// where a session is subtracted once its EARLIEST known exit (local EXIT event, or a closedSessions report, from
// either side of a sync — see ClosedSession) is after the baseline, whichever source that earliest exit comes
// from. A session's zone is always the one from a known ENTRY (open_sessions or a local event) when there is one;
// a closedSessions record never overrides it, only supplies the exit time (or, for a session never seen locally
// at all, the zone too, since it is then the only source).
// Without a baseline: count = sessions with a known ENTRY (open_sessions, local, or closedSessions-only) and no
// known exit yet, from either source.
// Sessions are matched by session id and events by event id, so the same record seen twice (open_sessions and the
// local store, or a re-sent event) is counted once, and the result does not depend on the order of the input arrays.
// Every timestamp-bearing input (local events, open_sessions entries, ZONE_COUNT baselines, closed sessions) is held
// to the same future-tolerance guard: none is a trusted exception.
import type { Event } from "@pmp/contracts";

/** Maximum a device clock may run ahead of the receiving clock before its events are ignored (SYNC-04, 5 minutes). */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;
/** A baseline older than this is reported as stale. */
export const DEFAULT_STALE_BASELINE_MS = 24 * 3_600_000;
/** Console flags a zone when the physical count differs from the system count by more than 3% (Phase 2 plan). */
export const DRIFT_FLAG_RATIO = 0.03;

export interface ZoneConfig {
  id: string;
  capacity: number;
}

/** A row of the synced open_sessions table. */
export interface OpenSessionRow {
  sessionId: string;
  zoneId: string;
  /** device_time of the ENTRY, UTC ISO. */
  entryTime: string;
}

/** A ZONE_COUNT event (synced or local). */
export interface ZoneCountRecord {
  id: string;
  zoneId: string;
  counted: number;
  systemCountAtTime: number;
  /** device_time, UTC ISO. */
  deviceTime: string;
}

/**
 * A session known to have closed, reported by any device (OQ-16 amendment). A baseline-branch exit used to be
 * subtracted only when the session was still in the open_sessions snapshot plus local ENTRY events — but
 * 0005_open_sessions.sql deletes the row on EXIT, and a cross-device exit never reaches this device's local events.
 * Without this input, such an exit is silently never subtracted and the baseline stays stale-high forever, not just
 * until the next sync (see CLAUDE.md's occupancy rule). This is download sync (SYNC-03), which does not exist yet:
 * pass [] until it does. It is wired here so the fix needs no further API change once SYNC-03 lands.
 *
 * Takes effect for a session entered either before the baseline (part of its physical count) or locally after it
 * (added to `entered`); either way, whichever of the local EXIT event and this record reports the earlier exit
 * decides when the session closed, so a later or duplicate report from either source is always inert.
 */
export interface ClosedSession {
  sessionId: string;
  zoneId: string;
  /** device_time of the ENTRY, UTC ISO. */
  entryTime: string;
  /** device_time of the EXIT, UTC ISO. */
  exitTime: string;
}

export type OccupancyWarningKind =
  "NEGATIVE" | "OVER_CAPACITY" | "STALE_BASELINE" | "ORPHAN_EXIT" | "FUTURE_EVENT_IGNORED";

export interface OccupancyWarning {
  /** null when the zone cannot be known (an orphan exit has no zone). */
  zoneId: string | null;
  kind: OccupancyWarningKind;
  /** Event or session the warning is about, when there is one. */
  ref?: string;
}

export interface ZoneOccupancy {
  /** Displayed count, clamped at 0. */
  count: number;
  /** Unclamped count; negative means drift and is also reported as a NEGATIVE warning. */
  rawCount: number;
  capacity: number;
  /** device_time of the baseline in use, or null when the count comes from open sessions. */
  baselineAt: string | null;
}

export interface OccupancyInput {
  zones: ZoneConfig[];
  openSessions: OpenSessionRow[];
  /** Events written on this device (including ones not yet uploaded). */
  localEvents: Event[];
  /** ZONE_COUNT history for the facility; the latest per zone is the baseline. */
  zoneCounts: ZoneCountRecord[];
  /** Sessions closed on any device (SYNC-03; stubbed, pass [] until it exists). See ClosedSession. */
  closedSessions?: ClosedSession[];
  /** The receiving clock. When omitted, the future-event and stale-baseline checks are skipped. */
  now?: string;
  staleBaselineMs?: number;
}

export type OccupancyResult =
  | { ok: true; zones: Record<string, ZoneOccupancy>; warnings: OccupancyWarning[] }
  | { ok: false; error: "MISSING_ZONE_CONFIG"; zoneIds: string[] };

const ms = (iso: string): number => Date.parse(iso);

interface Entry {
  sessionId: string;
  zoneId: string;
  time: number;
  ref: string;
}

export function computeOccupancy(input: OccupancyInput): OccupancyResult {
  const { zones, openSessions, localEvents, zoneCounts } = input;
  const closedSessionsInput = input.closedSessions ?? [];
  const nowMs = input.now === undefined ? undefined : ms(input.now);
  const warnings: OccupancyWarning[] = [];
  // Every timestamp-bearing input is held to the same trust boundary: ignored, with a warning, when it is more than
  // FUTURE_TOLERANCE_MS ahead of `now`, OR malformed (Date.parse returns NaN). Neither is a trusted exception. A
  // malformed timestamp is not merely "not future" — every NaN comparison is false, so an unguarded one would be
  // silently inert at best (never counted, never flagged stale) and, in a MAX-style selection with no fallback, can
  // get stuck in first permanently (see drift()). Reusing FUTURE_EVENT_IGNORED rather than adding a new kind: both
  // mean "this input cannot be trusted, so it was not used."
  const isFuture = (iso: string): boolean => {
    const t = ms(iso);
    return Number.isNaN(t) || (nowMs !== undefined && t > nowMs + FUTURE_TOLERANCE_MS);
  };

  // De-duplicate local events by id, then drop events from a clock that runs too far ahead.
  const events = new Map<string, Event>();
  for (const e of localEvents) if (!events.has(e.id)) events.set(e.id, e);
  const usable: Event[] = [];
  for (const e of events.values()) {
    if (isFuture(e.device_time)) {
      warnings.push({
        zoneId: e.type === "ENTRY" ? e.payload.zone_id : null,
        kind: "FUTURE_EVENT_IGNORED",
        ref: e.id,
      });
    } else {
      usable.push(e);
    }
  }

  // Entries by session id: the open_sessions snapshot plus local ENTRY events. The first record of a session wins.
  const entries = new Map<string, Entry>();
  for (const s of openSessions) {
    if (entries.has(s.sessionId)) continue;
    if (isFuture(s.entryTime)) {
      warnings.push({ zoneId: s.zoneId, kind: "FUTURE_EVENT_IGNORED", ref: s.sessionId });
      continue;
    }
    entries.set(s.sessionId, {
      sessionId: s.sessionId,
      zoneId: s.zoneId,
      time: ms(s.entryTime),
      ref: s.sessionId,
    });
  }
  for (const e of usable) {
    if (e.type === "ENTRY" && e.session_id !== null && !entries.has(e.session_id)) {
      entries.set(e.session_id, {
        sessionId: e.session_id,
        zoneId: e.payload.zone_id,
        time: ms(e.device_time),
        ref: e.id,
      });
    }
  }

  // Cross-device exits (SYNC-03; see ClosedSession). Dropped the same way as any other future-dated or malformed
  // input; both entryTime and exitTime are checked, since either could be bad.
  const closedSessions: ClosedSession[] = [];
  for (const cs of closedSessionsInput) {
    if (isFuture(cs.exitTime) || isFuture(cs.entryTime)) {
      warnings.push({ zoneId: cs.zoneId, kind: "FUTURE_EVENT_IGNORED", ref: cs.sessionId });
    } else {
      closedSessions.push(cs);
    }
  }

  // Exits: one per session (the earliest), since a second exit for the same session never removes a second vehicle.
  const exits = new Map<string, { time: number; ref: string }>();
  for (const e of usable) {
    if (e.type !== "EXIT" || e.session_id === null) continue;
    const t = ms(e.device_time);
    const have = exits.get(e.session_id);
    if (!have || t < have.time || (t === have.time && e.id < have.ref))
      exits.set(e.session_id, { time: t, ref: e.id });
  }

  // One view per session, merging every source. The zone always comes from a known ENTRY (open_sessions or a local
  // event) when there is one — never from `closedSessions.zoneId`, which this device cannot verify and which may
  // disagree with what it already knows. `earliestExit` is the earliest exit reported by ANY source (a local EXIT
  // event or a closedSessions record for the same session): taking the earliest, not "whichever source we checked
  // last", means a later or duplicate report — local or remote, in either order — can never re-open a session
  // that an earlier report already closed, and a session this device entered locally but only saw leave through
  // `closedSessions` is still closed exactly once.
  interface SessionView {
    zoneId: string;
    entryTime: number;
    earliestExit: number | null;
  }
  const sessions = new Map<string, SessionView>();
  for (const en of entries.values()) {
    sessions.set(en.sessionId, { zoneId: en.zoneId, entryTime: en.time, earliestExit: null });
  }
  for (const [sessionId, ex] of exits) {
    const sv = sessions.get(sessionId);
    if (sv)
      sv.earliestExit = sv.earliestExit === null ? ex.time : Math.min(sv.earliestExit, ex.time);
  }
  for (const cs of closedSessions) {
    const exitT = ms(cs.exitTime);
    const sv = sessions.get(cs.sessionId);
    if (sv) {
      sv.earliestExit = sv.earliestExit === null ? exitT : Math.min(sv.earliestExit, exitT);
    } else {
      // Never seen locally at all: closedSessions is the only source for both the zone and the entry time.
      sessions.set(cs.sessionId, {
        zoneId: cs.zoneId,
        entryTime: ms(cs.entryTime),
        earliestExit: exitT,
      });
    }
  }

  // Zone config must cover every zone the data mentions; guessing zero would hide a setup problem.
  const configured = new Map(zones.map((z) => [z.id, z]));
  const mentioned = new Set<string>();
  for (const sv of sessions.values()) mentioned.add(sv.zoneId);
  for (const c of zoneCounts) mentioned.add(c.zoneId);
  const missing = [...mentioned].filter((id) => !configured.has(id)).sort();
  if (missing.length > 0) return { ok: false, error: "MISSING_ZONE_CONFIG", zoneIds: missing };

  // Latest baseline per zone (by device_time, then id). A future-dated count is dropped first, with a warning, the
  // same as any other future-dated input — otherwise it would become the baseline and silently stop both the
  // STALE_BASELINE check (now - t goes negative) and every entry/exit after it from being counted.
  const baselines = new Map<string, ZoneCountRecord>();
  for (const c of zoneCounts) {
    if (isFuture(c.deviceTime)) {
      warnings.push({ zoneId: c.zoneId, kind: "FUTURE_EVENT_IGNORED", ref: c.id });
      continue;
    }
    const have = baselines.get(c.zoneId);
    if (
      !have ||
      ms(c.deviceTime) > ms(have.deviceTime) ||
      (ms(c.deviceTime) === ms(have.deviceTime) && c.id > have.id)
    ) {
      baselines.set(c.zoneId, c);
    }
  }

  // Exits whose session is unknown here: do not decrement anything, but say so.
  for (const [sessionId, ex] of exits) {
    if (!entries.has(sessionId)) warnings.push({ zoneId: null, kind: "ORPHAN_EXIT", ref: ex.ref });
  }

  const result: Record<string, ZoneOccupancy> = {};
  for (const zone of zones) {
    const baseline = baselines.get(zone.id);
    let raw: number;
    if (baseline) {
      const t = ms(baseline.deviceTime);
      // A session counted at the baseline (entryTime <= t) or entered after it (entryTime > t, added to `entered`)
      // is subtracted once its earliest known exit, from either source, is after the baseline too — a session
      // whose earliest exit is at or before the baseline was already gone (or never here) by the time of the
      // baseline and contributes nothing either way.
      let entered = 0;
      let exited = 0;
      for (const sv of sessions.values()) {
        if (sv.zoneId !== zone.id) continue;
        if (sv.entryTime > t) entered += 1;
        if (sv.earliestExit !== null && sv.earliestExit > t) exited += 1;
      }
      raw = baseline.counted + entered - exited;
      if (nowMs !== undefined && nowMs - t > (input.staleBaselineMs ?? DEFAULT_STALE_BASELINE_MS)) {
        warnings.push({ zoneId: zone.id, kind: "STALE_BASELINE" });
      }
    } else {
      raw = 0;
      for (const sv of sessions.values()) {
        if (sv.zoneId === zone.id && sv.earliestExit === null) raw += 1;
      }
    }
    const count = Math.max(0, raw);
    if (raw < 0) warnings.push({ zoneId: zone.id, kind: "NEGATIVE" });
    if (count > zone.capacity) warnings.push({ zoneId: zone.id, kind: "OVER_CAPACITY" });
    result[zone.id] = {
      count,
      rawCount: raw,
      capacity: zone.capacity,
      baselineAt: baseline ? baseline.deviceTime : null,
    };
  }

  warnings.sort(
    (a, b) =>
      (a.zoneId ?? "").localeCompare(b.zoneId ?? "") ||
      a.kind.localeCompare(b.kind) ||
      (a.ref ?? "").localeCompare(b.ref ?? ""),
  );
  return { ok: true, zones: result, warnings };
}

/**
 * counted - system_count_at_time of the latest ZONE_COUNT for the zone, or null when the zone has no baseline.
 * `now`, when given, drops a future-dated count first — the same guard computeOccupancy applies to the baseline it
 * selects, so drift() cannot report against a count that a correct baseline selection would have ignored. A
 * malformed deviceTime (Date.parse returns NaN) is dropped unconditionally, `now` or not: left unguarded, every
 * comparison against it is false, so it can never be displaced once selected — if the first record for a zone
 * happened to be malformed, it would stay "latest" forever, no matter how many valid records follow.
 */
export function drift(zoneCounts: ZoneCountRecord[], zoneId: string, now?: string): number | null {
  const nowMs = now === undefined ? undefined : ms(now);
  let latest: ZoneCountRecord | undefined;
  for (const c of zoneCounts) {
    if (c.zoneId !== zoneId) continue;
    const t = ms(c.deviceTime);
    if (Number.isNaN(t) || (nowMs !== undefined && t > nowMs + FUTURE_TOLERANCE_MS)) continue;
    if (!latest || t > ms(latest.deviceTime) || (t === ms(latest.deviceTime) && c.id > latest.id)) {
      latest = c;
    }
  }
  return latest ? latest.counted - latest.systemCountAtTime : null;
}

/** True when |drift| is more than 3% of the system count at that time (a zone that was empty is flagged on any difference). */
export function isDriftFlagged(counted: number, systemCountAtTime: number): boolean {
  const diff = Math.abs(counted - systemCountAtTime);
  return systemCountAtTime === 0 ? diff > 0 : diff / systemCountAtTime > DRIFT_FLAG_RATIO;
}

/** Convert a ZONE_COUNT event into the record the function takes. */
export function zoneCountFromEvent(e: Event): ZoneCountRecord | null {
  if (e.type !== "ZONE_COUNT") return null;
  return {
    id: e.id,
    zoneId: e.payload.zone_id,
    counted: e.payload.counted,
    systemCountAtTime: e.payload.system_count_at_time,
    deviceTime: e.device_time,
  };
}
