-- MET-02: system ENTRY count for one facility and one hour, to compare with the independent count on
-- ops/metrics/adherence-sheet.csv (`system_entries`).
--
-- Usage (psql):  psql -v facility_id='<uuid>' -v hour_start='2026-10-26 10:00:00+05:30' -f adherence.sql
--
-- Source: public.events (supabase/migrations/0003_events.sql) and the ENTRY payload `vehicle_class`
-- (packages/contracts/src/events.ts). The hour is the half-open range [hour_start, hour_start + 1 hour) on
-- `device_time`, the time the gate recorded, not `received_at`. Pass an offset (IST is +05:30) so the hour is
-- the facility's local hour.
--
-- `entries` counts every ENTRY, as the specification says. `live_entries` and `paper_backfill_entries`
-- split the same rows by `source` so a reviewer can see how many were typed in later (PAPER_BACKFILL).
--
-- STATUS: written against the migration, NOT run. The local database container was not available when this
-- was written (T-MET-02-I1 still needs a run against seed events). Read-only; changes nothing.
select
  coalesce(payload ->> 'vehicle_class', '(none)') as vehicle_class,
  count(*) as entries,
  count(*) filter (where source = 'LIVE') as live_entries,
  count(*) filter (where source = 'PAPER_BACKFILL') as paper_backfill_entries
from public.events
where facility_id = :'facility_id'::uuid
  and type = 'ENTRY'
  and device_time >= :'hour_start'::timestamptz
  and device_time < :'hour_start'::timestamptz + interval '1 hour'
group by rollup (coalesce(payload ->> 'vehicle_class', '(none)'))
order by vehicle_class nulls last;
