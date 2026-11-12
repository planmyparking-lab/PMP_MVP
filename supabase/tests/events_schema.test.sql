-- pgTAP tests for migration 0003_events.sql (CLD-02). Run with `pnpm test:db`, which applies migrations missing from
-- local history inside a rolled-back transaction. Fixtures are inserted as the superuser; the transaction is rolled back.
--
-- WHAT THIS FILE VALIDATES: the `events` table of 0003 (columns, constraints, privileges) against Afzal's confirmed
-- envelope decisions (docs/team/cld-02-events-review.md, section 7). It does not validate the TypeScript contract or the
-- ingest function: the SQL-versus-zod cross-check (T-IC01-C1) is supabase/tests/event_parity.test.sql, generated from
-- packages/contracts/fixtures/events, and ingest_events (0004) is covered by ingest_events.test.sql.
--   PROVISIONAL (team assumption, still not confirmed by Afzal in cld-02-events-review.md): events must reference a
--     device and staff member of their own facility. 0003 enforces it with composite foreign keys, the cross-facility
--     assertions below test it, and 0004-0006 build on the (id, facility_id) keys.
--   contract: the envelope in packages/contracts/src/events.ts (SYNC-01) has the same columns as this table: id
--     (UUIDv7), facility_id, device_id, staff_id (uuid), session_id, device_time, source (LIVE | PAPER_BACKFILL), payload
--     and schema_version. received_at is server-only. The optional recorded_at (OQ-42) has no column here.
--   contract: schema_version is 1 to MAX_SCHEMA_VERSION (32767) in the contract; the column is integer with check > 0,
--     no upper bound and no default. The smallint proposal was not applied, so the type assertion below says integer.
--   contract: session_id is nullable, with a CHECK requiring it for ENTRY/EXIT/PAYMENT/OVERRIDE and forbidding it
--     for ZONE_COUNT/SHIFT_OPEN/SHIFT_CLOSE. The seven valid and seven invalid type/session combinations are tested below.
--   contract: type-specific data lives in `payload jsonb` (default '{}'); the zod schemas are the source of truth for
--     its shape. No test here asserts payload contents, by decision.
--   contract: a uuid column does not enforce version 7. The contract does, and ingest_events checks the event id; no
--     assertion about it here.
--   contract: ingest claim checks live in ingest_events (0004) and are tested in ingest_events.test.sql.
--   append-only: the privilege assertions below state the documented requirement (docs/team/cld-02-events-review.md,
--     section 5). 0003 revokes UPDATE, DELETE, TRUNCATE (and TRIGGER, REFERENCES) from authenticated and service_role.
--     They are not to be weakened. Grants cannot constrain the table owner (postgres) or superusers; nothing here
--     asserts owner-level protection, and no trigger or purge role exists (CLD-08 is blocked on OQ-12).
--     INSERT is revoked from authenticated by 0004 (ingest_events is SECURITY DEFINER); asserted below.
begin;
select plan(71);

-- Three-argument form: the two-argument form reads its second argument as a description, not a table name.
select has_table('public', 'events', 'public.events exists');

-- Column types (five-argument form: schema, table, column, type, description)
select col_type_is('public', 'events', 'id', 'uuid', 'events.id is uuid');
select col_type_is('public', 'events', 'facility_id', 'uuid', 'events.facility_id is uuid');
select col_type_is('public', 'events', 'device_id', 'uuid', 'events.device_id is uuid');
select col_type_is('public', 'events', 'staff_id', 'uuid', 'events.staff_id is uuid');
select col_type_is('public', 'events', 'type', 'text', 'events.type is text');
select col_type_is('public', 'events', 'session_id', 'uuid', 'events.session_id is uuid');
select col_type_is('public', 'events', 'payload', 'jsonb', 'events.payload is jsonb');
select col_type_is('public', 'events', 'device_time', 'timestamp with time zone',
  'events.device_time is timestamptz');
select col_type_is('public', 'events', 'received_at', 'timestamp with time zone',
  'events.received_at is timestamptz');
select col_type_is('public', 'events', 'source', 'text', 'events.source is text');
select col_type_is('public', 'events', 'schema_version', 'integer', 'events.schema_version is integer');

-- Nullability, primary key, index
select is_empty(
  $$select attname from pg_attribute
    where attrelid = 'public.events'::regclass and attnum > 0 and not attisdropped
      and attname in ('id','facility_id','device_id','staff_id','type','payload','device_time',
                      'received_at','source','schema_version')
      and not attnotnull$$,
  'every column except session_id is NOT NULL'
);
select ok(
  (select not attnotnull from pg_attribute
   where attrelid = 'public.events'::regclass and attname = 'session_id'),
  'session_id is nullable (shift and zone events have no session)'
);
select ok(
  exists (
    select 1 from pg_constraint k
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    where k.conrelid = 'public.events'::regclass and k.contype = 'p'
      and array_length(k.conkey, 1) = 1 and a.attname = 'id'
  ),
  'primary key is exactly (id)'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'events'
      and indexname = 'events_facility_device_time_idx'
      and indexdef like '%(facility_id, device_time)%'
  ),
  'index on (facility_id, device_time) exists'
);

-- RLS and privileges
select ok(
  (select relrowsecurity from pg_class where oid = 'public.events'::regclass),
  'RLS is enabled on events'
);
select is(
  has_table_privilege('anon', 'public.events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  false,
  'anon holds no privilege on events'
);
select is(
  has_table_privilege('authenticated', 'public.events', 'UPDATE,DELETE'),
  false,
  'authenticated has neither UPDATE nor DELETE on events'
);
select is(
  has_table_privilege('anon', 'public.events', 'UPDATE,DELETE'),
  false,
  'anon has neither UPDATE nor DELETE on events'
);
select is(
  (select count(*)::int from pg_class c, aclexplode(c.relacl) a
   where c.oid = 'public.events'::regclass and a.grantee = 0
     and a.privilege_type in ('UPDATE', 'DELETE')),
  0,
  'PUBLIC has neither UPDATE nor DELETE on events'
);
-- Append-only requirement for application roles (has_table_privilege reports effective privileges, including any
-- inherited through role membership; the owner and superusers are intentionally not asserted here)
select is(
  has_table_privilege('authenticated', 'public.events', 'TRUNCATE'),
  false,
  'authenticated cannot TRUNCATE events (RLS does not govern TRUNCATE)'
);
-- Decision (Afzal): ingest_events is SECURITY DEFINER, so devices never need INSERT. Revoked by 0004_ingest_events.sql.
select is(
  has_table_privilege('authenticated', 'public.events', 'INSERT'),
  false,
  'authenticated has no direct INSERT on events'
);
select is(
  has_table_privilege('service_role', 'public.events', 'UPDATE'),
  false,
  'service_role cannot UPDATE events'
);
select is(
  has_table_privilege('service_role', 'public.events', 'DELETE'),
  false,
  'service_role cannot DELETE events'
);
select is(
  has_table_privilege('service_role', 'public.events', 'TRUNCATE'),
  false,
  'service_role cannot TRUNCATE events'
);

-- Fixtures: one organization, facility, device and staff member (plus a second facility for the RLS count)
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Org A');
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'A1', 'Asia/Kolkata', 100);
insert into public.devices (id, facility_id, name) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'Gate phone');
insert into public.staff (id, facility_id, name, pin_hash, pin_salt) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a2',
   'Fixture Guard', 'fixture-hash', 'fixture-salt');
-- A second facility in the same organization with its own device and staff member (cross-facility tests below)
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'B1', 'Asia/Kolkata', 80);
insert into public.devices (id, facility_id, name) values
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000b2', 'Gate phone B');
insert into public.staff (id, facility_id, name, pin_hash, pin_salt) values
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b2',
   'Fixture Guard B', 'fixture-hash', 'fixture-salt');

-- All seven documented event types are accepted
select lives_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 'LIVE', 1)$$,
  'type ENTRY accepted');
select lives_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'EXIT', '00000000-0000-0000-0000-0000000000b0', now(), 'LIVE', 1)$$,
  'type EXIT accepted');
select lives_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'PAYMENT', '00000000-0000-0000-0000-0000000000b0', now(), 'LIVE', 1)$$,
  'type PAYMENT accepted');
select lives_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'OVERRIDE', '00000000-0000-0000-0000-0000000000b0', now(), 'LIVE', 1)$$,
  'type OVERRIDE accepted');
select lives_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'ZONE_COUNT', null, now(), 'LIVE', 1)$$,
  'type ZONE_COUNT accepted');
select lives_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'SHIFT_OPEN', null, now(), 'LIVE', 1)$$,
  'type SHIFT_OPEN accepted');
select lives_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'SHIFT_CLOSE', null, now(), 'LIVE', 1)$$,
  'type SHIFT_CLOSE accepted');

-- Session IDs are required for parking-session event types.
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', null, now(), 'LIVE', 1)$$,
  '23514', null, 'ENTRY with null session_id is rejected');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'EXIT', null, now(), 'LIVE', 1)$$,
  '23514', null, 'EXIT with null session_id is rejected');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'PAYMENT', null, now(), 'LIVE', 1)$$,
  '23514', null, 'PAYMENT with null session_id is rejected');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'OVERRIDE', null, now(), 'LIVE', 1)$$,
  '23514', null, 'OVERRIDE with null session_id is rejected');

-- Session IDs are forbidden for non-session event types.
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'ZONE_COUNT', '00000000-0000-0000-0000-0000000000b0', now(), 'LIVE', 1)$$,
  '23514', null, 'ZONE_COUNT with non-null session_id is rejected');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'SHIFT_OPEN', '00000000-0000-0000-0000-0000000000b0', now(), 'LIVE', 1)$$,
  '23514', null, 'SHIFT_OPEN with non-null session_id is rejected');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'SHIFT_CLOSE', '00000000-0000-0000-0000-0000000000b0', now(), 'LIVE', 1)$$,
  '23514', null, 'SHIFT_CLOSE with non-null session_id is rejected');

-- Source vocabulary confirmed by Afzal: LIVE (default) or PAPER_BACKFILL. LIVE is exercised by the seven type tests above.
select lives_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 'PAPER_BACKFILL', 1)$$,
  'source PAPER_BACKFILL accepted');
select lives_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version)
    values ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 1)$$,
  'an event inserted without source is accepted');
select is(
  (select source from public.events where id = '00000000-0000-0000-0000-0000000000e9'),
  'LIVE',
  'source defaults to LIVE');

-- Rejections
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'BOGUS', null, now(), 'LIVE', 1)$$,
  '23514', null, 'unknown event type is rejected');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 'BOGUS', 1)$$,
  '23514', null, 'invalid source is rejected');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 'GATE', 1)$$,
  '23514', null, 'GATE is no longer a valid source (replaced by LIVE)');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 'LIVE', 0)$$,
  '23514', null, 'schema_version 0 is rejected');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 'LIVE', -1)$$,
  '23514', null, 'negative schema_version is rejected');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 'LIVE', null)$$,
  '23502', null, 'missing schema_version is rejected');
select ok(
  (select not atthasdef from pg_attribute
   where attrelid = 'public.events'::regclass and attname = 'schema_version'),
  'schema_version has no default (the writer must state it)');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 'LIVE', 1)$$,
  '23505', null, 'duplicate event id is rejected');

-- Foreign keys reject nonexistent references (the other two references are valid in each case)
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-00000000dead',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 'LIVE', 1)$$,
  '23503', null, 'nonexistent facility_id is rejected');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-00000000dead', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 'LIVE', 1)$$,
  '23503', null, 'nonexistent device_id is rejected');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, source, schema_version)
    values ('00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000dead',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 'LIVE', 1)$$,
  '23503', null, 'nonexistent staff_id is rejected');

-- Same-facility integrity (provisional team assumption): device_id and staff_id must belong to the event's facility.
-- Facility A owns device d2 and staff d1; facility B owns device d4 and staff d3.
select lives_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version)
    values ('00000000-0000-0000-0000-0000000000eb', '00000000-0000-0000-0000-0000000000b2',
            '00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d3',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 1)$$,
  'an event whose device and staff belong to its facility is accepted (facility B)');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version)
    values ('00000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000b2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d3',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 1)$$,
  '23503',
  'insert or update on table "events" violates foreign key constraint "events_device_facility_fkey"',
  'a device from another facility is rejected');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version)
    values ('00000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000b2',
            '00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 1)$$,
  '23503',
  'insert or update on table "events" violates foreign key constraint "events_staff_facility_fkey"',
  'a staff member from another facility is rejected');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version)
    values ('00000000-0000-0000-0000-0000000000fd', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 1)$$,
  '23503',
  'insert or update on table "events" violates foreign key constraint "events_device_facility_fkey"',
  'the reverse direction is rejected too (facility A with a facility B device)');
select throws_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version)
    values ('00000000-0000-0000-0000-0000000000fe', '00000000-0000-0000-0000-0000000000b2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'ENTRY', '00000000-0000-0000-0000-0000000000b0', now(), 1)$$,
  '23503', null, 'a device and staff member that both belong to another facility are rejected');

-- The constraints that enforce it: composite foreign keys and the unique keys they reference
select ok(
  exists (
    select 1 from pg_constraint k
    where k.conrelid = 'public.events'::regclass and k.contype = 'f'
      and k.confrelid = 'public.devices'::regclass
      and (select array_agg(l.attname::text || '->' || r.attname::text order by l.attname::text)
           from unnest(k.conkey, k.confkey) as u (lk, rk)
           join pg_attribute l on l.attrelid = k.conrelid and l.attnum = u.lk
           join pg_attribute r on r.attrelid = k.confrelid and r.attnum = u.rk)
          = array['device_id->id', 'facility_id->facility_id']
  ),
  'events has a composite foreign key (device_id, facility_id) to devices (id, facility_id)');
select ok(
  exists (
    select 1 from pg_constraint k
    where k.conrelid = 'public.events'::regclass and k.contype = 'f'
      and k.confrelid = 'public.staff'::regclass
      and (select array_agg(l.attname::text || '->' || r.attname::text order by l.attname::text)
           from unnest(k.conkey, k.confkey) as u (lk, rk)
           join pg_attribute l on l.attrelid = k.conrelid and l.attnum = u.lk
           join pg_attribute r on r.attrelid = k.confrelid and r.attnum = u.rk)
          = array['facility_id->facility_id', 'staff_id->id']
  ),
  'events has a composite foreign key (staff_id, facility_id) to staff (id, facility_id)');
select ok(
  exists (
    select 1 from pg_constraint k
    where k.conrelid = 'public.devices'::regclass and k.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname::text)
           from pg_attribute a where a.attrelid = k.conrelid and a.attnum = any (k.conkey))
          = array['facility_id', 'id']
  ),
  'devices has a unique constraint on (id, facility_id)');
select ok(
  exists (
    select 1 from pg_constraint k
    where k.conrelid = 'public.staff'::regclass and k.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname::text)
           from pg_attribute a where a.attrelid = k.conrelid and a.attnum = any (k.conkey))
          = array['facility_id', 'id']
  ),
  'staff has a unique constraint on (id, facility_id)');

-- Stored values and defaults, using rows inserted above (e9 omitted payload and source; e6 is a SHIFT_OPEN without session)
select is(
  (select payload from public.events where id = '00000000-0000-0000-0000-0000000000e9'),
  '{}'::jsonb,
  'payload defaults to an empty object');
select ok(
  (select received_at = now() from public.events where id = '00000000-0000-0000-0000-0000000000e9'),
  'received_at defaults to the database clock');
select ok(
  (select session_id is null from public.events where id = '00000000-0000-0000-0000-0000000000e6'),
  'an event without session_id is stored with a null session_id');
select lives_ok(
  $$insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version)
    values ('00000000-0000-0000-0000-0000000000ea', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
            'EXIT', '00000000-0000-0000-0000-0000000000b0', now(), 1)$$,
  'an event with a session_id is accepted');

-- Referenced rows cannot be deleted while events point at them (on delete restrict)
select throws_ok(
  $$delete from public.devices where id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23503', null, 'a device that has events cannot be deleted');
select throws_ok(
  $$delete from public.staff where id = '00000000-0000-0000-0000-0000000000d1'$$,
  '23503', null, 'a staff member who has events cannot be deleted');

-- The (id, facility_id) unique constraint exists on events (a target for later composite foreign keys)
select ok(
  exists (
    select 1 from pg_constraint k
    where k.conrelid = 'public.events'::regclass and k.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname::text)
           from pg_attribute a where a.attrelid = k.conrelid and a.attnum = any (k.conkey))
          = array['facility_id', 'id']
  ),
  'events has a unique constraint on (id, facility_id)');

-- RLS behaviour: event rows exist, but without policies a signed-in non-member sees none
set local role authenticated;
select results_eq(
  $$select count(*)::int from public.events$$, array[0],
  'authenticated role sees no events while no policy exists');
reset role;

select * from finish();
rollback;
