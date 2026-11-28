# Console backend handoffs (Anamika to Akanksha and Afzal)

Status: **implementation requests, not database contracts yet**. This page records the exact rows and function
inputs the current Console code can consume. No migration, RLS policy, Supabase client or network call is added by
the accompanying Console change. Open decisions remain open rather than being encoded silently.

## 1. CON-07 conflict inbox

### Existing read row (Afzal, migration 0006)

The Console parser accepts exactly this `public.sync_conflicts` row and rejects missing or extra fields:

```text
id uuid
facility_id uuid
type DUPLICATE_EXIT | ORPHAN_EXIT | DUPLICATE_ENTRY | CLOCK_SKEW
event_ids uuid[] (at least one)
session_id uuid null
dedupe_key uuid
status OPEN | RESOLVED
detail jsonb
created_at timestamptz
resolved_by uuid null
resolved_at timestamptz null
CHECK ((status = 'RESOLVED') = (resolved_at is not null))
```

Requested CLD-03 policy: an owner may select conflicts for facilities in their organization; a manager may select
conflicts for their facility. Guards, devices and anonymous users cannot select. No Console role receives direct
`insert`, `update` or `delete` on `sync_conflicts`.

### Requested resolution write (Akanksha with Afzal review)

Recommended table columns already listed in the Anamika sheet, made concrete for review:

```text
public.conflict_resolutions
  id uuid primary key default gen_random_uuid()
  conflict_id uuid not null references public.sync_conflicts(id) on delete restrict
  action text not null
  note text null
  resolved_by uuid not null references auth.users(id) on delete restrict
  resolved_at timestamptz not null default now()
```

Proposed action values match `apps/console/src/lib/conflicts.ts`:

```text
KEEP_FIRST | KEEP_SECOND | MARK_AS_TEST_ENTRY | ADD_NOTE | ACKNOWLEDGE
```

Allowed combinations:

- `DUPLICATE_EXIT`, `ORPHAN_EXIT`, `DUPLICATE_ENTRY`: `KEEP_FIRST`, `KEEP_SECOND`,
  `MARK_AS_TEST_ENTRY`, `ADD_NOTE`.
- `CLOCK_SKEW`: `ADD_NOTE`, `ACKNOWLEDGE` only.

Requested atomic function signature:

```sql
public.resolve_conflict(
  p_conflict_id uuid,
  p_action text,
  p_note text default null
) returns public.conflict_resolutions
```

The function must derive `resolved_by` from `auth.uid()`, lock the conflict, check facility membership, validate the
action against the conflict type, insert the audit row and update `sync_conflicts` in one transaction. It must reject
an already-resolved conflict and must never update or delete `events`. Whether `ADD_NOTE` changes the conflict to
`RESOLVED` is deliberately blocked on OQ-49.

Requested policy: owners and managers may call the function only for an allowed facility and may select its
resolution rows. Guards, devices and anonymous users receive no access. Direct table inserts are unnecessary if the
function is the only write path.

## 2. CON-09 open-session read and privacy

The Console adapter accepts exactly the migration 0005 row:

```text
session_id uuid
facility_id uuid
entry_event_id uuid
zone_id uuid
vehicle_class text
short_code text
vehicle_no text null
pass_id uuid null
entry_time timestamptz
created_at timestamptz
```

Requested CLD-03 policy: owner and manager reads use the same organization/facility scope as conflicts. Devices and
guards retain only the access required by the sync design. No application role writes `open_sessions`; its trigger
owns the projection.

The Console maps only `session_id`, `entry_time` and `pass_id` into the CON-09 overstay rule. CSV export omits the
`vehicle_no` column unless a caller explicitly opts in, as required by OQ-26. Threshold storage remains blocked on
OQ-46. PR #23 owns the Overstay page and `overstay.ts`; this change does not copy those files.

## 3. CLD-04 heartbeat request

Requested table columns are the ones already proposed in the Akanksha sheet:

```text
public.device_heartbeats
  device_id uuid primary key
  facility_id uuid not null
  received_at timestamptz not null
  queue_depth integer not null
  oldest_unsynced_age_s integer not null
  app_version text not null
  schema_version integer not null
  battery_pct integer null
```

Requested input signature:

```sql
public.heartbeat(
  p_device_id uuid,
  p_queue_depth integer,
  p_oldest_unsynced_age_s integer,
  p_app_version text,
  p_schema_version integer,
  p_battery_pct integer
) returns void
```

The function checks the caller's device claim, records the facility from the enrolled device rather than trusting a
request field, and accepts at most one update per device per five minutes. Owners and managers may select rows in
scope; direct writes remain denied. Opening-hours handling for stale status remains blocked on OQ-47.

## 4. CLD-05 and CON-08 read views

The view names are fixed: `v_zone_now`, `v_daily_kpis`, `v_hourly`. The only column list agreed by both sheets is:

```text
v_zone_now(facility_id, zone_id, zone_name, capacity, occupied, as_of)
```

The Console also needs these values, but their database names are not final and must be resolved through OQ-45 and
the pending `docs/integrations/ic-07-console-requirements.md` from PR #23:

```text
daily: facility, local day, vehicles, cash paise, UPI paise, pass paise,
       declared total paise, average stay minutes, overrides, overrides per 100
hourly: facility, one unambiguous hour-start value, entries, exits
```

Do not derive UPI as total minus cash. The report adapter additionally needs utilisation by zone, revenue by mode,
peak-hour heatmap, stay distribution, override counts by IC-01 reason code, shift variances and conflicts. Exact
`v_report_*` names and columns remain open because OQ-19 and OQ-45 are unresolved; no view shape is invented here.

## 5. Other exact Console write requests

These are requests from `docs/team/member-03-anamika.md`; they are not implemented in this change.

```sql
public.set_staff_pin(p_staff_id uuid, p_pin text) returns void

public.create_enrollment_code(p_facility_id uuid)
returns table (code text, expires_at timestamptz)
```

Both functions derive the actor and facility authorization from the authenticated session, never log the PIN or
enrollment code, and leave no plaintext PIN in a table.

```text
public.shift_reviews
  id uuid
  shift_id uuid
  reviewed_by uuid
  reviewed_at timestamptz
  status approved | flagged
  note text null

public.job_runs
  id uuid
  job text
  facility_id uuid
  started_at timestamptz
  finished_at timestamptz null
  status text
  detail jsonb

public.report_recipients
  facility_id uuid
  email text
  cadence daily | weekly | monthly
```

The shift read view must expose the identifiers and every value already carried by `SHIFT_OPEN` / `SHIFT_CLOSE`:
open and close times, staff, expected and counted cash, UPI declared and attested totals, both signed variances, and
closed/open status. Its name and exact column names need Akanksha and Afzal's agreement before Console wiring.

An exact `facility_setup_drafts` shape cannot be requested yet because operating hours are unresolved (OQ-47), and
the stored draft/version/concurrency model has not been agreed. Facility overstay storage is also blocked on OQ-46.
Those migrations should wait for decisions rather than encode the current UI's local draft shape.

## 6. Report route data access (CON-08, CLD-06): decision needed

The report route (`apps/console/app/api/reports/[type]/route.ts`) is called by the scheduler with the shared secret
(IC-08), so there is **no user session** and RLS gives it no rows. The Console never uses the service-role key
(member-03-anamika.md, security section). Reading the KPI views for a report therefore needs one of:

1. a `SECURITY DEFINER` function such as `report_data(p_facility_id uuid, p_from date, p_to date)` that the route calls
   with the secret checked first, returning only that facility's aggregates; or
2. the scheduler (database side) reading the views itself and passing the figures to the route; or
3. an explicit, documented exception allowing the service-role key in the report route only.

**Decided 28 Nov 2026 (OQ-72): option 1.** Migration `0013_report_data.sql` adds `report_data(p_secret, p_facility_id, p_from, p_to)`. Because the route reaches the database with the public anon key, the function checks the shared secret itself (against a stored SHA-256), not only the route. It is not yet applied or verified against a database; see OQ-72. Owners: Anamika with Akanksha and Afzal.

## 7. No ingest change requested

`public.ingest_events(events jsonb)` already exists in migration 0004 and is owned by Afzal. CON-07 and CON-09 need
read policies and the contracts above; they do not require an ingest signature or detector change.
