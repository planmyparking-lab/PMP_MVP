import "server-only";
import { ACTIVITY_LIMIT, ACTIVITY_WINDOW_DAYS, summarizeEvent } from "../activity";
import type { ActivityFilter, ActivityLine } from "../activity";
import { createSupabaseServerClient } from "../supabase/server";
import { getConsoleSession } from "./session";
import type { Loaded } from "./types";

export interface ActivityLive {
  facilityName: string;
  asOf: string;
  lines: Loaded<ActivityLine[]>;
  truncated: boolean;
  staffNames: Record<string, string>;
  deviceNames: Record<string, string>;
  filter: ActivityFilter;
}

/**
 * The selected facility's recent events (migration 0003, written by `ingest_events`), newest first, read with the
 * user's JWT. A session or event-id filter (from a conflict) searches all time; otherwise the events RECEIVED in the
 * last 7 days, ordered by receipt. `received_at` is the cloud's clock, so a paper backfill or a phone that was offline for
 * days still shows up when it syncs; `device_time` (the phone's claimed time) is what the table displays.
 */
export async function loadActivity(filter: ActivityFilter): Promise<ActivityLive | null> {
  const session = await getConsoleSession();
  if (session.kind !== "ok" || !session.facility) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const facility = session.facility;
  const asOf = new Date().toISOString();

  let query = supabase
    .from("events")
    .select("id, type, device_time, received_at, source, staff_id, device_id, session_id, payload")
    .eq("facility_id", facility.id)
    .order("received_at", { ascending: false })
    .limit(ACTIVITY_LIMIT);
  if (filter.type) query = query.eq("type", filter.type);
  if (filter.sessionId) query = query.eq("session_id", filter.sessionId);
  if (filter.eventIds.length > 0) query = query.in("id", filter.eventIds);
  if (!filter.sessionId && filter.eventIds.length === 0) {
    const since = new Date(Date.parse(asOf) - ACTIVITY_WINDOW_DAYS * 86_400_000).toISOString();
    query = query.gte("received_at", since);
  }

  const [eventsRes, staffRes, devicesRes, zonesRes] = await Promise.all([
    query,
    supabase.from("staff").select("id, name").eq("facility_id", facility.id),
    supabase.from("devices").select("id, name").eq("facility_id", facility.id),
    supabase.from("zones").select("id, name").eq("facility_id", facility.id),
  ]);

  const names = (rows: { id: unknown; name: unknown }[] | null) =>
    Object.fromEntries((rows ?? []).map((r) => [String(r.id), String(r.name)]));
  const zones = names(zonesRes.data);

  const lines: Loaded<ActivityLine[]> = eventsRes.error
    ? { ok: false, error: `events: ${eventsRes.error.message}` }
    : {
        ok: true,
        data: (eventsRes.data ?? []).map((e) =>
          summarizeEvent(
            {
              id: String(e.id),
              type: String(e.type),
              device_time: String(e.device_time),
              received_at: String(e.received_at),
              source: String(e.source),
              staff_id: String(e.staff_id),
              device_id: String(e.device_id),
              session_id: e.session_id === null ? null : String(e.session_id),
              payload: e.payload,
            },
            (id) => zones[id] ?? "Unknown zone",
          ),
        ),
      };

  return {
    facilityName: facility.name,
    asOf,
    lines,
    truncated: (eventsRes.data?.length ?? 0) >= ACTIVITY_LIMIT,
    staffNames: names(staffRes.data),
    deviceNames: names(devicesRes.data),
    filter,
  };
}
