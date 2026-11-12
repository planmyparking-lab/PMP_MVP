import "server-only";
import { buildShiftRows, SHIFT_EVENT_LIMIT } from "../shifts";
import type { ShiftBuild, ShiftEventRow } from "../shifts";
import { createSupabaseServerClient } from "../supabase/server";
import { getConsoleSession } from "./session";
import type { Loaded } from "./types";

export const SHIFT_WINDOW_DAYS = 30;

export interface ShiftsLive {
  facilityName: string;
  asOf: string;
  shifts: Loaded<ShiftBuild>;
  /** id -> name, for display only. */
  staffNames: Record<string, string>;
  /** True when the read hit SHIFT_EVENT_LIMIT, so older shifts in the window may be missing. */
  truncated: boolean;
  deviceNames: Record<string, string>;
}

/**
 * CON-06 read-only loader: SHIFT_OPEN and SHIFT_CLOSE events of the selected facility for the last 30 days, read
 * with the user's JWT (RLS applies). Replaces nothing in the database; shift views are still to come (OQ-51).
 */
export async function loadShiftsLive(): Promise<ShiftsLive | null> {
  const session = await getConsoleSession();
  if (session.kind !== "ok" || !session.facility) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const facility = session.facility;
  const asOf = new Date().toISOString();
  const since = new Date(Date.parse(asOf) - SHIFT_WINDOW_DAYS * 86_400_000).toISOString();

  const [eventsRes, staffRes, devicesRes] = await Promise.all([
    supabase
      .from("events")
      .select("type, device_time, device_id, staff_id, payload")
      .eq("facility_id", facility.id)
      .in("type", ["SHIFT_OPEN", "SHIFT_CLOSE"])
      .gte("device_time", since)
      .order("device_time", { ascending: false })
      .limit(SHIFT_EVENT_LIMIT),
    supabase.from("staff").select("id, name").eq("facility_id", facility.id),
    supabase.from("devices").select("id, name").eq("facility_id", facility.id),
  ]);

  const shifts: Loaded<ShiftBuild> = eventsRes.error
    ? { ok: false, error: `events: ${eventsRes.error.message}` }
    : {
        ok: true,
        data: buildShiftRows(
          (eventsRes.data ?? []).map((e): ShiftEventRow => ({
            type: e.type === "SHIFT_OPEN" ? "SHIFT_OPEN" : "SHIFT_CLOSE",
            device_time: String(e.device_time),
            device_id: String(e.device_id),
            staff_id: String(e.staff_id),
            payload: e.payload,
          })),
        ),
      };

  const names = (rows: { id: unknown; name: unknown }[] | null) =>
    Object.fromEntries((rows ?? []).map((r) => [String(r.id), String(r.name)]));

  return {
    facilityName: facility.name,
    asOf,
    shifts,
    truncated: (eventsRes.data?.length ?? 0) >= SHIFT_EVENT_LIMIT,
    staffNames: names(staffRes.data),
    deviceNames: names(devicesRes.data),
  };
}
