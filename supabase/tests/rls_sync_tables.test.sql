-- pgTAP tests for the 0010_rls.sql policies on the sync-derived and Console-written tables (open_sessions 0005,
-- sync_conflicts 0006, shift_reviews and conflict_resolutions 0007) and for the facilities column privileges. Run with
-- `pnpm test:db`. Principals are simulated with request.jwt.claims plus SET ROLE; fixtures are superuser inserts.
-- Not covered (blocked): overstay and stale-device alerts (OQ-46 default threshold, OQ-47, OQ-48), resolve_conflict() (OQ-49).
begin;
select plan(40);

create function public.t_count(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.t_count(text) to authenticated, anon;

-- Fixtures: org A with facilities A1, A2; org B with B1. Users: owner of A (o1), manager A1 (m1), manager A2 (m2),
-- owner of B (xo), device user at A1 (g1).
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-000000000a00', 'A'), ('00000000-0000-0000-0000-000000000b00', 'B');
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000a00', 'A1', 'Asia/Kolkata', 10),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000a00', 'A2', 'Asia/Kolkata', 10),
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000b00', 'B1', 'Asia/Kolkata', 10);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000f01', 'o1@test.invalid'), ('00000000-0000-0000-0000-000000000f02', 'm1@test.invalid'),
  ('00000000-0000-0000-0000-000000000f03', 'm2@test.invalid'), ('00000000-0000-0000-0000-000000000f04', 'xo@test.invalid'),
  ('00000000-0000-0000-0000-000000000f05', 'g1@test.invalid');
insert into public.memberships (user_id, org_id, facility_id, role) values
  ('00000000-0000-0000-0000-000000000f01', '00000000-0000-0000-0000-000000000a00', null, 'owner'),
  ('00000000-0000-0000-0000-000000000f02', '00000000-0000-0000-0000-000000000a00', '00000000-0000-0000-0000-000000000a01', 'manager'),
  ('00000000-0000-0000-0000-000000000f03', '00000000-0000-0000-0000-000000000a00', '00000000-0000-0000-0000-000000000a02', 'manager'),
  ('00000000-0000-0000-0000-000000000f04', '00000000-0000-0000-0000-000000000b00', null, 'owner');
insert into public.devices (id, facility_id, name, auth_user_id) values
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000a01', 'D1', '00000000-0000-0000-0000-000000000f05'),
  ('00000000-0000-0000-0000-000000000d02', '00000000-0000-0000-0000-000000000a02', 'D2', null);
insert into public.staff (id, facility_id, name, pin_hash, pin_salt) values
  ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000a01', 'S1', 'h', 's'),
  ('00000000-0000-0000-0000-000000000c02', '00000000-0000-0000-0000-000000000a02', 'S2', 'h', 's');

-- Events (PAPER_BACKFILL: no clock-skew conflicts). The triggers from 0005/0006 build open_sessions.
create function pg_temp.entry(fac uuid, dev uuid, st uuid, sess uuid, ts timestamptz) returns void language sql as $$
  insert into public.events (id, facility_id, device_id, staff_id, type, session_id, payload, device_time, source, schema_version)
  values (gen_random_uuid(), fac, dev, st, 'ENTRY', sess,
          jsonb_build_object('zone_id', gen_random_uuid(), 'vehicle_class', 'car', 'short_code', 'ABCDE'), ts, 'PAPER_BACKFILL', 1);
$$;
-- A1: three open sessions.
select pg_temp.entry('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000c01',
  '00000000-0000-0000-0000-000000000e01', timestamptz '2026-06-01 12:00:00+00' - interval '239 minutes');
select pg_temp.entry('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000c01',
  '00000000-0000-0000-0000-000000000e02', timestamptz '2026-06-01 12:00:00+00' - interval '240 minutes');
select pg_temp.entry('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000c01',
  '00000000-0000-0000-0000-000000000e03', timestamptz '2026-06-01 12:00:00+00' - interval '241 minutes');
-- A2: one open session.
select pg_temp.entry('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000d02', '00000000-0000-0000-0000-000000000c02',
  '00000000-0000-0000-0000-000000000e04', timestamptz '2026-06-01 12:00:00+00' - interval '61 minutes');
-- A1: one closed session (entry then exit), which leaves no open_sessions row.
select pg_temp.entry('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000c01',
  '00000000-0000-0000-0000-000000000e05', timestamptz '2026-06-01 12:00:00+00' - interval '600 minutes');
insert into public.events (id, facility_id, device_id, staff_id, type, session_id, payload, device_time, source, schema_version)
values (gen_random_uuid(), '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000d01',
        '00000000-0000-0000-0000-000000000c01', 'EXIT', '00000000-0000-0000-0000-000000000e05', '{"fare_paise":0,"exit_method":"SCAN"}',
        timestamptz '2026-06-01 12:00:00+00' - interval '500 minutes', 'PAPER_BACKFILL', 1);
-- A shift for the review policy, and one conflict (a duplicate exit) in A1 and one in B1's absence
insert into public.events (id, facility_id, device_id, staff_id, type, session_id, payload, device_time, source, schema_version)
values (gen_random_uuid(), '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000d01',
        '00000000-0000-0000-0000-000000000c01', 'SHIFT_CLOSE', null,
        '{"shift_id":"00000000-0000-0000-0000-0000000000a1","counted_cash_paise":0,"expected_cash_paise":0,"upi_total_declared_paise":0,"upi_attested_sum_paise":0,"variance_cash_paise":0,"variance_upi_paise":0}',
        timestamptz '2026-06-01 11:00:00+00', 'PAPER_BACKFILL', 1);
insert into public.sync_conflicts (id, facility_id, type, event_ids, session_id, dedupe_key) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000a01', 'DUPLICATE_EXIT',
   array[gen_random_uuid()], '00000000-0000-0000-0000-000000000e05', '00000000-0000-0000-0000-000000000e05');

-- ---- open_sessions and sync_conflicts policies ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f02","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.open_sessions), 3::bigint, 'manager of A1 reads open sessions of A1 only');
select is((select count(*) from public.sync_conflicts), 1::bigint, 'manager of A1 reads conflicts of A1');
select throws_ok($$select public.t_count($x$delete from public.open_sessions$x$)$$, '42501', null, 'nobody can delete open_sessions directly');
select throws_ok($$select public.t_count($x$update public.sync_conflicts set status = 'RESOLVED'$x$)$$, '42501', null,
  'a manager cannot edit sync_conflicts directly');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f03","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.open_sessions), 1::bigint, 'manager of A2 reads only A2 open sessions');
select is((select count(*) from public.sync_conflicts), 0::bigint, 'manager of A2 reads no conflicts of A1');
-- The 0009 KPI views are security_invoker, so they inherit the events policy: A2's one entry, nothing from A1.
select results_eq($$select facility_id::text, sum(entries)::int from public.v_hourly group by facility_id$$,
  $$values ('00000000-0000-0000-0000-000000000a02', 1)$$, 'manager of A2 sees only A2 in v_hourly (KPI views follow RLS)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f04","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.open_sessions) + (select count(*) from public.sync_conflicts),
  0::bigint, 'the owner of another organization reads none of them');
select is((select count(*) from public.v_hourly) + (select count(*) from public.v_daily_kpis), 0::bigint,
  'the owner of another organization reads no KPI rows of organization A');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f01","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.open_sessions), 4::bigint, 'the organization owner reads the open sessions of A1 and A2');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000f05","role":"authenticated","app_metadata":{"role":"device","device_id":"00000000-0000-0000-0000-000000000d01","facility_id":"00000000-0000-0000-0000-000000000a01"}}',
  true);
set local role authenticated;
select is((select count(*) from public.open_sessions), 3::bigint, 'a device reads open_sessions of its own facility');
select is((select count(*) from public.sync_conflicts), 0::bigint, 'a device reads no conflicts');
reset role;
update public.devices set revoked_at = now() where id = '00000000-0000-0000-0000-000000000d01';
set local role authenticated;
select is((select count(*) from public.open_sessions), 0::bigint, 'a revoked device reads no open_sessions (fails closed)');
reset role;

-- ---- shift_reviews ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f02","role":"authenticated"}', true);
set local role authenticated;
select is(public.t_count($$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status, note) values ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000f02', 'approved', 'ok')$$),
  1::bigint, 'a manager signs off a closed shift of their facility');
select throws_ok($$select public.t_count($x$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status) values ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-000000000f02', 'approved')$x$)$$,
  '42501', null, 'a shift with no SHIFT_CLOSE event cannot be reviewed');
select throws_ok($$select public.t_count($x$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status) values ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000f03', 'flagged')$x$)$$,
  '42501', null, 'the reviewer must be the caller (no review in someone else''s name)');
select throws_ok($$select public.t_count($x$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status) values ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000f02', 'approved')$x$)$$,
  '23505', null, 'the duplicate-click guard rejects the same (shift, reviewer, status)');
select throws_ok($$select public.t_count($x$update public.shift_reviews set note = 'edited'$x$)$$, '42501', null, 'reviews are append-only (no update)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f03","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.shift_reviews), 0::bigint, 'a manager of another facility cannot read the review');
select throws_ok($$select public.t_count($x$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status) values ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000f03', 'flagged')$x$)$$,
  '42501', null, 'a manager of another facility cannot review this facility''s shift');
reset role;

-- ---- conflict_resolutions ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f02","role":"authenticated"}', true);
set local role authenticated;
select is(public.t_count($$insert into public.conflict_resolutions (conflict_id, action, resolved_by) values ('00000000-0000-0000-0000-0000000000c1', 'KEEP_FIRST', '00000000-0000-0000-0000-000000000f02')$$),
  1::bigint, 'a manager resolves a conflict of their facility');
select throws_ok($$select public.t_count($x$insert into public.conflict_resolutions (conflict_id, action, note, resolved_by) values ('00000000-0000-0000-0000-0000000000c1', 'ADD_NOTE', '  ', '00000000-0000-0000-0000-000000000f02')$x$)$$,
  '23514', null, 'ADD_NOTE needs a note');
select throws_ok($$select public.t_count($x$update public.sync_conflicts set status = 'RESOLVED'$x$)$$, '42501', null,
  'resolving never edits the conflict row directly (status change needs an agreed function, OQ-49)');
select throws_ok($$select public.t_count($x$update public.events set source = 'LIVE'$x$)$$, '42501', null, 'resolving never edits events');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f03","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.t_count($x$insert into public.conflict_resolutions (conflict_id, action, resolved_by) values ('00000000-0000-0000-0000-0000000000c1', 'MARK_AS_TEST_ENTRY', '00000000-0000-0000-0000-000000000f03')$x$)$$,
  '42501', null, 'a manager of another facility cannot resolve this conflict');
select is((select count(*) from public.conflict_resolutions), 0::bigint, 'and cannot read its resolutions');
reset role;
select is_empty(
  $$select table_name, privilege_type from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public'
      and table_name in ('shift_reviews', 'conflict_resolutions', 'open_sessions', 'sync_conflicts')
      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'UPDATE', 'DELETE')$$,
  'no TRUNCATE/REFERENCES/TRIGGER/UPDATE/DELETE for authenticated on the sync-derived and Console-written tables');

-- ---- facilities: org_id (and id, created_at) are immutable for application roles; the editable columns still work ----
select ok(not has_column_privilege('authenticated', 'public.facilities', 'org_id', 'UPDATE'), 'authenticated has no UPDATE on facilities.org_id');
select ok(not has_column_privilege('authenticated', 'public.facilities', 'id', 'UPDATE'), 'authenticated has no UPDATE on facilities.id');
select ok(has_column_privilege('authenticated', 'public.facilities', 'name', 'UPDATE')
  and has_column_privilege('authenticated', 'public.facilities', 'timezone', 'UPDATE')
  and has_column_privilege('authenticated', 'public.facilities', 'slot_count', 'UPDATE'),
  'authenticated keeps UPDATE on name, timezone and slot_count');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f01","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.t_count($x$update public.facilities set org_id = '00000000-0000-0000-0000-000000000b00' where id = '00000000-0000-0000-0000-000000000a01'$x$)$$,
  '42501', null, 'an owner cannot move a facility into another organization (org_id update is denied)');
select throws_ok($$select public.t_count($x$update public.facilities set org_id = org_id where id = '00000000-0000-0000-0000-000000000a01'$x$)$$,
  '42501', null, 'even a no-op write to org_id is denied (the privilege is column-level, not value-level)');
select throws_ok($$select public.t_count($x$update public.facilities set id = gen_random_uuid() where id = '00000000-0000-0000-0000-000000000a01'$x$)$$,
  '42501', null, 'an owner cannot change a facility id');
select throws_ok($$select public.t_count($x$update public.facilities set created_at = now() where id = '00000000-0000-0000-0000-000000000a01'$x$)$$,
  '42501', null, 'an owner cannot change created_at');
select is(public.t_count($$update public.facilities set name = 'A1 renamed' where id = '00000000-0000-0000-0000-000000000a01'$$), 1::bigint,
  'an owner can still rename their facility');
select is(public.t_count($$update public.facilities set timezone = 'Asia/Dubai', slot_count = 12 where id = '00000000-0000-0000-0000-000000000a01'$$), 1::bigint,
  'an owner can still change timezone and slot_count together');
select is(public.t_count($$update public.facilities set name = 'not mine' where id = '00000000-0000-0000-0000-000000000b01'$$), 0::bigint,
  'an owner cannot edit a facility of another organization (RLS still decides which rows)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f02","role":"authenticated"}', true);
set local role authenticated;
select is(public.t_count($$update public.facilities set name = 'manager edit' where id = '00000000-0000-0000-0000-000000000a01'$$), 0::bigint,
  'a manager still cannot update the facility (owner-only policy)');
reset role;
select results_eq(
  $$select org_id::text, name, timezone, slot_count from public.facilities where id = '00000000-0000-0000-0000-000000000a01'$$,
  $$values ('00000000-0000-0000-0000-000000000a00', 'A1 renamed', 'Asia/Dubai', 12)$$,
  'after the attempts the facility is still in its organization, with only the permitted edits applied');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f04","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.facilities where id = '00000000-0000-0000-0000-000000000a01'), 0::bigint,
  'the owner of the other organization still cannot see the facility');
reset role;

select * from finish();
rollback;
