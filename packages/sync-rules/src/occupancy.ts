// Occupancy per zone (SYNC-04). Pure function, no I/O. Counts are always derived from records, never stored as an
// incremented counter, so a lost or repeated update cannot make them drift.
//
// With a physical ZONE_COUNT baseline for a zone: count = counted + entries after the baseline - exits after it.
// Without one: count = vehicles in the open_sessions snapshot plus local entries not yet in it, minus local exits.
// Sessions are matched by session id and events by event id, so the same record seen twice (open_sessions and the
// local store, or a re-sent event) is counted once, and the result does not depend on the order of the input arrays.
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
  const nowMs = input.now === undefined ? undefined : ms(input.now);
  const warnings: OccupancyWarning[] = [];

  // De-duplicate local events by id, then drop events from a clock that runs too far ahead.
  const events = new Map<string, Event>();
  for (const e of localEvents) if (!events.has(e.id)) events.set(e.id, e);
  const usable: Event[] = [];
  for (const e of events.values()) {
    if (nowMs !== undefined && ms(e.device_time) > nowMs + FUTURE_TOLERANCE_MS) {
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
    if (!entries.has(s.sessionId)) {
      entries.set(s.sessionId, {
        sessionId: s.sessionId,
        zoneId: s.zoneId,
        time: ms(s.entryTime),
        ref: s.sessionId,
      });
    }
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

  // Exits: one per session (the earliest), since a second exit for the same session never removes a second vehicle.
  const exits = new Map<string, { time: number; ref: string }>();
  for (const e of usable) {
    if (e.type !== "EXIT" || e.session_id === null) continue;
    const t = ms(e.device_time);
    const have = exits.get(e.session_id);
    if (!have || t < have.time || (t === have.time && e.id < have.ref))
      exits.set(e.session_id, { time: t, ref: e.id });
  }

  // Zone config must cover every zone the data mentions; guessing zero would hide a setup problem.
  const configured = new Map(zones.map((z) => [z.id, z]));
  const mentioned = new Set<string>();
  for (const en of entries.values()) mentioned.add(en.zoneId);
  for (const c of zoneCounts) mentioned.add(c.zoneId);
  const missing = [...mentioned].filter((id) => !configured.has(id)).sort();
  if (missing.length > 0) return { ok: false, error: "MISSING_ZONE_CONFIG", zoneIds: missing };

  // Latest baseline per zone (by device_time, then id).
  const baselines = new Map<string, ZoneCountRecord>();
  for (const c of zoneCounts) {
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
      // Entries after the baseline add one each; exits after it remove one each (the vehicle was either counted in the
      // baseline or entered after it, so either way it was part of this zone's count).
      let entered = 0;
      let exited = 0;
      for (const en of entries.values()) {
        if (en.zoneId !== zone.id) continue;
        if (en.time > t) entered += 1;
        const ex = exits.get(en.sessionId);
        if (ex && ex.time > t) exited += 1;
      }
      raw = baseline.counted + entered - exited;
      if (nowMs !== undefined && nowMs - t > (input.staleBaselineMs ?? DEFAULT_STALE_BASELINE_MS)) {
        warnings.push({ zoneId: zone.id, kind: "STALE_BASELINE" });
      }
    } else {
      raw = 0;
      for (const en of entries.values()) {
        if (en.zoneId === zone.id && !exits.has(en.sessionId)) raw += 1;
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

/** counted - system_count_at_time of the latest ZONE_COUNT for the zone, or null when the zone has no baseline. */
export function drift(zoneCounts: ZoneCountRecord[], zoneId: string): number | null {
  let latest: ZoneCountRecord | undefined;
  for (const c of zoneCounts) {
    if (c.zoneId !== zoneId) continue;
    if (
      !latest ||
      ms(c.deviceTime) > ms(latest.deviceTime) ||
      (ms(c.deviceTime) === ms(latest.deviceTime) && c.id > latest.id)
    ) {
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
