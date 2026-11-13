-- pgTAP tests for migration 0005_open_sessions.sql (SYNC-02, part 2). Run with `pnpm test:db`.
-- Events are inserted as the superuser (the trigger fires for any inserter); one end-to-end case goes through
-- ingest_events. The transaction is rolled back at the end.
begin;
select plan(27);

insert into auth.users (id) values ('00000000-0000-4000-8000-0000000000a1'), ('00000000-0000-4000-8000-0000000000a3');
insert into public.organizations (id, name) values ('00000000-0000-4000-8000-00000000000f', 'Org');
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000f', 'F1', 'Asia/Kolkata', 10),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-00000000000f', 'F2', 'Asia/Kolkata', 10);
insert into public.staff (id, facility_id, name, pin_hash, pin_salt) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000f1', 'g1', 'h', 's'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000f2', 'g2', 'h', 's');
insert into public.devices (id, facility_id, name, auth_user_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f1', 'Gate 1',
   '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000f2', 'Gate 2',
   '00000000-0000-4000-8000-0000000000a3');

-- helpers: n builds ids, entry/exit insert one event for facility F1 device d1
create function pg_temp.id(n int) returns uuid language sql as
  $$ select ('018f0000-0000-7000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.entry(n int, sess int, plate text default null, fac int default 1) returns void
language sql as $$
  insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version, payload)
  values (pg_temp.id(n), ('00000000-0000-4000-8000-0000000000f' || fac)::uuid,
          ('00000000-0000-4000-8000-0000000000d' || fac)::uuid, ('00000000-0000-4000-8000-0000000000b' || fac)::uuid,
          'ENTRY', pg_temp.id(sess), now(), 1,
          jsonb_strip_nulls(jsonb_build_object('vehicle_class', 'CAR',
            'zone_id', '00000000-0000-4000-8000-0000000000c1', 'short_code', '7K2QX', 'vehicle_no', plate))) $$;
create function pg_temp.exit(n int, sess int) returns void language sql as $$
  insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version, payload)
  values (pg_temp.id(n), '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1',
          '00000000-0000-4000-8000-0000000000b1', 'EXIT', pg_temp.id(sess), now(), 1,
          '{"fare_paise":5000,"exit_method":"SCAN"}') $$;

-- normalize_vehicle_no
select is(public.normalize_vehicle_no('up32 AB-1234'), 'UP32AB1234', 'plate is uppercased and stripped');
select is(public.normalize_vehicle_no(' - '), null, 'a plate with nothing left is NULL');
select is(public.normalize_vehicle_no(null), null, 'NULL stays NULL');

-- structure and privileges
select has_table('public', 'open_sessions', 'open_sessions exists');
select is((select relrowsecurity from pg_class where oid = 'public.open_sessions'::regclass), true, 'RLS enabled');
select is(has_table_privilege('authenticated', 'public.open_sessions', 'INSERT,UPDATE,DELETE'), false,
  'authenticated cannot write open_sessions');
select is(has_table_privilege('anon', 'public.open_sessions', 'SELECT'), false, 'anon cannot read open_sessions');

-- ENTRY opens a session
select pg_temp.entry(1, 101, 'up32 ab 1234');
select is((select count(*)::int from public.open_sessions), 1, 'an ENTRY opens one session');
select results_eq(
  $$select session_id, entry_event_id, vehicle_class, short_code, vehicle_no, zone_id
    from public.open_sessions$$,
  $$values (pg_temp.id(101), pg_temp.id(1), 'CAR', '7K2QX', 'UP32AB1234',
            '00000000-0000-4000-8000-0000000000c1'::uuid)$$,
  'the row carries the entry data and a normalized plate');
select is((select entry_time from public.open_sessions), (select device_time from public.events where id = pg_temp.id(1)),
  'entry_time is the ENTRY device_time');

-- a plate is optional
select pg_temp.entry(2, 102);
select is((select vehicle_no from public.open_sessions where session_id = pg_temp.id(102)), null,
  'an ENTRY without a plate has NULL vehicle_no');

-- a second ENTRY event for the same session changes nothing
select pg_temp.entry(3, 101, 'UP32AB1234');
select is((select count(*)::int from public.open_sessions where session_id = pg_temp.id(101)), 1,
  'a repeated session id keeps one row');
select is((select entry_event_id from public.open_sessions where session_id = pg_temp.id(101)), pg_temp.id(1),
  'the first ENTRY wins');

-- EXIT closes the session
select pg_temp.exit(10, 101);
select is((select count(*)::int from public.open_sessions where session_id = pg_temp.id(101)), 0,
  'an EXIT removes the open session');
select is((select count(*)::int from public.open_sessions), 1, 'other sessions are untouched');
select is((select count(*)::int from public.events where session_id = pg_temp.id(101)), 3,
  'events are kept (1 + 1 + 1)');

-- out of order: EXIT first, then ENTRY
select pg_temp.exit(11, 103);
select pg_temp.entry(4, 103);
select is((select count(*)::int from public.open_sessions where session_id = pg_temp.id(103)), 0,
  'an ENTRY that arrives after its EXIT does not open a session');

-- an EXIT for an unknown session is harmless
select lives_ok($$select pg_temp.exit(12, 999)$$, 'an orphan EXIT does not fail');

-- sessions of another facility are not closed by a same-numbered session id
select pg_temp.entry(5, 104, null, 2);
select pg_temp.exit(13, 104);  -- F1 exit with the same session id
select is((select count(*)::int from public.open_sessions where session_id = pg_temp.id(104)), 1,
  'an EXIT does not close a session of another facility');

-- the same session id in two facilities: both stay open (keyed per facility)
select pg_temp.entry(20, 105, null, 1);
select pg_temp.entry(21, 105, null, 2);
select is((select count(*)::int from public.open_sessions where session_id = pg_temp.id(105)), 2,
  'one session id used in two facilities opens one session in each');

-- an ENTRY stored without the required payload keys is kept but opens nothing
select lives_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version)
    values ('018f0000-0000-7000-8000-000000000203', '00000000-0000-4000-8000-0000000000f1',
            '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1', 'ENTRY',
            '018f0000-0000-7000-8000-000000000106', now(), 1)$$,
  'a raw ENTRY without payload keys is stored (and opens no session)');

-- end to end through ingest_events (device d1 of F1)
create table public.t_out (r jsonb);
grant all on public.t_out to authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
insert into public.t_out select public.ingest_events(jsonb_build_array(
  '{"id":"018f0000-0000-7000-8000-000000000201","type":"ENTRY","facility_id":"00000000-0000-4000-8000-0000000000f1","device_id":"00000000-0000-4000-8000-0000000000d1","staff_id":"00000000-0000-4000-8000-0000000000b1","session_id":"018f0000-0000-7000-8000-000000000301","device_time":"2026-10-01T10:00:00.000Z","source":"PAPER_BACKFILL","schema_version":1,"payload":{"vehicle_class":"CAR","zone_id":"00000000-0000-4000-8000-0000000000c1","short_code":"7K2QX"}}'::jsonb));
reset role;
select is((select count(*)::int from public.open_sessions where session_id = '018f0000-0000-7000-8000-000000000301'), 1,
  'an event ingested through ingest_events opens a session');
select is((select r ->> 'accepted' from public.t_out), '1', 'ingest_events reports it accepted');
-- a malformed zone_id or pass_id never stops the event from being stored: no session, a warning, the event stays
select lives_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version, payload)
    values ('018f0000-0000-7000-8000-000000000202', '00000000-0000-4000-8000-0000000000f1',
            '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1', 'ENTRY',
            '018f0000-0000-7000-8000-000000000107', now(), 1,
            '{"vehicle_class":"CAR","zone_id":"not-a-uuid","short_code":"7K2QX"}')$$,
  'an ENTRY with a malformed zone_id is still stored');
select is((select count(*)::int from public.events where id = '018f0000-0000-7000-8000-000000000202')
        + (select count(*)::int from public.open_sessions where session_id = '018f0000-0000-7000-8000-000000000107'),
  1, 'the event is kept and no session was opened for it');

-- Facility isolation under the 0010_rls.sql policies: a device reads its own facility's sessions and never another
-- facility's. A device is identified by its auth user plus the app_metadata claims (role, device_id, facility_id) that
-- public.device_facility() checks against the devices row.
create table public.t_seen (label text primary key, n int);
grant all on public.t_seen to authenticated;

-- auth.uid() prefers the flat request.jwt.claim.sub, which the ingest section above left set to device a1; PostgREST
-- sends only request.jwt.claims, so clear the flat one to simulate a real device request.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated","app_metadata":{"role":"device","device_id":"00000000-0000-4000-8000-0000000000d2","facility_id":"00000000-0000-4000-8000-0000000000f2"}}',
  true);
set local role authenticated;
insert into public.t_seen select 'f2_sees_f1', count(*)::int from public.open_sessions
  where facility_id = '00000000-0000-4000-8000-0000000000f1';
insert into public.t_seen select 'f2_sees_f2', count(*)::int from public.open_sessions
  where facility_id = '00000000-0000-4000-8000-0000000000f2';
reset role;
select is((select n from public.t_seen where label = 'f2_sees_f1'), 0,
  'a device of facility 2 sees none of facility 1''s open sessions');
select cmp_ok((select n from public.t_seen where label = 'f2_sees_f2'), '>', 0,
  'a device of facility 2 sees its own open sessions');
select * from finish();
rollback;
