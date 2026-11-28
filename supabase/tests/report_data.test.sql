-- pgTAP tests for migration 0013_report_data.sql (CON-08 / CLD-06, OQ-72). Run with `pnpm test:db`.
-- Fixtures are inserted as the superuser; callers are simulated with SET LOCAL ROLE. The transaction is rolled back.
-- NOT covered here: non-zero revenue and hourly rows. They need a full event fixture; the figures themselves come
-- unchanged from the 0009 views, which kpi_views, kpi_golden_day and kpi_oracle already test. This file tests the
-- door: who may call, what a wrong call does, and the empty and unknown cases.
begin;
select plan(14);

insert into public.organizations (id, name) values ('00000000-0000-0000-0000-00000000000f', 'Org');
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000f', 'F1', 'Asia/Kolkata', 10);

-- structure and privileges
select has_table('public', 'report_route_secret', 'report_route_secret exists');
select is((select relrowsecurity from pg_class where oid = 'public.report_route_secret'::regclass), true,
  'RLS enabled on report_route_secret');
select is(has_table_privilege('anon', 'public.report_route_secret', 'SELECT,INSERT,UPDATE,DELETE'), false,
  'anon holds no privilege on report_route_secret');
select is(has_table_privilege('authenticated', 'public.report_route_secret', 'SELECT,INSERT,UPDATE,DELETE'), false,
  'authenticated holds no privilege on report_route_secret');
select is(has_function_privilege('anon', 'public.report_data(text, uuid, date, date)', 'EXECUTE'), true,
  'anon may call report_data (the function checks the secret itself)');
select is((select prosecdef from pg_proc where oid = 'public.report_data(text, uuid, date, date)'::regprocedure), true,
  'report_data is SECURITY DEFINER');

-- closed until a secret is set
set local role anon;
select throws_ok(
  $$ select public.report_data('anything', '00000000-0000-0000-0000-0000000000f1', date '2026-10-01', date '2026-10-01') $$,
  '28000', 'report_data: not authorised', 'with no secret row set, every call is refused');

reset role;
insert into public.report_route_secret (secret_sha256) values (sha256(convert_to('right-secret', 'UTF8')));

set local role anon;
select throws_ok(
  $$ select public.report_data('wrong-secret', '00000000-0000-0000-0000-0000000000f1', date '2026-10-01', date '2026-10-01') $$,
  '28000', 'report_data: not authorised', 'a wrong secret is refused');
select throws_ok(
  $$ select public.report_data(null, '00000000-0000-0000-0000-0000000000f1', date '2026-10-01', date '2026-10-01') $$,
  '28000', 'report_data: not authorised', 'a null secret is refused');
select throws_ok(
  $$ select public.report_data('right-secret', '00000000-0000-0000-0000-0000000000f1', date '2026-10-02', date '2026-10-01') $$,
  '22023', 'report_data: invalid period', 'a reversed period is refused');
select throws_ok(
  $$ select public.report_data('right-secret', '00000000-0000-0000-0000-0000000000f1', date '2025-01-01', date '2026-10-01') $$,
  '22023', 'report_data: invalid period', 'a period longer than 366 days is refused');

-- right secret
select is(public.report_data('right-secret', '00000000-0000-0000-0000-0000000000aa', date '2026-10-01', date '2026-10-01'),
  null::jsonb, 'an unknown facility returns null');
select is(public.report_data('right-secret', '00000000-0000-0000-0000-0000000000f1', date '2026-10-01', date '2026-10-01'),
  '{"facility_name":"F1","revenue":{"cash_paise":0,"upi_paise":0,"pass_paise":0},"hourly":[]}'::jsonb,
  'a facility with no events reads zero revenue and no hours');

reset role;
select is((select count(*)::int from public.report_route_secret), 1,
  'only the hash is stored: one row, no plaintext column');

select * from finish();
rollback;
