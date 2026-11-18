import "server-only";
import { cache } from "react";
import { parseSyncConflictRows } from "../conflicts";
import { OpenSessionRowSchema } from "../openSessions";
import { createSupabaseServerClient } from "../supabase/server";
import { FUTURE_TOLERANCE_MS } from "@pmp/sync-rules";
import { readPaged } from "../readLimits";
import { zoneChecks, zoneCountRecords } from "../zoneDrift";
import { mapHeartbeats, mapKpiToday } from "./backendMaps";
import { countByIstHour, istDayStart } from "./istDay";
import { localDate } from "./localDay";
import { probeResult } from "./probe";
import type { Probe } from "./probe";
import { getConsoleSession } from "./session";
import type { FacilityLive, KpiToday, Loaded } from "./types";

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
 * Also used: the KPI views `v_daily_kpis` and `v_hourly` (0009), `device_heartbeats` (0008), read through probes so a
 * database without them still renders, and the latest ZONE_COUNT per zone, checked with SYNC-04's drift rule (#28).
 * Row-level security (0010) limits every read to the facilities the user is an owner or manager of.
 */
/**
 * ZONE_COUNT events read PER ZONE to find its latest physical count. A few rather than one, so a malformed latest row
 * (left out by zoneCountRecords) still leaves an older valid count to show. Reading per zone means a zone that was last
 * counted long ago is never crowded out by busier zones (review of #52).
 */
const ZONE_COUNTS_PER_ZONE = 5;
export const loadFacilityLive = cache(async (): Promise<FacilityLive | null> => {
  const session = await getConsoleSession();
  if (session.kind !== "ok" || !session.facility) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const facility = session.facility;
  const asOf = new Date().toISOString();
  const dayStart = istDayStart(asOf);
  const facilityToday = localDate(asOf, facility.timezone);

  const [
    zonesRes,
    insideRes,
    conflictsRes,
    devicesRes,
    staffRes,
    todayRes,
    dailyRes,
    hourlyRes,
    heartbeatsRes,
  ] = await Promise.all([
    supabase
      .from("zones")
      .select("id, name, capacity, vehicle_class")
      .eq("facility_id", facility.id)
      .order("name"),
    // PostgREST answers at most 1000 rows per request (max_rows), so the two large reads go through readPaged.
    readPaged(
      (from, to) =>
        supabase
          .from("open_sessions")
          .select("*")
          .eq("facility_id", facility.id)
          .order("entry_time")
          .order("session_id")
          .range(from, to),
      ROW_LIMIT,
    ),
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
    readPaged(
      (from, to) =>
        supabase
          .from("events")
          .select("type, device_time")
          .eq("facility_id", facility.id)
          .in("type", ["ENTRY", "EXIT", "OVERRIDE"])
          .gte("device_time", dayStart)
          .order("device_time")
          .order("id")
          .range(from, to),
      ROW_LIMIT * 5,
    ),
    supabase
      .from("v_daily_kpis")
      .select(
        "local_date, vehicles, cash_paise, upi_paise, pass_paise, declared_total_paise, overrides, overrides_per_100, avg_stay_minutes, orphan_exits",
      )
      .eq("facility_id", facility.id)
      .eq("local_date", facilityToday ?? "1970-01-01"),
    supabase
      .from("v_hourly")
      .select("local_date, hour, entries, exits")
      .eq("facility_id", facility.id)
      .eq("local_date", facilityToday ?? "1970-01-01"),
    supabase
      .from("device_heartbeats")
      .select(
        "device_id, received_at, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct",
      )
      .eq("facility_id", facility.id),
  ]);

  // Latest physical counts, one small read per zone (zones are few, and the reads run in parallel). Counts dated more
  // than the SYNC-04 tolerance ahead of now are excluded here, as drift() would ignore them.
  const zoneIds = (zonesRes.data ?? []).map((z) => String(z.id));
  const countCutoff = new Date(Date.parse(asOf) + FUTURE_TOLERANCE_MS).toISOString();
  const zoneCountsRes = await Promise.all(
    zoneIds.map((zoneId) =>
      supabase
        .from("events")
        .select("id, device_time, payload")
        .eq("facility_id", facility.id)
        .eq("type", "ZONE_COUNT")
        .eq("payload->>zone_id", zoneId)
        .lte("device_time", countCutoff)
        .order("device_time", { ascending: false })
        .order("id", { ascending: false })
        .limit(ZONE_COUNTS_PER_ZONE),
    ),
  );
  const zoneCountError = zoneCountsRes.find((r) => r.error)?.error ?? null;

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
            passId: r.pass_id,
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

  // Both KPI views must be readable; if either is absent the dashboard keeps counting events itself.
  let kpis: Probe<KpiToday>;
  if (facilityToday === null) {
    kpis = {
      state: "error",
      error: `facility timezone "${facility.timezone}" is not a valid IANA name`,
    };
  } else {
    const daily = probeResult("v_daily_kpis", dailyRes, (rows) => rows as unknown[]);
    const hourly = probeResult("v_hourly", hourlyRes, (rows) => rows as unknown[]);
    if (daily.state !== "ok") {
      kpis = daily;
    } else if (hourly.state !== "ok") {
      kpis = hourly;
    } else {
      try {
        kpis = { state: "ok", data: mapKpiToday(facilityToday, daily.data, hourly.data) };
      } catch (e) {
        kpis = {
          state: "error",
          error: `KPI views: ${e instanceof Error ? e.message : "unexpected shape"}`,
        };
      }
    }
  }

  const heartbeats = probeResult("device_heartbeats", heartbeatsRes, (rows) =>
    mapHeartbeats(rows as unknown[]),
  );

  const physical: FacilityLive["zoneChecks"] = zoneCountError
    ? fail("zone counts", zoneCountError.message)
    : {
        ok: true,
        data: zoneChecks(
          zoneCountRecords(zoneCountsRes.flatMap((r) => r.data ?? [])),
          zoneIds,
          asOf,
        ),
      };

  return {
    facility,
    asOf,
    zones,
    zoneChecks: physical,
    inside,
    conflicts,
    devices,
    staff,
    today,
    kpis,
    heartbeats,
  };
});

export function unwrap<T>(value: Loaded<T>): T | null {
  return value.ok ? value.data : null;
}
