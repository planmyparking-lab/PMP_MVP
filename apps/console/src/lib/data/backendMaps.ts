import { z } from "zod";
import type { HeartbeatLive, KpiToday } from "./types";

/**
 * Row shapes of the backend objects that are still in open pull requests. Kept strict on the columns the Console
 * reads, so a renamed or retyped column (IC-07: "column names are the contract") shows as "unavailable" instead of
 * a wrong number. Unknown extra columns are allowed, because the Console selects columns explicitly.
 */
const int = z.number().int();
const nonNegInt = int.nonnegative();

/** `v_daily_kpis` (#33, 0009_views_kpis.sql). */
export const DailyKpiRow = z.object({
  local_date: z.string(),
  vehicles: nonNegInt,
  cash_paise: nonNegInt,
  upi_paise: nonNegInt,
  pass_paise: nonNegInt,
  declared_total_paise: nonNegInt,
  overrides: nonNegInt,
  overrides_per_100: z.number().nullable(),
  avg_stay_minutes: z.number().nullable(),
  orphan_exits: nonNegInt,
});

/** `v_hourly` (#33). */
export const HourlyRow = z.object({
  local_date: z.string(),
  hour: int.min(0).max(23),
  entries: nonNegInt,
  exits: nonNegInt,
});

/** `device_heartbeats` (#31, 0008_device_heartbeats.sql). `battery_pct` may become nullable (review on #31). */
export const HeartbeatRow = z.object({
  device_id: z.string(),
  received_at: z.string(),
  queue_depth: nonNegInt,
  oldest_unsynced_age_s: nonNegInt,
  app_version: z.string(),
  schema_version: int,
  battery_pct: int.min(0).max(100).nullable(),
});

/**
 * Today's KPIs for one facility. No `v_daily_kpis` row means no event today (the view emits no row for an empty
 * day, see docs/integrations/cld-05-kpi-views.md "EMPTY PERIODS"), which is zero, not unknown.
 */
export function mapKpiToday(localDate: string, daily: unknown[], hourly: unknown[]): KpiToday {
  const days = z
    .array(DailyKpiRow)
    .parse(daily)
    .filter((r) => r.local_date === localDate);
  const hours = z
    .array(HourlyRow)
    .parse(hourly)
    .filter((r) => r.local_date === localDate);
  if (days.length > 1) throw new Error("more than one v_daily_kpis row for one day");
  const d = days[0];
  const entriesByHour = Array.from({ length: 24 }, () => 0);
  let exits = 0;
  for (const h of hours) {
    entriesByHour[h.hour] = (entriesByHour[h.hour] ?? 0) + h.entries;
    exits += h.exits;
  }
  return {
    localDate,
    vehicles: d?.vehicles ?? 0,
    exits,
    cashPaise: d?.cash_paise ?? 0,
    upiPaise: d?.upi_paise ?? 0,
    passPaise: d?.pass_paise ?? 0,
    declaredTotalPaise: d?.declared_total_paise ?? 0,
    overrides: d?.overrides ?? 0,
    overridesPer100: d?.overrides_per_100 ?? null,
    avgStayMinutes: d?.avg_stay_minutes ?? null,
    orphanExits: d?.orphan_exits ?? 0,
    entriesByHour,
  };
}

export function mapHeartbeats(rows: unknown[]): HeartbeatLive[] {
  return z
    .array(HeartbeatRow)
    .parse(rows)
    .map((r) => ({
      deviceId: r.device_id,
      receivedAt: r.received_at,
      queueDepth: r.queue_depth,
      oldestUnsyncedAgeS: r.oldest_unsynced_age_s,
      appVersion: r.app_version,
      schemaVersion: r.schema_version,
      batteryPct: r.battery_pct,
    }));
}
