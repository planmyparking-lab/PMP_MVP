-- Tests for strict event payload validation introduced by migration 0011 (promoted from proposed 0013, OQ-52).
begin;

select plan(219);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1');

insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-00000000000f', 'Payload Test Org');

insert into public.facilities (id, org_id, name, timezone, slot_count)
values (
  '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-0000-0000-00000000000f',
  'Payload Test Facility',
  'Asia/Kolkata',
  10
);

insert into public.staff (id, facility_id, name, pin_hash, pin_salt, active)
values (
  '00000000-0000-4000-8000-0000000000b1',
  '00000000-0000-4000-8000-0000000000f1',
  'Payload Test Guard',
  'h',
  's',
  true
);

insert into public.devices (id, facility_id, name, auth_user_id)
values (
  '00000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000f1',
  'Payload Test Device',
  '00000000-0000-0000-0000-0000000000a1'
);

create table public.payload_test_results (
  label text primary key,
  result jsonb
);

create table public.payload_test_base (e jsonb);

grant all on public.payload_test_results, public.payload_test_base
to authenticated;

insert into public.payload_test_base values (
  '{
    "id": "018f0000-0000-7000-8000-000000001000",
    "type": "ENTRY",
    "facility_id": "00000000-0000-4000-8000-0000000000f1",
    "device_id": "00000000-0000-4000-8000-0000000000d1",
    "staff_id": "00000000-0000-4000-8000-0000000000b1",
    "session_id": "018f0000-0000-7000-8000-000000002000",
    "device_time": "2026-10-01T10:00:00.000Z",
    "source": "LIVE",
    "schema_version": 1,
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "7K2QX"
    }
  }'::jsonb
);

create function pg_temp.call_payloads(label text, overrides jsonb[])
returns void
language plpgsql
as $$
declare
  b jsonb := (select e from public.payload_test_base);
  batch jsonb := '[]';
  o jsonb;
begin
  foreach o in array overrides loop
    batch := batch || jsonb_build_array(b || o);
  end loop;

  insert into public.payload_test_results
  values (label, public.ingest_events(batch));
end;
$$;

grant execute on function pg_temp.call_payloads(text, jsonb[])
to authenticated;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-0000000000a1',
  true
);

set local role authenticated;

-- Events 0..7 (eight events) must be rejected.
-- Events 8..14 (seven events) cover all seven valid event types.

select pg_temp.call_payloads('payloads', array[

  -- Invalid ENTRY: malformed short code.
  '{
    "id": "018f0000-0000-7000-8000-000000001001",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "bad!"
    }
  }'::jsonb,

  -- Invalid EXIT: fractional fare.
  '{
    "id": "018f0000-0000-7000-8000-000000001002",
    "type": "EXIT",
    "payload": {
      "fare_paise": 1.5,
      "exit_method": "SCAN"
    }
  }'::jsonb,

  -- Invalid ZONE_COUNT: fractional count.
  '{
    "id": "018f0000-0000-7000-8000-000000001003",
    "type": "ZONE_COUNT",
    "session_id": null,
    "payload": {
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "counted": 1.5,
      "system_count_at_time": 1
    }
  }'::jsonb,

  -- Invalid PAYMENT: negative amount.
  '{
    "id": "018f0000-0000-7000-8000-000000001004",
    "type": "PAYMENT",
    "payload": {
      "mode": "CASH",
      "amount_paise": -1,
      "upi_attested": false
    }
  }'::jsonb,

  -- Invalid OVERRIDE: OTHER requires a non-empty note.
  '{
    "id": "018f0000-0000-7000-8000-000000001005",
    "type": "OVERRIDE",
    "payload": {
      "target_event_id": "018f0000-0000-7000-8000-000000002005",
      "reason_code": "OTHER"
    }
  }'::jsonb,

  -- Invalid PAYMENT: UPI attestation cannot be true for CASH.
  '{
    "id": "018f0000-0000-7000-8000-000000001006",
    "type": "PAYMENT",
    "payload": {
      "mode": "CASH",
      "amount_paise": 100,
      "upi_attested": true
    }
  }'::jsonb,

  -- Invalid ENTRY: unknown payload key.
  '{
    "id": "018f0000-0000-7000-8000-000000001007",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "7K2QX",
      "unexpected_field": true
    }
  }'::jsonb,

  -- Invalid envelope: unknown top-level key.
  '{
    "id": "018f0000-0000-7000-8000-000000001008",
    "unexpected_envelope_field": true
  }'::jsonb,

  -- Valid ENTRY.
  '{
    "id": "018f0000-0000-7000-8000-000000001011",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "7K2QX"
    }
  }'::jsonb,

  -- Valid EXIT.
  '{
    "id": "018f0000-0000-7000-8000-000000001012",
    "type": "EXIT",
    "payload": {
      "fare_paise": 100,
      "exit_method": "SCAN"
    }
  }'::jsonb,

  -- Valid PAYMENT.
  '{
    "id": "018f0000-0000-7000-8000-000000001013",
    "type": "PAYMENT",
    "payload": {
      "mode": "CASH",
      "amount_paise": 100,
      "upi_attested": false
    }
  }'::jsonb,

  -- Valid OVERRIDE.
  '{
    "id": "018f0000-0000-7000-8000-000000001014",
    "type": "OVERRIDE",
    "payload": {
      "target_event_id": "018f0000-0000-7000-8000-000000002014",
      "reason_code": "OTHER",
      "note": "Manual correction"
    }
  }'::jsonb,

  -- Valid ZONE_COUNT.
  '{
    "id": "018f0000-0000-7000-8000-000000001015",
    "type": "ZONE_COUNT",
    "session_id": null,
    "payload": {
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "counted": 5,
      "system_count_at_time": 4
    }
  }'::jsonb,

  -- Valid SHIFT_OPEN.
  '{
    "id": "018f0000-0000-7000-8000-000000001016",
    "type": "SHIFT_OPEN",
    "session_id": null,
    "payload": {
      "shift_id": "00000000-0000-4000-8000-0000000000c2",
      "opening_float_paise": 1000
    }
  }'::jsonb,

  -- Valid SHIFT_CLOSE.
  '{
    "id": "018f0000-0000-7000-8000-000000001017",
    "type": "SHIFT_CLOSE",
    "session_id": null,
    "payload": {
      "shift_id": "00000000-0000-4000-8000-0000000000c2",
      "counted_cash_paise": 1000,
      "expected_cash_paise": 1000,
      "upi_total_declared_paise": 0,
      "upi_attested_sum_paise": 0,
      "variance_cash_paise": 0,
      "variance_upi_paise": 0
    }
  }'::jsonb

]);

reset role;

create function pg_temp.payload_status(label text, i int)
returns text
language sql
as $$
  select
    (result -> 'results' -> i ->> 'status')
    || coalesce(':' || (result -> 'results' -> i ->> 'reason'), '')
  from public.payload_test_results
  where payload_test_results.label = payload_status.label;
$$;

-- Eight invalid events must be rejected.
select is(pg_temp.payload_status('payloads', 0), 'REJECTED:INVALID_PAYLOAD',
  'malformed ENTRY short code is rejected');

select is(pg_temp.payload_status('payloads', 1), 'REJECTED:INVALID_PAYLOAD',
  'fractional EXIT fare is rejected');

select is(pg_temp.payload_status('payloads', 2), 'REJECTED:INVALID_PAYLOAD',
  'fractional ZONE_COUNT is rejected');

select is(pg_temp.payload_status('payloads', 3), 'REJECTED:INVALID_PAYLOAD',
  'negative PAYMENT amount is rejected');

select is(pg_temp.payload_status('payloads', 4), 'REJECTED:INVALID_PAYLOAD',
  'OTHER override without a note is rejected');

select is(pg_temp.payload_status('payloads', 5), 'REJECTED:INVALID_PAYLOAD',
  'CASH payment with UPI attestation is rejected');

select is(pg_temp.payload_status('payloads', 6), 'REJECTED:INVALID_PAYLOAD',
  'unknown payload keys are rejected');

select is(pg_temp.payload_status('payloads', 7), 'REJECTED:INVALID_ENVELOPE',
  'unknown envelope keys are rejected');

-- Seven valid event types must be accepted.
select is(pg_temp.payload_status('payloads', 8), 'ACCEPTED',
  'valid ENTRY payload is accepted');

select is(pg_temp.payload_status('payloads', 9), 'ACCEPTED',
  'valid EXIT payload is accepted');

select is(pg_temp.payload_status('payloads', 10), 'ACCEPTED',
  'valid PAYMENT payload is accepted');

select is(pg_temp.payload_status('payloads', 11), 'ACCEPTED',
  'valid OVERRIDE payload is accepted');

select is(pg_temp.payload_status('payloads', 12), 'ACCEPTED',
  'valid ZONE_COUNT payload is accepted');

select is(pg_temp.payload_status('payloads', 13), 'ACCEPTED',
  'valid SHIFT_OPEN payload is accepted');

select is(pg_temp.payload_status('payloads', 14), 'ACCEPTED',
  'valid SHIFT_CLOSE payload is accepted');

-- Batch counters and persistence.
select is(
  (select result ->> 'accepted'
   from public.payload_test_results where label = 'payloads'),
  '7',
  'batch reports seven accepted events'
);

select is(
  (select result ->> 'rejected'
   from public.payload_test_results where label = 'payloads'),
  '8',
  'batch reports eight rejected events'
);

select is(
  (select count(*)::text
   from public.events
   where id in (
     '018f0000-0000-7000-8000-000000001011',
     '018f0000-0000-7000-8000-000000001012',
     '018f0000-0000-7000-8000-000000001013',
     '018f0000-0000-7000-8000-000000001014',
     '018f0000-0000-7000-8000-000000001015',
     '018f0000-0000-7000-8000-000000001016',
     '018f0000-0000-7000-8000-000000001017'
   )),
  '7',
  'all seven valid events are persisted'
);

select is(
  (select count(*)::text
   from public.events
   where id in (
     '018f0000-0000-7000-8000-000000001001',
     '018f0000-0000-7000-8000-000000001002',
     '018f0000-0000-7000-8000-000000001003',
     '018f0000-0000-7000-8000-000000001004',
     '018f0000-0000-7000-8000-000000001005',
     '018f0000-0000-7000-8000-000000001006',
     '018f0000-0000-7000-8000-000000001007',
     '018f0000-0000-7000-8000-000000001008'
   )),
  '0',
  'no invalid events are persisted, including invalid envelope'
);

-- ---------------------------------------------------------------------------
-- Step 3: numeric payload parity (safe-integer bounds, signs, null/missing).
-- Events 0..37 must be rejected before insertion; events 38..49 are accepted.
-- ---------------------------------------------------------------------------
set local role authenticated;

select pg_temp.call_payloads('numeric', array[

  -- Invalid: EXIT fare above safe maximum.
  '{
    "id": "018f0000-0000-7000-8000-000000001101",
    "type": "EXIT",
    "payload": {"fare_paise": 9007199254740992, "exit_method": "SCAN"}
  }'::jsonb,

  -- Invalid: EXIT negative fare.
  '{
    "id": "018f0000-0000-7000-8000-000000001102",
    "type": "EXIT",
    "payload": {"fare_paise": -1, "exit_method": "SCAN"}
  }'::jsonb,

  -- Invalid: EXIT missing fare.
  '{
    "id": "018f0000-0000-7000-8000-000000001103",
    "type": "EXIT",
    "payload": {"exit_method": "SCAN"}
  }'::jsonb,

  -- Invalid: EXIT null fare.
  '{
    "id": "018f0000-0000-7000-8000-000000001104",
    "type": "EXIT",
    "payload": {"fare_paise": null, "exit_method": "SCAN"}
  }'::jsonb,

  -- Invalid: EXIT string fare.
  '{
    "id": "018f0000-0000-7000-8000-000000001105",
    "type": "EXIT",
    "payload": {"fare_paise": "100", "exit_method": "SCAN"}
  }'::jsonb,

  -- Invalid: EXIT tariff_version 0.
  '{
    "id": "018f0000-0000-7000-8000-000000001106",
    "type": "EXIT",
    "payload": {"fare_paise": 100, "exit_method": "SCAN", "tariff_version": 0}
  }'::jsonb,

  -- Invalid: EXIT fractional tariff_version.
  '{
    "id": "018f0000-0000-7000-8000-000000001107",
    "type": "EXIT",
    "payload": {"fare_paise": 100, "exit_method": "SCAN", "tariff_version": 1.5}
  }'::jsonb,

  -- Invalid: EXIT null tariff_version.
  '{
    "id": "018f0000-0000-7000-8000-000000001108",
    "type": "EXIT",
    "payload": {"fare_paise": 100, "exit_method": "SCAN", "tariff_version": null}
  }'::jsonb,

  -- Invalid: EXIT tariff_version above safe maximum.
  '{
    "id": "018f0000-0000-7000-8000-000000001109",
    "type": "EXIT",
    "payload": {"fare_paise": 100, "exit_method": "SCAN", "tariff_version": 9007199254740992}
  }'::jsonb,

  -- Invalid: EXIT negative tariff_version.
  '{
    "id": "018f0000-0000-7000-8000-00000000110a",
    "type": "EXIT",
    "payload": {"fare_paise": 100, "exit_method": "SCAN", "tariff_version": -1}
  }'::jsonb,

  -- Invalid: PAYMENT amount above safe maximum.
  '{
    "id": "018f0000-0000-7000-8000-00000000110b",
    "type": "PAYMENT",
    "payload": {"mode": "CASH", "amount_paise": 9007199254740992, "upi_attested": false}
  }'::jsonb,

  -- Invalid: PAYMENT null amount.
  '{
    "id": "018f0000-0000-7000-8000-00000000110c",
    "type": "PAYMENT",
    "payload": {"mode": "CASH", "amount_paise": null, "upi_attested": false}
  }'::jsonb,

  -- Invalid: PAYMENT missing amount.
  '{
    "id": "018f0000-0000-7000-8000-00000000110d",
    "type": "PAYMENT",
    "payload": {"mode": "CASH", "upi_attested": false}
  }'::jsonb,

  -- Invalid: PAYMENT fractional amount.
  '{
    "id": "018f0000-0000-7000-8000-00000000110e",
    "type": "PAYMENT",
    "payload": {"mode": "CASH", "amount_paise": 100.5, "upi_attested": false}
  }'::jsonb,

  -- Invalid: ZONE_COUNT negative counted.
  '{
    "id": "018f0000-0000-7000-8000-00000000110f",
    "type": "ZONE_COUNT",
    "session_id": null,
    "payload": {"zone_id": "00000000-0000-4000-8000-0000000000c1", "counted": -1, "system_count_at_time": 1}
  }'::jsonb,

  -- Invalid: ZONE_COUNT fractional system_count_at_time.
  '{
    "id": "018f0000-0000-7000-8000-000000001110",
    "type": "ZONE_COUNT",
    "session_id": null,
    "payload": {"zone_id": "00000000-0000-4000-8000-0000000000c1", "counted": 1, "system_count_at_time": 1.5}
  }'::jsonb,

  -- Invalid: ZONE_COUNT counted above safe maximum.
  '{
    "id": "018f0000-0000-7000-8000-000000001111",
    "type": "ZONE_COUNT",
    "session_id": null,
    "payload": {"zone_id": "00000000-0000-4000-8000-0000000000c1", "counted": 9007199254740992, "system_count_at_time": 1}
  }'::jsonb,

  -- Invalid: ZONE_COUNT negative system_count_at_time.
  '{
    "id": "018f0000-0000-7000-8000-000000001112",
    "type": "ZONE_COUNT",
    "session_id": null,
    "payload": {"zone_id": "00000000-0000-4000-8000-0000000000c1", "counted": 1, "system_count_at_time": -1}
  }'::jsonb,

  -- Invalid: ZONE_COUNT null system_count_at_time.
  '{
    "id": "018f0000-0000-7000-8000-000000001113",
    "type": "ZONE_COUNT",
    "session_id": null,
    "payload": {"zone_id": "00000000-0000-4000-8000-0000000000c1", "counted": 1, "system_count_at_time": null}
  }'::jsonb,

  -- Invalid: ZONE_COUNT missing counted.
  '{
    "id": "018f0000-0000-7000-8000-000000001114",
    "type": "ZONE_COUNT",
    "session_id": null,
    "payload": {"zone_id": "00000000-0000-4000-8000-0000000000c1", "system_count_at_time": 1}
  }'::jsonb,

  -- Invalid: SHIFT_OPEN negative float.
  '{
    "id": "018f0000-0000-7000-8000-000000001115",
    "type": "SHIFT_OPEN",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "opening_float_paise": -1}
  }'::jsonb,

  -- Invalid: SHIFT_OPEN fractional float.
  '{
    "id": "018f0000-0000-7000-8000-000000001116",
    "type": "SHIFT_OPEN",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "opening_float_paise": 1.5}
  }'::jsonb,

  -- Invalid: SHIFT_OPEN float above safe maximum.
  '{
    "id": "018f0000-0000-7000-8000-000000001117",
    "type": "SHIFT_OPEN",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "opening_float_paise": 9007199254740992}
  }'::jsonb,

  -- Invalid: SHIFT_OPEN missing float.
  '{
    "id": "018f0000-0000-7000-8000-000000001118",
    "type": "SHIFT_OPEN",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2"}
  }'::jsonb,

  -- Invalid: SHIFT_OPEN null float.
  '{
    "id": "018f0000-0000-7000-8000-000000001119",
    "type": "SHIFT_OPEN",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "opening_float_paise": null}
  }'::jsonb,

  -- Invalid: SHIFT_CLOSE negative counted_cash_paise.
  '{
    "id": "018f0000-0000-7000-8000-00000000111a",
    "type": "SHIFT_CLOSE",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "counted_cash_paise": -1, "expected_cash_paise": 1000, "upi_total_declared_paise": 0, "upi_attested_sum_paise": 0, "variance_cash_paise": 0, "variance_upi_paise": 0}
  }'::jsonb,

  -- Invalid: SHIFT_CLOSE expected_cash_paise above safe maximum.
  '{
    "id": "018f0000-0000-7000-8000-00000000111b",
    "type": "SHIFT_CLOSE",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "counted_cash_paise": 1000, "expected_cash_paise": 9007199254740992, "upi_total_declared_paise": 0, "upi_attested_sum_paise": 0, "variance_cash_paise": 0, "variance_upi_paise": 0}
  }'::jsonb,

  -- Invalid: SHIFT_CLOSE fractional upi_attested_sum_paise.
  '{
    "id": "018f0000-0000-7000-8000-00000000111c",
    "type": "SHIFT_CLOSE",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "counted_cash_paise": 1000, "expected_cash_paise": 1000, "upi_total_declared_paise": 0, "upi_attested_sum_paise": 1.5, "variance_cash_paise": 0, "variance_upi_paise": 0}
  }'::jsonb,

  -- Invalid: SHIFT_CLOSE variance_cash above safe maximum.
  '{
    "id": "018f0000-0000-7000-8000-00000000111d",
    "type": "SHIFT_CLOSE",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "counted_cash_paise": 1000, "expected_cash_paise": 1000, "upi_total_declared_paise": 0, "upi_attested_sum_paise": 0, "variance_cash_paise": 9007199254740992, "variance_upi_paise": 0}
  }'::jsonb,

  -- Invalid: SHIFT_CLOSE variance_upi below safe minimum.
  '{
    "id": "018f0000-0000-7000-8000-00000000111e",
    "type": "SHIFT_CLOSE",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "counted_cash_paise": 1000, "expected_cash_paise": 1000, "upi_total_declared_paise": 0, "upi_attested_sum_paise": 0, "variance_cash_paise": 0, "variance_upi_paise": -9007199254740992}
  }'::jsonb,

  -- Invalid: SHIFT_CLOSE fractional variance_cash.
  '{
    "id": "018f0000-0000-7000-8000-00000000111f",
    "type": "SHIFT_CLOSE",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "counted_cash_paise": 1000, "expected_cash_paise": 1000, "upi_total_declared_paise": 0, "upi_attested_sum_paise": 0, "variance_cash_paise": 1.5, "variance_upi_paise": 0}
  }'::jsonb,

  -- Invalid: SHIFT_CLOSE null variance_upi.
  '{
    "id": "018f0000-0000-7000-8000-000000001120",
    "type": "SHIFT_CLOSE",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "counted_cash_paise": 1000, "expected_cash_paise": 1000, "upi_total_declared_paise": 0, "upi_attested_sum_paise": 0, "variance_cash_paise": 0, "variance_upi_paise": null}
  }'::jsonb,

  -- Invalid: SHIFT_CLOSE missing upi_total_declared_paise.
  '{
    "id": "018f0000-0000-7000-8000-000000001121",
    "type": "SHIFT_CLOSE",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "counted_cash_paise": 1000, "expected_cash_paise": 1000, "upi_attested_sum_paise": 0, "variance_cash_paise": 0, "variance_upi_paise": 0}
  }'::jsonb,

  -- Invalid: SHIFT_CLOSE string variance_cash.
  '{
    "id": "018f0000-0000-7000-8000-000000001122",
    "type": "SHIFT_CLOSE",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "counted_cash_paise": 1000, "expected_cash_paise": 1000, "upi_total_declared_paise": 0, "upi_attested_sum_paise": 0, "variance_cash_paise": "0", "variance_upi_paise": 0}
  }'::jsonb,

  -- Invalid: OVERRIDE OTHER with spaces-only note.
  '{
    "id": "018f0000-0000-7000-8000-000000001123",
    "type": "OVERRIDE",
    "payload": {"target_event_id": "018f0000-0000-7000-8000-000000002100", "reason_code": "OTHER", "note": "   "}
  }'::jsonb,

  -- Invalid: OVERRIDE OTHER with tab/newline-only note.
  '{
    "id": "018f0000-0000-7000-8000-000000001124",
    "type": "OVERRIDE",
    "payload": {"target_event_id": "018f0000-0000-7000-8000-000000002100", "reason_code": "OTHER", "note": "\t\n"}
  }'::jsonb,

  -- Invalid: OVERRIDE OTHER with NBSP-only note.
  '{
    "id": "018f0000-0000-7000-8000-000000001125",
    "type": "OVERRIDE",
    "payload": {"target_event_id": "018f0000-0000-7000-8000-000000002100", "reason_code": "OTHER", "note": "\u00a0"}
  }'::jsonb,

  -- Invalid: OVERRIDE null note.
  '{
    "id": "018f0000-0000-7000-8000-000000001126",
    "type": "OVERRIDE",
    "payload": {"target_event_id": "018f0000-0000-7000-8000-000000002100", "reason_code": "OTHER", "note": null}
  }'::jsonb,

  -- Valid: EXIT max fare and max tariff_version.
  '{
    "id": "018f0000-0000-7000-8000-000000001127",
    "type": "EXIT",
    "payload": {"fare_paise": 9007199254740991, "exit_method": "SCAN", "tariff_version": 9007199254740991}
  }'::jsonb,

  -- Valid: EXIT zero fare and tariff_version 1.
  '{
    "id": "018f0000-0000-7000-8000-000000001128",
    "type": "EXIT",
    "payload": {"fare_paise": 0, "exit_method": "SCAN", "tariff_version": 1}
  }'::jsonb,

  -- Valid: EXIT without optional tariff_version.
  '{
    "id": "018f0000-0000-7000-8000-000000001129",
    "type": "EXIT",
    "payload": {"fare_paise": 100, "exit_method": "SCAN"}
  }'::jsonb,

  -- Valid: PAYMENT max amount.
  '{
    "id": "018f0000-0000-7000-8000-00000000112a",
    "type": "PAYMENT",
    "payload": {"mode": "CASH", "amount_paise": 9007199254740991, "upi_attested": false}
  }'::jsonb,

  -- Valid: PAYMENT zero amount.
  '{
    "id": "018f0000-0000-7000-8000-00000000112b",
    "type": "PAYMENT",
    "payload": {"mode": "CASH", "amount_paise": 0, "upi_attested": false}
  }'::jsonb,

  -- Valid: ZONE_COUNT zero counted and max system count.
  '{
    "id": "018f0000-0000-7000-8000-00000000112c",
    "type": "ZONE_COUNT",
    "session_id": null,
    "payload": {"zone_id": "00000000-0000-4000-8000-0000000000c1", "counted": 0, "system_count_at_time": 9007199254740991}
  }'::jsonb,

  -- Valid: ZONE_COUNT max counted and zero system count.
  '{
    "id": "018f0000-0000-7000-8000-00000000112d",
    "type": "ZONE_COUNT",
    "session_id": null,
    "payload": {"zone_id": "00000000-0000-4000-8000-0000000000c1", "counted": 9007199254740991, "system_count_at_time": 0}
  }'::jsonb,

  -- Valid: SHIFT_OPEN zero float.
  '{
    "id": "018f0000-0000-7000-8000-00000000112e",
    "type": "SHIFT_OPEN",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "opening_float_paise": 0}
  }'::jsonb,

  -- Valid: SHIFT_OPEN max float.
  '{
    "id": "018f0000-0000-7000-8000-00000000112f",
    "type": "SHIFT_OPEN",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "opening_float_paise": 9007199254740991}
  }'::jsonb,

  -- Valid: SHIFT_CLOSE max counts, +max cash and -max upi variance.
  '{
    "id": "018f0000-0000-7000-8000-000000001130",
    "type": "SHIFT_CLOSE",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "counted_cash_paise": 9007199254740991, "expected_cash_paise": 9007199254740991, "upi_total_declared_paise": 9007199254740991, "upi_attested_sum_paise": 9007199254740991, "variance_cash_paise": 9007199254740991, "variance_upi_paise": -9007199254740991}
  }'::jsonb,

  -- Valid: SHIFT_CLOSE zero counts, -max cash and +max upi variance.
  '{
    "id": "018f0000-0000-7000-8000-000000001131",
    "type": "SHIFT_CLOSE",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-4000-8000-0000000000c2", "counted_cash_paise": 0, "expected_cash_paise": 0, "upi_total_declared_paise": 0, "upi_attested_sum_paise": 0, "variance_cash_paise": -9007199254740991, "variance_upi_paise": 9007199254740991}
  }'::jsonb,

  -- Valid: OVERRIDE OTHER with non-blank note.
  '{
    "id": "018f0000-0000-7000-8000-000000001132",
    "type": "OVERRIDE",
    "payload": {"target_event_id": "018f0000-0000-7000-8000-000000002100", "reason_code": "OTHER", "note": "x"}
  }'::jsonb

]);

reset role;

select is(pg_temp.payload_status('numeric', 0), 'REJECTED:INVALID_PAYLOAD',
  'EXIT fare above safe maximum: rejected');

select is(pg_temp.payload_status('numeric', 1), 'REJECTED:INVALID_PAYLOAD',
  'EXIT negative fare: rejected');

select is(pg_temp.payload_status('numeric', 2), 'REJECTED:INVALID_PAYLOAD',
  'EXIT missing fare: rejected');

select is(pg_temp.payload_status('numeric', 3), 'REJECTED:INVALID_PAYLOAD',
  'EXIT null fare: rejected');

select is(pg_temp.payload_status('numeric', 4), 'REJECTED:INVALID_PAYLOAD',
  'EXIT string fare: rejected');

select is(pg_temp.payload_status('numeric', 5), 'REJECTED:INVALID_PAYLOAD',
  'EXIT tariff_version 0: rejected');

select is(pg_temp.payload_status('numeric', 6), 'REJECTED:INVALID_PAYLOAD',
  'EXIT fractional tariff_version: rejected');

select is(pg_temp.payload_status('numeric', 7), 'REJECTED:INVALID_PAYLOAD',
  'EXIT null tariff_version: rejected');

select is(pg_temp.payload_status('numeric', 8), 'REJECTED:INVALID_PAYLOAD',
  'EXIT tariff_version above safe maximum: rejected');

select is(pg_temp.payload_status('numeric', 9), 'REJECTED:INVALID_PAYLOAD',
  'EXIT negative tariff_version: rejected');

select is(pg_temp.payload_status('numeric', 10), 'REJECTED:INVALID_PAYLOAD',
  'PAYMENT amount above safe maximum: rejected');

select is(pg_temp.payload_status('numeric', 11), 'REJECTED:INVALID_PAYLOAD',
  'PAYMENT null amount: rejected');

select is(pg_temp.payload_status('numeric', 12), 'REJECTED:INVALID_PAYLOAD',
  'PAYMENT missing amount: rejected');

select is(pg_temp.payload_status('numeric', 13), 'REJECTED:INVALID_PAYLOAD',
  'PAYMENT fractional amount: rejected');

select is(pg_temp.payload_status('numeric', 14), 'REJECTED:INVALID_PAYLOAD',
  'ZONE_COUNT negative counted: rejected');

select is(pg_temp.payload_status('numeric', 15), 'REJECTED:INVALID_PAYLOAD',
  'ZONE_COUNT fractional system_count_at_time: rejected');

select is(pg_temp.payload_status('numeric', 16), 'REJECTED:INVALID_PAYLOAD',
  'ZONE_COUNT counted above safe maximum: rejected');

select is(pg_temp.payload_status('numeric', 17), 'REJECTED:INVALID_PAYLOAD',
  'ZONE_COUNT negative system_count_at_time: rejected');

select is(pg_temp.payload_status('numeric', 18), 'REJECTED:INVALID_PAYLOAD',
  'ZONE_COUNT null system_count_at_time: rejected');

select is(pg_temp.payload_status('numeric', 19), 'REJECTED:INVALID_PAYLOAD',
  'ZONE_COUNT missing counted: rejected');

select is(pg_temp.payload_status('numeric', 20), 'REJECTED:INVALID_PAYLOAD',
  'SHIFT_OPEN negative float: rejected');

select is(pg_temp.payload_status('numeric', 21), 'REJECTED:INVALID_PAYLOAD',
  'SHIFT_OPEN fractional float: rejected');

select is(pg_temp.payload_status('numeric', 22), 'REJECTED:INVALID_PAYLOAD',
  'SHIFT_OPEN float above safe maximum: rejected');

select is(pg_temp.payload_status('numeric', 23), 'REJECTED:INVALID_PAYLOAD',
  'SHIFT_OPEN missing float: rejected');

select is(pg_temp.payload_status('numeric', 24), 'REJECTED:INVALID_PAYLOAD',
  'SHIFT_OPEN null float: rejected');

select is(pg_temp.payload_status('numeric', 25), 'REJECTED:INVALID_PAYLOAD',
  'SHIFT_CLOSE negative counted_cash_paise: rejected');

select is(pg_temp.payload_status('numeric', 26), 'REJECTED:INVALID_PAYLOAD',
  'SHIFT_CLOSE expected_cash_paise above safe maximum: rejected');

select is(pg_temp.payload_status('numeric', 27), 'REJECTED:INVALID_PAYLOAD',
  'SHIFT_CLOSE fractional upi_attested_sum_paise: rejected');

select is(pg_temp.payload_status('numeric', 28), 'REJECTED:INVALID_PAYLOAD',
  'SHIFT_CLOSE variance_cash above safe maximum: rejected');

select is(pg_temp.payload_status('numeric', 29), 'REJECTED:INVALID_PAYLOAD',
  'SHIFT_CLOSE variance_upi below safe minimum: rejected');

select is(pg_temp.payload_status('numeric', 30), 'REJECTED:INVALID_PAYLOAD',
  'SHIFT_CLOSE fractional variance_cash: rejected');

select is(pg_temp.payload_status('numeric', 31), 'REJECTED:INVALID_PAYLOAD',
  'SHIFT_CLOSE null variance_upi: rejected');

select is(pg_temp.payload_status('numeric', 32), 'REJECTED:INVALID_PAYLOAD',
  'SHIFT_CLOSE missing upi_total_declared_paise: rejected');

select is(pg_temp.payload_status('numeric', 33), 'REJECTED:INVALID_PAYLOAD',
  'SHIFT_CLOSE string variance_cash: rejected');

select is(pg_temp.payload_status('numeric', 34), 'REJECTED:INVALID_PAYLOAD',
  'OVERRIDE OTHER with spaces-only note: rejected');

select is(pg_temp.payload_status('numeric', 35), 'REJECTED:INVALID_PAYLOAD',
  'OVERRIDE OTHER with tab/newline-only note: rejected');

select is(pg_temp.payload_status('numeric', 36), 'REJECTED:INVALID_PAYLOAD',
  'OVERRIDE OTHER with NBSP-only note: rejected');

select is(pg_temp.payload_status('numeric', 37), 'REJECTED:INVALID_PAYLOAD',
  'OVERRIDE null note: rejected');

select is(pg_temp.payload_status('numeric', 38), 'ACCEPTED',
  'EXIT max fare and max tariff_version: accepted');

select is(pg_temp.payload_status('numeric', 39), 'ACCEPTED',
  'EXIT zero fare and tariff_version 1: accepted');

select is(pg_temp.payload_status('numeric', 40), 'ACCEPTED',
  'EXIT without optional tariff_version: accepted');

select is(pg_temp.payload_status('numeric', 41), 'ACCEPTED',
  'PAYMENT max amount: accepted');

select is(pg_temp.payload_status('numeric', 42), 'ACCEPTED',
  'PAYMENT zero amount: accepted');

select is(pg_temp.payload_status('numeric', 43), 'ACCEPTED',
  'ZONE_COUNT zero counted and max system count: accepted');

select is(pg_temp.payload_status('numeric', 44), 'ACCEPTED',
  'ZONE_COUNT max counted and zero system count: accepted');

select is(pg_temp.payload_status('numeric', 45), 'ACCEPTED',
  'SHIFT_OPEN zero float: accepted');

select is(pg_temp.payload_status('numeric', 46), 'ACCEPTED',
  'SHIFT_OPEN max float: accepted');

select is(pg_temp.payload_status('numeric', 47), 'ACCEPTED',
  'SHIFT_CLOSE max counts, +max cash and -max upi variance: accepted');

select is(pg_temp.payload_status('numeric', 48), 'ACCEPTED',
  'SHIFT_CLOSE zero counts, -max cash and +max upi variance: accepted');

select is(pg_temp.payload_status('numeric', 49), 'ACCEPTED',
  'OVERRIDE OTHER with non-blank note: accepted');

select is(
  (select result ->> 'accepted'
   from public.payload_test_results where label = 'numeric'),
  '12',
  'numeric batch reports 12 accepted events'
);

select is(
  (select result ->> 'rejected'
   from public.payload_test_results where label = 'numeric'),
  '38',
  'numeric batch reports 38 rejected events'
);

select is(
  (select count(*)::text
   from public.events
   where id in (
     '018f0000-0000-7000-8000-000000001127',
     '018f0000-0000-7000-8000-000000001128',
     '018f0000-0000-7000-8000-000000001129',
     '018f0000-0000-7000-8000-00000000112a',
     '018f0000-0000-7000-8000-00000000112b',
     '018f0000-0000-7000-8000-00000000112c',
     '018f0000-0000-7000-8000-00000000112d',
     '018f0000-0000-7000-8000-00000000112e',
     '018f0000-0000-7000-8000-00000000112f',
     '018f0000-0000-7000-8000-000000001130',
     '018f0000-0000-7000-8000-000000001131',
     '018f0000-0000-7000-8000-000000001132'
   )),
  '12',
  'all valid boundary events are persisted'
);

select is(
  (select count(*)::text
   from public.events
   where id in (
     '018f0000-0000-7000-8000-000000001101',
     '018f0000-0000-7000-8000-000000001102',
     '018f0000-0000-7000-8000-000000001103',
     '018f0000-0000-7000-8000-000000001104',
     '018f0000-0000-7000-8000-000000001105',
     '018f0000-0000-7000-8000-000000001106',
     '018f0000-0000-7000-8000-000000001107',
     '018f0000-0000-7000-8000-000000001108',
     '018f0000-0000-7000-8000-000000001109',
     '018f0000-0000-7000-8000-00000000110a',
     '018f0000-0000-7000-8000-00000000110b',
     '018f0000-0000-7000-8000-00000000110c',
     '018f0000-0000-7000-8000-00000000110d',
     '018f0000-0000-7000-8000-00000000110e',
     '018f0000-0000-7000-8000-00000000110f',
     '018f0000-0000-7000-8000-000000001110',
     '018f0000-0000-7000-8000-000000001111',
     '018f0000-0000-7000-8000-000000001112',
     '018f0000-0000-7000-8000-000000001113',
     '018f0000-0000-7000-8000-000000001114',
     '018f0000-0000-7000-8000-000000001115',
     '018f0000-0000-7000-8000-000000001116',
     '018f0000-0000-7000-8000-000000001117',
     '018f0000-0000-7000-8000-000000001118',
     '018f0000-0000-7000-8000-000000001119',
     '018f0000-0000-7000-8000-00000000111a',
     '018f0000-0000-7000-8000-00000000111b',
     '018f0000-0000-7000-8000-00000000111c',
     '018f0000-0000-7000-8000-00000000111d',
     '018f0000-0000-7000-8000-00000000111e',
     '018f0000-0000-7000-8000-00000000111f',
     '018f0000-0000-7000-8000-000000001120',
     '018f0000-0000-7000-8000-000000001121',
     '018f0000-0000-7000-8000-000000001122',
     '018f0000-0000-7000-8000-000000001123',
     '018f0000-0000-7000-8000-000000001124',
     '018f0000-0000-7000-8000-000000001125',
     '018f0000-0000-7000-8000-000000001126'
   )),
  '0',
  'no invalid numeric events are persisted'
);

-- ---------------------------------------------------------------------------
-- Step 4: facility/device/staff UUID parity and recorded_at datetime parity.
-- Events 0..27 must be rejected as INVALID_ENVELOPE before insertion;
-- events 28..33 are accepted.
-- ---------------------------------------------------------------------------
set local role authenticated;

select pg_temp.call_payloads('envelope', array[

  -- Invalid: braced facility_id.
  '{
    "id": "018f0000-0000-7000-8000-000000001201",
    "session_id": "018f0000-0000-7000-8000-000000002201",
    "facility_id": "{00000000-0000-4000-8000-0000000000f1}",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0001"
    }
  }'::jsonb,

  -- Invalid: unhyphenated facility_id.
  '{
    "id": "018f0000-0000-7000-8000-000000001202",
    "session_id": "018f0000-0000-7000-8000-000000002202",
    "facility_id": "000000000000400080000000000000f1",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0002"
    }
  }'::jsonb,

  -- Invalid: facility_id with version nibble 0.
  '{
    "id": "018f0000-0000-7000-8000-000000001203",
    "session_id": "018f0000-0000-7000-8000-000000002203",
    "facility_id": "00000000-0000-0000-8000-0000000000f1",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0003"
    }
  }'::jsonb,

  -- Invalid: facility_id with version nibble 9.
  '{
    "id": "018f0000-0000-7000-8000-000000001204",
    "session_id": "018f0000-0000-7000-8000-000000002204",
    "facility_id": "00000000-0000-9000-8000-0000000000f1",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0004"
    }
  }'::jsonb,

  -- Invalid: device_id with variant nibble c.
  '{
    "id": "018f0000-0000-7000-8000-000000001205",
    "session_id": "018f0000-0000-7000-8000-000000002205",
    "device_id": "00000000-0000-4000-c000-0000000000d1",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0005"
    }
  }'::jsonb,

  -- Invalid: device_id unhyphenated.
  '{
    "id": "018f0000-0000-7000-8000-000000001206",
    "session_id": "018f0000-0000-7000-8000-000000002206",
    "device_id": "000000000000400080000000000000d1",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0006"
    }
  }'::jsonb,

  -- Invalid: device_id with surrounding space.
  '{
    "id": "018f0000-0000-7000-8000-000000001207",
    "session_id": "018f0000-0000-7000-8000-000000002207",
    "device_id": " 00000000-0000-4000-8000-0000000000d1",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0007"
    }
  }'::jsonb,

  -- Invalid: staff_id braced.
  '{
    "id": "018f0000-0000-7000-8000-000000001208",
    "session_id": "018f0000-0000-7000-8000-000000002208",
    "staff_id": "{00000000-0000-4000-8000-0000000000b1}",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0008"
    }
  }'::jsonb,

  -- Invalid: staff_id with variant nibble 0.
  '{
    "id": "018f0000-0000-7000-8000-000000001209",
    "session_id": "018f0000-0000-7000-8000-000000002209",
    "staff_id": "00000000-0000-4000-0000-0000000000b1",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0009"
    }
  }'::jsonb,

  -- Invalid: staff_id as JSON number.
  '{
    "id": "018f0000-0000-7000-8000-00000000120a",
    "session_id": "018f0000-0000-7000-8000-00000000220a",
    "staff_id": 12345,
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0010"
    }
  }'::jsonb,

  -- Invalid: facility_id JSON null.
  '{
    "id": "018f0000-0000-7000-8000-00000000120b",
    "session_id": "018f0000-0000-7000-8000-00000000220b",
    "facility_id": null,
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0011"
    }
  }'::jsonb,

  -- Invalid: recorded_at JSON null.
  '{
    "id": "018f0000-0000-7000-8000-00000000120c",
    "session_id": "018f0000-0000-7000-8000-00000000220c",
    "recorded_at": null,
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0012"
    }
  }'::jsonb,

  -- Invalid: recorded_at JSON number.
  '{
    "id": "018f0000-0000-7000-8000-00000000120d",
    "session_id": "018f0000-0000-7000-8000-00000000220d",
    "recorded_at": 1234567890,
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0013"
    }
  }'::jsonb,

  -- Invalid: recorded_at missing seconds.
  '{
    "id": "018f0000-0000-7000-8000-00000000120e",
    "session_id": "018f0000-0000-7000-8000-00000000220e",
    "recorded_at": "2026-10-01T10:05Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0014"
    }
  }'::jsonb,

  -- Invalid: recorded_at with positive offset.
  '{
    "id": "018f0000-0000-7000-8000-00000000120f",
    "session_id": "018f0000-0000-7000-8000-00000000220f",
    "recorded_at": "2026-10-01T10:05:00+05:30",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0015"
    }
  }'::jsonb,

  -- Invalid: recorded_at with offset and Z.
  '{
    "id": "018f0000-0000-7000-8000-000000001210",
    "session_id": "018f0000-0000-7000-8000-000000002210",
    "recorded_at": "2026-10-01T10:05:00+05:30Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0016"
    }
  }'::jsonb,

  -- Invalid: recorded_at with lowercase z.
  '{
    "id": "018f0000-0000-7000-8000-000000001211",
    "session_id": "018f0000-0000-7000-8000-000000002211",
    "recorded_at": "2026-10-01T10:05:00z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0017"
    }
  }'::jsonb,

  -- Invalid: recorded_at without Z.
  '{
    "id": "018f0000-0000-7000-8000-000000001212",
    "session_id": "018f0000-0000-7000-8000-000000002212",
    "recorded_at": "2026-10-01T10:05:00",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0018"
    }
  }'::jsonb,

  -- Invalid: recorded_at with space separator.
  '{
    "id": "018f0000-0000-7000-8000-000000001213",
    "session_id": "018f0000-0000-7000-8000-000000002213",
    "recorded_at": "2026-10-01 10:05:00Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0019"
    }
  }'::jsonb,

  -- Invalid: recorded_at month 13.
  '{
    "id": "018f0000-0000-7000-8000-000000001214",
    "session_id": "018f0000-0000-7000-8000-000000002214",
    "recorded_at": "2026-13-01T10:05:00Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0020"
    }
  }'::jsonb,

  -- Invalid: recorded_at 30 February.
  '{
    "id": "018f0000-0000-7000-8000-000000001215",
    "session_id": "018f0000-0000-7000-8000-000000002215",
    "recorded_at": "2026-02-30T10:05:00Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0021"
    }
  }'::jsonb,

  -- Invalid: recorded_at 29 February in a non-leap year.
  '{
    "id": "018f0000-0000-7000-8000-000000001216",
    "session_id": "018f0000-0000-7000-8000-000000002216",
    "recorded_at": "2026-02-29T10:05:00Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0022"
    }
  }'::jsonb,

  -- Invalid: recorded_at 31 April.
  '{
    "id": "018f0000-0000-7000-8000-000000001217",
    "session_id": "018f0000-0000-7000-8000-000000002217",
    "recorded_at": "2026-04-31T10:05:00Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0023"
    }
  }'::jsonb,

  -- Invalid: recorded_at hour 24.
  '{
    "id": "018f0000-0000-7000-8000-000000001218",
    "session_id": "018f0000-0000-7000-8000-000000002218",
    "recorded_at": "2026-10-01T24:00:00Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0024"
    }
  }'::jsonb,

  -- Invalid: recorded_at minute 60.
  '{
    "id": "018f0000-0000-7000-8000-000000001219",
    "session_id": "018f0000-0000-7000-8000-000000002219",
    "recorded_at": "2026-10-01T10:60:00Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0025"
    }
  }'::jsonb,

  -- Invalid: recorded_at second 60.
  '{
    "id": "018f0000-0000-7000-8000-00000000121a",
    "session_id": "018f0000-0000-7000-8000-00000000221a",
    "recorded_at": "2026-10-01T10:05:60Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0026"
    }
  }'::jsonb,

  -- Invalid: recorded_at dangling fractional point.
  '{
    "id": "018f0000-0000-7000-8000-00000000121b",
    "session_id": "018f0000-0000-7000-8000-00000000221b",
    "recorded_at": "2026-10-01T10:05:00.Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0027"
    }
  }'::jsonb,

  -- Invalid: recorded_at year 0000 (PostgreSQL limitation).
  '{
    "id": "018f0000-0000-7000-8000-00000000121c",
    "session_id": "018f0000-0000-7000-8000-00000000221c",
    "recorded_at": "0000-01-01T00:00:00Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0028"
    }
  }'::jsonb,

  -- Valid: uppercase facility, device and staff ids.
  '{
    "id": "018f0000-0000-7000-8000-00000000121d",
    "session_id": "018f0000-0000-7000-8000-00000000221d",
    "facility_id": "00000000-0000-4000-8000-0000000000F1",
    "device_id": "00000000-0000-4000-8000-0000000000D1",
    "staff_id": "00000000-0000-4000-8000-0000000000B1",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0029"
    }
  }'::jsonb,

  -- Valid: recorded_at with whole seconds.
  '{
    "id": "018f0000-0000-7000-8000-00000000121e",
    "session_id": "018f0000-0000-7000-8000-00000000221e",
    "recorded_at": "2026-10-01T10:05:00Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0030"
    }
  }'::jsonb,

  -- Valid: recorded_at with nine fractional digits.
  '{
    "id": "018f0000-0000-7000-8000-00000000121f",
    "session_id": "018f0000-0000-7000-8000-00000000221f",
    "recorded_at": "2026-10-01T10:05:00.123456789Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0031"
    }
  }'::jsonb,

  -- Valid: recorded_at on a leap day.
  '{
    "id": "018f0000-0000-7000-8000-000000001220",
    "session_id": "018f0000-0000-7000-8000-000000002220",
    "recorded_at": "2024-02-29T00:00:00Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0032"
    }
  }'::jsonb,

  -- Valid: recorded_at at 23:59:59.
  '{
    "id": "018f0000-0000-7000-8000-000000001221",
    "session_id": "018f0000-0000-7000-8000-000000002221",
    "recorded_at": "2026-10-01T23:59:59Z",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0033"
    }
  }'::jsonb,

  -- Valid: recorded_at absent.
  '{
    "id": "018f0000-0000-7000-8000-000000001222",
    "session_id": "018f0000-0000-7000-8000-000000002222",
    "payload": {
      "vehicle_class": "CAR",
      "zone_id": "00000000-0000-4000-8000-0000000000c1",
      "short_code": "A0034"
    }
  }'::jsonb

]);

reset role;

select is(pg_temp.payload_status('envelope', 0), 'REJECTED:INVALID_ENVELOPE',
  'braced facility_id: rejected');

select is(pg_temp.payload_status('envelope', 1), 'REJECTED:INVALID_ENVELOPE',
  'unhyphenated facility_id: rejected');

select is(pg_temp.payload_status('envelope', 2), 'REJECTED:INVALID_ENVELOPE',
  'facility_id with version nibble 0: rejected');

select is(pg_temp.payload_status('envelope', 3), 'REJECTED:INVALID_ENVELOPE',
  'facility_id with version nibble 9: rejected');

select is(pg_temp.payload_status('envelope', 4), 'REJECTED:INVALID_ENVELOPE',
  'device_id with variant nibble c: rejected');

select is(pg_temp.payload_status('envelope', 5), 'REJECTED:INVALID_ENVELOPE',
  'device_id unhyphenated: rejected');

select is(pg_temp.payload_status('envelope', 6), 'REJECTED:INVALID_ENVELOPE',
  'device_id with surrounding space: rejected');

select is(pg_temp.payload_status('envelope', 7), 'REJECTED:INVALID_ENVELOPE',
  'staff_id braced: rejected');

select is(pg_temp.payload_status('envelope', 8), 'REJECTED:INVALID_ENVELOPE',
  'staff_id with variant nibble 0: rejected');

select is(pg_temp.payload_status('envelope', 9), 'REJECTED:INVALID_ENVELOPE',
  'staff_id as JSON number: rejected');

select is(pg_temp.payload_status('envelope', 10), 'REJECTED:INVALID_ENVELOPE',
  'facility_id JSON null: rejected');

select is(pg_temp.payload_status('envelope', 11), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at JSON null: rejected');

select is(pg_temp.payload_status('envelope', 12), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at JSON number: rejected');

select is(pg_temp.payload_status('envelope', 13), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at missing seconds: rejected');

select is(pg_temp.payload_status('envelope', 14), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at with positive offset: rejected');

select is(pg_temp.payload_status('envelope', 15), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at with offset and Z: rejected');

select is(pg_temp.payload_status('envelope', 16), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at with lowercase z: rejected');

select is(pg_temp.payload_status('envelope', 17), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at without Z: rejected');

select is(pg_temp.payload_status('envelope', 18), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at with space separator: rejected');

select is(pg_temp.payload_status('envelope', 19), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at month 13: rejected');

select is(pg_temp.payload_status('envelope', 20), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at 30 February: rejected');

select is(pg_temp.payload_status('envelope', 21), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at 29 February in a non-leap year: rejected');

select is(pg_temp.payload_status('envelope', 22), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at 31 April: rejected');

select is(pg_temp.payload_status('envelope', 23), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at hour 24: rejected');

select is(pg_temp.payload_status('envelope', 24), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at minute 60: rejected');

select is(pg_temp.payload_status('envelope', 25), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at second 60: rejected');

select is(pg_temp.payload_status('envelope', 26), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at dangling fractional point: rejected');

select is(pg_temp.payload_status('envelope', 27), 'REJECTED:INVALID_ENVELOPE',
  'recorded_at year 0000 (PostgreSQL limitation): rejected');

select is(pg_temp.payload_status('envelope', 28), 'ACCEPTED',
  'uppercase facility, device and staff ids: accepted');

select is(pg_temp.payload_status('envelope', 29), 'ACCEPTED',
  'recorded_at with whole seconds: accepted');

select is(pg_temp.payload_status('envelope', 30), 'ACCEPTED',
  'recorded_at with nine fractional digits: accepted');

select is(pg_temp.payload_status('envelope', 31), 'ACCEPTED',
  'recorded_at on a leap day: accepted');

select is(pg_temp.payload_status('envelope', 32), 'ACCEPTED',
  'recorded_at at 23:59:59: accepted');

select is(pg_temp.payload_status('envelope', 33), 'ACCEPTED',
  'recorded_at absent: accepted');

select is(
  (select result ->> 'accepted'
   from public.payload_test_results where label = 'envelope'),
  '6',
  'envelope batch reports 6 accepted events'
);

select is(
  (select result ->> 'rejected'
   from public.payload_test_results where label = 'envelope'),
  '28',
  'envelope batch reports 28 rejected events'
);

select is(
  (select count(*)::text
   from public.events
   where id in (
     '018f0000-0000-7000-8000-00000000121d',
     '018f0000-0000-7000-8000-00000000121e',
     '018f0000-0000-7000-8000-00000000121f',
     '018f0000-0000-7000-8000-000000001220',
     '018f0000-0000-7000-8000-000000001221',
     '018f0000-0000-7000-8000-000000001222'
   )),
  '6',
  'all valid envelope events are persisted'
);

select is(
  (select count(*)::text
   from public.events
   where id in (
     '018f0000-0000-7000-8000-000000001201',
     '018f0000-0000-7000-8000-000000001202',
     '018f0000-0000-7000-8000-000000001203',
     '018f0000-0000-7000-8000-000000001204',
     '018f0000-0000-7000-8000-000000001205',
     '018f0000-0000-7000-8000-000000001206',
     '018f0000-0000-7000-8000-000000001207',
     '018f0000-0000-7000-8000-000000001208',
     '018f0000-0000-7000-8000-000000001209',
     '018f0000-0000-7000-8000-00000000120a',
     '018f0000-0000-7000-8000-00000000120b',
     '018f0000-0000-7000-8000-00000000120c',
     '018f0000-0000-7000-8000-00000000120d',
     '018f0000-0000-7000-8000-00000000120e',
     '018f0000-0000-7000-8000-00000000120f',
     '018f0000-0000-7000-8000-000000001210',
     '018f0000-0000-7000-8000-000000001211',
     '018f0000-0000-7000-8000-000000001212',
     '018f0000-0000-7000-8000-000000001213',
     '018f0000-0000-7000-8000-000000001214',
     '018f0000-0000-7000-8000-000000001215',
     '018f0000-0000-7000-8000-000000001216',
     '018f0000-0000-7000-8000-000000001217',
     '018f0000-0000-7000-8000-000000001218',
     '018f0000-0000-7000-8000-000000001219',
     '018f0000-0000-7000-8000-00000000121a',
     '018f0000-0000-7000-8000-00000000121b',
     '018f0000-0000-7000-8000-00000000121c'
   )),
  '0',
  'no invalid envelope events are persisted'
);

select is(
  (select to_char(recorded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US')
   from public.events where id = '018f0000-0000-7000-8000-00000000121e'),
  '2026-10-01T10:05:00.000000',
  'recorded_at is persisted (recorded_at with whole seconds)'
);

select is(
  (select to_char(recorded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US')
   from public.events where id = '018f0000-0000-7000-8000-00000000121f'),
  '2026-10-01T10:05:00.123457',
  'recorded_at is persisted (recorded_at with nine fractional digits)'
);

select is(
  (select to_char(recorded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US')
   from public.events where id = '018f0000-0000-7000-8000-000000001220'),
  '2024-02-29T00:00:00.000000',
  'recorded_at is persisted (recorded_at on a leap day)'
);

select is(
  (select to_char(recorded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US')
   from public.events where id = '018f0000-0000-7000-8000-000000001221'),
  '2026-10-01T23:59:59.000000',
  'recorded_at is persisted (recorded_at at 23:59:59)'
);

select is(
  (select recorded_at is null from public.events where id = '018f0000-0000-7000-8000-000000001222'),
  true,
  'recorded_at is stored as NULL when absent (recorded_at absent)'
);

-- ---------------------------------------------------------------------------
-- Step 5: absent facility_id. call_payloads merges overrides and so cannot drop
-- a key; this event is built by deleting the key from the base event (jsonb '-').
-- ---------------------------------------------------------------------------
create table public.payload_test_submitted (label text primary key, batch jsonb);
grant all on public.payload_test_submitted to authenticated;

create function pg_temp.call_raw(label text, batch jsonb)
returns void
language plpgsql
as $$
begin
  insert into public.payload_test_submitted values (label, batch);
  insert into public.payload_test_results
  values (label, public.ingest_events(batch));
end;
$$;

grant execute on function pg_temp.call_raw(text, jsonb)
to authenticated;

set local role authenticated;

select pg_temp.call_raw('missing_facility', jsonb_build_array(
  (((select e from public.payload_test_base)
    || '{"id": "018f0000-0000-7000-8000-000000001301"}'::jsonb)
   - 'facility_id')
));

reset role;

select is(
  (select ((batch -> 0) ? 'facility_id')
   from public.payload_test_submitted where label = 'missing_facility'),
  false,
  'missing-field case: the submitted event has no facility_id key at all'
);

select is(pg_temp.payload_status('missing_facility', 0), 'REJECTED:INVALID_ENVELOPE',
  'an event without facility_id is rejected as INVALID_ENVELOPE');

select is(
  (select result ->> 'accepted' || '/' || (result ->> 'rejected')
   from public.payload_test_results where label = 'missing_facility'),
  '0/1',
  'missing-facility batch reports zero accepted and one rejected');

select is(
  (select count(*)::text from public.events where id = '018f0000-0000-7000-8000-000000001301'),
  '0',
  'the event without facility_id is not persisted'
);

-- ---------------------------------------------------------------------------
-- IC-01 contract groups: schema_version contract-first, exact Zod UUIDs, the JavaScript trim() set,
-- detail field paths and the id echo, and a historical row without recorded_at.
-- Events 0..41 are rejected (reason and detail asserted); events 42..51 are accepted.
-- ---------------------------------------------------------------------------
create function pg_temp.payload_full(label text, i int)
returns text
language sql
as $$
  select (result -> 'results' -> i ->> 'status')
         || coalesce(':' || (result -> 'results' -> i ->> 'reason'), '')
         || coalesce('@' || (result -> 'results' -> i ->> 'detail'), '')
  from public.payload_test_results
  where payload_test_results.label = payload_full.label;
$$;

create function pg_temp.payload_echo(label text, i int)
returns text
language sql
as $$
  select coalesce(result -> 'results' -> i ->> 'id', '<none>')
  from public.payload_test_results
  where payload_test_results.label = payload_echo.label;
$$;

set local role authenticated;

select pg_temp.call_payloads('contract', array[

  -- Invalid: schema_version -1.
  '{
    "id": "018f0000-0000-7000-8000-000000001401",
    "schema_version": -1
  }'::jsonb,

  -- Invalid: schema_version JSON null.
  '{
    "id": "018f0000-0000-7000-8000-000000001402",
    "schema_version": null
  }'::jsonb,

  -- Invalid: schema_version 2147483647.
  '{
    "id": "018f0000-0000-7000-8000-000000001403",
    "schema_version": 2147483647
  }'::jsonb,

  -- Invalid: schema_version 32768.
  '{
    "id": "018f0000-0000-7000-8000-000000001404",
    "schema_version": 32768
  }'::jsonb,

  -- Invalid: schema_version 32767 (contract-valid, above the server maximum).
  '{
    "id": "018f0000-0000-7000-8000-000000001405",
    "schema_version": 32767
  }'::jsonb,

  -- Invalid: PAYMENT with the upper-case max session_id.
  '{
    "id": "018f0000-0000-7000-8000-000000001406",
    "type": "PAYMENT",
    "session_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
    "payload": {"mode": "CASH", "amount_paise": 100, "upi_attested": false}
  }'::jsonb,

  -- Invalid: ZONE_COUNT with the upper-case max zone_id.
  '{
    "id": "018f0000-0000-7000-8000-000000001407",
    "type": "ZONE_COUNT",
    "session_id": null,
    "payload": {"zone_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "counted": 1, "system_count_at_time": 1}
  }'::jsonb,

  -- Invalid: ENTRY zone_id with version nibble 0.
  '{
    "id": "018f0000-0000-7000-8000-000000001408",
    "session_id": "018f0000-0000-7000-8000-000000002401",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-0000-8000-0000000000c1", "short_code": "C0001"}
  }'::jsonb,

  -- Invalid: ENTRY zone_id with version nibble 9.
  '{
    "id": "018f0000-0000-7000-8000-000000001409",
    "session_id": "018f0000-0000-7000-8000-000000002402",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-9000-8000-0000000000c1", "short_code": "C0002"}
  }'::jsonb,

  -- Invalid: ENTRY pass_id as the upper-case max uuid.
  '{
    "id": "018f0000-0000-7000-8000-00000000140a",
    "session_id": "018f0000-0000-7000-8000-000000002403",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0003", "pass_id": "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"}
  }'::jsonb,

  -- Invalid: ENTRY with a braced session_id.
  '{
    "id": "018f0000-0000-7000-8000-00000000140b",
    "session_id": "{018f0000-0000-7000-8000-000000002405}",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0005"}
  }'::jsonb,

  -- Invalid: OVERRIDE target_event_id that is a valid uuid but not version 7.
  '{
    "id": "018f0000-0000-7000-8000-00000000140c",
    "type": "OVERRIDE",
    "session_id": "018f0000-0000-7000-8000-000000002498",
    "payload": {"target_event_id": "5f1d2c3e-0000-4000-8000-000000000001", "reason_code": "LOST_TOKEN"}
  }'::jsonb,

  -- Invalid: OVERRIDE target_event_id as the nil uuid.
  '{
    "id": "018f0000-0000-7000-8000-00000000140d",
    "type": "OVERRIDE",
    "session_id": "018f0000-0000-7000-8000-000000002498",
    "payload": {"target_event_id": "00000000-0000-0000-0000-000000000000", "reason_code": "LOST_TOKEN"}
  }'::jsonb,

  -- Invalid: event id as the nil uuid (valid uuid, not version 7).
  '{
    "id": "00000000-0000-0000-0000-000000000000"
  }'::jsonb,

  -- Invalid: event id as a braced uuid.
  '{
    "id": "{018f0000-0000-7000-8000-000000001502}"
  }'::jsonb,

  -- Invalid: event id as a JSON number.
  '{
    "id": 12345
  }'::jsonb,

  -- Invalid: ENTRY vehicle_class of only NBSP (U+00A0).
  '{
    "id": "018f0000-0000-7000-8000-00000000140e",
    "session_id": "018f0000-0000-7000-8000-000000002407",
    "payload": {"vehicle_class": "\u00a0", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0007"}
  }'::jsonb,

  -- Invalid: ENTRY vehicle_class of only BOM (U+FEFF).
  '{
    "id": "018f0000-0000-7000-8000-00000000140f",
    "session_id": "018f0000-0000-7000-8000-000000002408",
    "payload": {"vehicle_class": "\ufeff", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0008"}
  }'::jsonb,

  -- Invalid: ENTRY vehicle_class of only OGHAM SPACE MARK (U+1680).
  '{
    "id": "018f0000-0000-7000-8000-000000001410",
    "session_id": "018f0000-0000-7000-8000-000000002409",
    "payload": {"vehicle_class": "\u1680", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0009"}
  }'::jsonb,

  -- Invalid: ENTRY vehicle_class of only EM SPACE (U+2003).
  '{
    "id": "018f0000-0000-7000-8000-000000001411",
    "session_id": "018f0000-0000-7000-8000-00000000240a",
    "payload": {"vehicle_class": "\u2003", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0010"}
  }'::jsonb,

  -- Invalid: ENTRY vehicle_class of only LINE SEPARATOR (U+2028).
  '{
    "id": "018f0000-0000-7000-8000-000000001412",
    "session_id": "018f0000-0000-7000-8000-00000000240b",
    "payload": {"vehicle_class": "\u2028", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0011"}
  }'::jsonb,

  -- Invalid: ENTRY vehicle_class of only IDEOGRAPHIC SPACE (U+3000).
  '{
    "id": "018f0000-0000-7000-8000-000000001413",
    "session_id": "018f0000-0000-7000-8000-00000000240c",
    "payload": {"vehicle_class": "\u3000", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0012"}
  }'::jsonb,

  -- Invalid: ENTRY vehicle_class of mixed trim() whitespace.
  '{
    "id": "018f0000-0000-7000-8000-000000001414",
    "session_id": "018f0000-0000-7000-8000-00000000240d",
    "payload": {"vehicle_class": " \t\n\u00a0 ", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0013"}
  }'::jsonb,

  -- Invalid: ENTRY vehicle_no of only IDEOGRAPHIC SPACE.
  '{
    "id": "018f0000-0000-7000-8000-000000001415",
    "session_id": "018f0000-0000-7000-8000-00000000240e",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0014", "vehicle_no": "\u3000"}
  }'::jsonb,

  -- Invalid: OVERRIDE OTHER note of only PARAGRAPH SEPARATOR (U+2029).
  '{
    "id": "018f0000-0000-7000-8000-000000001416",
    "type": "OVERRIDE",
    "session_id": "018f0000-0000-7000-8000-000000002498",
    "payload": {"target_event_id": "018f0000-0000-7000-8000-000000002100", "reason_code": "OTHER", "note": "\u2029"}
  }'::jsonb,

  -- Invalid: OVERRIDE OTHER note of only NARROW NO-BREAK SPACE (U+202F).
  '{
    "id": "018f0000-0000-7000-8000-000000001417",
    "type": "OVERRIDE",
    "session_id": "018f0000-0000-7000-8000-000000002498",
    "payload": {"target_event_id": "018f0000-0000-7000-8000-000000002100", "reason_code": "OTHER", "note": "\u202f"}
  }'::jsonb,

  -- Invalid: OVERRIDE OTHER note of only MEDIUM MATHEMATICAL SPACE (U+205F).
  '{
    "id": "018f0000-0000-7000-8000-000000001418",
    "type": "OVERRIDE",
    "session_id": "018f0000-0000-7000-8000-000000002498",
    "payload": {"target_event_id": "018f0000-0000-7000-8000-000000002100", "reason_code": "OTHER", "note": "\u205f"}
  }'::jsonb,

  -- Invalid: unknown payload key zz.
  '{
    "id": "018f0000-0000-7000-8000-000000001419",
    "session_id": "018f0000-0000-7000-8000-000000002412",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0018", "zz": 1}
  }'::jsonb,

  -- Invalid: two unknown payload keys zz and aa: the first in byte order is reported.
  '{
    "id": "018f0000-0000-7000-8000-00000000141a",
    "session_id": "018f0000-0000-7000-8000-000000002413",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0019", "zz": 1, "aa": 1}
  }'::jsonb,

  -- Invalid: unknown payload keys B_key and a_key: upper case sorts first in byte order.
  '{
    "id": "018f0000-0000-7000-8000-00000000141b",
    "session_id": "018f0000-0000-7000-8000-000000002414",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0020", "a_key": 1, "B_key": 1}
  }'::jsonb,

  -- Invalid: unknown payload key with a space and punctuation.
  '{
    "id": "018f0000-0000-7000-8000-00000000141c",
    "session_id": "018f0000-0000-7000-8000-000000002415",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0021", "bad key!": 1}
  }'::jsonb,

  -- Invalid: unknown payload key of 41 characters.
  '{
    "id": "018f0000-0000-7000-8000-00000000141d",
    "session_id": "018f0000-0000-7000-8000-000000002416",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0022", "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk": 1}
  }'::jsonb,

  -- Invalid: unknown payload key with a non-ASCII letter.
  '{
    "id": "018f0000-0000-7000-8000-00000000141e",
    "session_id": "018f0000-0000-7000-8000-000000002417",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0023", "\u00e9": 1}
  }'::jsonb,

  -- Invalid: unknown payload key with a control character.
  '{
    "id": "018f0000-0000-7000-8000-00000000141f",
    "session_id": "018f0000-0000-7000-8000-000000002418",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0024", "a\u0001b": 1}
  }'::jsonb,

  -- Invalid: unknown payload key of exactly 40 characters.
  '{
    "id": "018f0000-0000-7000-8000-000000001420",
    "session_id": "018f0000-0000-7000-8000-000000002419",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0025", "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk": 1}
  }'::jsonb,

  -- Invalid: unknown payload key of only digits.
  '{
    "id": "018f0000-0000-7000-8000-000000001421",
    "session_id": "018f0000-0000-7000-8000-00000000241a",
    "payload": {"123": 1, "vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0026"}
  }'::jsonb,

  -- Invalid: unknown envelope key extra_field.
  '{
    "id": "018f0000-0000-7000-8000-000000001422",
    "extra_field": 1
  }'::jsonb,

  -- Invalid: two unknown envelope keys zz and aa: the first in byte order is reported.
  '{
    "id": "018f0000-0000-7000-8000-000000001423",
    "zz": 1,
    "aa": 1
  }'::jsonb,

  -- Invalid: unknown envelope key of 41 characters.
  '{
    "id": "018f0000-0000-7000-8000-000000001424",
    "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk": 1
  }'::jsonb,

  -- Invalid: unknown envelope key with a hyphen.
  '{
    "id": "018f0000-0000-7000-8000-000000001425",
    "x-y": 1
  }'::jsonb,

  -- Invalid: unknown envelope key that looks like markup.
  '{
    "id": "018f0000-0000-7000-8000-000000001426",
    "<b>x</b>": 1
  }'::jsonb,

  -- Invalid: unknown envelope key of exactly 40 characters.
  '{
    "id": "018f0000-0000-7000-8000-000000001427",
    "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk": 1
  }'::jsonb,

  -- Valid: EXIT with the nil session_id.
  '{
    "id": "018f0000-0000-7000-8000-000000001428",
    "type": "EXIT",
    "session_id": "00000000-0000-0000-0000-000000000000",
    "payload": {"fare_paise": 100, "exit_method": "SCAN"}
  }'::jsonb,

  -- Valid: PAYMENT with the lower-case max session_id.
  '{
    "id": "018f0000-0000-7000-8000-000000001429",
    "type": "PAYMENT",
    "session_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "payload": {"mode": "CASH", "amount_paise": 100, "upi_attested": false}
  }'::jsonb,

  -- Valid: ZONE_COUNT with the lower-case max zone_id.
  '{
    "id": "018f0000-0000-7000-8000-00000000142a",
    "type": "ZONE_COUNT",
    "session_id": null,
    "payload": {"zone_id": "ffffffff-ffff-ffff-ffff-ffffffffffff", "counted": 1, "system_count_at_time": 1}
  }'::jsonb,

  -- Valid: SHIFT_OPEN with the nil shift_id.
  '{
    "id": "018f0000-0000-7000-8000-00000000142b",
    "type": "SHIFT_OPEN",
    "session_id": null,
    "payload": {"shift_id": "00000000-0000-0000-0000-000000000000", "opening_float_paise": 0}
  }'::jsonb,

  -- Valid: EXIT with the nil tariff_id.
  '{
    "id": "018f0000-0000-7000-8000-00000000142c",
    "type": "EXIT",
    "session_id": "018f0000-0000-7000-8000-000000002499",
    "payload": {"fare_paise": 100, "exit_method": "SCAN", "tariff_id": "00000000-0000-0000-0000-000000000000"}
  }'::jsonb,

  -- Valid: ENTRY with a UUID version 8 session_id.
  '{
    "id": "018f0000-0000-7000-8000-00000000142d",
    "session_id": "018f0000-0000-8000-8000-000000002404",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0004"}
  }'::jsonb,

  -- Valid: ENTRY with an upper-case UUIDv7 event id.
  '{
    "session_id": "018f0000-0000-7000-8000-000000002406",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0006"},
    "id": "018F0000-0000-7000-8000-000000001501"
  }'::jsonb,

  -- Valid: ENTRY vehicle_class of only ZERO WIDTH SPACE (U+200B) is not blank for trim().
  '{
    "id": "018f0000-0000-7000-8000-00000000142e",
    "session_id": "018f0000-0000-7000-8000-00000000240f",
    "payload": {"vehicle_class": "\u200b", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0015"}
  }'::jsonb,

  -- Valid: ENTRY vehicle_class of only NEXT LINE (U+0085) is not blank for trim().
  '{
    "id": "018f0000-0000-7000-8000-00000000142f",
    "session_id": "018f0000-0000-7000-8000-000000002410",
    "payload": {"vehicle_class": "\u0085", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0016"}
  }'::jsonb,

  -- Valid: ENTRY vehicle_class of only MONGOLIAN VOWEL SEPARATOR (U+180E) is not blank for trim().
  '{
    "id": "018f0000-0000-7000-8000-000000001430",
    "session_id": "018f0000-0000-7000-8000-000000002411",
    "payload": {"vehicle_class": "\u180e", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C0017"}
  }'::jsonb

]);

reset role;

select is(pg_temp.payload_full('contract', 0), 'REJECTED:INVALID_ENVELOPE@schema_version',
  'schema_version -1: rejected with detail');

select is(pg_temp.payload_full('contract', 1), 'REJECTED:INVALID_ENVELOPE@schema_version',
  'schema_version JSON null: rejected with detail');

select is(pg_temp.payload_full('contract', 2), 'REJECTED:INVALID_ENVELOPE@schema_version',
  'schema_version 2147483647: rejected with detail');

select is(pg_temp.payload_full('contract', 3), 'REJECTED:INVALID_ENVELOPE@schema_version',
  'schema_version 32768: rejected with detail');

select is(pg_temp.payload_full('contract', 4), 'REJECTED:SCHEMA_VERSION_TOO_NEW@schema_version',
  'schema_version 32767 (contract-valid, above the server maximum): rejected with detail');

select is(pg_temp.payload_full('contract', 5), 'REJECTED:INVALID_ENVELOPE@session_id',
  'PAYMENT with the upper-case max session_id: rejected with detail');

select is(pg_temp.payload_full('contract', 6), 'REJECTED:INVALID_PAYLOAD@payload.zone_id',
  'ZONE_COUNT with the upper-case max zone_id: rejected with detail');

select is(pg_temp.payload_full('contract', 7), 'REJECTED:INVALID_PAYLOAD@payload.zone_id',
  'ENTRY zone_id with version nibble 0: rejected with detail');

select is(pg_temp.payload_full('contract', 8), 'REJECTED:INVALID_PAYLOAD@payload.zone_id',
  'ENTRY zone_id with version nibble 9: rejected with detail');

select is(pg_temp.payload_full('contract', 9), 'REJECTED:INVALID_PAYLOAD@payload.pass_id',
  'ENTRY pass_id as the upper-case max uuid: rejected with detail');

select is(pg_temp.payload_full('contract', 10), 'REJECTED:INVALID_ENVELOPE@session_id',
  'ENTRY with a braced session_id: rejected with detail');

select is(pg_temp.payload_full('contract', 11), 'REJECTED:INVALID_PAYLOAD@payload.target_event_id',
  'OVERRIDE target_event_id that is a valid uuid but not version 7: rejected with detail');

select is(pg_temp.payload_full('contract', 12), 'REJECTED:INVALID_PAYLOAD@payload.target_event_id',
  'OVERRIDE target_event_id as the nil uuid: rejected with detail');

select is(pg_temp.payload_full('contract', 13), 'REJECTED:INVALID_ENVELOPE@id',
  'event id as the nil uuid (valid uuid, not version 7): rejected with detail');

select is(pg_temp.payload_full('contract', 14), 'REJECTED:INVALID_ENVELOPE@id',
  'event id as a braced uuid: rejected with detail');

select is(pg_temp.payload_full('contract', 15), 'REJECTED:INVALID_ENVELOPE@id',
  'event id as a JSON number: rejected with detail');

select is(pg_temp.payload_full('contract', 16), 'REJECTED:INVALID_PAYLOAD@payload.vehicle_class',
  'ENTRY vehicle_class of only NBSP (U+00A0): rejected with detail');

select is(pg_temp.payload_full('contract', 17), 'REJECTED:INVALID_PAYLOAD@payload.vehicle_class',
  'ENTRY vehicle_class of only BOM (U+FEFF): rejected with detail');

select is(pg_temp.payload_full('contract', 18), 'REJECTED:INVALID_PAYLOAD@payload.vehicle_class',
  'ENTRY vehicle_class of only OGHAM SPACE MARK (U+1680): rejected with detail');

select is(pg_temp.payload_full('contract', 19), 'REJECTED:INVALID_PAYLOAD@payload.vehicle_class',
  'ENTRY vehicle_class of only EM SPACE (U+2003): rejected with detail');

select is(pg_temp.payload_full('contract', 20), 'REJECTED:INVALID_PAYLOAD@payload.vehicle_class',
  'ENTRY vehicle_class of only LINE SEPARATOR (U+2028): rejected with detail');

select is(pg_temp.payload_full('contract', 21), 'REJECTED:INVALID_PAYLOAD@payload.vehicle_class',
  'ENTRY vehicle_class of only IDEOGRAPHIC SPACE (U+3000): rejected with detail');

select is(pg_temp.payload_full('contract', 22), 'REJECTED:INVALID_PAYLOAD@payload.vehicle_class',
  'ENTRY vehicle_class of mixed trim() whitespace: rejected with detail');

select is(pg_temp.payload_full('contract', 23), 'REJECTED:INVALID_PAYLOAD@payload.vehicle_no',
  'ENTRY vehicle_no of only IDEOGRAPHIC SPACE: rejected with detail');

select is(pg_temp.payload_full('contract', 24), 'REJECTED:INVALID_PAYLOAD@payload.note',
  'OVERRIDE OTHER note of only PARAGRAPH SEPARATOR (U+2029): rejected with detail');

select is(pg_temp.payload_full('contract', 25), 'REJECTED:INVALID_PAYLOAD@payload.note',
  'OVERRIDE OTHER note of only NARROW NO-BREAK SPACE (U+202F): rejected with detail');

select is(pg_temp.payload_full('contract', 26), 'REJECTED:INVALID_PAYLOAD@payload.note',
  'OVERRIDE OTHER note of only MEDIUM MATHEMATICAL SPACE (U+205F): rejected with detail');

select is(pg_temp.payload_full('contract', 27), 'REJECTED:INVALID_PAYLOAD@payload.zz',
  'unknown payload key zz: rejected with detail');

select is(pg_temp.payload_full('contract', 28), 'REJECTED:INVALID_PAYLOAD@payload.aa',
  'two unknown payload keys zz and aa: the first in byte order is reported: rejected with detail');

select is(pg_temp.payload_full('contract', 29), 'REJECTED:INVALID_PAYLOAD@payload.B_key',
  'unknown payload keys B_key and a_key: upper case sorts first in byte order: rejected with detail');

select is(pg_temp.payload_full('contract', 30), 'REJECTED:INVALID_PAYLOAD@payload.?',
  'unknown payload key with a space and punctuation: rejected with detail');

select is(pg_temp.payload_full('contract', 31), 'REJECTED:INVALID_PAYLOAD@payload.?',
  'unknown payload key of 41 characters: rejected with detail');

select is(pg_temp.payload_full('contract', 32), 'REJECTED:INVALID_PAYLOAD@payload.?',
  'unknown payload key with a non-ASCII letter: rejected with detail');

select is(pg_temp.payload_full('contract', 33), 'REJECTED:INVALID_PAYLOAD@payload.?',
  'unknown payload key with a control character: rejected with detail');

select is(pg_temp.payload_full('contract', 34), 'REJECTED:INVALID_PAYLOAD@payload.kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
  'unknown payload key of exactly 40 characters: rejected with detail');

select is(pg_temp.payload_full('contract', 35), 'REJECTED:INVALID_PAYLOAD@payload.123',
  'unknown payload key of only digits: rejected with detail');

select is(pg_temp.payload_full('contract', 36), 'REJECTED:INVALID_ENVELOPE@envelope.extra_field',
  'unknown envelope key extra_field: rejected with detail');

select is(pg_temp.payload_full('contract', 37), 'REJECTED:INVALID_ENVELOPE@envelope.aa',
  'two unknown envelope keys zz and aa: the first in byte order is reported: rejected with detail');

select is(pg_temp.payload_full('contract', 38), 'REJECTED:INVALID_ENVELOPE@envelope.?',
  'unknown envelope key of 41 characters: rejected with detail');

select is(pg_temp.payload_full('contract', 39), 'REJECTED:INVALID_ENVELOPE@envelope.?',
  'unknown envelope key with a hyphen: rejected with detail');

select is(pg_temp.payload_full('contract', 40), 'REJECTED:INVALID_ENVELOPE@envelope.?',
  'unknown envelope key that looks like markup: rejected with detail');

select is(pg_temp.payload_full('contract', 41), 'REJECTED:INVALID_ENVELOPE@envelope.kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
  'unknown envelope key of exactly 40 characters: rejected with detail');

select is(pg_temp.payload_full('contract', 42), 'ACCEPTED',
  'EXIT with the nil session_id: accepted');

select is(pg_temp.payload_full('contract', 43), 'ACCEPTED',
  'PAYMENT with the lower-case max session_id: accepted');

select is(pg_temp.payload_full('contract', 44), 'ACCEPTED',
  'ZONE_COUNT with the lower-case max zone_id: accepted');

select is(pg_temp.payload_full('contract', 45), 'ACCEPTED',
  'SHIFT_OPEN with the nil shift_id: accepted');

select is(pg_temp.payload_full('contract', 46), 'ACCEPTED',
  'EXIT with the nil tariff_id: accepted');

select is(pg_temp.payload_full('contract', 47), 'ACCEPTED',
  'ENTRY with a UUID version 8 session_id: accepted');

select is(pg_temp.payload_full('contract', 48), 'ACCEPTED',
  'ENTRY with an upper-case UUIDv7 event id: accepted');

select is(pg_temp.payload_full('contract', 49), 'ACCEPTED',
  'ENTRY vehicle_class of only ZERO WIDTH SPACE (U+200B) is not blank for trim(): accepted');

select is(pg_temp.payload_full('contract', 50), 'ACCEPTED',
  'ENTRY vehicle_class of only NEXT LINE (U+0085) is not blank for trim(): accepted');

select is(pg_temp.payload_full('contract', 51), 'ACCEPTED',
  'ENTRY vehicle_class of only MONGOLIAN VOWEL SEPARATOR (U+180E) is not blank for trim(): accepted');

select is(pg_temp.payload_echo('contract', 13), '00000000-0000-0000-0000-000000000000',
  'a valid uuid that is not UUIDv7 (the nil uuid) is echoed exactly as sent');

select is(pg_temp.payload_echo('contract', 48), '018F0000-0000-7000-8000-000000001501',
  'an upper-case UUIDv7 id is echoed exactly as sent');

select is(pg_temp.payload_echo('contract', 14), '<none>',
  'a braced id is never echoed');

select is(pg_temp.payload_echo('contract', 15), '<none>',
  'a numeric id is never echoed');

select is(
  (select result ->> 'accepted'
   from public.payload_test_results where label = 'contract'),
  '10',
  'contract batch reports 10 accepted events'
);

select is(
  (select result ->> 'rejected'
   from public.payload_test_results where label = 'contract'),
  '42',
  'contract batch reports 42 rejected events'
);

select is(
  (select count(*)::text
   from public.events
   where id in (
     '018f0000-0000-7000-8000-000000001428',
     '018f0000-0000-7000-8000-000000001429',
     '018f0000-0000-7000-8000-00000000142a',
     '018f0000-0000-7000-8000-00000000142b',
     '018f0000-0000-7000-8000-00000000142c',
     '018f0000-0000-7000-8000-00000000142d',
     '018F0000-0000-7000-8000-000000001501',
     '018f0000-0000-7000-8000-00000000142e',
     '018f0000-0000-7000-8000-00000000142f',
     '018f0000-0000-7000-8000-000000001430'
   )),
  '10',
  'all valid contract events are persisted'
);

select is(
  (select count(*)::text
   from public.events
   where id in (
     '018f0000-0000-7000-8000-000000001401',
     '018f0000-0000-7000-8000-000000001402',
     '018f0000-0000-7000-8000-000000001403',
     '018f0000-0000-7000-8000-000000001404',
     '018f0000-0000-7000-8000-000000001405',
     '018f0000-0000-7000-8000-000000001406',
     '018f0000-0000-7000-8000-000000001407',
     '018f0000-0000-7000-8000-000000001408',
     '018f0000-0000-7000-8000-000000001409',
     '018f0000-0000-7000-8000-00000000140a',
     '018f0000-0000-7000-8000-00000000140b',
     '018f0000-0000-7000-8000-00000000140c',
     '018f0000-0000-7000-8000-00000000140d',
     '018f0000-0000-7000-8000-00000000140e',
     '018f0000-0000-7000-8000-00000000140f',
     '018f0000-0000-7000-8000-000000001410',
     '018f0000-0000-7000-8000-000000001411',
     '018f0000-0000-7000-8000-000000001412',
     '018f0000-0000-7000-8000-000000001413',
     '018f0000-0000-7000-8000-000000001414',
     '018f0000-0000-7000-8000-000000001415',
     '018f0000-0000-7000-8000-000000001416',
     '018f0000-0000-7000-8000-000000001417',
     '018f0000-0000-7000-8000-000000001418',
     '018f0000-0000-7000-8000-000000001419',
     '018f0000-0000-7000-8000-00000000141a',
     '018f0000-0000-7000-8000-00000000141b',
     '018f0000-0000-7000-8000-00000000141c',
     '018f0000-0000-7000-8000-00000000141d',
     '018f0000-0000-7000-8000-00000000141e',
     '018f0000-0000-7000-8000-00000000141f',
     '018f0000-0000-7000-8000-000000001420',
     '018f0000-0000-7000-8000-000000001421',
     '018f0000-0000-7000-8000-000000001422',
     '018f0000-0000-7000-8000-000000001423',
     '018f0000-0000-7000-8000-000000001424',
     '018f0000-0000-7000-8000-000000001425',
     '018f0000-0000-7000-8000-000000001426',
     '018f0000-0000-7000-8000-000000001427'
   )),
  '0',
  'no invalid contract event with a valid uuid id is persisted'
);

-- A row stored before recorded_at existed has NULL recorded_at. The same event re-sent unchanged is a duplicate; the
-- same id with a recorded_at added is a collision and must not be merged into the old row.
insert into public.events (id, facility_id, device_id, staff_id, type, session_id, payload, device_time, source, schema_version)
values (
  '018f0000-0000-7000-8000-000000001601',
  '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000b1',
  'ENTRY',
  '018f0000-0000-7000-8000-000000002601',
  '{"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "H0001"}'::jsonb,
  '2026-10-01T10:00:00Z',
  'LIVE',
  1
);

set local role authenticated;

select pg_temp.call_payloads('history', array[
  '{"id": "018f0000-0000-7000-8000-000000001601", "session_id": "018f0000-0000-7000-8000-000000002601", "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "H0001"}}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-000000001601", "session_id": "018f0000-0000-7000-8000-000000002601", "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "H0001"}, "recorded_at": "2026-10-01T10:05:00Z"}'::jsonb
]);

reset role;

select is(pg_temp.payload_full('history', 0), 'DUPLICATE',
  'an old row without recorded_at: the same event re-sent unchanged is a duplicate');

select is(pg_temp.payload_full('history', 1), 'REJECTED:ID_COLLISION',
  'an old row without recorded_at: the same id re-sent with a recorded_at is a collision');

select is(
  (select recorded_at is null from public.events where id = '018f0000-0000-7000-8000-000000001601'),
  true,
  'the old row keeps a NULL recorded_at'
);

-- ---------------------------------------------------------------------------
-- Strict-validation behaviours previously asserted in supabase/tests/ingest_events.test.sql (moved here from the
-- merged suite, since they require migration 0011): schema_version contract range, envelope/payload detail paths,
-- non-object and missing-key events, claim/staff rejections carrying no detail, id echo and TOO_OLD.
-- ---------------------------------------------------------------------------
insert into public.staff (id, facility_id, name, pin_hash, pin_salt, active)
values (
  '00000000-0000-4000-8000-0000000000b2',
  '00000000-0000-4000-8000-0000000000f1',
  'Payload Test Inactive Guard',
  'h',
  's',
  false
);

set local role authenticated;

select pg_temp.call_payloads('ic01_reject', array[
  -- 0..3: schema_version outside the contract (1..32767) or not a whole JSON number.
  '{"id": "018f0000-0000-7000-8000-000000001701", "schema_version": 0}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-000000001702", "schema_version": "1"}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-000000001703", "schema_version": 1.4}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-000000001704", "schema_version": 3000000000}'::jsonb,
  -- 4..9: envelope field details.
  '{"id": "018f0000-0000-7000-8000-000000001705", "device_time": "yesterday"}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-000000001706", "device_time": "2026-10-01T10:00:00+05:30"}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-000000001707", "session_id": null}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-000000001708", "type": "NOPE"}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-000000001709", "source": "HACK"}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-00000000170a", "source": "PAPER_BACKFILL", "recorded_at": "nope"}'::jsonb,
  -- 10..16: payload shape and field details.
  '{"id": "018f0000-0000-7000-8000-00000000170b", "payload": {}}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-00000000170c", "payload": null}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-00000000170d", "type": "EXIT", "payload": {"fare_paise": -5, "exit_method": "SCAN"}}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-00000000170e", "type": "EXIT", "payload": {"fare_paise": "100", "exit_method": "SCAN"}}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-00000000170f", "type": "EXIT", "payload": {"fare_paise": 100000000000000000000, "exit_method": "SCAN"}}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-000000001710", "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "7K2QX", "vehicle_no": null}}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-000000001711", "type": "PAYMENT", "payload": {"mode": "CASH", "amount_paise": 100, "upi_attested": true}}'::jsonb,
  -- 17..19: claims and staff (rejected without a detail).
  '{"id": "018f0000-0000-7000-8000-000000001712", "facility_id": "00000000-0000-4000-8000-0000000000f2"}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-000000001713", "device_id": "00000000-0000-4000-8000-0000000000d9"}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-000000001714", "staff_id": "00000000-0000-4000-8000-0000000000b2"}'::jsonb
]);

select pg_temp.call_payloads('ic01_first', array['{"id": "018f0000-0000-7000-8000-000000001720", "schema_version": 1.0}'::jsonb]);
select pg_temp.call_payloads('ic01_retry', array['{"id": "018f0000-0000-7000-8000-000000001720", "schema_version": 1.0}'::jsonb]);

select pg_temp.call_raw('ic01_non_object', '["nope"]'::jsonb);
select pg_temp.call_raw('ic01_missing_payload', jsonb_build_array(
  (((select e from public.payload_test_base)
    || '{"id": "018f0000-0000-7000-8000-000000001721"}'::jsonb)
   - 'payload')
));

reset role;

select is(pg_temp.payload_full('ic01_reject', 0), 'REJECTED:INVALID_ENVELOPE@schema_version',
  'schema_version 0 is outside the contract range 1..32767: INVALID_ENVELOPE (not TOO_OLD), detail names schema_version');
select is(pg_temp.payload_full('ic01_reject', 1), 'REJECTED:INVALID_ENVELOPE@schema_version',
  'a string schema_version must be a JSON number: INVALID_ENVELOPE, detail names schema_version');
select is(pg_temp.payload_full('ic01_reject', 2), 'REJECTED:INVALID_ENVELOPE@schema_version',
  'a fractional schema_version (1.4) is rejected, detail names schema_version');
select is(pg_temp.payload_full('ic01_reject', 3), 'REJECTED:INVALID_ENVELOPE@schema_version',
  'a schema_version beyond the integer range is rejected, detail names schema_version');
select is(pg_temp.payload_full('ic01_reject', 4), 'REJECTED:INVALID_ENVELOPE@device_time',
  'non-ISO device_time is rejected, detail names device_time');
select is(pg_temp.payload_full('ic01_reject', 5), 'REJECTED:INVALID_ENVELOPE@device_time',
  'device_time must be UTC with Z: an offset is rejected, detail names device_time');
select is(pg_temp.payload_full('ic01_reject', 6), 'REJECTED:INVALID_ENVELOPE@session_id',
  'ENTRY without a session_id is rejected, detail names session_id');
select is(pg_temp.payload_full('ic01_reject', 7), 'REJECTED:INVALID_ENVELOPE@type',
  'an unknown type is rejected, detail names type');
select is(pg_temp.payload_full('ic01_reject', 8), 'REJECTED:INVALID_ENVELOPE@source',
  'an unknown source is rejected, detail names source');
select is(pg_temp.payload_full('ic01_reject', 9), 'REJECTED:INVALID_ENVELOPE@recorded_at',
  'a malformed recorded_at on a PAPER_BACKFILL event is rejected, detail names recorded_at');
select is(pg_temp.payload_full('ic01_reject', 10), 'REJECTED:INVALID_PAYLOAD@payload.vehicle_class',
  'an empty ENTRY payload: detail names the first missing field in schema order');
select is(pg_temp.payload_full('ic01_reject', 11), 'REJECTED:INVALID_PAYLOAD@payload',
  'a JSON null payload is INVALID_PAYLOAD, detail is payload');
select is(pg_temp.payload_full('ic01_reject', 12), 'REJECTED:INVALID_PAYLOAD@payload.fare_paise',
  'a negative fare_paise is rejected, detail names the offending field');
select is(pg_temp.payload_full('ic01_reject', 13), 'REJECTED:INVALID_PAYLOAD@payload.fare_paise',
  'a string amount is rejected, detail names the offending field');
select is(pg_temp.payload_full('ic01_reject', 14), 'REJECTED:INVALID_PAYLOAD@payload.fare_paise',
  'an amount beyond the safe-integer range is rejected, detail names the offending field');
select is(pg_temp.payload_full('ic01_reject', 15), 'REJECTED:INVALID_PAYLOAD@payload.vehicle_no',
  'an optional key set to null is rejected, detail names the key');
select is(pg_temp.payload_full('ic01_reject', 16), 'REJECTED:INVALID_PAYLOAD@payload.upi_attested',
  'upi_attested with mode CASH is rejected, detail names upi_attested');
select is(pg_temp.payload_full('ic01_reject', 17), 'REJECTED:CLAIM_MISMATCH',
  'a claim mismatch (other facility) carries no detail');
select is(pg_temp.payload_full('ic01_reject', 18), 'REJECTED:CLAIM_MISMATCH',
  'a claim mismatch (other device) carries no detail');
select is(pg_temp.payload_full('ic01_reject', 19), 'REJECTED:STAFF_NOT_ACTIVE',
  'an inactive staff member is rejected without a detail');

select is(pg_temp.payload_full('ic01_first', 0), 'ACCEPTED',
  'schema_version 1.0 is the whole number 1 and is accepted, with no detail');
select is(pg_temp.payload_echo('ic01_first', 0), '018f0000-0000-7000-8000-000000001720',
  'an accepted event echoes its id');
select is(pg_temp.payload_full('ic01_retry', 0), 'DUPLICATE',
  're-sending the same event is a duplicate, with no detail');

select is(pg_temp.payload_full('ic01_non_object', 0), 'REJECTED:INVALID_ENVELOPE@event',
  'an event that is not an object is rejected, detail is event');
select is(pg_temp.payload_echo('ic01_non_object', 0), '<none>',
  'a non-object event echoes no id');
select is(pg_temp.payload_full('ic01_missing_payload', 0), 'REJECTED:INVALID_ENVELOPE@payload',
  'an event without a payload key is INVALID_ENVELOPE, detail is payload');

select is(
  (select count(*)::text from public.events
   where id between '018f0000-0000-7000-8000-000000001701' and '018f0000-0000-7000-8000-000000001714'
      or id = '018f0000-0000-7000-8000-000000001721'),
  '0',
  'none of the rejected IC-01 events is persisted'
);

-- SCHEMA_VERSION_TOO_OLD is unreachable while the server minimum is 1 (the contract starts at 1), so the minimum is
-- raised to 2 for one call and restored straight after; the change is rolled back with the rest of this test.
create or replace function public.min_supported_schema_version() returns integer
    language sql immutable parallel safe set search_path = pg_catalog
    as $$ select 2 $$;

set local role authenticated;
select pg_temp.call_payloads('ic01_too_old', array['{"id": "018f0000-0000-7000-8000-000000001730", "schema_version": 1}'::jsonb]);
reset role;

create or replace function public.min_supported_schema_version() returns integer
    language sql immutable parallel safe set search_path = pg_catalog
    as $$ select 1 $$;

select is(pg_temp.payload_full('ic01_too_old', 0), 'REJECTED:SCHEMA_VERSION_TOO_OLD@schema_version',
  'a contract-valid version below the server minimum is TOO_OLD (minimum raised to 2 for this call), detail names schema_version');

-- Leap-year century rule (PR #30 review): a year divisible by 100 is a leap year only when it is also divisible by 400.
-- 1900 and 2100 have no 29 February; 2000 does. Checked for recorded_at and for device_time, which share the validator.
set local role authenticated;
select pg_temp.call_payloads('leap_century', array[
  '{"id": "018f0000-0000-7000-8000-0000000017c0", "session_id": "018f0000-0000-7000-8000-0000000027c0",
    "recorded_at": "1900-02-29T10:00:00Z",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C1900"}}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-0000000017c1", "session_id": "018f0000-0000-7000-8000-0000000027c1",
    "recorded_at": "2100-02-29T10:00:00Z",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C2100"}}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-0000000017c2", "session_id": "018f0000-0000-7000-8000-0000000027c2",
    "recorded_at": "2000-02-29T10:00:00Z",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "C2000"}}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-0000000017c3", "session_id": "018f0000-0000-7000-8000-0000000027c3",
    "device_time": "1900-02-29T10:00:00Z",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "D1900"}}'::jsonb,
  '{"id": "018f0000-0000-7000-8000-0000000017c4", "session_id": "018f0000-0000-7000-8000-0000000027c4",
    "device_time": "2000-02-29T10:00:00Z",
    "payload": {"vehicle_class": "CAR", "zone_id": "00000000-0000-4000-8000-0000000000c1", "short_code": "D2000"}}'::jsonb
]);
reset role;

select is(pg_temp.payload_full('leap_century', 0), 'REJECTED:INVALID_ENVELOPE@recorded_at',
  'recorded_at 29 February 1900 (century, not divisible by 400): rejected');
select is(pg_temp.payload_full('leap_century', 1), 'REJECTED:INVALID_ENVELOPE@recorded_at',
  'recorded_at 29 February 2100 (century, not divisible by 400): rejected');
select is(pg_temp.payload_full('leap_century', 2), 'ACCEPTED',
  'recorded_at 29 February 2000 (divisible by 400): accepted');
select is(pg_temp.payload_full('leap_century', 3), 'REJECTED:INVALID_ENVELOPE@device_time',
  'device_time 29 February 1900: rejected');
select is(pg_temp.payload_full('leap_century', 4), 'ACCEPTED',
  'device_time 29 February 2000: accepted');
select is(
  (select to_char(recorded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS')
   from public.events where id = '018f0000-0000-7000-8000-0000000017c2'),
  '2000-02-29T10:00:00',
  'recorded_at 29 February 2000 is persisted');
select is(
  (select to_char(device_time at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS')
   from public.events where id = '018f0000-0000-7000-8000-0000000017c4'),
  '2000-02-29T10:00:00',
  'device_time 29 February 2000 is persisted');
select is(
  (select count(*)::int from public.events where id in ('018f0000-0000-7000-8000-0000000017c0',
     '018f0000-0000-7000-8000-0000000017c1', '018f0000-0000-7000-8000-0000000017c3')),
  0,
  'no rejected century event is stored');

select * from finish();
rollback;
