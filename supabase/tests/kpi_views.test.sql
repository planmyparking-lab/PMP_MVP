-- pgTAP tests for migration 0009_views_kpis.sql (CLD-05: v_hourly, v_daily_kpis). Run with `pnpm test:db`.
-- v_zone_now is NOT tested: it is not written (occupancy definition pending, OQ-A7), so T-CLD-05-U2 is not covered.
-- T-CLD-05-I2 (30-day oracle), R1 (a column-list FILE does not exist yet; the column assertions below pin the proposed
-- names and types) and X1 (k6 p95) are NOT covered here; see docs/integrations/cld-05-kpi-views.md.
-- Covered: U1 (golden day), U3 (hour edges), I1 (RLS through the views), N1 (empty facility), plus the CLD-05 edge cases.
--
-- The expected values were computed BY HAND from the fixture below, not by the views. Facility time zone Asia/Kolkata is
-- UTC+05:30 (so 00:00 local = 18:30 UTC the day before). All events are PAPER_BACKFILL, so the clock-skew detector stays quiet.
--
-- Facility F1 (golden), local times on 10 and 11 March 2026:
--   S1  entry 10 Mar 23:59:59, exit 11 Mar 00:01:00 (spans midnight, 61 s), CASH 250 paid 23:59:59.5 on the 10th
--   S2  entry 10:00, exit 11:00 (60 min), CASH 5000; a DUPLICATE exit at 11:05 (must be ignored)
--   S3  pass entry 10:15, exit 10:45 (30 min), PASS 1200
--   S4  entry 10:20, exit 12:20 (120 min), UPI 7000 attested
--   S5  entry 10:25, exit 10:55 (30 min), UPI 3000 not attested, plus WAIVED 9999 and mode CARD 4444 (both excluded)
--   S6  orphan: exit 11:00 with no entry
--   S8  entry 12:00, never exits
--   S9  entry 13:00, exit 12:30 (exit BEFORE entry: negative stay, excluded from the average)
--   two OVERRIDE events on 10 March
--
-- RLS: policies for events and facilities arrive with 0010 (CLD-03), which is not in this chain. A positive RLS test needs
-- some policy, so this file creates two STAND-IN policies (kpi_test_*) inside the transaction. They prove that the views
-- run with the caller's rights (security_invoker) and isolate facilities and organizations when the table policies do; they
-- do NOT test the 0010 policies themselves. The transaction is rolled back, so nothing remains.
-- SCOPE WARNING: this file validates the views against the 0001-0009 chain only. Permissive policies combine with OR, so
-- if 0010's real policies are present the stand-ins below would ADD access and could mask a 0010 policy that wrongly denies
-- or wrongly allows. Passing this file after 0010 lands is therefore NOT evidence that 0010's RLS is correct. That needs a
-- separate 0010-specific RLS test that uses the real policies with no stand-in policy created.
begin;
select plan(40);

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000aa00', 'Org A'), ('00000000-0000-0000-0000-00000000ab00', 'Org B');
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000aa00', 'F1 golden', 'Asia/Kolkata', 10),
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000aa00', 'F2 empty', 'Asia/Kolkata', 10),
  ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-00000000aa00', 'F3 malformed payments', 'Asia/Kolkata', 10),
  ('00000000-0000-0000-0000-00000000aa04', '00000000-0000-0000-0000-00000000aa00', 'F4 hour edges', 'Asia/Kolkata', 10),
  ('00000000-0000-0000-0000-00000000aa05', '00000000-0000-0000-0000-00000000aa00', 'F5 Kathmandu', 'Asia/Kathmandu', 10),
  ('00000000-0000-0000-0000-00000000ab01', '00000000-0000-0000-0000-00000000ab00', 'F7 other organization', 'Asia/Kolkata', 10);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000bb01', 'm1@test.invalid'), ('00000000-0000-0000-0000-00000000bb02', 'm2@test.invalid'),
  ('00000000-0000-0000-0000-00000000bb05', 'm5@test.invalid');
insert into public.memberships (user_id, org_id, facility_id, role) values
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000aa00', '00000000-0000-0000-0000-00000000aa01', 'manager'),
  ('00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-00000000aa00', '00000000-0000-0000-0000-00000000aa02', 'manager'),
  ('00000000-0000-0000-0000-00000000bb05', '00000000-0000-0000-0000-00000000ab00', '00000000-0000-0000-0000-00000000ab01', 'manager');
-- one device and one staff member per facility that has events (events need both in their own facility)
insert into public.devices (id, facility_id, name)
  select ('00000000-0000-0000-0000-00000000dd0' || n)::uuid, ('00000000-0000-0000-0000-00000000aa0' || n)::uuid, 'D' || n
  from generate_series(1, 5) n where n <> 2;
insert into public.devices (id, facility_id, name) values
  ('00000000-0000-0000-0000-00000000dd07', '00000000-0000-0000-0000-00000000ab01', 'D7');
insert into public.staff (id, facility_id, name, pin_hash, pin_salt)
  select ('00000000-0000-0000-0000-00000000cc0' || n)::uuid, ('00000000-0000-0000-0000-00000000aa0' || n)::uuid, 'S' || n, 'h', 's'
  from generate_series(1, 5) n where n <> 2;
insert into public.staff (id, facility_id, name, pin_hash, pin_salt) values
  ('00000000-0000-0000-0000-00000000cc07', '00000000-0000-0000-0000-00000000ab01', 'S7', 'h', 's');

-- helpers. fac: 1..5 for org A, 7 for org B. sid(n) builds a session id.
create function pg_temp.sid(n int) returns uuid language sql as
  $$ select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.ev(fac int, t text, sess uuid, ts timestamptz, p jsonb default '{}', eid uuid default gen_random_uuid())
returns void language sql as $$
  insert into public.events (id, facility_id, device_id, staff_id, type, session_id, payload, device_time, source, schema_version)
  values (eid, (case when fac = 7 then '00000000-0000-0000-0000-00000000ab01' else '00000000-0000-0000-0000-00000000aa0' || fac end)::uuid,
          ('00000000-0000-0000-0000-00000000dd0' || fac)::uuid, ('00000000-0000-0000-0000-00000000cc0' || fac)::uuid,
          t, sess, p, ts, 'PAPER_BACKFILL', 1);
$$;
create function pg_temp.entry(fac int, sess uuid, ts timestamptz, extra jsonb default '{}', eid uuid default gen_random_uuid())
returns void language sql as $$
  select pg_temp.ev(fac, 'ENTRY', sess, ts,
    jsonb_build_object('zone_id', gen_random_uuid(), 'vehicle_class', 'car', 'short_code', 'ABCDE') || extra, eid);
$$;
create function pg_temp.pay(fac int, sess uuid, ts timestamptz, mode text, amount jsonb, attested boolean default false)
returns void language sql as $$
  select pg_temp.ev(fac, 'PAYMENT', sess, ts, jsonb_build_object('mode', mode, 'amount_paise', amount, 'upi_attested', attested));
$$;

-- F1 golden fixture (UTC times; IST = UTC + 5:30)
select pg_temp.entry(1, pg_temp.sid(51), '2026-03-10 18:29:59+00');
select pg_temp.pay(1, pg_temp.sid(51), '2026-03-10 18:29:59.5+00', 'CASH', '250');
select pg_temp.ev(1, 'EXIT', pg_temp.sid(51), '2026-03-10 18:31:00+00');
select pg_temp.entry(1, pg_temp.sid(52), '2026-03-10 04:30:00+00');
select pg_temp.ev(1, 'EXIT', pg_temp.sid(52), '2026-03-10 05:30:00+00');
select pg_temp.pay(1, pg_temp.sid(52), '2026-03-10 05:30:00+00', 'CASH', '5000');
select pg_temp.ev(1, 'EXIT', pg_temp.sid(52), '2026-03-10 05:35:00+00');
select pg_temp.entry(1, pg_temp.sid(53), '2026-03-10 04:45:00+00', jsonb_build_object('pass_id', gen_random_uuid()));
select pg_temp.ev(1, 'EXIT', pg_temp.sid(53), '2026-03-10 05:15:00+00');
select pg_temp.pay(1, pg_temp.sid(53), '2026-03-10 05:15:00+00', 'PASS', '1200');
select pg_temp.entry(1, pg_temp.sid(54), '2026-03-10 04:50:00+00');
select pg_temp.ev(1, 'EXIT', pg_temp.sid(54), '2026-03-10 06:50:00+00');
select pg_temp.pay(1, pg_temp.sid(54), '2026-03-10 06:50:00+00', 'UPI', '7000', true);
select pg_temp.entry(1, pg_temp.sid(55), '2026-03-10 04:55:00+00');
select pg_temp.ev(1, 'EXIT', pg_temp.sid(55), '2026-03-10 05:25:00+00');
select pg_temp.pay(1, pg_temp.sid(55), '2026-03-10 05:25:00+00', 'UPI', '3000', false);
select pg_temp.pay(1, pg_temp.sid(55), '2026-03-10 05:25:00+00', 'WAIVED', '9999');
select pg_temp.pay(1, pg_temp.sid(55), '2026-03-10 05:25:00+00', 'CARD', '4444');
select pg_temp.ev(1, 'EXIT', pg_temp.sid(56), '2026-03-10 05:30:00+00');
select pg_temp.entry(1, pg_temp.sid(58), '2026-03-10 06:30:00+00');
select pg_temp.entry(1, pg_temp.sid(59), '2026-03-10 07:30:00+00');
select pg_temp.ev(1, 'EXIT', pg_temp.sid(59), '2026-03-10 07:00:00+00');
select pg_temp.ev(1, 'OVERRIDE', pg_temp.sid(52), '2026-03-10 05:40:00+00',
  '{"target_event_id":"00000000-0000-0000-0000-000000000099","reason_code":"OTHER","note":"x"}');
select pg_temp.ev(1, 'OVERRIDE', pg_temp.sid(54), '2026-03-10 06:55:00+00',
  '{"target_event_id":"00000000-0000-0000-0000-000000000099","reason_code":"OTHER","note":"x"}');

-- F3: payments inserted directly, bypassing ingest_events (for example rows stored before payload validation was stricter).
-- 12 March: valid cash 5000, 5000.0 (a whole JSON number) and 7 = 10007, UPI 3000, PASS 11
select pg_temp.pay(3, pg_temp.sid(301), '2026-03-12 05:00:00+00', 'CASH', '5000');
select pg_temp.pay(3, pg_temp.sid(302), '2026-03-12 05:01:00+00', 'CASH', '5000.0');
select pg_temp.pay(3, pg_temp.sid(303), '2026-03-12 05:02:00+00', 'CASH', '7');
select pg_temp.pay(3, pg_temp.sid(304), '2026-03-12 05:03:00+00', 'UPI', '3000', true);
select pg_temp.pay(3, pg_temp.sid(305), '2026-03-12 05:04:00+00', 'PASS', '11');
-- 12 March: malformed or unsupported, all excluded and none raises
select pg_temp.pay(3, pg_temp.sid(310), '2026-03-12 05:10:00+00', 'CASH', '"twelve"');
select pg_temp.pay(3, pg_temp.sid(311), '2026-03-12 05:11:00+00', 'CASH', '12.5');
select pg_temp.pay(3, pg_temp.sid(312), '2026-03-12 05:12:00+00', 'CASH', '1e30');
select pg_temp.pay(3, pg_temp.sid(313), '2026-03-12 05:13:00+00', 'CASH', '9223372036854775808');
select pg_temp.pay(3, pg_temp.sid(314), '2026-03-12 05:14:00+00', 'CASH', 'null');
select pg_temp.pay(3, pg_temp.sid(315), '2026-03-12 05:15:00+00', 'CASH', '-5');
select pg_temp.pay(3, pg_temp.sid(316), '2026-03-12 05:16:00+00', 'CASH', '"5000"');
select pg_temp.pay(3, pg_temp.sid(317), '2026-03-12 05:17:00+00', 'CASH', 'true');
select pg_temp.pay(3, pg_temp.sid(318), '2026-03-12 05:18:00+00', 'CASH', '[5000]');
select pg_temp.ev(3, 'PAYMENT', pg_temp.sid(319), '2026-03-12 05:19:00+00', '{"mode":"CASH","upi_attested":false}');
select pg_temp.ev(3, 'PAYMENT', pg_temp.sid(320), '2026-03-12 05:20:00+00', '[1,2]');
select pg_temp.pay(3, pg_temp.sid(321), '2026-03-12 05:21:00+00', 'WAIVED', '500');
select pg_temp.pay(3, pg_temp.sid(322), '2026-03-12 05:22:00+00', 'cash', '500');
select pg_temp.pay(3, pg_temp.sid(323), '2026-03-12 05:23:00+00', 'CARD', '500');
select pg_temp.ev(3, 'PAYMENT', pg_temp.sid(324), '2026-03-12 05:24:00+00', '{"amount_paise":500,"upi_attested":false}');
-- 13 March: two payments of the bigint maximum (the sum exceeds bigint). 14 March: one alone.
-- 15 March: bigint-maximum cash plus 5 of UPI (the total saturates at the maximum, documented in 0009).
select pg_temp.pay(3, pg_temp.sid(330), '2026-03-13 05:00:00+00', 'CASH', '9223372036854775807');
select pg_temp.pay(3, pg_temp.sid(331), '2026-03-13 05:01:00+00', 'CASH', '9223372036854775807');
select pg_temp.pay(3, pg_temp.sid(332), '2026-03-14 05:00:00+00', 'CASH', '9223372036854775807');
select pg_temp.pay(3, pg_temp.sid(333), '2026-03-15 05:00:00+00', 'CASH', '9223372036854775807');
select pg_temp.pay(3, pg_temp.sid(334), '2026-03-15 05:01:00+00', 'UPI', '5');

-- F4: hour edges in Asia/Kolkata. 00:00:00, 00:59:59 and 01:00:00 local on 15 March, and 23:59:59 on the 14th.
select pg_temp.entry(4, pg_temp.sid(401), '2026-03-14 18:29:59+00');
select pg_temp.entry(4, pg_temp.sid(402), '2026-03-14 18:30:00+00');
select pg_temp.entry(4, pg_temp.sid(403), '2026-03-14 19:29:59+00');
select pg_temp.entry(4, pg_temp.sid(404), '2026-03-14 19:30:00+00');
-- 16 March: two ENTRY events of one session at the same instant; the lower event id wins (no pass), so pass_count stays 0
select pg_temp.entry(4, pg_temp.sid(410), '2026-03-16 05:00:00+00', '{}', '00000000-0000-0000-0000-0000000f0001');
select pg_temp.entry(4, pg_temp.sid(410), '2026-03-16 05:00:00+00', jsonb_build_object('pass_id', gen_random_uuid()),
  '00000000-0000-0000-0000-0000000f0002');

-- F5: Asia/Kathmandu is UTC+05:45, not on the hour: 18:15 UTC on 14 March is 00:00 local on the 15th
select pg_temp.entry(5, pg_temp.sid(501), '2026-03-14 18:15:00+00');
select pg_temp.entry(5, pg_temp.sid(502), '2026-03-14 18:14:59+00');

-- F7 (another organization): one stay of 10 minutes and 700 cash on 10 March (local)
select pg_temp.entry(7, pg_temp.sid(701), '2026-03-10 04:30:00+00');
select pg_temp.ev(7, 'EXIT', pg_temp.sid(701), '2026-03-10 04:40:00+00');
select pg_temp.pay(7, pg_temp.sid(701), '2026-03-10 04:40:00+00', 'CASH', '700');

-- ---- Column contract (T-CLD-05-R1 is only partly covered: no IC-07 column-list file exists to compare with) ----
select is(
  (select array_agg(column_name::text || ':' || data_type::text order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'v_hourly'),
  array['facility_id:uuid', 'local_date:date', 'hour:integer', 'entries:integer', 'exits:integer'],
  'v_hourly columns, order and types');
select is(
  (select array_agg(column_name::text || ':' || data_type::text order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'v_daily_kpis'),
  array['facility_id:uuid', 'local_date:date', 'vehicles:integer', 'cash_paise:bigint', 'upi_paise:bigint', 'pass_paise:bigint',
        'declared_total_paise:bigint', 'pass_count:integer', 'avg_stay_minutes:numeric', 'overrides:integer',
        'overrides_per_100:numeric', 'orphan_exits:integer'],
  'v_daily_kpis columns, order and types (money is bigint paise)');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.v_hourly'::regclass),
  'v_hourly uses security_invoker = true');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.v_daily_kpis'::regclass),
  'v_daily_kpis uses security_invoker = true');
select is(has_table_privilege('anon', 'public.v_daily_kpis', 'SELECT') or has_table_privilege('anon', 'public.v_hourly', 'SELECT'),
  false, 'anon holds no privilege on either view');
select is(has_table_privilege('authenticated', 'public.v_daily_kpis', 'SELECT')
  and has_table_privilege('authenticated', 'public.v_hourly', 'SELECT'), true, 'authenticated may select both views');

-- ---- T-CLD-05-U1: golden day, read as superuser (sees every row) ----
select is((select count(*) from public.v_daily_kpis where facility_id = '00000000-0000-0000-0000-00000000aa01'), 2::bigint,
  'F1 has two active local days: 10 and 11 March');
select results_eq(
  $$select vehicles, cash_paise, upi_paise, pass_paise, declared_total_paise, pass_count, avg_stay_minutes::text,
           overrides, overrides_per_100::text, orphan_exits
    from public.v_daily_kpis where facility_id = '00000000-0000-0000-0000-00000000aa01' and local_date = '2026-03-10'$$,
  $$values (7, 5000::bigint, 10000::bigint, 1200::bigint, 16200::bigint, 1, '60.00', 2, '28.57', 1)$$,
  '10 March: 7 entries; cash 5000, UPI 10000 (attested or not), pass 1200, total 16200 (WAIVED 9999 and CARD 4444 excluded); 1 pass entry; mean stay 60 (S9 negative and orphan excluded); 2 overrides = 28.57 per 100; 1 orphan exit');
select results_eq(
  $$select vehicles, cash_paise, upi_paise, pass_paise, declared_total_paise, pass_count, avg_stay_minutes::text,
           overrides, overrides_per_100::text, orphan_exits
    from public.v_daily_kpis where facility_id = '00000000-0000-0000-0000-00000000aa01' and local_date = '2026-03-11'$$,
  $$values (0, 250::bigint, 0::bigint, 0::bigint, 250::bigint, 0, '1.02', 0, null::text, 0)$$,
  '11 March: the midnight-spanning session counts its exit, stay (61 s = 1.02 min) and its 23:59:59.5 payment (250, dated by the exit) here; no entries, per-100 is null');
select is((select cash_paise + upi_paise + pass_paise - declared_total_paise from public.v_daily_kpis
  where facility_id = '00000000-0000-0000-0000-00000000aa01' and local_date = '2026-03-10'), 0::bigint,
  'declared_total_paise equals the sum of the three payment-mode totals');
select results_eq(
  $$select local_date::text, hour, entries, exits from public.v_hourly
    where facility_id = '00000000-0000-0000-0000-00000000aa01' order by local_date, hour$$,
  $$values ('2026-03-10', 10, 4, 2), ('2026-03-10', 11, 0, 2), ('2026-03-10', 12, 1, 2), ('2026-03-10', 13, 1, 0),
           ('2026-03-10', 23, 1, 0), ('2026-03-11', 0, 0, 1)$$,
  'hourly buckets (local): the duplicate exit at 11:05 is not counted, the orphan exit is, the 23:59:59 entry is hour 23 and its exit is 00:01 next day');
select is((select sum(entries) from public.v_hourly where facility_id = '00000000-0000-0000-0000-00000000aa01'),
  (select sum(vehicles) from public.v_daily_kpis where facility_id = '00000000-0000-0000-0000-00000000aa01'),
  'F1: hourly entries total equals daily vehicles total (the two views pair sessions the same way)');

-- ---- Payment modes, WAIVED, malformed amounts, overflow (F3) ----
select is((select count(*) from public.v_daily_kpis where facility_id = '00000000-0000-0000-0000-00000000aa03'), 4::bigint,
  'F3 with malformed payments still returns its four days (12 to 15 March), no error');
select results_eq(
  $$select cash_paise, upi_paise, pass_paise, declared_total_paise, vehicles, orphan_exits
    from public.v_daily_kpis where facility_id = '00000000-0000-0000-0000-00000000aa03' and local_date = '2026-03-12'$$,
  $$values (10007::bigint, 3000::bigint, 11::bigint, 13018::bigint, 0, 0)$$,
  '12 March: CASH 5000, 5000.0 and 7, UPI 3000, PASS 11 count; "twelve", 12.5, 1e30, 2^63, null, -5, "5000", true, [5000], missing key, array payload, WAIVED, CARD, lower-case cash and a missing mode add nothing');
select results_eq(
  $$select cash_paise, declared_total_paise from public.v_daily_kpis
    where facility_id = '00000000-0000-0000-0000-00000000aa03' and local_date = '2026-03-13'$$,
  $$values (9223372036854775807::bigint, 9223372036854775807::bigint)$$,
  'two bigint-maximum payments overflow the sum: clamped to the maximum, no error');
select results_eq(
  $$select cash_paise, declared_total_paise from public.v_daily_kpis
    where facility_id = '00000000-0000-0000-0000-00000000aa03' and local_date = '2026-03-14'$$,
  $$values (9223372036854775807::bigint, 9223372036854775807::bigint)$$,
  'a single payment of exactly the bigint maximum is accepted');
select results_eq(
  $$select cash_paise, upi_paise, declared_total_paise from public.v_daily_kpis
    where facility_id = '00000000-0000-0000-0000-00000000aa03' and local_date = '2026-03-15'$$,
  $$values (9223372036854775807::bigint, 5::bigint, 9223372036854775807::bigint)$$,
  'when the true total exceeds bigint the total saturates at the maximum (documented), each mode keeps its own value');
select is((select declared_total_paise from public.v_daily_kpis
  where facility_id = '00000000-0000-0000-0000-00000000aa01' and local_date = '2026-03-10'), 16200::bigint,
  'the other facility''s revenue is unaffected by the malformed payments');

-- ---- T-CLD-05-U3: hour edges (F4 Asia/Kolkata, F5 Asia/Kathmandu) ----
select results_eq(
  $$select local_date::text, hour, entries, exits from public.v_hourly
    where facility_id = '00000000-0000-0000-0000-00000000aa04' order by local_date, hour$$,
  $$values ('2026-03-14', 23, 1, 0), ('2026-03-15', 0, 2, 0), ('2026-03-15', 1, 1, 0), ('2026-03-16', 10, 1, 0)$$,
  '23:59:59 is hour 23 of the 14th; 00:00:00 and 00:59:59 are hour 0 of the 15th; 01:00:00 is hour 1; 10:30 local on the 16th');
select results_eq(
  $$select local_date::text, hour, entries from public.v_hourly
    where facility_id = '00000000-0000-0000-0000-00000000aa05' order by local_date, hour$$,
  $$values ('2026-03-14', 23, 1), ('2026-03-15', 0, 1)$$,
  'a +05:45 time zone is honoured: 18:15 UTC is 00:00 local on the 15th, 18:14:59 UTC is 23:59:59 on the 14th');
select results_eq(
  $$select local_date::text, vehicles, pass_count, cash_paise, upi_paise, pass_paise, declared_total_paise
    from public.v_daily_kpis where facility_id = '00000000-0000-0000-0000-00000000aa04' order by local_date$$,
  $$values ('2026-03-14', 1, 0, 0::bigint, 0::bigint, 0::bigint, 0::bigint), ('2026-03-15', 3, 0, 0::bigint, 0::bigint, 0::bigint, 0::bigint),
           ('2026-03-16', 1, 0, 0::bigint, 0::bigint, 0::bigint, 0::bigint)$$,
  'days with entries and no payment read zero revenue (never null); two ENTRY events of one session count once and the lower event id decides pass_count');

-- ---- Cross-facility and cross-organization isolation helpers: stand-in policies (see the header) ----
create function public.kpi_test_is_member(fid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.facilities f join public.memberships m on m.org_id = f.org_id
    where f.id = fid and m.user_id = (select auth.uid()) and m.role in ('owner', 'manager')
      and (m.facility_id is null or m.facility_id = f.id));
$$;

-- With no policy on events and facilities (the 0001-0009 chain) the views return nothing to a signed-in user. When 0010 is
-- present this check is not applicable and passes trivially. The isolation tests below still run with the stand-in policies
-- (OR-combined with 0010's), so they do not validate 0010; see the scope warning in the header.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bb01","role":"authenticated"}', true);
set local role authenticated;
select is(
  case when exists (select 1 from pg_policy where polrelid = 'public.events'::regclass)
       then 0::bigint else (select count(*) from public.v_daily_kpis) + (select count(*) from public.v_hourly) end,
  0::bigint, 'deny by default: without an events policy a signed-in manager reads no KPI rows (or 0010 is present: not applicable)');
reset role;

create policy kpi_test_events_select on public.events for select to authenticated
  using (public.kpi_test_is_member(facility_id));
create policy kpi_test_facilities_select on public.facilities for select to authenticated
  using (public.kpi_test_is_member(id));

-- ---- T-CLD-05-I1: RLS through the views ----
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bb01","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.v_daily_kpis), 2::bigint, 'manager of F1 sees only F1''s two daily rows');
select is((select count(*) from public.v_hourly), 6::bigint, 'manager of F1 sees only F1''s six hourly rows');
select is((select count(*) from public.v_daily_kpis where facility_id <> '00000000-0000-0000-0000-00000000aa01'), 0::bigint,
  'manager of F1 sees no row of another facility of the same organization');
select is((select count(*) from public.v_daily_kpis where facility_id = '00000000-0000-0000-0000-00000000ab01'), 0::bigint,
  'manager of F1 sees no row of the other organization');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bb05","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$select facility_id::text, local_date::text, vehicles, cash_paise, declared_total_paise, avg_stay_minutes::text
    from public.v_daily_kpis$$,
  $$values ('00000000-0000-0000-0000-00000000ab01', '2026-03-10', 1, 700::bigint, 700::bigint, '10.00')$$,
  'manager of the other organization sees exactly its own facility''s row and no organization A data');
select is((select count(*) from public.v_hourly where facility_id <> '00000000-0000-0000-0000-00000000ab01'), 0::bigint,
  'manager of the other organization sees no organization A hourly row');
reset role;

-- ---- T-CLD-05-N1: empty facility ----
select is((select count(*) from public.v_daily_kpis where facility_id = '00000000-0000-0000-0000-00000000aa02')
  + (select count(*) from public.v_hourly where facility_id = '00000000-0000-0000-0000-00000000aa02'), 0::bigint,
  'a facility with no events returns no rows and no error (superuser)');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bb02","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.v_daily_kpis) + (select count(*) from public.v_hourly), 0::bigint,
  'the manager of the empty facility reads zero rows, no error, and sees no other facility''s data');
select is((select coalesce(sum(cash_paise + upi_paise + pass_paise + declared_total_paise), 0)::bigint from public.v_daily_kpis), 0::bigint,
  'an aggregate over the empty facility is zero, not null');
reset role;

-- a device (a different principal: no membership) reads nothing, and anon is refused outright
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bb09","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.v_daily_kpis) + (select count(*) from public.v_hourly), 0::bigint,
  'a signed-in user with no membership reads no KPI rows');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.v_daily_kpis$$, '42501', null, 'anon cannot read v_daily_kpis');
select throws_ok($$select count(*) from public.v_hourly$$, '42501', null, 'anon cannot read v_hourly');
reset role;

-- ---- Late exit (PR #33 review): revenue moves from the payment's date to the exit's date ----
-- F6, Asia/Kolkata. Session 601 enters 20 March 22:00 IST (16:30Z) and pays CASH 1500 at 22:10 IST (16:40Z). While the
-- session has no EXIT the payment is dated by itself (20 March). When the EXIT at 21 March 00:30 IST (19:00Z) arrives, the
-- revenue moves to the exit date and 20 March keeps only the entry. The total never changes. A report produced for
-- 20 March before the exit synced would therefore differ from the views afterwards (documented in cld-05-kpi-views.md).
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-0000-0000-00000000aa06', '00000000-0000-0000-0000-00000000aa00', 'F6 late exit', 'Asia/Kolkata', 10);
insert into public.devices (id, facility_id, name) values
  ('00000000-0000-0000-0000-00000000dd06', '00000000-0000-0000-0000-00000000aa06', 'D6');
insert into public.staff (id, facility_id, name, pin_hash, pin_salt) values
  ('00000000-0000-0000-0000-00000000cc06', '00000000-0000-0000-0000-00000000aa06', 'S6', 'h', 's');
select pg_temp.entry(6, pg_temp.sid(601), '2026-03-20 16:30:00+00');
select pg_temp.pay(6, pg_temp.sid(601), '2026-03-20 16:40:00+00', 'CASH', '1500');
select results_eq(
  $$select local_date, vehicles, cash_paise, declared_total_paise from public.v_daily_kpis
    where facility_id = '00000000-0000-0000-0000-00000000aa06' order by local_date$$,
  $$values ('2026-03-20'::date, 1, 1500::bigint, 1500::bigint)$$,
  'before its exit syncs, a session''s payment is dated by the payment (20 March)');
select pg_temp.ev(6, 'EXIT', pg_temp.sid(601), '2026-03-20 19:00:00+00', '{"fare_paise":1500,"exit_method":"SCAN"}');
select results_eq(
  $$select local_date, vehicles, cash_paise, declared_total_paise from public.v_daily_kpis
    where facility_id = '00000000-0000-0000-0000-00000000aa06' order by local_date$$,
  $$values ('2026-03-20'::date, 1, 0::bigint, 0::bigint), ('2026-03-21'::date, 0, 1500::bigint, 1500::bigint)$$,
  'once the exit syncs, the same payment moves to the exit date (21 March); 20 March keeps the entry');
select is((select sum(declared_total_paise)::bigint from public.v_daily_kpis
  where facility_id = '00000000-0000-0000-0000-00000000aa06'), 1500::bigint,
  'moving the payment to the exit date never changes the facility''s total');

-- ---- Invariants over every row ----
select is((select count(*) from public.v_daily_kpis where avg_stay_minutes is not null and avg_stay_minutes < 0), 0::bigint,
  'no negative average stay is ever reported');
select is((select count(*) from public.v_daily_kpis where cash_paise < 0 or upi_paise < 0 or pass_paise < 0 or declared_total_paise < 0),
  0::bigint, 'no negative money is ever reported');
select is((select count(*) from public.v_daily_kpis where cash_paise is null or upi_paise is null or pass_paise is null
  or declared_total_paise is null), 0::bigint, 'revenue columns are never null');

select * from finish();
rollback;
