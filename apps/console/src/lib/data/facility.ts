import "server-only";
import { cache } from "react";
import { parseSyncConflictRows } from "../conflicts";
import { OpenSessionRowSchema } from "../openSessions";
import { createSupabaseServerClient } from "../supabase/server";
import { countByIstHour, istDayStart } from "./istDay";
import { getConsoleSession } from "./session";
import type { FacilityLive, Loaded } from "./types";

const fail = (what: string, message: string): { ok: false; error: string } => ({
  ok: false,
  error: `${what}: ${message}`,
});

/** Upper bound on rows pulled for one screen; a pilot facility has 100 to 500 slots. */
const ROW_LIMIT = 2000;

/**
 * Everything the Console screens show for the selected facility, read with the user's JWT. Each part loads on
 * its own, so one missing grant or policy shows as one "unavailable" card, not a broken page.
 * Sources (all implemented in supabase/migrations): zones (0001), devices and staff (0002), events (0003),
 * open_sessions (0005) and sync_conflicts (0006).
 */
export const loadFacilityLive = cache(async (): Promise<FacilityLive | null> => {
  const session = await getConsoleSession();
  if (session.kind !== "ok" || !session.facility) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const facility = session.facility;
  const asOf = new Date().toISOString();
  const dayStart = istDayStart(asOf);

  const [zonesRes, insideRes, conflictsRes, devicesRes, staffRes, todayRes] = await Promise.all([
    supabase
      .from("zones")
      .select("id, name, capacity, vehicle_class")
      .eq("facility_id", facility.id)
      .order("name"),
    supabase
      .from("open_sessions")
      .select("*")
      .eq("facility_id", facility.id)
      .order("entry_time")
      .limit(ROW_LIMIT),
    supabase
      .from("sync_conflicts")
      .select("*")
      .eq("facility_id", facility.id)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("devices")
      .select("id, name, enrolled_at, revoked_at")
      .eq("facility_id", facility.id)
      .order("enrolled_at"),
    // Never select pin_hash or pin_salt (IC-06).
    supabase
      .from("staff")
      .select("id, name, active, created_at")
      .eq("facility_id", facility.id)
      .order("name"),
    supabase
      .from("events")
      .select("type, device_time")
      .eq("facility_id", facility.id)
      .in("type", ["ENTRY", "EXIT", "OVERRIDE"])
      .gte("device_time", dayStart)
      .limit(ROW_LIMIT * 5),
  ]);

  const zoneNames = new Map<string, string>(
    (zonesRes.data ?? []).map((z) => [String(z.id), String(z.name)]),
  );

  const parsedInside = insideRes.error
    ? null
    : OpenSessionRowSchema.array().safeParse(insideRes.data ?? []);
  const openRows = parsedInside?.success ? parsedInside.data : null;
  const inside: FacilityLive["inside"] = insideRes.error
    ? fail("open_sessions", insideRes.error.message)
    : openRows === null
      ? fail("open_sessions", "rows did not match the 0005 shape")
      : {
          ok: true,
          data: openRows.map((r) => ({
            sessionId: r.session_id,
            shortCode: r.short_code,
            zoneName: zoneNames.get(r.zone_id) ?? "Unknown zone",
            vehicleClass: r.vehicle_class,
            entryTime: r.entry_time,
            hasPass: r.pass_id !== null,
          })),
        };

  // Occupied per zone = vehicles currently inside (open_sessions), until the v_zone_now view exists (OQ, see docs).
  const counts = new Map<string, number>();
  for (const r of openRows ?? []) counts.set(r.zone_id, (counts.get(r.zone_id) ?? 0) + 1);
  const zones: FacilityLive["zones"] = zonesRes.error
    ? fail("zones", zonesRes.error.message)
    : openRows === null
      ? fail("zones", "occupied counts need open_sessions, which could not be read")
      : {
          ok: true,
          data: (zonesRes.data ?? []).map((z) => ({
            id: String(z.id),
            name: String(z.name),
            capacity: Number(z.capacity),
            vehicleClass: String(z.vehicle_class),
            occupied: counts.get(String(z.id)) ?? 0,
          })),
        };

  let conflicts: FacilityLive["conflicts"];
  if (conflictsRes.error) {
    conflicts = fail("sync_conflicts", conflictsRes.error.message);
  } else {
    try {
      conflicts = { ok: true, data: parseSyncConflictRows(conflictsRes.data ?? []) };
    } catch {
      conflicts = fail("sync_conflicts", "rows did not match the 0006 shape");
    }
  }

  const devices: FacilityLive["devices"] = devicesRes.error
    ? fail("devices", devicesRes.error.message)
    : {
        ok: true,
        data: (devicesRes.data ?? []).map((d) => ({
          id: String(d.id),
          name: String(d.name),
          enrolledAt: String(d.enrolled_at),
          revokedAt: d.revoked_at === null ? null : String(d.revoked_at),
        })),
      };

  const staff: FacilityLive["staff"] = staffRes.error
    ? fail("staff", staffRes.error.message)
    : {
        ok: true,
        data: (staffRes.data ?? []).map((s) => ({
          id: String(s.id),
          name: String(s.name),
          active: Boolean(s.active),
          createdAt: String(s.created_at),
        })),
      };

  let today: FacilityLive["today"];
  if (todayRes.error) {
    today = fail("events", todayRes.error.message);
  } else {
    const rows = todayRes.data ?? [];
    const entryTimes = rows.filter((r) => r.type === "ENTRY").map((r) => String(r.device_time));
    today = {
      ok: true,
      data: {
        entries: entryTimes.length,
        exits: rows.filter((r) => r.type === "EXIT").length,
        overrides: rows.filter((r) => r.type === "OVERRIDE").length,
        entriesByHour: countByIstHour(entryTimes),
      },
    };
  }

  return { facility, asOf, zones, inside, conflicts, devices, staff, today };
});

export function unwrap<T>(value: Loaded<T>): T | null {
  return value.ok ? value.data : null;
}
