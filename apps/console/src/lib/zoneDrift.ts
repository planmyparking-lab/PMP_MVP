import { ZoneCountPayload } from "@pmp/contracts";
import {
  DEFAULT_STALE_BASELINE_MS,
  FUTURE_TOLERANCE_MS,
  drift,
  isDriftFlagged,
} from "@pmp/sync-rules";
import type { ZoneCountRecord } from "@pmp/sync-rules";

/**
 * CON-04 / MET-01: the latest physical count per zone, checked with SYNC-04's rules from `@pmp/sync-rules` (#28, Afzal):
 * the same baseline selection as `drift()` and the Console's 3% flag `isDriftFlagged()`. The occupancy figure itself is
 * NOT recomputed here (sheet C4: counts come from the view or open sessions only); this only reports how the last
 * physical count compared with what the system showed at that moment.
 */
export interface ZoneCheck {
  counted: number;
  systemCountAtTime: number;
  /** counted - system_count_at_time, exactly what `drift()` returns. */
  drift: number;
  /** More than 3% apart (any difference when the system showed 0). */
  flagged: boolean;
  /** device_time of the count. */
  countedAt: string;
  /** Older than SYNC-04's stale-baseline limit (24 h). */
  stale: boolean;
}

/** ZONE_COUNT event rows -> records; a payload that breaks the contract is left out, never guessed. */
export function zoneCountRecords(
  rows: ReadonlyArray<{ id: unknown; device_time: unknown; payload: unknown }>,
): ZoneCountRecord[] {
  const out: ZoneCountRecord[] = [];
  for (const r of rows) {
    const p = ZoneCountPayload.safeParse(r.payload);
    if (!p.success) continue;
    out.push({
      id: String(r.id),
      zoneId: p.data.zone_id,
      counted: p.data.counted,
      systemCountAtTime: p.data.system_count_at_time,
      deviceTime: String(r.device_time),
    });
  }
  return out;
}

/** Same selection as `drift()`: drop malformed and future-dated counts, newest wins, ties broken by id. */
function latestFor(records: readonly ZoneCountRecord[], zoneId: string, nowMs: number) {
  let latest: ZoneCountRecord | undefined;
  for (const c of records) {
    if (c.zoneId !== zoneId) continue;
    const t = Date.parse(c.deviceTime);
    if (Number.isNaN(t) || t > nowMs + FUTURE_TOLERANCE_MS) continue;
    const lt = latest ? Date.parse(latest.deviceTime) : -Infinity;
    if (!latest || t > lt || (t === lt && c.id > latest.id)) latest = c;
  }
  return latest;
}

export function zoneChecks(
  records: readonly ZoneCountRecord[],
  zoneIds: readonly string[],
  nowIso: string,
): Record<string, ZoneCheck | null> {
  const nowMs = Date.parse(nowIso);
  const out: Record<string, ZoneCheck | null> = {};
  for (const zoneId of zoneIds) {
    const latest = latestFor(records, zoneId, nowMs);
    const d = drift([...records], zoneId, nowIso);
    if (!latest || d === null) {
      out[zoneId] = null;
      continue;
    }
    out[zoneId] = {
      counted: latest.counted,
      systemCountAtTime: latest.systemCountAtTime,
      drift: d,
      flagged: isDriftFlagged(latest.counted, latest.systemCountAtTime),
      countedAt: latest.deviceTime,
      stale: nowMs - Date.parse(latest.deviceTime) > DEFAULT_STALE_BASELINE_MS,
    };
  }
  return out;
}
