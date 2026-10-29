-- pgTAP tests for migrations 0001 and 0002 (CLD-02). Run with `pnpm test:db` or `npx supabase@2.122.0 test db` (Docker).
-- Fixtures are inserted as the superuser; the transaction is rolled back at the end.
begin;
select plan(53);

-- Tables exist
select has_table('organizations', 'public');
select has_table('facilities', 'public');
select has_table('zones', 'public');
select has_table('tariffs', 'public');
select has_table('passes', 'public');
select has_table('staff', 'public');
select has_table('devices', 'public');
select has_table('memberships', 'public');
select has_table('enrollment_codes', 'public');



-- RLS enabled on EVERY table in public (T-CLD-02-U1), and no literal-true policy exists (T-CLD-03-N3 precursor)
select is_empty(
  $$select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity$$,
  'every public table has RLS enabled'
);
select is_empty(
  $$select policyname from pg_policies
    where schemaname = 'public' and (qual ~ '^\(*true\)*$' or with_check ~ '^\(*true\)*$')$$,
  'no policy is literally true'
);
select is_empty(
  $$select table_name from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'
      and table_name in ('organizations','facilities','zones','tariffs','passes',
                         'staff','devices','memberships','enrollment_codes')$$,
  'anon holds no grants on these tables'
);

-- Column types (T-CLD-02-X1): integer money, timestamptz times
-- Five-argument form (schema, table, column, type, description): the four-argument forms are ambiguous
-- when every argument is an untyped literal.
select col_type_is('public', 'passes', 'dues', 'integer', 'passes.dues is integer paise');
select col_type_is('public', 'passes', 'valid_to', 'date', 'passes.valid_to is a date');
select col_type_is('public', 'tariffs', 'effective_from', 'timestamp with time zone',
  'tariffs.effective_from is timestamptz');
select col_type_is('public', 'devices', 'enrolled_at', 'timestamp with time zone',
  'devices.enrolled_at is timestamptz');
select col_type_is('public', 'enrollment_codes', 'expires_at', 'timestamp with time zone',
  'enrollment_codes.expires_at is timestamptz');
select col_type_is('public', 'enrollment_codes', 'used_at', 'timestamp with time zone',
  'enrollment_codes.used_at is timestamptz');

-- Fixtures: two organizations, one facility each, two auth users
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Org A'),
  ('00000000-0000-0000-0000-0000000000b1', 'Org B');
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'A1', 'Asia/Kolkata', 100),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', 'B1', 'Asia/Kolkata', 50);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'owner-a@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'mgr-a@example.test');
-- One valid staff row so the staff RLS assertion below tests a table that actually holds data
-- (the fake hash and salt are placeholders, not a real PIN scheme).
insert into public.staff (id, facility_id, name, pin_hash, pin_salt) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a2',
   'Fixture Guard', 'fixture-hash', 'fixture-salt');

-- Check constraints
select throws_ok(
  $$insert into public.zones (facility_id, name, capacity, vehicle_class)
    values ('00000000-0000-0000-0000-0000000000a2', 'Z', -1, 'CAR')$$,
  '23514', null, 'negative zone capacity is rejected');
select throws_ok(
  $$insert into public.facilities (org_id, name, timezone, slot_count)
    values ('00000000-0000-0000-0000-0000000000a1', 'Bad', 'Asia/Kolkata', -1)$$,
  '23514', null, 'negative slot_count is rejected');
select throws_ok(
  $$insert into public.passes (facility_id, vehicle_no, valid_to, dues)
    values ('00000000-0000-0000-0000-0000000000a2', 'KA01AB1234', current_date, -1)$$,
  '23514', null, 'negative pass dues (paise) is rejected');
select throws_ok(
  $$insert into public.zones (facility_id, name, capacity, vehicle_class)
    values ('00000000-0000-0000-0000-00000000dead', 'Z', 10, 'CAR')$$,
  '23503', null, 'zone must reference an existing facility');
select throws_ok(
  $$insert into public.staff (facility_id, name, pin_hash, pin_salt)
    values ('00000000-0000-0000-0000-00000000dead', 'G', 'h', 's')$$,
  '23503', null, 'staff must reference an existing facility');

-- Memberships: roles restricted to owner | manager | guard
select throws_ok(
  $$insert into public.memberships (user_id, org_id, role)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'admin')$$,
  '23514', null, 'unknown membership role is rejected');
select lives_ok(
  $$insert into public.memberships (user_id, org_id, role)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'owner')$$,
  'org-wide owner membership accepted');
select lives_ok(
  $$insert into public.memberships (user_id, org_id, facility_id, role)
    values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1',
            '00000000-0000-0000-0000-0000000000a2', 'manager')$$,
  'facility manager membership accepted');
select lives_ok(
  $$insert into public.memberships (user_id, org_id, facility_id, role)
    values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1',
            '00000000-0000-0000-0000-0000000000a2', 'guard')$$,
  'guard membership accepted');
select throws_ok(
  $$insert into public.memberships (user_id, org_id, role)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'owner')$$,
  '23505', null, 'duplicate org-wide membership is rejected (null facility counts as equal)');
select throws_ok(
  $$insert into public.memberships (user_id, org_id, facility_id, role)
    values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1',
            '00000000-0000-0000-0000-0000000000b2', 'manager')$$,
  '23503', null, 'membership cannot pair an organization with another organization''s facility');

-- Devices
select throws_ok(
  $$insert into public.devices (facility_id, name)
    values ('00000000-0000-0000-0000-0000000000a2', '')$$,
  '23514', null, 'empty device name is rejected');
select throws_ok(
  $$insert into public.devices (facility_id, name)
    values ('00000000-0000-0000-0000-0000000000a2', repeat('x', 61))$$,
  '23514', null, 'device name over 60 characters is rejected');
select lives_ok(
  $$insert into public.devices (facility_id, name)
    values ('00000000-0000-0000-0000-0000000000a2', repeat('x', 60))$$,
  'device name of 60 characters is accepted');

-- Enrollment codes (storage constraints only; enrollment behaviour is CLD-03)
select lives_ok(
  $$insert into public.enrollment_codes (code_hash, facility_id, created_by, expires_at)
    values ('hash-1', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000c2', now() + interval '10 minutes')$$,
  'enrollment code row accepted');
select throws_ok(
  $$insert into public.enrollment_codes (code_hash, facility_id, expires_at)
    values ('hash-1', '00000000-0000-0000-0000-0000000000a2', now() + interval '10 minutes')$$,
  '23505', null, 'duplicate code_hash is rejected');
select throws_ok(
  $$insert into public.enrollment_codes (code_hash, facility_id, created_at, expires_at)
    values ('hash-2', '00000000-0000-0000-0000-0000000000a2', now(), now() - interval '1 minute')$$,
  '23514', null, 'expires_at must be after created_at');

-- Valid rows and column defaults
select lives_ok(
  $$insert into public.zones (id, facility_id, name, capacity, vehicle_class)
    values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 'Z1', 50, 'CAR')$$,
  'a valid zone is accepted');
select lives_ok(
  $$insert into public.tariffs (facility_id, vehicle_class, rule_json, effective_from)
    values ('00000000-0000-0000-0000-0000000000a2', 'CAR', '{"slabs": []}'::jsonb, now())$$,
  'a valid tariff is accepted');
select lives_ok(
  $$insert into public.passes (facility_id, vehicle_no, valid_to)
    values ('00000000-0000-0000-0000-0000000000a2', 'KA01AB1234', current_date + 30)$$,
  'a pass without dues is accepted');
select is(
  (select dues from public.passes where vehicle_no = 'KA01AB1234'),
  0,
  'passes.dues defaults to 0 paise');
select is(
  (select active from public.staff where id = '00000000-0000-0000-0000-0000000000d1'),
  true,
  'staff.active defaults to true');
select ok(
  (select not attnotnull from pg_attribute
   where attrelid = 'public.staff'::regclass and attname = 'phone'),
  'staff.phone is optional');
select throws_ok(
  $$insert into public.tariffs (facility_id, vehicle_class, rule_json, effective_from)
    values ('00000000-0000-0000-0000-0000000000a2', 'CAR', null, now())$$,
  '23502', null, 'a tariff without rule_json is rejected');

-- Membership uniqueness is per organization: the same user may be org-wide owner of a second organization
select lives_ok(
  $$insert into public.memberships (user_id, org_id, role)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'owner')$$,
  'the same user can own a different organization');

-- Parents cannot be deleted while children exist
select throws_ok(
  $$delete from public.facilities where id = '00000000-0000-0000-0000-0000000000a2'$$,
  '23503', null, 'a facility with children cannot be deleted');
select throws_ok(
  $$delete from public.organizations where id = '00000000-0000-0000-0000-0000000000a1'$$,
  '23503', null, 'an organization with facilities cannot be deleted');

-- Every foreign-key index the migrations promise exists
select is_empty(
  $$select n from unnest(array[
      'facilities_org_id_idx', 'zones_facility_id_idx', 'tariffs_lookup_idx', 'passes_facility_vehicle_idx',
      'staff_facility_id_idx', 'devices_facility_id_idx', 'memberships_user_id_idx', 'memberships_org_id_idx',
      'memberships_facility_id_idx', 'enrollment_codes_facility_id_idx']) as n
    where not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = n)$$,
  'all migration indexes exist');

-- Auth user deletion: memberships cascade, device and enrollment-code references are set to null
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c3', 'device-user@example.test');
insert into public.devices (id, facility_id, name, auth_user_id) values
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000a2', 'Linked phone',
   '00000000-0000-0000-0000-0000000000c3');
select lives_ok(
  $$delete from auth.users
    where id in ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c3')$$,
  'deleting auth users is allowed');
select is(
  (select count(*)::int from public.memberships where user_id = '00000000-0000-0000-0000-0000000000c2'),
  0,
  'memberships are deleted with their auth user');
select ok(
  (select auth_user_id is null from public.devices where id = '00000000-0000-0000-0000-0000000000d5'),
  'devices.auth_user_id is set to null when the auth user is deleted');
select ok(
  (select created_by is null from public.enrollment_codes where code_hash = 'hash-1'),
  'enrollment_codes.created_by is set to null when the auth user is deleted');

-- RLS behaviour: without policies, a signed-in non-member sees no rows (deny by default)
set local role authenticated;
select results_eq(
  $$select count(*)::int from public.organizations$$, array[0],
  'authenticated role sees no organizations while no policy exists');
select results_eq(
  $$select count(*)::int from public.staff$$, array[0],
  'authenticated role sees no staff rows');
select results_eq(
  $$select count(*)::int from public.enrollment_codes$$, array[0],
  'authenticated role sees no enrollment codes');
reset role;

select * from finish();
rollback;
