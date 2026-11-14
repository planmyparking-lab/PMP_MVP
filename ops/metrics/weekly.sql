-- MET-03: database-derived sections of the weekly pilot metrics pack.
--
-- Required psql variables:
--   facility_id  UUID of the facility being reported
--   week_start   inclusive timestamptz boundary in the facility's local offset
--   week_end     exclusive timestamptz boundary in the facility's local offset
--
-- Example (local database only):
--   psql -v facility_id='<uuid>' \
--     -v week_start='2026-11-02 00:00:00+05:30' \
--     -v week_end='2026-11-09 00:00:00+05:30' \
--     -f ops/metrics/weekly.sql
--
-- STATUS: written against migrations 0003, 0006 and 0008. Run on the local stack with the CON-11 demo seed (see
-- ops/metrics/README.md); never run against a real project as part of development verification. It is read-only.
-- MET-01 and MET-02 remain sourced from their CSV sheets.

-- Section 5: conflicts created during the week, by the four IC-10 types.
with params as (
  select
    :'facility_id'::uuid as facility_id,
    :'week_start'::timestamptz as week_start,
    :'week_end'::timestamptz as week_end
),
conflict_types(type) as (
  values ('DUPLICATE_EXIT'), ('ORPHAN_EXIT'), ('DUPLICATE_ENTRY'), ('CLOCK_SKEW')
),
weekly_conflicts as (
  select conflict.*
  from public.sync_conflicts as conflict
  cross join params
  where conflict.facility_id = params.facility_id
    and conflict.created_at >= params.week_start
    and conflict.created_at < params.week_end
)
select
  conflict_types.type as conflict_type,
  count(weekly_conflicts.id)::bigint as conflicts_created,
  count(weekly_conflicts.id) filter (where weekly_conflicts.status = 'OPEN')::bigint as currently_open,
  count(weekly_conflicts.id) filter (where weekly_conflicts.status = 'RESOLVED')::bigint as currently_resolved
from conflict_types
left join weekly_conflicts on weekly_conflicts.type = conflict_types.type
group by conflict_types.type
order by conflict_types.type;

-- Section 5: conflicts that were unresolved for more than 24 hours at the report end.
-- `resolved_at >= week_end` reconstructs the end-of-week snapshot when this query is rerun later.
with params as (
  select
    :'facility_id'::uuid as facility_id,
    :'week_end'::timestamptz as week_end
)
select
  conflict.id,
  conflict.type as conflict_type,
  conflict.session_id,
  cardinality(conflict.event_ids) as event_count,
  conflict.created_at,
  floor(extract(epoch from (params.week_end - conflict.created_at)) / 60)::bigint as age_minutes
from public.sync_conflicts as conflict
cross join params
where conflict.facility_id = params.facility_id
  and conflict.created_at < params.week_end
  and (conflict.resolved_at is null or conflict.resolved_at >= params.week_end)
  and params.week_end - conflict.created_at > interval '24 hours'
order by conflict.created_at, conflict.id;

-- Section 6: OVERRIDE events per 100 ENTRY events, grouped by the IC-01 reason code.
-- Both numerator and denominator use device_time and the same half-open weekly window. A zero denominator
-- produces NULL rather than claiming a rate; the raw counts remain present for review.
with params as (
  select
    :'facility_id'::uuid as facility_id,
    :'week_start'::timestamptz as week_start,
    :'week_end'::timestamptz as week_end
),
reason_codes(reason_code) as (
  values
    ('LOST_TOKEN'),
    ('DAMAGED_TOKEN'),
    ('MISREAD_NUMBER'),
    ('WRONG_CLASS'),
    ('OWNER_WAIVER'),
    ('STAFF_VEHICLE'),
    ('OTHER')
),
entry_total as (
  select count(*)::bigint as entries
  from public.events as event
  cross join params
  where event.facility_id = params.facility_id
    and event.type = 'ENTRY'
    and event.device_time >= params.week_start
    and event.device_time < params.week_end
),
override_counts as (
  select event.payload ->> 'reason_code' as reason_code, count(*)::bigint as overrides
  from public.events as event
  cross join params
  where event.facility_id = params.facility_id
    and event.type = 'OVERRIDE'
    and event.device_time >= params.week_start
    and event.device_time < params.week_end
  group by event.payload ->> 'reason_code'
)
select
  reason_codes.reason_code,
  coalesce(override_counts.overrides, 0)::bigint as overrides,
  entry_total.entries,
  case
    when entry_total.entries = 0 then null
    else round(coalesce(override_counts.overrides, 0) * 100.0 / entry_total.entries, 2)
  end as overrides_per_100_vehicles
from reason_codes
cross join entry_total
left join override_counts using (reason_code)
order by reason_codes.reason_code;

-- Section 4: sync latency of the week. LIVE events only: a paper backfill is keyed in late on purpose.
-- Latency is received_at minus device_time; a negative value (device clock ahead) is kept, not hidden.
with params as (
  select
    :'facility_id'::uuid as facility_id,
    :'week_start'::timestamptz as week_start,
    :'week_end'::timestamptz as week_end
),
latency as (
  select extract(epoch from (event.received_at - event.device_time)) as seconds
  from public.events as event
  cross join params
  where event.facility_id = params.facility_id
    and event.source = 'LIVE'
    and event.device_time >= params.week_start
    and event.device_time < params.week_end
)
select
  count(*)::bigint as live_events,
  round((percentile_cont(0.5) within group (order by seconds))::numeric, 1) as latency_p50_seconds,
  round((percentile_cont(0.95) within group (order by seconds))::numeric, 1) as latency_p95_seconds,
  round(max(seconds)::numeric, 1) as latency_max_seconds
from latency;

-- Section 4: each phone's LATEST heartbeat (0008 keeps one row per device, so this is a snapshot at the time the
-- query runs, not a weekly history). Revoked phones are left out. A phone that never sent one shows nulls.
with params as (
  select :'facility_id'::uuid as facility_id
)
select
  device.name as device,
  heartbeat.received_at as last_heartbeat,
  heartbeat.queue_depth,
  heartbeat.oldest_unsynced_age_s,
  heartbeat.app_version,
  heartbeat.schema_version,
  heartbeat.schema_version < public.max_supported_schema_version() as older_schema
from public.devices as device
cross join params
left join public.device_heartbeats as heartbeat on heartbeat.device_id = device.id
where device.facility_id = params.facility_id
  and device.revoked_at is null
order by device.name;

-- Sections whose database sources do not exist yet. Keep these explicit in the pack instead of leaving blanks.
-- Quarantined events stay in the phone outbox (SYNC-06) and device_heartbeats (0008) has no column for them.
select *
from (
  values
    ('4. Sync health: quarantined events', 'missing: no server-side source'),
    ('4. Sync health: weekly heartbeat history', 'missing: device_heartbeats keeps the latest row only'),
    ('7. Reports', 'missing: public.job_runs')
) as missing_sources(section, status)
order by section;

-- Non-database sections remain outside this SQL:
--   1 Facility status: pilot log (manual)
--   2 Occupancy accuracy: ops/metrics/audit-sheet.csv
--   3 Adherence: ops/metrics/adherence-sheet.csv
--   8 Cloud: Supabase dashboard and billing (manual)
--   9 Open issues and 10 Decisions needed: weekly review (manual)
