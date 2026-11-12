-- pgTAP tests for 0010_rls.sql (CLD-03) on the base tables, and for heartbeat() (0008, CLD-04) as called by RLS
-- principals. Run with `pnpm test:db`. Covers the D.3 permission matrix for the base tables, device fail-closed behaviour
-- (revoked device, mismatched claims), the heartbeat read policy, and T-CLD-04-U1/I1/N1/N2 under real principals
-- (device_heartbeats.test.sql covers heartbeat() itself). The 0005-0007 tables are in rls_sync_tables.test.sql.
-- NOT covered (blocked): job_runs, audit_log, enroll_device, and the IC-09 contract test against Afzal's sender.
-- Principals are simulated with request.jwt.claims plus SET ROLE; fixtures are inserted as the superuser.
begin;
select plan(111);

-- Helper that runs one DML statement as the current role and returns the affected row count. Errors propagate.
create function public.t_count(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.t_count(text) to authenticated, anon;

-- Fixtures ------------------------------------------------------------------------------------------------------
-- orgs: A (..0a00), B (..0b00). facilities: A1 (..0a01), A2 (..0a02) in A; B1 (..0b01) in B.
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-000000000a00', 'Org A'), ('00000000-0000-0000-0000-000000000b00', 'Org B');
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000a00', 'A1', 'Asia/Kolkata', 10),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000a00', 'A2', 'Asia/Kolkata', 10),
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000b00', 'B1', 'Asia/Kolkata', 10);
-- users: owner of A (f01), manager A1 (f02), manager A2 (f03), owner of B (f04), device users (f05, f06, f07), stranger (f08)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000f01', 'o@test.invalid'), ('00000000-0000-0000-0000-000000000f02', 'm1@test.invalid'),
  ('00000000-0000-0000-0000-000000000f03', 'm2@test.invalid'), ('00000000-0000-0000-0000-000000000f04', 'xo@test.invalid'),
  ('00000000-0000-0000-0000-000000000f05', 'g1@test.invalid'), ('00000000-0000-0000-0000-000000000f06', 'g2@test.invalid'),
  ('00000000-0000-0000-0000-000000000f07', 'gr@test.invalid'), ('00000000-0000-0000-0000-000000000f08', 's@test.invalid'),
  ('00000000-0000-0000-0000-000000000f09', 'n@test.invalid');
insert into public.memberships (user_id, org_id, facility_id, role) values
  ('00000000-0000-0000-0000-000000000f01', '00000000-0000-0000-0000-000000000a00', null, 'owner'),
  ('00000000-0000-0000-0000-000000000f02', '00000000-0000-0000-0000-000000000a00', '00000000-0000-0000-0000-000000000a01', 'manager'),
  ('00000000-0000-0000-0000-000000000f03', '00000000-0000-0000-0000-000000000a00', '00000000-0000-0000-0000-000000000a02', 'manager'),
  ('00000000-0000-0000-0000-000000000f04', '00000000-0000-0000-0000-000000000b00', null, 'owner');
-- devices: D1 at A1 (user f05), D2 at A2 (f06), DR at A1 revoked (f07)
insert into public.devices (id, facility_id, name, auth_user_id, revoked_at) values
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000a01', 'D1', '00000000-0000-0000-0000-000000000f05', null),
  ('00000000-0000-0000-0000-000000000d02', '00000000-0000-0000-0000-000000000a02', 'D2', '00000000-0000-0000-0000-000000000f06', null),
  ('00000000-0000-0000-0000-000000000d03', '00000000-0000-0000-0000-000000000a01', 'DR', '00000000-0000-0000-0000-000000000f07', now());
insert into public.staff (id, facility_id, name, pin_hash, pin_salt, active) values
  ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000a01', 'S1 active', 'h', 's', true),
  ('00000000-0000-0000-0000-000000000c02', '00000000-0000-0000-0000-000000000a01', 'S1 inactive', 'h', 's', false),
  ('00000000-0000-0000-0000-000000000c03', '00000000-0000-0000-0000-000000000a02', 'S2 active', 'h', 's', true);
insert into public.zones (id, facility_id, name, capacity, vehicle_class) values
  ('00000000-0000-0000-0000-000000000e01', '00000000-0000-0000-0000-000000000a01', 'Z1', 5, 'car'),
  ('00000000-0000-0000-0000-000000000e02', '00000000-0000-0000-0000-000000000a02', 'Z2', 5, 'car'),
  ('00000000-0000-0000-0000-000000000e03', '00000000-0000-0000-0000-000000000b01', 'ZB', 5, 'car');
insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version) values
  ('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000d01',
   '00000000-0000-0000-0000-000000000c01', 'ENTRY', '00000000-0000-0000-0000-000000000801', now(), 1);
insert into public.enrollment_codes (code_hash, facility_id, expires_at) values
  ('hash-a1', '00000000-0000-0000-0000-000000000a01', now() + interval '10 minutes');

-- Catalog checks ------------------------------------------------------------------------------------------------
select is_empty(
  $$select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity$$,
  'T-CLD-02-U1: every public table has row level security enabled');
select is_empty(
  $$select policyname from pg_policies where schemaname = 'public'
    and (lower(btrim(qual)) in ('true', '(true)') or lower(btrim(with_check)) in ('true', '(true)'))$$,
  'T-CLD-03-N3: no policy is literally true');
select is_empty(
  $$select policyname from pg_policies where schemaname = 'public' and not ('authenticated' = any (roles))$$,
  'every policy is scoped to the authenticated role only');
select columns_are('public', 'staff_for_device', array['id', 'name', 'pin_hash', 'pin_salt', 'active'],
  'IC-06: staff_for_device exposes exactly id, name, pin_hash, pin_salt, active');
select col_type_is('public', 'device_heartbeats', 'received_at', 'timestamp with time zone',
  'device_heartbeats.received_at is timestamptz');

-- Owner of org A (organization-wide membership) -------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f01","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.organizations), 1::bigint, 'owner sees only their organization');
select is((select count(*) from public.facilities), 2::bigint, 'owner sees both facilities of the organization');
select is((select count(*) from public.zones), 2::bigint, 'owner sees zones of A1 and A2 only (not org B)');
select is((select count(*) from public.events), 1::bigint, 'owner reads events');
select is((select count(*) from public.memberships), 3::bigint, 'owner reads all memberships of the organization only');
select is(public.t_count($$update public.facilities set name = 'A1b' where id = '00000000-0000-0000-0000-000000000a01'$$), 1::bigint,
  'owner can update a facility');
select is(public.t_count($$delete from public.organizations where id = '00000000-0000-0000-0000-000000000a00'$$), 0::bigint,
  'owner cannot delete the organization (no delete policy)');
select is(public.t_count($$insert into public.zones (facility_id, name, capacity, vehicle_class) values ('00000000-0000-0000-0000-000000000a02', 'Z2b', 1, 'car')$$), 1::bigint,
  'owner can insert a zone in A2');
select throws_ok(
  $$select public.t_count($x$insert into public.zones (facility_id, name, capacity, vehicle_class) values ('00000000-0000-0000-0000-000000000b01', 'bad', 1, 'car')$x$)$$,
  '42501', null, 'owner cannot insert a zone in another organization');
select is(public.t_count($$insert into public.memberships (user_id, org_id, facility_id, role) values ('00000000-0000-0000-0000-000000000f09', '00000000-0000-0000-0000-000000000a00', '00000000-0000-0000-0000-000000000a01', 'manager')$$), 1::bigint,
  'owner can add a membership inside their organization');
select throws_ok(
  $$select public.t_count($x$insert into public.memberships (user_id, org_id, facility_id, role) values ('00000000-0000-0000-0000-000000000f08', '00000000-0000-0000-0000-000000000b00', null, 'owner')$x$)$$,
  '42501', null, 'owner cannot grant a membership in another organization');
reset role;

-- Manager of A1 -------------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f02","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.facilities), 1::bigint, 'manager sees only their facility');
select is((select count(*) from public.organizations), 1::bigint, 'manager sees their organization');
select is((select count(*) from public.zones), 1::bigint, 'manager sees zones of A1 only');
select is((select count(*) from public.staff), 2::bigint, 'manager reads staff of A1');
select is((select count(*) from public.devices), 2::bigint, 'manager reads devices of A1');
select is((select count(*) from public.enrollment_codes), 1::bigint, 'manager reads enrollment codes of A1');
select is((select count(*) from public.events), 1::bigint, 'manager reads events of A1');
select is((select count(*) from public.memberships), 2::bigint,
  'manager reads the membership rows of their facility (own row and the one the owner added), not the owner row');
select is(public.t_count($$update public.facilities set name = 'x' where id = '00000000-0000-0000-0000-000000000a01'$$), 0::bigint,
  'manager cannot update the facility');
select is(public.t_count($$insert into public.zones (facility_id, name, capacity, vehicle_class) values ('00000000-0000-0000-0000-000000000a01', 'Z1b', 1, 'car')$$), 1::bigint,
  'manager can insert a zone in A1');
select throws_ok(
  $$select public.t_count($x$insert into public.zones (facility_id, name, capacity, vehicle_class) values ('00000000-0000-0000-0000-000000000a02', 'bad', 1, 'car')$x$)$$,
  '42501', null, 'manager cannot insert a zone in A2');
select is(public.t_count($$insert into public.enrollment_codes (code_hash, facility_id, expires_at) values ('hash-new', '00000000-0000-0000-0000-000000000a01', now() + interval '10 minutes')$$), 1::bigint,
  'manager can create an enrollment code for their facility');
select throws_ok(
  $$select public.t_count($x$insert into public.enrollment_codes (code_hash, facility_id, expires_at) values ('hash-bad', '00000000-0000-0000-0000-000000000a02', now() + interval '10 minutes')$x$)$$,
  '42501', null, 'T-CLD-03-N6: manager cannot create an enrollment code for another facility');
select throws_ok(
  $$select public.t_count($x$insert into public.memberships (user_id, org_id, facility_id, role) values ('00000000-0000-0000-0000-000000000f08', '00000000-0000-0000-0000-000000000a00', '00000000-0000-0000-0000-000000000a01', 'manager')$x$)$$,
  '42501', null, 'manager cannot write memberships');
select throws_ok(
  $$select public.t_count($x$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000c01', 'ENTRY', gen_random_uuid(), now(), 1)$x$)$$,
  '42501', null, 'manager cannot insert events directly');
select throws_ok($$select public.t_count($x$update public.events set source = 'LIVE'$x$)$$, '42501', null,
  'manager cannot update events');
select throws_ok($$select public.t_count($x$delete from public.events$x$)$$, '42501', null,
  'T-CLD-08-N2: manager cannot delete events');
-- Regression (review of #34): a manager must not take over a device identity and write events in a guard's name.
select throws_ok(
  $$select public.t_count($x$update public.devices set auth_user_id = '00000000-0000-0000-0000-000000000f02' where id = '00000000-0000-0000-0000-000000000d01'$x$)$$,
  '42501', null, 'manager cannot repoint devices.auth_user_id to their own user');
select throws_ok(
  $$select public.t_count($x$insert into public.devices (facility_id, name, auth_user_id) values ('00000000-0000-0000-0000-000000000a01', 'forged', '00000000-0000-0000-0000-000000000f02')$x$)$$,
  '42501', null, 'manager cannot insert a device (devices come from the enrollment function, IC-05)');
select throws_ok($$select public.ingest_events('[]'::jsonb)$$, '42501', null,
  'so ingest_events still refuses the manager: no device row points at their user');
select is(public.t_count($$update public.devices set name = 'D1 gate' where id = '00000000-0000-0000-0000-000000000d01'$$), 1::bigint,
  'manager can still rename a device of their facility');
-- Regression (review of #34): managers never read or write PIN material.
select throws_ok($$select pin_hash from public.staff$$, '42501', null, 'manager cannot read staff.pin_hash');
select throws_ok($$select pin_salt from public.staff$$, '42501', null, 'manager cannot read staff.pin_salt');
select is((select count(*) from (select id, facility_id, name, phone, active, created_at from public.staff) s), 2::bigint,
  'manager reads the non-secret staff columns the Console uses');
select throws_ok(
  $$select public.t_count($x$update public.staff set pin_hash = 'x' where id = '00000000-0000-0000-0000-000000000c01'$x$)$$,
  '42501', null, 'manager cannot overwrite a PIN hash directly (PINs are set only through set_staff_pin, IC-06)');
select throws_ok(
  $$select public.t_count($x$insert into public.staff (facility_id, name, pin_hash, pin_salt) values ('00000000-0000-0000-0000-000000000a01', 'forged', 'h', 's')$x$)$$,
  '42501', null, 'manager cannot insert staff with a chosen PIN hash');
select is(public.t_count($$update public.staff set active = false where id = '00000000-0000-0000-0000-000000000c02'$$), 1::bigint,
  'manager can still deactivate a guard');
reset role;

-- Device at A1 (valid) ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000f05","role":"authenticated","app_metadata":{"role":"device","device_id":"00000000-0000-0000-0000-000000000d01","facility_id":"00000000-0000-0000-0000-000000000a01","org_id":"00000000-0000-0000-0000-000000000a00"}}',
  true);
set local role authenticated;
select is((select count(*) from public.facilities), 1::bigint, 'device sees only its own facility');
select is((select count(*) from public.zones where facility_id <> '00000000-0000-0000-0000-000000000a01'), 0::bigint,
  'T-CLD-03-I3: device reads only zones of its facility');
select is((select count(*) from public.zones), 2::bigint, 'device reads both zones of its facility (A1 now has two)');
select is((select count(*) from public.zones where facility_id = '00000000-0000-0000-0000-000000000a02'), 0::bigint,
  'T-CLD-03-N2: device cannot read another facility');
select is((select count(*) from public.staff), 0::bigint, 'device cannot read the staff base table');
select is((select count(*) from public.staff_for_device), 1::bigint,
  'device reads only active staff of its facility through staff_for_device');
select is((select count(*) from public.devices), 0::bigint, 'device cannot read devices');
select is((select count(*) from public.enrollment_codes), 0::bigint, 'device cannot read enrollment codes');
select is((select count(*) from public.events), 0::bigint, 'device reads no events (fail closed, sync design pending)');
select is((select count(*) from public.organizations), 0::bigint, 'device cannot read organizations');
select is((select count(*) from public.memberships), 0::bigint, 'device cannot read memberships');
select throws_ok($$select public.t_count($x$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000c01', 'ENTRY', gen_random_uuid(), now(), 1)$x$)$$,
  '42501', null, 'T-CLD-03-N1: device cannot insert events directly');
select throws_ok($$select public.t_count($x$update public.events set source = 'LIVE'$x$)$$, '42501', null,
  'T-CLD-03-N1: device cannot update events');
select throws_ok($$select public.t_count($x$delete from public.events$x$)$$, '42501', null,
  'T-CLD-03-N1: device cannot delete events');
select throws_ok(
  $$select public.t_count($x$insert into public.zones (facility_id, name, capacity, vehicle_class) values ('00000000-0000-0000-0000-000000000a01', 'bad', 1, 'car')$x$)$$,
  '42501', null, 'device cannot write zones');
reset role;

-- Device at A2 ---------------------------------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000f06","role":"authenticated","app_metadata":{"role":"device","device_id":"00000000-0000-0000-0000-000000000d02","facility_id":"00000000-0000-0000-0000-000000000a02"}}',
  true);
set local role authenticated;
select is((select count(*) from public.zones where facility_id = '00000000-0000-0000-0000-000000000a01'), 0::bigint,
  'device at A2 cannot read zones of A1');
select is((select name from public.staff_for_device), 'S2 active', 'device at A2 sees only its own staff');
reset role;

-- Device fail-closed cases -----------------------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000f07","role":"authenticated","app_metadata":{"role":"device","device_id":"00000000-0000-0000-0000-000000000d03","facility_id":"00000000-0000-0000-0000-000000000a01"}}',
  true);
set local role authenticated;
select is((select count(*) from public.zones), 0::bigint, 'T-CLD-03-I4: a revoked device reads nothing (fails closed)');
select is((select count(*) from public.staff_for_device), 0::bigint, 'a revoked device reads no staff');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000f05","role":"authenticated","app_metadata":{"role":"device","device_id":"00000000-0000-0000-0000-000000000d01","facility_id":"00000000-0000-0000-0000-000000000a02"}}',
  true);
set local role authenticated;
select is((select count(*) from public.zones), 0::bigint, 'a token whose facility claim does not match the device row reads nothing');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000f05","role":"authenticated","app_metadata":{"device_id":"00000000-0000-0000-0000-000000000d01","facility_id":"00000000-0000-0000-0000-000000000a01"}}',
  true);
set local role authenticated;
select is((select count(*) from public.zones), 0::bigint, 'a token without the device role claim reads nothing');
reset role;

-- Other organization and strangers ------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f04","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.facilities), 1::bigint, 'owner of org B sees only B1');
select is((select count(*) from public.zones where facility_id = '00000000-0000-0000-0000-000000000a01'), 0::bigint,
  'owner of org B cannot read zones of org A');
select is((select count(*) from public.events), 0::bigint, 'owner of org B cannot read events of org A');
select throws_ok(
  $$select public.t_count($x$insert into public.zones (facility_id, name, capacity, vehicle_class) values ('00000000-0000-0000-0000-000000000a01', 'bad', 1, 'car')$x$)$$,
  '42501', null, 'owner of org B cannot insert into org A');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f08","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.organizations), 0::bigint, 'a user without membership sees no organization');
select is((select count(*) from public.facilities), 0::bigint, 'a user without membership sees no facility');
select is(public.is_member('00000000-0000-0000-0000-000000000a01', array['owner', 'manager']), false,
  'T-CLD-03-U1: is_member is false without a membership');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.organizations$$, '42501', null, 'anon cannot read organizations');
select throws_ok($$select count(*) from public.zones$$, '42501', null, 'anon cannot read zones');
reset role;

-- is_member truth table (as superuser the function reads auth.uid() from the claims) ---------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f02","role":"authenticated"}', true);
select is(public.is_member('00000000-0000-0000-0000-000000000a01', array['manager']), true, 'T-CLD-03-U1: manager is a member of A1');
select is(public.is_member('00000000-0000-0000-0000-000000000a02', array['manager']), false, 'T-CLD-03-U1: manager of A1 is not a member of A2');
select is(public.is_member('00000000-0000-0000-0000-000000000a01', array['owner']), false, 'T-CLD-03-U1: manager does not hold the owner role');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f01","role":"authenticated"}', true);
select is(public.is_member('00000000-0000-0000-0000-000000000a02', array['owner']), true, 'T-CLD-03-U1: organization-wide owner is a member of every facility of the org');
select is(public.is_member('00000000-0000-0000-0000-000000000b01', array['owner']), false, 'T-CLD-03-U1: owner of org A is not a member of org B facilities');

-- Heartbeat (CLD-04) ----------------------------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000f05","role":"authenticated","app_metadata":{"role":"device","device_id":"00000000-0000-0000-0000-000000000d01","facility_id":"00000000-0000-0000-0000-000000000a01"}}',
  true);
set local role authenticated;
select is(public.heartbeat(device_id => '00000000-0000-0000-0000-000000000d01', queue_depth => 3, oldest_unsynced_age => 10,
  app_version => '1.0.0', schema_version => 1, battery => 80), true, 'T-CLD-04-I1: the first heartbeat is stored');
select is(public.heartbeat('00000000-0000-0000-0000-000000000d01', 9, 99, '1.0.1', 1, 70), false,
  'T-CLD-04-I1: a second heartbeat inside 5 minutes is ignored without error');
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-000000000d02', 0, 0, '1.0.0', 1, 50)$$, '42501', null,
  'T-CLD-04-N1: a device cannot write another device''s heartbeat');
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-000000000d01', -1, 0, '1.0.0', 1, 50)$$, '22023', null,
  'T-CLD-04-U1: negative queue depth is rejected');
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-000000000d01', 0, -5, '1.0.0', 1, 50)$$, '22023', null,
  'negative oldest_unsynced_age is rejected');
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-000000000d01', 0, 0, '1.0.0', 1, 120)$$, '22023', null,
  'T-CLD-04-U1: battery above 100 is rejected');
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-000000000d01', 0, 0, null, 1, 50)$$, '22023', null,
  'T-CLD-04-U1: a null app version is rejected');
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-000000000d01', 0, 0, '1.0.0', 0, 50)$$, '22023', null,
  'a non-positive schema version is rejected');
select throws_ok($$select public.t_count($x$insert into public.device_heartbeats (device_id, facility_id, queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct) values ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000a01', 0, 0, 'x', 1, 1)$x$)$$,
  '42501', null, 'a device cannot write device_heartbeats directly');
select is((select count(*) from public.device_heartbeats), 0::bigint, 'T-CLD-04-N2: a guard device cannot read heartbeats');
reset role;
select is((select count(*) from public.device_heartbeats), 1::bigint, 'exactly one heartbeat row exists for the device');
select results_eq(
  $$select queue_depth, oldest_unsynced_age_s, app_version, schema_version, battery_pct, facility_id::text
    from public.device_heartbeats$$,
  $$values (3, 10, '1.0.0', 1, 80, '00000000-0000-0000-0000-000000000a01')$$,
  'the stored row holds the first accepted values and the device facility');
update public.device_heartbeats set received_at = now() - interval '6 minutes';
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000f05","role":"authenticated","app_metadata":{"role":"device","device_id":"00000000-0000-0000-0000-000000000d01","facility_id":"00000000-0000-0000-0000-000000000a01"}}',
  true);
set local role authenticated;
select is(public.heartbeat('00000000-0000-0000-0000-000000000d01', 9, 99, '1.0.1', 2, 70), true,
  'T-CLD-04-I1: a heartbeat after the window is stored');
reset role;
select results_eq(
  $$select queue_depth, app_version, schema_version, battery_pct from public.device_heartbeats$$,
  $$values (9, '1.0.1', 2, 70)$$, 'the row reflects the latest accepted values');
update public.device_heartbeats set received_at = now() - interval '4 minutes 59 seconds';
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000f05","role":"authenticated","app_metadata":{"role":"device","device_id":"00000000-0000-0000-0000-000000000d01","facility_id":"00000000-0000-0000-0000-000000000a01"}}',
  true);
set local role authenticated;
select is(public.heartbeat('00000000-0000-0000-0000-000000000d01', 1, 1, '1.0.2', 2, 60), false,
  'a heartbeat 4 minutes 59 seconds after the last one is still ignored');
reset role;

-- Revoked device and missing role claim cannot send heartbeats
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000f07","role":"authenticated","app_metadata":{"role":"device","device_id":"00000000-0000-0000-0000-000000000d03","facility_id":"00000000-0000-0000-0000-000000000a01"}}',
  true);
set local role authenticated;
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-000000000d03', 0, 0, '1.0.0', 1, 50)$$, '42501', null,
  'a revoked device cannot send a heartbeat');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000f05","role":"authenticated","app_metadata":{"device_id":"00000000-0000-0000-0000-000000000d01"}}',
  true);
set local role authenticated;
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-000000000d01', 0, 0, '1.0.0', 1, 50)$$, '42501', null,
  'a token without the device role claim cannot send a heartbeat');
reset role;
set local role anon;
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-000000000d01', 0, 0, '1.0.0', 1, 50)$$, '42501', null,
  'anon cannot call heartbeat');
reset role;

-- Heartbeat read policy
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f02","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.device_heartbeats), 1::bigint, 'manager of A1 reads the heartbeat of their facility');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f03","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.device_heartbeats), 0::bigint, 'manager of A2 cannot read heartbeats of A1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f01","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.device_heartbeats), 1::bigint, 'owner reads heartbeats of the organization');
reset role;

-- Privilege boundary (regression for the TRUNCATE/REFERENCES/TRIGGER finding)
select is_empty(
  $$select table_name, privilege_type from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public'
      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')$$,
  'authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any public table');
select is_empty(
  $$select table_name from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'$$,
  'anon holds no privilege on any public table');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f01","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$truncate public.zones$$, '42501', null, 'an owner cannot TRUNCATE a tenant table (RLS would not stop it)');
reset role;

select is_empty(
  $$select privilege_type from information_schema.role_table_grants
    where grantee = 'authenticated' and table_name = 'staff_for_device' and privilege_type <> 'SELECT'$$,
  'staff_for_device is read-only for authenticated (it runs as its owner, so a write would bypass RLS on staff)');
select is_empty(
  $$select table_name, column_name, privilege_type from information_schema.column_privileges
    where grantee = 'authenticated' and table_schema = 'public'
      and ((table_name = 'staff' and column_name in ('pin_hash', 'pin_salt'))
        or (table_name = 'devices' and privilege_type in ('INSERT', 'UPDATE')
            and column_name not in ('name', 'revoked_at')))$$,
  'authenticated holds no privilege on PIN columns and cannot write device identity columns');

-- A token carrying device claims for D1 but issued to another auth user (D2's user) reads nothing
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000f06","role":"authenticated","app_metadata":{"role":"device","device_id":"00000000-0000-0000-0000-000000000d01","facility_id":"00000000-0000-0000-0000-000000000a01"}}',
  true);
set local role authenticated;
select is((select count(*) from public.zones where facility_id = '00000000-0000-0000-0000-000000000a01'), 0::bigint,
  'a device token claiming another device''s identity reads nothing');
reset role;

-- Revocation takes effect on the very next request with the same token
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000f05","role":"authenticated","app_metadata":{"role":"device","device_id":"00000000-0000-0000-0000-000000000d01","facility_id":"00000000-0000-0000-0000-000000000a01"}}',
  true);
set local role authenticated;
select ok((select count(*) from public.zones) > 0, 'before revocation the device reads its zones');
reset role;
update public.devices set revoked_at = now() where id = '00000000-0000-0000-0000-000000000d01';
set local role authenticated;
select is((select count(*) from public.zones), 0::bigint, 'after revocation the same token reads no zones');
select is((select count(*) from public.staff_for_device), 0::bigint, 'after revocation the same token reads no staff');
select throws_ok($$select public.heartbeat('00000000-0000-0000-0000-000000000d01', 0, 0, '1.0.0', 1, 50)$$, '42501', null,
  'after revocation the same token cannot send a heartbeat');
reset role;

-- Removing a membership removes access immediately
delete from public.memberships where user_id = '00000000-0000-0000-0000-000000000f02';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000f02","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.facilities), 0::bigint, 'a manager whose membership was removed sees no facility');
reset role;

-- The catalog check above is the enforcement for FUTURE tables: a new table that keeps Supabase default grants is detected
create table public.zz_future_table (id int);
select isnt_empty(
  $$select privilege_type from information_schema.role_table_grants
    where grantee = 'authenticated' and table_name = 'zz_future_table'
      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')$$,
  'a later table that keeps the default grants would be caught by the catalog check');
drop table public.zz_future_table;

select * from finish();
rollback;
