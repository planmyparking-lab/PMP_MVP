-- 0009 (CLD-05): v_hourly and v_daily_kpis. Read-only views over events; no table, no function, no data change.
--
-- NOT IN THIS FILE: v_zone_now. It needs the occupancy definition shared with Afzal's occupancy.ts (OQ-A7, unresolved),
-- and the sheet requires it to equal occupancy.ts on shared fixtures (T-CLD-05-U2). It is deferred, not forgotten.
--
-- DEPENDENCIES: 0001-0003 only (events, facilities). Who may READ the views is decided by the RLS policies on events and
-- facilities, which do not exist until 0010 (CLD-03): with the 0001-0009 chain alone every non-superuser role sees zero
-- rows (deny by default). Views are security_invoker, so the caller's RLS applies and nothing here widens access.
--
-- COLUMN CONTRACT (IC-07). Names follow docs/team/member-04-akanksha.md CLD-05 for the date and hour columns, and the
-- OQ-45 decision (Afzal, 8 Nov 2026, docs/integrations/ic-07-console-requirements.md) for revenue:
--   v_hourly(facility_id, local_date, hour, entries, exits)
--   v_daily_kpis(facility_id, local_date, vehicles, cash_paise, upi_paise, pass_paise, declared_total_paise, pass_count,
--                avg_stay_minutes, overrides, overrides_per_100, orphan_exits)
-- pass_count is a COUNT of entries made with a pass (not money); pass money is pass_paise. orphan_exits is the "orphans"
-- column the sheet asks for. Renaming or retyping a column needs Anamika's approval (IC-07).
--
-- REVENUE (OQ-45). Only PAYMENT events, never inferred from ENTRY or EXIT. cash_paise, upi_paise and pass_paise are the sums
-- of payments with mode CASH, UPI and PASS. WAIVED is excluded from every total. A payment with any other mode (unknown,
-- misspelt, lower case, missing) is NOT valid revenue and is excluded as well. upi_paise is every UPI payment, attested or
-- not: UPI is guard-declared, and the attested sub-total is deliberately not a column (OQ-45: no derived columns).
-- declared_total_paise = cash_paise + upi_paise + pass_paise (the same three sums, added before clamping).
-- An amount counts only if payload.amount_paise is a JSON number that is a whole number from 0 to the bigint maximum.
-- Anything else (string, boolean, null, fraction, negative, too large, missing, non-object payload) adds 0 and never raises
-- an error: ingest_events only checks that the key exists, and one malformed row must not break a facility's dashboard.
-- CASE guards the cast because PostgreSQL guarantees CASE evaluation order, not WHERE/AND order. Sums are numeric, so
-- nothing overflows while adding; each reported figure is clamped to the bigint maximum at the end (saturation: if a day's
-- true total exceeds 9.22e18 paise the total reads as the maximum and may be lower than the true sum; unreachable with
-- contract-valid data, whose amounts are safe JavaScript integers).
--
-- SESSIONS AND DATE CONVENTION. Sessions are paired by (facility_id, session_id). The first ENTRY and the first EXIT of a
-- session count (first by device_time, then event id: deterministic). Later ENTRY or EXIT events of the same session are
-- duplicates: ignored here and left to sync_conflicts for a person. An EXIT whose session has no ENTRY is an orphan: counted
-- in orphan_exits, left out of every stay figure. A session with an ENTRY and no EXIT is open: counted as a vehicle, no stay.
-- All dates and hours are local to facilities.timezone (an IANA name that must be valid), computed from device_time.
-- A session that spans midnight is split by event, not by session (sheet CLD-05 edge cases):
--   vehicles, pass_count and v_hourly.entries  -> the date and hour of the ENTRY;
--   exits, orphan_exits, avg_stay_minutes and v_hourly.exits -> the date and hour of the EXIT;
--   revenue -> the date of the session's EXIT; a payment whose session has no exit yet uses the payment's own local date;
--   overrides -> the date of the OVERRIDE event.
-- Consequence: a day can show exits without entries (the midnight-spanning case) and overrides_per_100 is null when
-- vehicles is 0. avg_stay_minutes is the mean of (exit - entry) in minutes per session, rounded to 2 decimals, null when
-- the day has no valid stay. A stay with an exit earlier than its entry (negative) is invalid and excluded from the mean.
-- Precision: the stays are averaged in seconds and the mean is divided by 60 once, then rounded. Dividing each stay by 60
-- first rounds every quotient at 16 decimals, and an exact half such as 104.855 then rounds down (found by
-- kpi_oracle.test.sql). When the exact mean in minutes lies on a rounding boundary, the mean in seconds has at most two
-- decimals and the division by 60 terminates, so numeric arithmetic is exact there and round() rounds half away from zero.
-- Orphan exits are still counted in v_hourly.exits: an exit physically happened.
--
-- EMPTY PERIODS. Revenue columns are never null: an active day with no valid payment reads 0. A facility, or a day, with no
-- events produces no row (the sheet allows "zero rows or zero values"); the Console shows zero for a missing day. Days between
-- two active days are not generated.
--
-- CONFLICT RESOLUTIONS ARE NOT APPLIED. First-wins is the only rule the repository fixes (sheet CLD-05: "count first exit
-- only, rest flagged"). KEEP_SECOND, MARK_AS_TEST_ENTRY, KEEP_FIRST/ADD_NOTE/ACKNOWLEDGE are not read by these views because
-- nothing authoritative says when a conflict is closed or which events they remove (OQ-49 open, no resolve_conflict(),
-- conflict_resolutions has no status). The exact blockers are listed in docs/integrations/cld-05-kpi-views.md.
--
-- PERFORMANCE. Written without multiply-referenced CTEs so a filter on facility_id is pushed into the event scans. See
-- docs/integrations/cld-05-kpi-views.md for measured timings and the limits of an unfiltered view.
-- v_hourly and v_daily_kpis repeat the session pairing on purpose: sharing it would need a third public view, which no
-- specification defines. A test asserts that v_hourly.entries equals v_daily_kpis.vehicles.

create view public.v_hourly with (security_invoker = true) as
select b.facility_id,
       l.lts::date as local_date,
       extract(hour from l.lts)::integer as hour,
       sum(v.entries)::integer as entries,
       sum(v.exits)::integer as exits
from (
  -- One row per session: its first ENTRY time and first EXIT time. Later events of the session are duplicates and drop out
  -- of min(). One grouped scan (no join) so a filter on facility_id reaches the events scan.
  select e.facility_id,
         min(e.device_time) filter (where e.type = 'ENTRY') as entry_time,
         min(e.device_time) filter (where e.type = 'EXIT') as exit_time
  from public.events e
  where e.type in ('ENTRY', 'EXIT')
  group by e.facility_id, e.session_id
) b
join public.facilities f on f.id = b.facility_id
cross join lateral (values (b.entry_time, 1, 0), (b.exit_time, 0, 1)) v(t, entries, exits)
cross join lateral (select v.t at time zone f.timezone as lts) l
where v.t is not null
group by b.facility_id, l.lts::date, extract(hour from l.lts)::integer;

create view public.v_daily_kpis with (security_invoker = true) as
select k.facility_id,
       k.local_date,
       sum(k.vehicles)::integer as vehicles,
       least(sum(k.cash), 9223372036854775807::numeric)::bigint as cash_paise,
       least(sum(k.upi), 9223372036854775807::numeric)::bigint as upi_paise,
       least(sum(k.pass), 9223372036854775807::numeric)::bigint as pass_paise,
       least(sum(k.cash) + sum(k.upi) + sum(k.pass), 9223372036854775807::numeric)::bigint as declared_total_paise,
       sum(k.pass_count)::integer as pass_count,
       -- average the stays in seconds, then convert to minutes once (see the header: no per-row division)
       round(avg(k.stay_seconds) / 60, 2) as avg_stay_minutes,
       sum(k.overrides)::integer as overrides,
       case when sum(k.vehicles) = 0 then null
            else round(sum(k.overrides) * 100.0 / sum(k.vehicles), 2) end as overrides_per_100,
       sum(k.orphan_exits)::integer as orphan_exits
from (
  -- Branch 1: one row per session (ENTRY, EXIT and PAYMENT events grouped by facility and session; one scan, no join, so a
  -- filter on facility_id reaches the events scan), split into an entry fact (entry date) and an exit fact (exit date).
  -- The payments of a session that has an EXIT are dated by that exit and ride on the exit fact.
  select s.facility_id,
         v.local_date,
         v.vehicles,
         v.pass_count,
         v.stay_seconds,
         v.orphan_exits,
         0 as overrides,
         v.cash,
         v.upi,
         v.pass
  from (
    select e.facility_id,
           e.session_id,
           bool_or(e.type = 'ENTRY') as has_entry,
           min(e.device_time) filter (where e.type = 'ENTRY') as entry_time,
           min(e.device_time) filter (where e.type = 'EXIT') as exit_time,
           -- pass flag of the FIRST entry (device_time, then id): deterministic when two entries share an instant
           (array_agg(e.with_pass order by e.device_time, e.id) filter (where e.type = 'ENTRY'))[1] as with_pass,
           coalesce(sum(e.amount) filter (where e.type = 'PAYMENT' and e.mode = 'CASH'), 0) as cash,
           coalesce(sum(e.amount) filter (where e.type = 'PAYMENT' and e.mode = 'UPI'), 0) as upi,
           coalesce(sum(e.amount) filter (where e.type = 'PAYMENT' and e.mode = 'PASS'), 0) as pass
    from (
      select ev.facility_id, ev.session_id, ev.type, ev.device_time, ev.id,
             (ev.payload ->> 'pass_id') is not null as with_pass,
             ev.payload ->> 'mode' as mode,
             -- valid amount: a JSON number, whole, 0 .. bigint maximum; anything else adds 0 (see the header)
             case when ev.type = 'PAYMENT'
                       and jsonb_typeof(ev.payload -> 'amount_paise') = 'number'
                       and (ev.payload -> 'amount_paise')::numeric >= 0
                       and (ev.payload -> 'amount_paise')::numeric = trunc((ev.payload -> 'amount_paise')::numeric)
                       and (ev.payload -> 'amount_paise')::numeric <= 9223372036854775807
                  then (ev.payload -> 'amount_paise')::numeric
                  else 0 end as amount
      from public.events ev
      where ev.type in ('ENTRY', 'EXIT', 'PAYMENT')
    ) e
    group by e.facility_id, e.session_id
  ) s
  join public.facilities f on f.id = s.facility_id
  cross join lateral (values
    ((s.entry_time at time zone f.timezone)::date, 1, case when s.with_pass then 1 else 0 end, null::numeric, 0,
       0::numeric, 0::numeric, 0::numeric),
    ((s.exit_time at time zone f.timezone)::date, 0, 0,
       case when s.has_entry and s.exit_time >= s.entry_time
            then extract(epoch from (s.exit_time - s.entry_time)) end,
       case when s.has_entry then 0 else 1 end,
       s.cash, s.upi, s.pass)
  ) v(local_date, vehicles, pass_count, stay_seconds, orphan_exits, cash, upi, pass)
  where v.local_date is not null

  union all

  -- Branch 2: payments of a session that has no EXIT event (yet, or ever): dated by the payment itself. Malformed or
  -- unsupported payments still produce a zero row so the day exists, with zero revenue.
  select p.facility_id,
         (p.device_time at time zone f.timezone)::date,
         0, 0, null::numeric, 0, 0,
         case when p.payload ->> 'mode' = 'CASH' then p.amount else 0 end,
         case when p.payload ->> 'mode' = 'UPI' then p.amount else 0 end,
         case when p.payload ->> 'mode' = 'PASS' then p.amount else 0 end
  from (
    select pe.facility_id, pe.session_id, pe.device_time, pe.payload,
           case when jsonb_typeof(pe.payload -> 'amount_paise') = 'number'
                     and (pe.payload -> 'amount_paise')::numeric >= 0
                     and (pe.payload -> 'amount_paise')::numeric = trunc((pe.payload -> 'amount_paise')::numeric)
                     and (pe.payload -> 'amount_paise')::numeric <= 9223372036854775807
                then (pe.payload -> 'amount_paise')::numeric
                else 0 end as amount
    from public.events pe
    where pe.type = 'PAYMENT'
      and not exists (
        select 1 from public.events x
        where x.facility_id = pe.facility_id and x.session_id = pe.session_id and x.type = 'EXIT')
  ) p
  join public.facilities f on f.id = p.facility_id

  union all

  select o.facility_id, (o.device_time at time zone f.timezone)::date, 0, 0, null::numeric, 0, 1, 0, 0, 0
  from public.events o
  join public.facilities f on f.id = o.facility_id
  where o.type = 'OVERRIDE'
) k
group by k.facility_id, k.local_date;

-- Nothing for anon; signed-in users are filtered by RLS on events and facilities through security_invoker.
revoke all on table public.v_hourly, public.v_daily_kpis from public, anon, authenticated;
grant select on table public.v_hourly, public.v_daily_kpis to authenticated;
