-- pgTAP tests for migration 0006_conflict_detector.sql (SYNC-05). Run with `pnpm test:db`.
-- Events are inserted as the superuser; the triggers fire for any inserter. Rolled back at the end.
begin;
select plan(24);

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.organizations (id, name) values ('00000000-0000-0000-0000-00000000000f', 'Org');
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000f', 'F1', 'Asia/Kolkata', 10),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000f', 'F2', 'Asia/Kolkata', 10);
insert into public.staff (id, facility_id, name, pin_hash, pin_salt) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1', 'g1', 'h', 's'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000f2', 'g2', 'h', 's');
insert into public.devices (id, facility_id, name, auth_user_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 'Gate 1',
   '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f2', 'Gate 2', null);

-- helpers: n builds ids, entry/exit insert one event for facility F1 device d1
create function pg_temp.id(n int) returns uuid language sql as
  $$ select ('018f0000-0000-7000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.entry(n int, sess int, plate text default null, fac int default 1) returns void
language sql as $$
  insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version, payload)
  values (pg_temp.id(n), ('00000000-0000-0000-0000-0000000000f' || fac)::uuid,
          ('00000000-0000-0000-0000-0000000000d' || fac)::uuid, ('00000000-0000-0000-0000-0000000000b' || fac)::uuid,
          'ENTRY', pg_temp.id(sess), now(), 1,
          jsonb_strip_nulls(jsonb_build_object('vehicle_class', 'CAR',
            'zone_id', '00000000-0000-0000-0000-0000000000c1', 'short_code', '7K2QX', 'vehicle_no', plate))) $$;
create function pg_temp.exit(n int, sess int) returns void language sql as $$
  insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version, payload)
  values (pg_temp.id(n), '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1',
          '00000000-0000-0000-0000-0000000000b1', 'EXIT', pg_temp.id(sess), now(), 1,
          '{"fare_paise":5000,"exit_method":"SCAN"}') $$;

-- PAPER_BACKFILL / skew helper
create function pg_temp.skewed(n int, sess int, offset_min int, src text default 'LIVE') returns void language sql as $$
  insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, received_at, source, schema_version, payload)
  values (pg_temp.id(n), '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1',
          '00000000-0000-0000-0000-0000000000b1', 'ENTRY', pg_temp.id(sess),
          '2026-10-01T10:00:00Z'::timestamptz + make_interval(mins => offset_min), '2026-10-01T10:00:00Z', src, 1,
          '{"vehicle_class":"CAR","zone_id":"00000000-0000-0000-0000-0000000000c1","short_code":"7K2QX"}') $$;
create function pg_temp.n_open(t text) returns int language sql as
  $$ select count(*)::int from public.sync_conflicts where type = t and status = 'OPEN' $$;

-- structure and privileges
select has_table('public', 'sync_conflicts', 'sync_conflicts exists');
select is((select relrowsecurity from pg_class where oid = 'public.sync_conflicts'::regclass), true, 'RLS enabled');
select is(has_table_privilege('authenticated', 'public.sync_conflicts', 'INSERT,UPDATE,DELETE'), false,
  'authenticated cannot write sync_conflicts');
select is(has_table_privilege('anon', 'public.sync_conflicts', 'SELECT'), false, 'anon cannot read sync_conflicts');

-- clean data
select pg_temp.entry(1, 101, 'UP32AB1234');
select pg_temp.exit(2, 101);
select pg_temp.entry(3, 102, 'UP32AB1234');  -- same plate re-enters after a proper exit
select is((select count(*)::int from public.sync_conflicts), 0, 'clean data (entry, exit, re-entry) creates no conflict');

-- DUPLICATE_EXIT
select pg_temp.exit(4, 102);
select pg_temp.exit(5, 102);
select is(pg_temp.n_open('DUPLICATE_EXIT'), 1, 'two exits for one session create one open DUPLICATE_EXIT');
select is((select event_ids from public.sync_conflicts where type = 'DUPLICATE_EXIT'),
  array[pg_temp.id(4), pg_temp.id(5)], 'the conflict lists both exit ids');
select pg_temp.exit(6, 102);
select is((select cardinality(event_ids) from public.sync_conflicts where type = 'DUPLICATE_EXIT'), 3,
  'a third exit is appended to the open conflict');
select is(pg_temp.n_open('DUPLICATE_EXIT'), 1, 'still one open DUPLICATE_EXIT per session');
select is((select count(*)::int from public.events where type = 'EXIT' and session_id = pg_temp.id(102)), 3,
  'all three exit events are kept');

-- ORPHAN_EXIT, and its automatic resolution when the entry arrives
select pg_temp.exit(7, 103);
select is(pg_temp.n_open('ORPHAN_EXIT'), 1, 'an exit without an entry creates an ORPHAN_EXIT');
select pg_temp.entry(8, 103);
select is(pg_temp.n_open('ORPHAN_EXIT'), 0, 'the late entry closes the orphan conflict');
select is((select detail ->> 'resolution' from public.sync_conflicts where type = 'ORPHAN_EXIT'), 'entry_arrived',
  'resolution note is entry_arrived');
select ok((select resolved_at is not null and status = 'RESOLVED' from public.sync_conflicts where type = 'ORPHAN_EXIT'),
  'the resolved conflict has status and timestamp set');
select is((select count(*)::int from public.sync_conflicts where type = 'ORPHAN_EXIT'), 1,
  'no further orphan conflict for an in-order entry/exit pair');

-- DUPLICATE_ENTRY: same plate (normalized), two sessions open at once, same facility
select pg_temp.entry(10, 110, 'up32 AB 1234');
select pg_temp.entry(11, 111, 'UP32AB1234');
select is(pg_temp.n_open('DUPLICATE_ENTRY'), 1, 'the same plate open twice creates one DUPLICATE_ENTRY');
select is((select event_ids from public.sync_conflicts where type = 'DUPLICATE_ENTRY'),
  array[pg_temp.id(10), pg_temp.id(11)], 'the conflict lists both entry ids, first entry first');
select pg_temp.entry(12, 112, 'UP32AB1234', 2);
select pg_temp.entry(13, 113);
select is(pg_temp.n_open('DUPLICATE_ENTRY'), 1, 'another facility and entries without a plate add no conflict');

-- CLOCK_SKEW
select pg_temp.skewed(20, 120, 6);
select pg_temp.skewed(21, 121, -4);
select pg_temp.skewed(22, 122, 90, 'PAPER_BACKFILL');
select is(pg_temp.n_open('CLOCK_SKEW'), 1, 'only the event 6 minutes off creates CLOCK_SKEW');
select is((select event_ids from public.sync_conflicts where type = 'CLOCK_SKEW'), array[pg_temp.id(20)],
  'the skewed event is the one recorded');
select is((select (detail ->> 'skew_seconds')::int from public.sync_conflicts where type = 'CLOCK_SKEW'), 360,
  'the skew is recorded in seconds');

-- a failing detector never loses the event
alter table public.sync_conflicts add constraint t_always_fails check (false) not valid;
select lives_ok($$select pg_temp.exit(30, 130)$$, 'the event insert succeeds even when conflict creation fails');
alter table public.sync_conflicts drop constraint t_always_fails;
select is((select count(*)::int from public.events where id = pg_temp.id(30)), 1, 'the event was stored');
select is((select count(*)::int from public.sync_conflicts where dedupe_key = pg_temp.id(130)), 0,
  'and no conflict row was left behind');

select * from finish();
rollback;
