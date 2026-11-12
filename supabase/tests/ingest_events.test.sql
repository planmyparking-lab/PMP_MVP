-- pgTAP tests for migration 0004_ingest_events.sql (SYNC-02). Run with `pnpm test:db`.
-- ingest_events is SECURITY DEFINER (Afzal's decision): devices have EXECUTE only and cannot insert into events
-- directly. Fixtures are inserted as the superuser; the function is called as `authenticated` with a JWT subject.
-- Results are collected into a helper table so the assertions themselves run as the superuser.
begin;
select plan(36);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000a1'), ('00000000-0000-4000-8000-0000000000a2');
insert into public.organizations (id, name) values ('00000000-0000-4000-8000-00000000000f', 'Org');
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000f', 'F1', 'Asia/Kolkata', 10),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-00000000000f', 'F2', 'Asia/Kolkata', 10);
insert into public.staff (id, facility_id, name, pin_hash, pin_salt, active) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000f1', 'active guard', 'h', 's', true),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000f1', 'inactive guard', 'h', 's', false),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000f2', 'other facility guard', 'h', 's', true);
-- a1 is an enrolled device of F1; a2 is an authenticated user that is not a device
insert into public.devices (id, facility_id, name, auth_user_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f1', 'Gate 1',
   '00000000-0000-4000-8000-0000000000a1');

create table public.test_results (label text primary key, result jsonb);
create table public.test_base (e jsonb);
grant all on public.test_results, public.test_base to authenticated;
insert into public.test_base values ($j$
  {"id":"018f0000-0000-7000-8000-000000000001","type":"ENTRY",
   "facility_id":"00000000-0000-4000-8000-0000000000f1","device_id":"00000000-0000-4000-8000-0000000000d1",
   "staff_id":"00000000-0000-4000-8000-0000000000b1","session_id":"018f0000-0000-7000-8000-0000000000a1",
   "device_time":"2026-10-01T10:00:00.000Z","source":"LIVE","schema_version":1,
   "payload":{"vehicle_class":"CAR","zone_id":"00000000-0000-4000-8000-0000000000c1","short_code":"7K2QX"}} $j$);

-- helper: batch = base event merged with each override
create function pg_temp.call(label text, overrides jsonb[]) returns void language plpgsql as $$
declare b jsonb := (select e from public.test_base); batch jsonb := '[]'; o jsonb;
begin
  foreach o in array overrides loop batch := batch || jsonb_build_array(b || o); end loop;
  insert into public.test_results values (label, public.ingest_events(batch));
end $$;
grant execute on function pg_temp.call(text, jsonb[]) to authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
select pg_temp.call('first', array['{}'::jsonb]);
select pg_temp.call('retry', array['{}'::jsonb]);
select pg_temp.call('collision', array['{"payload":{"vehicle_class":"BIKE","zone_id":"00000000-0000-4000-8000-0000000000c1","short_code":"7K2QX"}}'::jsonb]);
select pg_temp.call('other_facility', array['{"id":"018f0000-0000-7000-8000-000000000002","facility_id":"00000000-0000-4000-8000-0000000000f2"}'::jsonb]);
select pg_temp.call('other_device', array['{"id":"018f0000-0000-7000-8000-000000000003","device_id":"00000000-0000-4000-8000-0000000000d9"}'::jsonb]);
select pg_temp.call('inactive_staff', array['{"id":"018f0000-0000-7000-8000-000000000004","staff_id":"00000000-0000-4000-8000-0000000000b2"}'::jsonb]);
select pg_temp.call('foreign_staff', array['{"id":"018f0000-0000-7000-8000-000000000005","staff_id":"00000000-0000-4000-8000-0000000000b3"}'::jsonb]);
select pg_temp.call('empty_payload', array['{"id":"018f0000-0000-7000-8000-000000000006","payload":{}}'::jsonb]);
select pg_temp.call('unknown_type', array['{"id":"018f0000-0000-7000-8000-000000000007","type":"NOPE"}'::jsonb]);
select pg_temp.call('loose_time', array['{"id":"018f0000-0000-7000-8000-000000000008","device_time":"yesterday"}'::jsonb]);
select pg_temp.call('offset_time', array['{"id":"018f0000-0000-7000-8000-000000000009","device_time":"2026-10-01T10:00:00+05:30"}'::jsonb]);
select pg_temp.call('entry_no_session', array['{"id":"018f0000-0000-7000-8000-00000000000a","session_id":null}'::jsonb]);
select pg_temp.call('version_new', array['{"id":"018f0000-0000-7000-8000-00000000000b","schema_version":2}'::jsonb]);
-- TOO_OLD is checked with a contract-valid version (1) below a server minimum raised to 2 for this one call (rolled back
-- with the test). Version 0 is judged differently by 0004 (TOO_OLD) and the proposed IC-01 validation (INVALID_ENVELOPE,
-- OQ-53), so it is asserted only in supabase/proposed-tests; this suite must pass with and without --proposed.
reset role;
create or replace function public.min_supported_schema_version() returns integer
    language sql immutable parallel safe set search_path = pg_catalog
    as $$ select 2 $$;
set local role authenticated;
select pg_temp.call('version_old', array['{"id":"018f0000-0000-7000-8000-00000000000c","schema_version":1}'::jsonb]);
reset role;
create or replace function public.min_supported_schema_version() returns integer
    language sql immutable parallel safe set search_path = pg_catalog
    as $$ select 1 $$;
set local role authenticated;
select pg_temp.call('version_string', array['{"id":"018f0000-0000-7000-8000-00000000000d","schema_version":"1"}'::jsonb]);
select pg_temp.call('version_fraction', array['{"id":"018f0000-0000-7000-8000-000000000012","schema_version":1.4}'::jsonb]);
select pg_temp.call('version_whole_decimal', array['{"id":"018f0000-0000-7000-8000-000000000013","schema_version":1.0}'::jsonb]);
select pg_temp.call('version_huge', array['{"id":"018f0000-0000-7000-8000-000000000014","schema_version":3000000000}'::jsonb]);
select pg_temp.call('bad_source', array['{"id":"018f0000-0000-7000-8000-00000000000e","source":"HACK"}'::jsonb]);
select pg_temp.call('not_v7', array['{"id":"018f0000-0000-4000-8000-00000000000f"}'::jsonb]);
-- one batch mixing an accepted, a duplicate and a rejected event: the rejection must not roll back the rest
select pg_temp.call('mixed', array[
  '{"id":"018f0000-0000-7000-8000-000000000010","session_id":"018f0000-0000-7000-8000-0000000000a2"}'::jsonb,
  '{}'::jsonb,
  '{"id":"018f0000-0000-7000-8000-000000000011","staff_id":"00000000-0000-4000-8000-0000000000b2"}'::jsonb]);
reset role;

create function pg_temp.status(label text, i int default 0) returns text language sql as
  $$ select (result -> 'results' -> i ->> 'status') || coalesce(':' || (result -> 'results' -> i ->> 'reason'), '')
     from public.test_results where test_results.label = status.label $$;

select is(pg_temp.status('first'), 'ACCEPTED', 'a valid event is accepted');
select is(pg_temp.status('retry'), 'DUPLICATE', 're-sending the same event is a duplicate, not an error');
select is(pg_temp.status('collision'), 'REJECTED:ID_COLLISION', 'same id with different content is a collision');
select is(pg_temp.status('other_facility'), 'REJECTED:CLAIM_MISMATCH', 'facility_id must be the device''s facility');
select is(pg_temp.status('other_device'), 'REJECTED:CLAIM_MISMATCH', 'device_id must be the calling device');
select is(pg_temp.status('inactive_staff'), 'REJECTED:STAFF_NOT_ACTIVE', 'inactive staff are rejected');
select is(pg_temp.status('foreign_staff'), 'REJECTED:STAFF_NOT_ACTIVE', 'staff of another facility are rejected');
select is(pg_temp.status('empty_payload'), 'REJECTED:INVALID_PAYLOAD', 'missing required payload keys are rejected');
select is(pg_temp.status('unknown_type'), 'REJECTED:INVALID_ENVELOPE', 'unknown event type is rejected');
select is(pg_temp.status('loose_time'), 'REJECTED:INVALID_ENVELOPE', 'non-ISO device_time is rejected');
select is(pg_temp.status('offset_time'), 'REJECTED:INVALID_ENVELOPE', 'device_time must be UTC with Z');
select is(pg_temp.status('entry_no_session'), 'REJECTED:INVALID_ENVELOPE', 'ENTRY without session_id is rejected');
select is(pg_temp.status('version_new'), 'REJECTED:SCHEMA_VERSION_TOO_NEW', 'a newer schema_version is rejected');
select is(pg_temp.status('version_old'), 'REJECTED:SCHEMA_VERSION_TOO_OLD', 'an older schema_version is rejected');
select is(pg_temp.status('version_string'), 'REJECTED:INVALID_ENVELOPE', 'schema_version must be a JSON number');
select is(pg_temp.status('version_fraction'), 'REJECTED:INVALID_ENVELOPE', 'a fractional schema_version (1.4) is rejected');
select is(pg_temp.status('version_whole_decimal'), 'ACCEPTED', 'schema_version 1.0 is the whole number 1 and is accepted');
select is(pg_temp.status('version_huge'), 'REJECTED:INVALID_ENVELOPE', 'a schema_version beyond the integer range is rejected');
select is(pg_temp.status('bad_source'), 'REJECTED:INVALID_ENVELOPE', 'unknown source is rejected');
select is(pg_temp.status('not_v7'), 'REJECTED:INVALID_ENVELOPE', 'a non-UUIDv7 id is rejected');
select is(pg_temp.status('mixed', 0), 'ACCEPTED', 'mixed batch: new event accepted');
select is(pg_temp.status('mixed', 1), 'DUPLICATE', 'mixed batch: earlier event reported as duplicate');
select is(pg_temp.status('mixed', 2), 'REJECTED:STAFF_NOT_ACTIVE', 'mixed batch: bad event rejected');
select is(
  (select result ->> 'accepted' || '/' || (result ->> 'duplicates') || '/' || (result ->> 'rejected')
   from public.test_results where label = 'mixed'),
  '1/1/1', 'batch counters add up');
select is((select count(*)::int from public.events), 3, 'only the three valid events were stored (first, 1.0, mixed)');
select is(
  (select (select result -> 'min_supported_version' from public.test_results where label = 'first')::int),
  1, 'response carries min_supported_version');

-- caller checks: errors are captured as SQLSTATE codes by a helper that runs under the tested role
create table public.test_errors (label text primary key, code text);
grant all on public.test_errors to authenticated, anon;
create function pg_temp.try(label text, sub text, sql text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', sub, true);
  begin
    execute sql;
    insert into public.test_errors values (label, 'OK');
  exception when others then
    insert into public.test_errors values (label, sqlstate);
  end;
end $$;
grant execute on function pg_temp.try(text, text, text) to authenticated, anon;

set local role authenticated;
select pg_temp.try('non_device', '00000000-0000-4000-8000-0000000000a2', $q$select public.ingest_events('[]')$q$);
select pg_temp.try('no_jwt', '', $q$select public.ingest_events('[]')$q$);
select pg_temp.try('not_array', '00000000-0000-4000-8000-0000000000a1', $q$select public.ingest_events('{}')$q$);
select pg_temp.try('direct_insert', '00000000-0000-4000-8000-0000000000a1',
  $q$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version)
     values ('018f0000-0000-7000-8000-0000000000ff', '00000000-0000-4000-8000-0000000000f1',
             '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1', 'ENTRY',
             '018f0000-0000-7000-8000-0000000000a1', now(), 1)$q$);
reset role;
set local role anon;
select pg_temp.try('anon', '', $q$select public.ingest_events('[]')$q$);
reset role;
update public.devices set revoked_at = now();
set local role authenticated;
select pg_temp.try('revoked', '00000000-0000-4000-8000-0000000000a1', $q$select public.ingest_events('[]')$q$);
reset role;

select is((select code from public.test_errors where label = 'non_device'), '42501', 'a user that is not an enrolled device is refused');
select is((select code from public.test_errors where label = 'no_jwt'), '28000', 'a call without a JWT subject is refused');
select is((select code from public.test_errors where label = 'not_array'), '22023', 'a non-array argument is refused');
select is((select code from public.test_errors where label = 'direct_insert'), '42501', 'a device cannot insert into events directly');
select is((select code from public.test_errors where label = 'anon'), '42501', 'anon cannot execute ingest_events');
select is((select code from public.test_errors where label = 'revoked'), '42501', 'a revoked device is refused');

select is(has_function_privilege('anon', 'public.ingest_events(jsonb)', 'EXECUTE'), false, 'anon has no EXECUTE');
select is(has_function_privilege('authenticated', 'public.ingest_events(jsonb)', 'EXECUTE'), true,
  'authenticated has EXECUTE');
select is((select prosecdef from pg_proc where oid = 'public.ingest_events(jsonb)'::regprocedure), true,
  'ingest_events is SECURITY DEFINER');
select ok(
  (select coalesce(proconfig, '{}') @> array['search_path=pg_catalog, public, pg_temp']
     from pg_proc where oid = 'public.ingest_events(jsonb)'::regprocedure),
  'ingest_events pins search_path');
select * from finish();
rollback;
