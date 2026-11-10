-- pgTAP test T-CLD-05-I2 (migration 0009_views_kpis.sql): independent oracle comparison over 30 days of seed data.
-- Run with `pnpm test:db`. Everything below happens in one transaction that is rolled back.
--
-- WHAT IT DOES
--   1. Builds a deterministic fixture (generate_series and modular arithmetic, md5-derived ids; no random values) for
--      three facilities in three time zones over the 30 local dates 2026-10-15 .. 2026-11-13, plus three single edge days.
--   2. Computes the expected v_daily_kpis and v_hourly rows with an ORACLE written in PL/pgSQL (pg_temp.run_oracle).
--   3. Compares EVERY row of both views (unfiltered) with the oracle: row counts, rows only in the view, rows only in the
--      oracle, an ordered row-by-row results_eq including NULLs, and grand totals.
--
-- ORACLE INDEPENDENCE
--   The oracle never reads v_daily_kpis or v_hourly (asserted below on its source text). It does not reuse the view's
--   structure: instead of one grouped scan per session and a UNION ALL of facts, it loops facility by facility and session
--   by session, looks up the first ENTRY and first EXIT with ORDER BY ... LIMIT 1, walks the session's payments one by one,
--   and increments per-day and per-hour counters in temporary tables. Local dates and hours are derived by switching the
--   session TimeZone setting to the facility's zone and casting (timestamptz::date, extract(hour ...)), not with
--   AT TIME ZONE. The amount check is a separate function that casts through the JSON text. The average stay is computed
--   from summed seconds, not as an average of per-session minutes.
--   The rules it encodes are the ones documented in docs/integrations/cld-05-kpi-views.md section 3 and the 0009 header:
--   first ENTRY / first EXIT win (device_time, then event id); orphan EXIT counted on its date and in hourly exits;
--   negative stays excluded from the mean; revenue only for modes CASH, UPI, PASS with a whole JSON number 0 .. bigint max,
--   dated by the session's first EXIT or, without an EXIT, by the payment itself; overrides dated by the OVERRIDE event;
--   overrides_per_100 null when vehicles is 0; avg_stay_minutes null when the day has no valid stay; a day exists only
--   when it has a first entry, a first exit, a payment of a session without exit, or an override.
--
-- FIXTURE (per facility F1 Asia/Kolkata +05:30, F2 Asia/Kathmandu +05:45, F3 America/New_York, DST ends 1 Nov 2026)
--   Per local day d = 0..29, 8 to 14 generated sessions k with entry minute (k*97 + d*31 + f*17) mod 1440 (all 24 hours):
--     k mod 9 = 4  open session (ENTRY, no EXIT) with a CASH payment 10 min after entry (dated by the payment)
--     k mod 10 = 7 negative stay (EXIT before ENTRY)            k mod 12 = 6 zero-length stay (EXIT = ENTRY)
--     otherwise    stay of 5 .. 244 min (crosses local midnight for late entries)
--     k mod 5 = 2  pass entry                                   k mod 8 = 1  duplicate EXIT (later, or earlier when d mod 4 = 0)
--     k mod 15 = 8 duplicate ENTRY 2 min later, opposite pass flag
--     k mod 15 = 9 duplicate ENTRY at the same instant, opposite pass flag (tie broken by event id)
--     k mod 4 = 3  OVERRIDE one minute after entry               k mod 6 = 0  second payment, UPI attested
--   one payment per closed session: modes CASH, UPI, PASS, WAIVED, CARD, lower-case cash, or no mode; amounts valid,
--   5000.0, or malformed ("5000", 12.5, -300, null, 1e30, true, missing key).
--   Per facility and day: one explicit midnight-spanning session (entry 23:40+ local, 35 min stay, paid before midnight),
--   one orphan EXIT (paid 20 min before the exit on even days), and on d mod 5 = 1 a payment-only session.
--   Edge days: F1 2026-11-18 (one negative stay only: avg null), F2 2026-11-20 (payment-only session plus an override:
--   vehicles 0, avg and per-100 null), F3 2026-10-10 (one open entry: per-100 0.00, avg null).
--
-- ROUNDING BOUNDARY (keep it): F2 on 2026-10-22 has 10 valid stays totalling 62913 s, an exact mean of 104.855 min, which
-- the documented rule (mean rounded to 2 places) makes 104.86. This file found that 0009 once divided each stay by 60 before
-- averaging and reported 104.85; 0009 now averages seconds and divides once. The fixture is deliberately left on this
-- boundary so a return of per-row division fails here. See docs/integrations/cld-05-kpi-views.md section 8.
--
-- NOT PROVEN HERE: performance or p95 (T-CLD-05-X1), RLS (I1, kpi_views.test.sql), the bigint saturation path (amounts
-- stay far below it; kpi_views.test.sql covers it), conflict resolutions (not applied by 0009, see the doc section 4).
begin;
select plan(25);

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------------------------------------
create function pg_temp.u(t text) returns uuid language sql immutable as $$ select md5(t)::uuid $$;

create temp table fx_fac (n int primary key, id uuid not null, tz text not null);
insert into fx_fac values
  (1, '00000000-0000-0000-0000-0000000c0001', 'Asia/Kolkata'),
  (2, '00000000-0000-0000-0000-0000000c0002', 'Asia/Kathmandu'),
  (3, '00000000-0000-0000-0000-0000000c0003', 'America/New_York');

insert into public.organizations (id, name) values ('00000000-0000-0000-0000-0000000c0000', 'Oracle org');
insert into public.facilities (id, org_id, name, timezone, slot_count)
  select id, '00000000-0000-0000-0000-0000000c0000', 'Oracle F' || n, tz, 50 from fx_fac;
insert into public.devices (id, facility_id, name) select pg_temp.u('device:' || n), id, 'OD' || n from fx_fac;
insert into public.staff (id, facility_id, name, pin_hash, pin_salt)
  select pg_temp.u('staff:' || n), id, 'OS' || n, 'h', 's' from fx_fac;

-- Generated sessions. t_entry is a local wall-clock time converted to timestamptz in the facility's zone.
create temp table fx_sess as
select f.n as fac, f.id as facility_id, d, k,
       pg_temp.u('s:' || f.n || ':' || d || ':' || k) as sid,
       ((date '2026-10-15' + d) + make_interval(mins => (k * 97 + d * 31 + f.n * 17) % 1440, secs => (k * 13 + d) % 60))
         at time zone f.tz as t_entry,
       make_interval(mins => 5 + (k * 37 + d * 11 + f.n * 7) % 240, secs => (k * 7) % 60) as stay,
       case when k % 9 = 4 then 'open' when k % 10 = 7 then 'negative' when k % 12 = 6 then 'zero' else 'normal' end as kind
from fx_fac f
cross join generate_series(0, 29) d
cross join lateral generate_series(0, 7 + (d * 5 + f.n * 3) % 7) k;
-- one explicit local-midnight crosser per facility and day (k = 100)
insert into fx_sess
select f.n, f.id, d, 100, pg_temp.u('s:' || f.n || ':' || d || ':100'),
       ((date '2026-10-15' + d) + make_interval(hours => 23, mins => 40 + d % 15)) at time zone f.tz,
       interval '35 minutes', 'normal'
from fx_fac f cross join generate_series(0, 29) d;
alter table fx_sess add column t_exit timestamptz;
update fx_sess set t_exit = case kind when 'normal' then t_entry + stay when 'negative' then t_entry - stay
                                      when 'zero' then t_entry end;

create temp table fx_ev (id uuid primary key, fac int not null, type text not null, sid uuid not null,
                         ts timestamptz not null, payload jsonb not null);

-- ENTRY (first), with a pass on k mod 5 = 2
insert into fx_ev
select pg_temp.u('e:' || sid), fac, 'ENTRY', sid, t_entry,
       jsonb_build_object('zone_id', pg_temp.u('zone:' || fac), 'vehicle_class', 'car', 'short_code', 'K' || k)
       || case when k % 5 = 2 then jsonb_build_object('pass_id', pg_temp.u('pass:' || sid)) else '{}' end
from fx_sess;
-- duplicate ENTRY 2 minutes later (k mod 15 = 8) or at the same instant (k mod 15 = 9), with the opposite pass flag
insert into fx_ev
select pg_temp.u('e2:' || sid), fac, 'ENTRY', sid,
       case when k % 15 = 8 then t_entry + interval '2 minutes' else t_entry end,
       jsonb_build_object('zone_id', pg_temp.u('zone:' || fac), 'vehicle_class', 'car', 'short_code', 'K' || k)
       || case when k % 5 = 2 then '{}' else jsonb_build_object('pass_id', pg_temp.u('pass2:' || sid)) end
from fx_sess where k % 15 in (8, 9);
-- EXIT and duplicate EXIT
insert into fx_ev select pg_temp.u('x:' || sid), fac, 'EXIT', sid, t_exit, '{}' from fx_sess where t_exit is not null;
insert into fx_ev
select pg_temp.u('x2:' || sid), fac, 'EXIT', sid,
       case when d % 4 = 0 then t_exit - interval '5 minutes' else t_exit + make_interval(mins => 10 + d * 3) end, '{}'
from fx_sess where t_exit is not null and k % 8 = 1;
-- one payment per closed session: mode and amount vary deterministically
insert into fx_ev
select pg_temp.u('p:' || sid), fac, 'PAYMENT', sid,
       case when k = 100 then t_entry + interval '1 minute' else t_exit - interval '30 seconds' end,
       case when (k * 3 + d) % 17 = 0 then '{}'::jsonb
            else jsonb_build_object('mode', (array['CASH', 'UPI', 'PASS', 'CASH', 'UPI', 'WAIVED', 'CARD', 'cash'])[1 + (k + d + fac) % 8]) end
       || jsonb_build_object('upi_attested', k % 2 = 0)
       || case (k + 2 * d + fac) % 13
            when 0 then '{"amount_paise": "5000"}'::jsonb
            when 1 then '{"amount_paise": 12.5}'
            when 2 then '{"amount_paise": -300}'
            when 3 then '{"amount_paise": null}'
            when 4 then '{"amount_paise": 1e30}'
            when 5 then '{}'
            when 6 then '{"amount_paise": 5000.0}'
            when 7 then '{"amount_paise": true}'
            else jsonb_build_object('amount_paise', 1000 + ((k * 131 + d * 17 + fac * 5) % 50) * 100) end
from fx_sess where t_exit is not null;
-- second payment, UPI attested (k mod 6 = 0)
insert into fx_ev
select pg_temp.u('p2:' || sid), fac, 'PAYMENT', sid, t_exit,
       jsonb_build_object('mode', 'UPI', 'amount_paise', 250 + d, 'upi_attested', true)
from fx_sess where t_exit is not null and k % 6 = 0;
-- payment of an open session (no EXIT): dated by the payment itself
insert into fx_ev
select pg_temp.u('po:' || sid), fac, 'PAYMENT', sid, t_entry + interval '10 minutes',
       jsonb_build_object('mode', 'CASH', 'amount_paise', 2000 + k * 10, 'upi_attested', false)
from fx_sess where kind = 'open';
-- OVERRIDE (k mod 4 = 3)
insert into fx_ev
select pg_temp.u('ov:' || sid), fac, 'OVERRIDE', sid, t_entry + interval '1 minute',
       jsonb_build_object('target_event_id', pg_temp.u('e:' || sid), 'reason_code', 'OTHER', 'note', 'oracle')
from fx_sess where k % 4 = 3;
-- orphan EXIT per facility and day; even days also carry a CASH payment 20 minutes before the exit
insert into fx_ev
select pg_temp.u('ox:' || f.n || ':' || d), f.n, 'EXIT', pg_temp.u('orphan:' || f.n || ':' || d),
       ((date '2026-10-15' + d) + make_interval(mins => (d * 41 + f.n * 13) % 1440)) at time zone f.tz, '{}'
from fx_fac f cross join generate_series(0, 29) d;
insert into fx_ev
select pg_temp.u('op:' || f.n || ':' || d), f.n, 'PAYMENT', pg_temp.u('orphan:' || f.n || ':' || d),
       ((date '2026-10-15' + d) + make_interval(mins => (d * 41 + f.n * 13) % 1440)) at time zone f.tz - interval '20 minutes',
       jsonb_build_object('mode', 'CASH', 'amount_paise', 700 + d, 'upi_attested', false)
from fx_fac f cross join generate_series(0, 29) d where d % 2 = 0;
-- payment-only sessions (no ENTRY, no EXIT) on d mod 5 = 1: one valid payment and one WAIVED
insert into fx_ev
select pg_temp.u('pp:' || f.n || ':' || d || ':' || i), f.n, 'PAYMENT', pg_temp.u('ponly:' || f.n || ':' || d),
       ((date '2026-10-15' + d) + make_interval(mins => 600 + f.n * 7 + i)) at time zone f.tz,
       jsonb_build_object('mode', case when i = 1 then 'WAIVED' else (array['CASH', 'UPI', 'PASS'])[1 + d % 3] end,
                          'amount_paise', 1500, 'upi_attested', false)
from fx_fac f cross join generate_series(0, 29) d cross join generate_series(0, 1) i where d % 5 = 1;
-- edge days
insert into fx_ev values
  -- F1 2026-11-18 10:00 local: one negative stay only
  (pg_temp.u('edge:1:e'), 1, 'ENTRY', pg_temp.u('edge:1'), '2026-11-18 10:00:00+05:30',
   jsonb_build_object('zone_id', pg_temp.u('zone:1'), 'vehicle_class', 'car', 'short_code', 'EDGE1')),
  (pg_temp.u('edge:1:x'), 1, 'EXIT', pg_temp.u('edge:1'), '2026-11-18 09:00:00+05:30', '{}'),
  -- F2 2026-11-20 12:00 local: payment-only session plus an override on it
  (pg_temp.u('edge:2:p'), 2, 'PAYMENT', pg_temp.u('edge:2'), '2026-11-20 12:00:00+05:45',
   '{"mode": "CASH", "amount_paise": 999, "upi_attested": false}'),
  (pg_temp.u('edge:2:o'), 2, 'OVERRIDE', pg_temp.u('edge:2'), '2026-11-20 12:05:00+05:45',
   '{"target_event_id": "00000000-0000-0000-0000-000000000099", "reason_code": "OTHER", "note": "oracle"}'),
  -- F3 2026-10-10 08:00 local (EDT): one open entry
  (pg_temp.u('edge:3:e'), 3, 'ENTRY', pg_temp.u('edge:3'), '2026-10-10 08:00:00-04:00',
   jsonb_build_object('zone_id', pg_temp.u('zone:3'), 'vehicle_class', 'car', 'short_code', 'EDGE3'));

insert into public.events (id, facility_id, device_id, staff_id, type, session_id, payload, device_time, source, schema_version)
select e.id, f.id, pg_temp.u('device:' || f.n), pg_temp.u('staff:' || f.n), e.type, e.sid, e.payload, e.ts, 'PAPER_BACKFILL', 1
from fx_ev e join fx_fac f on f.n = e.fac
order by e.ts, e.id;

-- ---------------------------------------------------------------------------------------------------------------------
-- Oracle (see the header). Reads public.events and public.facilities only.
-- ---------------------------------------------------------------------------------------------------------------------
create temp table oracle_day (
  facility_id uuid, local_date date,
  vehicles int not null default 0, pass_count int not null default 0,
  cash numeric not null default 0, upi numeric not null default 0, pass numeric not null default 0,
  stay_seconds numeric not null default 0, stay_count int not null default 0,
  overrides int not null default 0, orphan_exits int not null default 0,
  primary key (facility_id, local_date));
create temp table oracle_hour (
  facility_id uuid, local_date date, hour int,
  entries int not null default 0, exits int not null default 0,
  primary key (facility_id, local_date, hour));

-- A valid amount is a JSON number that is whole and within 0 .. bigint maximum; anything else is worth 0.
create function pg_temp.oracle_amount(p jsonb) returns numeric language plpgsql immutable as $$
declare
  raw jsonb;
  n numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' then return 0; end if;
  raw := p -> 'amount_paise';
  if raw is null or jsonb_typeof(raw) <> 'number' then return 0; end if;
  n := (raw #>> '{}')::numeric;
  if n < 0 or n <> floor(n) or n > 9223372036854775807 then return 0; end if;
  return n;
end $$;

create function pg_temp.oracle_touch_day(fid uuid, day date) returns void language sql as $$
  insert into oracle_day (facility_id, local_date) values (fid, day) on conflict do nothing;
$$;

create function pg_temp.oracle_add_hour(fid uuid, ts timestamptz, add_entries int, add_exits int)
returns void language sql as $$
  insert into oracle_hour (facility_id, local_date, hour, entries, exits)
  values (fid, ts::date, extract(hour from ts)::int, add_entries, add_exits)
  on conflict (facility_id, local_date, hour)
  do update set entries = oracle_hour.entries + excluded.entries, exits = oracle_hour.exits + excluded.exits;
$$;

create function pg_temp.run_oracle() returns void language plpgsql as $$
declare
  saved_tz text := current_setting('TimeZone');
  fac record;
  sess record;
  pay record;
  ovr record;
  entry_ts timestamptz;
  entry_pass boolean;
  exit_ts timestamptz;
  pay_day date;
  amt numeric;
  pay_mode text;
begin
  for fac in select id, timezone from public.facilities order by id loop
    -- local calendar of this facility: casts of timestamptz below use it
    perform set_config('TimeZone', fac.timezone, true);

    for sess in
      select distinct session_id from public.events
      where facility_id = fac.id and type in ('ENTRY', 'EXIT', 'PAYMENT') order by session_id
    loop
      entry_ts := null; entry_pass := null; exit_ts := null;

      select ev.device_time, coalesce(jsonb_typeof(ev.payload -> 'pass_id'), 'null') <> 'null'
        into entry_ts, entry_pass
        from public.events ev
       where ev.facility_id = fac.id and ev.session_id = sess.session_id and ev.type = 'ENTRY'
       order by ev.device_time, ev.id limit 1;

      select ev.device_time into exit_ts
        from public.events ev
       where ev.facility_id = fac.id and ev.session_id = sess.session_id and ev.type = 'EXIT'
       order by ev.device_time, ev.id limit 1;

      if entry_ts is not null then
        perform pg_temp.oracle_touch_day(fac.id, entry_ts::date);
        update oracle_day set vehicles = vehicles + 1, pass_count = pass_count + case when entry_pass then 1 else 0 end
         where facility_id = fac.id and local_date = entry_ts::date;
        perform pg_temp.oracle_add_hour(fac.id, entry_ts, 1, 0);
      end if;

      if exit_ts is not null then
        perform pg_temp.oracle_touch_day(fac.id, exit_ts::date);
        perform pg_temp.oracle_add_hour(fac.id, exit_ts, 0, 1);
        if entry_ts is null then
          update oracle_day set orphan_exits = orphan_exits + 1
           where facility_id = fac.id and local_date = exit_ts::date;
        elsif exit_ts >= entry_ts then
          update oracle_day set stay_seconds = stay_seconds + extract(epoch from exit_ts - entry_ts), stay_count = stay_count + 1
           where facility_id = fac.id and local_date = exit_ts::date;
        end if;
      end if;

      for pay in
        select ev.device_time, ev.payload from public.events ev
        where ev.facility_id = fac.id and ev.session_id = sess.session_id and ev.type = 'PAYMENT'
      loop
        pay_day := coalesce(exit_ts, pay.device_time)::date;
        perform pg_temp.oracle_touch_day(fac.id, pay_day);
        amt := pg_temp.oracle_amount(pay.payload);
        pay_mode := case when jsonb_typeof(pay.payload) = 'object' then pay.payload ->> 'mode' end;
        if pay_mode = 'CASH' then
          update oracle_day set cash = cash + amt where facility_id = fac.id and local_date = pay_day;
        elsif pay_mode = 'UPI' then
          update oracle_day set upi = upi + amt where facility_id = fac.id and local_date = pay_day;
        elsif pay_mode = 'PASS' then
          update oracle_day set pass = pass + amt where facility_id = fac.id and local_date = pay_day;
        end if;
      end loop;
    end loop;

    for ovr in select ev.device_time from public.events ev where ev.facility_id = fac.id and ev.type = 'OVERRIDE' loop
      perform pg_temp.oracle_touch_day(fac.id, ovr.device_time::date);
      update oracle_day set overrides = overrides + 1
       where facility_id = fac.id and local_date = ovr.device_time::date;
    end loop;
  end loop;

  perform set_config('TimeZone', saved_tz, true);
end $$;

-- the session TimeZone in force before the oracle runs (the oracle switches it per facility and must restore it)
create temp table oracle_tz_before as select current_setting('TimeZone') as tz;
select pg_temp.run_oracle();

-- Expected rows, typed exactly like the view columns.
create temp table expected_daily as
select facility_id, local_date, vehicles::integer as vehicles,
       least(cash, 9223372036854775807)::bigint as cash_paise,
       least(upi, 9223372036854775807)::bigint as upi_paise,
       least(pass, 9223372036854775807)::bigint as pass_paise,
       least(cash + upi + pass, 9223372036854775807)::bigint as declared_total_paise,
       pass_count::integer as pass_count,
       case when stay_count = 0 then null else round(stay_seconds / 60 / stay_count, 2) end::numeric as avg_stay_minutes,
       overrides::integer as overrides,
       case when vehicles = 0 then null else round(overrides::numeric * 100 / vehicles, 2) end::numeric as overrides_per_100,
       orphan_exits::integer as orphan_exits
from oracle_day;
create temp table expected_hourly as
select facility_id, local_date, hour::integer as hour, entries::integer as entries, exits::integer as exits from oracle_hour;

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture coverage (computed from the raw fixture events, not from the views)
-- ---------------------------------------------------------------------------------------------------------------------
-- numeric value of a fixture amount when it is a JSON number (CASE guards the cast), else null
create temp table fx_amt as
select id, case when jsonb_typeof(payload -> 'amount_paise') = 'number' then (payload ->> 'amount_paise')::numeric end as n
from fx_ev where type = 'PAYMENT';

create temp table fx_first as
select f.n, f.tz, s.sid,
       (select min(ts) from fx_ev e where e.sid = s.sid and e.type = 'ENTRY') as first_entry,
       (select min(ts) from fx_ev e where e.sid = s.sid and e.type = 'EXIT') as first_exit
from (select distinct fac, sid from fx_ev) s join fx_fac f on f.n = s.fac;

select is((select count(distinct tz) from fx_fac), 3::bigint,
  'fixture: three facilities in three different time zones (+05:30, +05:45, America/New_York with a DST change)');
select is((select count(*) from fx_fac f where (select count(distinct (first_entry at time zone f.tz)::date) from fx_first x
            where x.n = f.n and (first_entry at time zone f.tz)::date between '2026-10-15' and '2026-11-13') = 30), 3::bigint,
  'fixture: every facility has entries on each of the 30 local dates 2026-10-15 .. 2026-11-13');
select is((select count(*) from fx_fac f where (select count(distinct extract(hour from first_entry at time zone f.tz))
            from fx_first x where x.n = f.n) = 24), 3::bigint,
  'fixture: every facility has entries in all 24 local hours');
select is((select count(*) from fx_fac f where exists (select 1 from fx_first x where x.n = f.n
            and (first_exit at time zone f.tz)::date > (first_entry at time zone f.tz)::date)), 3::bigint,
  'fixture: every facility has sessions spanning local midnight');
select ok((select count(*) from (select sid from fx_ev where type = 'EXIT' group by sid having count(*) > 1) s) >= 20,
  'fixture: at least 20 sessions with a duplicate EXIT');
select ok((select count(*) from fx_first where first_entry is null and first_exit is not null) >= 90,
  'fixture: at least 90 orphan EXIT sessions');
select ok((select count(*) from fx_first where first_exit < first_entry) >= 20,
  'fixture: at least 20 negative-duration sessions');
select ok((select count(*) from (select sid from fx_ev where type = 'ENTRY' group by sid having count(*) > 1) s) >= 20
  and exists (select 1 from fx_ev a join fx_ev b on a.sid = b.sid and a.id < b.id and a.ts = b.ts
              where a.type = 'ENTRY' and b.type = 'ENTRY'
                and (a.payload ? 'pass_id') <> (b.payload ? 'pass_id')),
  'fixture: duplicate ENTRY events, including same-instant ties with different pass flags');
select is((select count(distinct case
              when not e.payload ? 'amount_paise' then 'missing key'
              when jsonb_typeof(e.payload -> 'amount_paise') <> 'number' then jsonb_typeof(e.payload -> 'amount_paise')
              when a.n < 0 then 'negative'
              when a.n <> trunc(a.n) then 'fraction'
              when a.n > 9223372036854775807 then 'too large' end)
            from fx_ev e join fx_amt a on a.id = e.id), 7::bigint,
  'fixture: malformed payment amounts of all seven kinds (missing key, JSON string, boolean, null, negative, fraction, 1e30)');
select ok(exists (select 1 from fx_ev where type = 'PAYMENT' and payload ->> 'mode' = 'WAIVED'),
  'fixture: WAIVED payments');
select ok(exists (select 1 from fx_ev where type = 'PAYMENT' and payload ->> 'mode' = 'CARD')
  and exists (select 1 from fx_ev where type = 'PAYMENT' and payload ->> 'mode' = 'cash')
  and exists (select 1 from fx_ev where type = 'PAYMENT' and not payload ? 'mode'),
  'fixture: unknown payment modes (CARD, lower-case cash, missing mode)');
select is((select count(distinct e.payload ->> 'mode') from fx_ev e join fx_amt a on a.id = e.id
            where e.payload ->> 'mode' in ('CASH', 'UPI', 'PASS') and a.n between 1 and 100000 and a.n = trunc(a.n)), 3::bigint,
  'fixture: valid CASH, UPI and PASS payments');
select ok((select count(*) from fx_ev where type = 'OVERRIDE') >= 50, 'fixture: at least 50 OVERRIDE events');
select ok(exists (select 1 from expected_daily where avg_stay_minutes is null)
  and exists (select 1 from expected_daily where overrides_per_100 is null)
  and exists (select 1 from expected_daily where avg_stay_minutes is not null and overrides_per_100 is not null)
  and exists (select 1 from expected_daily where vehicles > 0 and avg_stay_minutes is null),
  'fixture: the expected rows include null avg_stay_minutes, null overrides_per_100 and non-null values');
select ok(pg_get_functiondef('pg_temp.run_oracle()'::regprocedure) !~* 'v_daily_kpis|v_hourly'
  and pg_get_functiondef('pg_temp.oracle_amount(jsonb)'::regprocedure) !~* 'v_daily_kpis|v_hourly'
  and pg_get_functiondef('pg_temp.oracle_add_hour(uuid, timestamptz, integer, integer)'::regprocedure) !~* 'v_daily_kpis|v_hourly'
  and pg_get_functiondef('pg_temp.oracle_touch_day(uuid, date)'::regprocedure) !~* 'v_daily_kpis|v_hourly',
  'oracle independence: no oracle function references v_daily_kpis or v_hourly');
select is(current_setting('TimeZone'), (select tz from oracle_tz_before),
  'the oracle restored the original session TimeZone it switched per facility');

-- ---------------------------------------------------------------------------------------------------------------------
-- T-CLD-05-I2: the views against the oracle, every row of both views (no facility filter)
-- ---------------------------------------------------------------------------------------------------------------------
select is((select count(*) from public.v_daily_kpis), (select count(*) from expected_daily),
  'v_daily_kpis returns as many rows as the oracle expects');
select is((select count(*) from public.v_hourly), (select count(*) from expected_hourly),
  'v_hourly returns as many rows as the oracle expects');
select is_empty($$select * from public.v_daily_kpis except all select * from expected_daily$$,
  'v_daily_kpis has no row the oracle does not expect (unexpected rows or wrong values)');
select is_empty($$select * from expected_daily except all select * from public.v_daily_kpis$$,
  'v_daily_kpis is missing no row the oracle expects');
select is_empty($$select * from public.v_hourly except all select * from expected_hourly$$,
  'v_hourly has no row the oracle does not expect (unexpected rows or wrong values)');
select is_empty($$select * from expected_hourly except all select * from public.v_hourly$$,
  'v_hourly is missing no row the oracle expects');
select results_eq(
  $$select facility_id, local_date, vehicles, cash_paise, upi_paise, pass_paise, declared_total_paise, pass_count,
           avg_stay_minutes, overrides, overrides_per_100, orphan_exits
    from public.v_daily_kpis order by facility_id, local_date$$,
  $$select facility_id, local_date, vehicles, cash_paise, upi_paise, pass_paise, declared_total_paise, pass_count,
           avg_stay_minutes, overrides, overrides_per_100, orphan_exits
    from expected_daily order by facility_id, local_date$$,
  'v_daily_kpis equals the oracle row by row, every column, NULLs included');
select results_eq(
  $$select facility_id, local_date, hour, entries, exits from public.v_hourly order by facility_id, local_date, hour$$,
  $$select facility_id, local_date, hour, entries, exits from expected_hourly order by facility_id, local_date, hour$$,
  'v_hourly equals the oracle row by row');
select results_eq(
  $$select sum(vehicles), sum(cash_paise), sum(upi_paise), sum(pass_paise), sum(declared_total_paise), sum(pass_count),
           sum(overrides), sum(orphan_exits), (select sum(entries) from public.v_hourly), (select sum(exits) from public.v_hourly)
    from public.v_daily_kpis$$,
  $$select sum(vehicles), sum(cash_paise), sum(upi_paise), sum(pass_paise), sum(declared_total_paise), sum(pass_count),
           sum(overrides), sum(orphan_exits), (select sum(entries) from expected_hourly), (select sum(exits) from expected_hourly)
    from expected_daily$$,
  'grand totals over the whole period equal the oracle exactly');

select * from finish();
rollback;
