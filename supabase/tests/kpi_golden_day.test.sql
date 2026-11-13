-- pgTAP test T-CLD-05-U1 (migration 0009_views_kpis.sql): daily KPIs on the golden day equal a hand-computed row.
-- Run with `pnpm test:db`. One transaction, rolled back.
--
-- Spec (docs/team/member-04-akanksha.md, CLD-05 seed fixture): a golden day with 100 entries, 90 exits, 10 overrides,
-- 5 pass entries, known cash and UPI totals, one orphan exit, one duplicate exit, one midnight-spanning session.
-- Interpretation (assumption OQ-57 in docs/team/open-questions-and-assumptions.md, not an external decision):
--   "90 exits" = 90 distinct first-EXIT outcomes on the golden date, the orphan EXIT included; the duplicate EXIT of a
--   session that already exited is not one of them. The midnight-spanning session's EXIT belongs to the next local date.
--
-- Every expected value below is a literal computed BY HAND from this fixture, never read from a view.
--
-- FIXTURE. Facility G, Asia/Kolkata (UTC+05:30). Golden local date 2026-03-20; next local date 2026-03-21.
-- All times are local (+05:30). Ids are fixed; nothing is random.
--   Sessions k = 1..89   ENTRY 08:00 + k min (08:01 .. 09:29), EXIT exactly 60 min later (09:01 .. 10:29), same day.
--                        k = 1..5 enter with a pass (pass_id) and make no payment.
--                        k = 6..55  pay CASH 5000 at their exit (50 payments).
--                        k = 56..89 pay UPI 4000 at their exit (34 payments).
--   Session  k = 90      midnight-spanning: ENTRY 23:50 on the 20th, EXIT 00:20 on the 21st (30 min),
--                        pays CASH 3000 at 23:51 on the 20th (revenue follows the exit date: the 21st).
--   Sessions k = 91..100 ENTRY 12:31 .. 12:40, never exit (open).
--   Orphan  k = 900      EXIT 15:00 with no ENTRY.
--   Duplicate            a second EXIT of session k = 1 at 09:06 (its first EXIT is 09:01).
--   Overrides            10 OVERRIDE events 16:00 .. 16:09, on sessions k = 1..10.
-- Raw event counts: ENTRY 100; EXIT 92 (89 + 1 midnight + 1 orphan + 1 duplicate), of which 91 on the 20th
-- (89 + orphan + duplicate) and 1 on the 21st; PAYMENT 85 (50 + 34 + 1); OVERRIDE 10.
begin;
select plan(5);

insert into public.organizations (id, name) values ('00000000-0000-0000-0000-0000000d0000', 'Golden org');
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000d0000', 'G golden day', 'Asia/Kolkata', 150);
insert into public.devices (id, facility_id, name) values
  ('00000000-0000-0000-0000-0000000d0002', '00000000-0000-0000-0000-0000000d0001', 'GD');
insert into public.staff (id, facility_id, name, pin_hash, pin_salt) values
  ('00000000-0000-0000-0000-0000000d0003', '00000000-0000-0000-0000-0000000d0001', 'GS', 'h', 's');

-- id helpers: session k, and event k of a kind (e001 ENTRY, e002 EXIT, e003 duplicate EXIT, e004 PAYMENT, e005 OVERRIDE)
create function pg_temp.gsid(k int) returns uuid language sql immutable as
  $$ select ('00000000-0000-0000-0001-' || lpad(k::text, 12, '0'))::uuid $$;
create function pg_temp.geid(kind text, k int) returns uuid language sql immutable as
  $$ select ('00000000-0000-0000-' || kind || '-' || lpad(k::text, 12, '0'))::uuid $$;
create function pg_temp.gev(eid uuid, t text, k int, ts timestamptz, p jsonb) returns void language sql as $$
  insert into public.events (id, facility_id, device_id, staff_id, type, session_id, payload, device_time, source, schema_version)
  values (eid, '00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000d0002',
          '00000000-0000-0000-0000-0000000d0003', t, pg_temp.gsid(k), p, ts, 'PAPER_BACKFILL', 1);
$$;
create function pg_temp.gentry_payload(k int, with_pass boolean) returns jsonb language sql immutable as $$
  select jsonb_build_object('zone_id', '00000000-0000-0000-0000-0000000d0010', 'vehicle_class', 'car', 'short_code', 'G' || k)
         || case when with_pass then jsonb_build_object('pass_id', ('00000000-0000-0000-0002-' || lpad(k::text, 12, '0'))::uuid)
                 else '{}'::jsonb end;
$$;

-- sessions 1..89: entry 08:00 + k min, exit 60 min later; pass on 1..5; CASH 5000 on 6..55; UPI 4000 on 56..89
select pg_temp.gev(pg_temp.geid('e001', k), 'ENTRY', k, timestamptz '2026-03-20 08:00:00+05:30' + make_interval(mins => k),
                   pg_temp.gentry_payload(k, k <= 5))
from generate_series(1, 89) k;
select pg_temp.gev(pg_temp.geid('e002', k), 'EXIT', k, timestamptz '2026-03-20 09:00:00+05:30' + make_interval(mins => k), '{}')
from generate_series(1, 89) k;
select pg_temp.gev(pg_temp.geid('e004', k), 'PAYMENT', k, timestamptz '2026-03-20 09:00:00+05:30' + make_interval(mins => k),
                   jsonb_build_object('mode', case when k <= 55 then 'CASH' else 'UPI' end,
                                      'amount_paise', case when k <= 55 then 5000 else 4000 end,
                                      'upi_attested', k > 55))
from generate_series(6, 89) k;

-- session 90: spans local midnight
select pg_temp.gev(pg_temp.geid('e001', 90), 'ENTRY', 90, '2026-03-20 23:50:00+05:30', pg_temp.gentry_payload(90, false));
select pg_temp.gev(pg_temp.geid('e004', 90), 'PAYMENT', 90, '2026-03-20 23:51:00+05:30',
                   '{"mode": "CASH", "amount_paise": 3000, "upi_attested": false}');
select pg_temp.gev(pg_temp.geid('e002', 90), 'EXIT', 90, '2026-03-21 00:20:00+05:30', '{}');

-- sessions 91..100: open (no exit)
select pg_temp.gev(pg_temp.geid('e001', k), 'ENTRY', k, timestamptz '2026-03-20 12:00:00+05:30' + make_interval(mins => k - 60),
                   pg_temp.gentry_payload(k, false))
from generate_series(91, 100) k;

-- orphan EXIT (session 900 has no ENTRY) and a duplicate EXIT of session 1
select pg_temp.gev(pg_temp.geid('e002', 900), 'EXIT', 900, '2026-03-20 15:00:00+05:30', '{}');
select pg_temp.gev(pg_temp.geid('e003', 1), 'EXIT', 1, '2026-03-20 09:06:00+05:30', '{}');

-- 10 overrides on sessions 1..10
select pg_temp.gev(pg_temp.geid('e005', k), 'OVERRIDE', k, timestamptz '2026-03-20 16:00:00+05:30' + make_interval(mins => k - 1),
                   jsonb_build_object('target_event_id', pg_temp.geid('e001', k), 'reason_code', 'OTHER', 'note', 'golden'))
from generate_series(1, 10) k;

-- 1. The fixture is the one the spec asks for (raw events, not the views). Local dates in Asia/Kolkata.
--    entries 100 = 89 + 1 + 10; pass entries 5 (k = 1..5); overrides 10;
--    raw EXIT events on the 20th 91 = 89 paired + 1 orphan + 1 duplicate (raw events, NOT distinct exits);
--    raw EXIT events on the 21st 1 (the midnight session); payments 85 = 50 + 34 + 1.
select results_eq(
  $$select count(*) filter (where type = 'ENTRY'),
           count(*) filter (where type = 'ENTRY' and payload ? 'pass_id'),
           count(*) filter (where type = 'OVERRIDE'),
           count(*) filter (where type = 'EXIT' and (device_time at time zone 'Asia/Kolkata')::date = '2026-03-20'),
           count(*) filter (where type = 'EXIT' and (device_time at time zone 'Asia/Kolkata')::date = '2026-03-21'),
           count(*) filter (where type = 'PAYMENT')
    from public.events where facility_id = '00000000-0000-0000-0000-0000000d0001'$$,
  $$values (100::bigint, 5::bigint, 10::bigint, 91::bigint, 1::bigint, 85::bigint)$$,
  'golden fixture: 100 entries, 5 pass entries, 10 overrides, 91 raw EXIT events on the golden date (incl. the duplicate), 1 on the next date, 85 payments');

-- 2. T-CLD-05-U1: the complete golden-date row of v_daily_kpis.
--    vehicles             100     = sessions whose first ENTRY is on the 20th: 89 + 1 (midnight, enters 23:50) + 10 open
--    cash_paise           250000  = 50 payments (k = 6..55) x 5000; the midnight session's 3000 is dated by its exit (21st)
--    upi_paise            136000  = 34 payments (k = 56..89) x 4000
--    pass_paise           0       = no PASS payment
--    declared_total_paise 386000  = 250000 + 136000 + 0
--    pass_count           5       = k = 1..5
--    avg_stay_minutes     60.00   = 89 stays of exactly 60 min / 89; the orphan has no stay, the 10 open sessions have none,
--                                   the duplicate EXIT is ignored (first EXIT 09:01 wins), the midnight stay is on the 21st
--    overrides            10
--    overrides_per_100    10.00   = 10 x 100 / 100
--    orphan_exits         1       = session 900
select results_eq(
  $$select facility_id, local_date, vehicles, cash_paise, upi_paise, pass_paise, declared_total_paise, pass_count,
           avg_stay_minutes, overrides, overrides_per_100, orphan_exits
    from public.v_daily_kpis
    where facility_id = '00000000-0000-0000-0000-0000000d0001' and local_date = '2026-03-20'$$,
  $$values ('00000000-0000-0000-0000-0000000d0001'::uuid, '2026-03-20'::date, 100, 250000::bigint, 136000::bigint, 0::bigint,
            386000::bigint, 5, 60.00::numeric, 10, 10.00::numeric, 1)$$,
  'U1: golden-day v_daily_kpis row equals the hand-computed row (100 vehicles, cash 250000, UPI 136000, total 386000, 5 pass, mean stay 60.00, 10 overrides = 10.00 per 100, 1 orphan)');

-- 3. 90 distinct first-EXIT outcomes on the golden date. v_daily_kpis has no exits column; v_hourly.exits counts the first
--    EXIT of each session (0009: min(device_time) per session), orphans included.
--    exits   90  = 89 first exits (09:01 .. 10:29) + 1 orphan (15:00); the duplicate (09:06) is not a first exit and the
--                  midnight session's exit is on the 21st
--    entries 100 = as in assertion 2
select results_eq(
  $$select sum(entries)::integer, sum(exits)::integer from public.v_hourly
    where facility_id = '00000000-0000-0000-0000-0000000d0001' and local_date = '2026-03-20'$$,
  $$values (100, 90)$$,
  'golden date: 90 distinct first exits (89 paired + 1 orphan; duplicate excluded) and 100 entries in v_hourly');

-- 4. Next local date: only the midnight-spanning session's exit, stay and revenue.
--    vehicles 0 (it entered on the 20th); cash 3000 (paid 23:51 on the 20th, dated by its exit); total 3000;
--    avg_stay_minutes 30.00 = 23:50 -> 00:20; overrides 0; overrides_per_100 null (vehicles 0); orphan_exits 0
select results_eq(
  $$select facility_id, local_date, vehicles, cash_paise, upi_paise, pass_paise, declared_total_paise, pass_count,
           avg_stay_minutes, overrides, overrides_per_100, orphan_exits
    from public.v_daily_kpis
    where facility_id = '00000000-0000-0000-0000-0000000d0001' and local_date = '2026-03-21'$$,
  $$values ('00000000-0000-0000-0000-0000000d0001'::uuid, '2026-03-21'::date, 0, 3000::bigint, 0::bigint, 0::bigint,
            3000::bigint, 0, 30.00::numeric, 0, null::numeric, 0)$$,
  'next date: the midnight-spanning session''s exit, 30-minute stay and 3000 cash land on 2026-03-21; no entries, per-100 null');

-- 5. No other day: the facility has exactly these two daily rows.
select results_eq(
  $$select local_date from public.v_daily_kpis where facility_id = '00000000-0000-0000-0000-0000000d0001' order by local_date$$,
  $$values ('2026-03-20'::date), ('2026-03-21'::date)$$,
  'the golden facility has exactly two daily rows: 2026-03-20 and 2026-03-21');

select * from finish();
rollback;
