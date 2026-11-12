-- pgTAP tests for migration 0008_device_heartbeats.sql (CLD-04). Run with `pnpm test:db`.
-- Fixtures are inserted as the superuser; callers are simulated with request.jwt.claims plus SET LOCAL ROLE.
-- The transaction is rolled back at the end. The read policy arrives with 0010_rls.sql and is not tested here.
begin;
select plan(48);

-- Fixtures: one organization, two facilities; devices d1 (F1), d2 (F2), d3 (F1, revoked), d4 (F1, deleted in a test).
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3');
insert into public.organizations (id, name) values ('00000000-0000-0000-0000-00000000000f', 'Org');
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000f', 'F1', 'Asia/Kolkata', 10),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000f', 'F2', 'Asia/Kolkata', 10);
insert into public.devices (id, facility_id, name, auth_user_id, revoked_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 'Gate 1',
   '00000000-0000-0000-0000-0000000000a1', null),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f2', 'Gate 2',
   '00000000-0000-0000-0000-0000000000a2', null),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000f1', 'Gate 3',
   '00000000-0000-0000-0000-0000000000a3', now()),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000f1', 'Gate 4', null, null);

-- Sets the caller identity. Called as the superuser, before SET LOCAL ROLE.
create function pg_temp.claims(usr uuid, meta jsonb) returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', usr, 'role', 'authenticated', 'app_metadata', meta))::text, true) $$;
create function pg_temp.device_meta(dev uuid) returns jsonb language sql as $$
  select jsonb_build_object('role', 'device', 'device_id', dev) $$;

-- structure and privileges
select has_table('public', 'device_heartbeats', 'device_heartbeats exists');
select is((select relrowsecurity from pg_class where oid = 'public.device_heartbeats'::regclass), true,
  'RLS enabled on device_heartbeats');
select is(has_table_privilege('anon', 'public.device_heartbeats', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'), false,
  'anon holds no privileges on device_heartbeats');
select is(has_table_privilege('authenticated', 'public.device_heartbeats', 'INSERT,UPDATE,DELETE,TRUNCATE'), false,
  'authenticated cannot write device_heartbeats directly');
select columns_are('public', 'device_heartbeats',
  array['device_id', 'facility_id', 'received_at', 'queue_depth', 'oldest_unsynced_age_s', 'app_version',
        'schema_version', 'battery_pct'], 'device_heartbeats columns');
select col_is_pk('public', 'device_heartbeats', 'device_id', 'one row per device: device_id is the primary key');
select col_type_is('public', 'device_heartbeats', 'received_at', 'timestamp with time zone',
  'device_heartbeats.received_at is timestamptz');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'device_heartbeats'
                  and indexname = 'device_heartbeats_facility_received_idx'),
  'device_heartbeats has the (facility, received_at) index');
select has_function('public', 'heartbeat', array['uuid', 'integer', 'integer', 'text', 'integer', 'integer'],
  'heartbeat(uuid, integer, integer, text, integer, integer) exists');
select is((select prosecdef from pg_proc where oid = 'public.heartbeat(uuid, integer, integer, text, integer, integer)'::regprocedure),
  true, 'heartbeat is SECURITY DEFINER');
select is(has_function_privilege('anon', 'public.heartbeat(uuid, integer, integer, text, integer, integer)', 'EXECUTE'), false,
  'anon cannot execute heartbeat');
select is(has_function_privilege('authenticated', 'public.heartbeat(uuid, integer, integer, text, integer, integer)', 'EXECUTE'), true,
  'authenticated can execute heartbeat');

-- table constraints (direct inserts as the superuser)
select lives_ok($$insert into public.device_heartbeats
  (device_id, facility_id, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 0, 0, '1.0.0', 1, 100)$$,
  'a valid heartbeat row can be inserted (zero queue, full battery)');
select is((select received_at = now() from public.device_heartbeats), true, 'received_at defaults to the database time');
select throws_ok($$insert into public.device_heartbeats
  (device_id, facility_id, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 1, 1, '1.0.0', 1, 50)$$, '23505', null,
  'a second row for the same device is rejected');
select throws_ok($$insert into public.device_heartbeats
  (device_id, facility_id, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f2', -1, 0, '1.0.0', 1, 50)$$, '23514', null,
  'a negative queue_depth is rejected');
select throws_ok($$insert into public.device_heartbeats
  (device_id, facility_id, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f2', 0, -1, '1.0.0', 1, 50)$$, '23514', null,
  'a negative oldest_unsynced_age_s is rejected');
select throws_ok($$insert into public.device_heartbeats
  (device_id, facility_id, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f2', 0, 0, '   ', 1, 50)$$, '23514', null,
  'a blank app_version is rejected');
select throws_ok($$insert into public.device_heartbeats
  (device_id, facility_id, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f2', 0, 0, '1.0.0', 0, 50)$$, '23514', null,
  'a non-positive schema_version is rejected');
select throws_ok($$insert into public.device_heartbeats
  (device_id, facility_id, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f2', 0, 0, '1.0.0', 1, 101)$$, '23514', null,
  'battery_pct above 100 is rejected');
select throws_ok($$insert into public.device_heartbeats
  (device_id, facility_id, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f2', 0, 0, '1.0.0', 1, -1)$$, '23514', null,
  'a negative battery_pct is rejected');
select throws_ok($$insert into public.device_heartbeats
  (device_id, facility_id, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f2', null, 0, '1.0.0', 1, 50)$$, '23502', null,
  'a null queue_depth is rejected');
select throws_ok($$insert into public.device_heartbeats
  (device_id, facility_id, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f1', 0, 0, '1.0.0', 1, 50)$$, '23503', null,
  'a heartbeat cannot carry a facility other than its device''s');
select throws_ok($$insert into public.device_heartbeats
  (device_id, facility_id, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct) values
  ('00000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-0000000000f1', 0, 0, '1.0.0', 1, 50)$$, '23503', null,
  'a heartbeat for an unknown device is rejected');
insert into public.device_heartbeats
  (device_id, facility_id, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct) values
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000f1', 0, 0, '1.0.0', 1, 50);
delete from public.devices where id = '00000000-0000-0000-0000-0000000000d4';
select is((select count(*)::int from public.device_heartbeats where device_id = '00000000-0000-0000-0000-0000000000d4'), 0,
  'deleting a device deletes its heartbeat row');

-- heartbeat(): accepted calls. Start from an empty table.
delete from public.device_heartbeats;
select pg_temp.claims('00000000-0000-0000-0000-0000000000a1', pg_temp.device_meta('00000000-0000-0000-0000-0000000000d1'));
set local role authenticated;
select is(public.heartbeat(device_id => '00000000-0000-0000-0000-0000000000d1', queue_depth => 3, oldest_unsynced_age => 10,
  app_version => '1.0.0', schema_version => 1, battery => 80), true, 'the first heartbeat is stored');
select is(public.heartbeat('00000000-0000-0000-0000-0000000000d1', 9, 99, '1.0.1', 2, 70), false,
  'a second heartbeat inside the 5-minute window is ignored without error');
reset role;
select results_eq(
  $$select queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct, facility_id::text
    from public.device_heartbeats$$,
  $$values (3, 10, '1.0.0', 1, 80, '00000000-0000-0000-0000-0000000000f1')$$,
  'the row holds the first accepted values and the facility of the device');
select is((select received_at = now() from public.device_heartbeats), true, 'received_at is the database time');

update public.device_heartbeats set received_at = now() - interval '4 minutes 59 seconds';
select pg_temp.claims('00000000-0000-0000-0000-0000000000a1', pg_temp.device_meta('00000000-0000-0000-0000-0000000000d1'));
set local role authenticated;
select is(public.heartbeat('00000000-0000-0000-0000-0000000000d1', 1, 1, '1.0.2', 2, 60), false,
  'a heartbeat 4 minutes 59 seconds after the last one is still ignored');
reset role;

update public.device_heartbeats set received_at = now() - interval '6 minutes';
select pg_temp.claims('00000000-0000-0000-0000-0000000000a1', pg_temp.device_meta('00000000-0000-0000-0000-0000000000d1'));
set local role authenticated;
select is(public.heartbeat('00000000-0000-0000-0000-0000000000d1', 9, 99, '1.0.1', 2, 70), true,
  'a heartbeat after the window is stored');
reset role;
select results_eq(
  $$select queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct from public.device_heartbeats$$,
  $$values (9, 99, '1.0.1', 2, 70)$$, 'the single row now holds the latest accepted values');
select is((select received_at = now() from public.device_heartbeats), true, 'the accepted update refreshes received_at');

select pg_temp.claims('00000000-0000-0000-0000-0000000000a2', pg_temp.device_meta('00000000-0000-0000-0000-0000000000d2'));
set local role authenticated;
select is(public.heartbeat('00000000-0000-0000-0000-0000000000d2', 0, 0, '1.0.0', 1, 50), true,
  'another device stores its own heartbeat independently');
reset role;
select is((select facility_id from public.device_heartbeats where device_id = '00000000-0000-0000-0000-0000000000d2'),
  '00000000-0000-0000-0000-0000000000f2'::uuid, 'the facility comes from the devices table, not from the caller');
select is((select count(*)::int from public.device_heartbeats), 2, 'one row per device');

-- heartbeat(): malformed values are rejected, not clamped
select pg_temp.claims('00000000-0000-0000-0000-0000000000a1', pg_temp.device_meta('00000000-0000-0000-0000-0000000000d1'));
set local role authenticated;
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-0000000000d1', -1, 0, '1.0.0', 1, 50)$$, '22023', null,
  'a negative queue depth is rejected');
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-0000000000d1', 0, -5, '1.0.0', 1, 50)$$, '22023', null,
  'a negative oldest_unsynced_age is rejected');
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-0000000000d1', 0, 0, '1.0.0', 1, 120)$$, '22023', null,
  'a battery above 100 is rejected');
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-0000000000d1', 0, 0, '1.0.0', 1, null)$$, '22023', null,
  'a null battery is rejected');
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-0000000000d1', 0, 0, ' ', 1, 50)$$, '22023', null,
  'a blank app version is rejected');
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-0000000000d1', 0, 0, '1.0.0', 0, 50)$$, '22023', null,
  'a non-positive schema version is rejected');
reset role;

-- heartbeat(): identity fails closed with one generic error
select pg_temp.claims('00000000-0000-0000-0000-0000000000a1', pg_temp.device_meta('00000000-0000-0000-0000-0000000000d1'));
set local role authenticated;
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-0000000000d2', 0, 0, '1.0.0', 1, 50)$$, '42501', null,
  'a device cannot write another device''s heartbeat');
reset role;
select pg_temp.claims('00000000-0000-0000-0000-0000000000a1', pg_temp.device_meta('00000000-0000-0000-0000-0000000000d2'));
set local role authenticated;
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-0000000000d1', 0, 0, '1.0.0', 1, 50)$$, '42501', null,
  'a device claim that differs from the argument is rejected');
reset role;
select pg_temp.claims('00000000-0000-0000-0000-0000000000a1', jsonb_build_object('device_id', '00000000-0000-0000-0000-0000000000d1'));
set local role authenticated;
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-0000000000d1', 0, 0, '1.0.0', 1, 50)$$, '42501', null,
  'a token without the device role claim is rejected');
reset role;
select pg_temp.claims('00000000-0000-0000-0000-0000000000a3', pg_temp.device_meta('00000000-0000-0000-0000-0000000000d3'));
set local role authenticated;
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-0000000000d3', 0, 0, '1.0.0', 1, 50)$$, '42501', null,
  'a revoked device cannot send a heartbeat');
-- direct writes stay closed even for the device itself
select throws_ok($$update public.device_heartbeats set battery_pct = 1$$, '42501', null,
  'authenticated cannot update device_heartbeats directly');
reset role;
set local role anon;
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-0000000000d1', 0, 0, '1.0.0', 1, 50)$$, '42501', null,
  'anon cannot call heartbeat');
reset role;

select * from finish();
rollback;
