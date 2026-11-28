-- 0013 (CON-08 / CLD-06, OQ-72): report_data(), the one door the report route uses to read a facility's figures.
--
-- WHY. The report route (apps/console/app/api/reports/[type]/route.ts) is called by the scheduler with a shared secret
-- (IC-08), so it has no user session and RLS (0010) gives it no rows. The Console never holds the service-role key.
-- Decision (Anamika, docs/integrations/console-backend-handoffs.md section 6, option 1): a SECURITY DEFINER function that
-- returns only one facility's aggregates for one period.
--
-- WHO MAY CALL IT. The route reaches the database with the public anon key, which anyone can read from the browser
-- bundle. EXECUTE therefore has to go to anon, and the function checks the shared secret ITSELF: the route cannot be the
-- only gate, or anyone could call the function directly and read any facility. The secret is never stored; only its
-- SHA-256 is, in report_route_secret. No policy and no table privilege exists for anon or authenticated, so the hash is
-- unreadable through the API.
--   * An operator inserts the hash once per environment (a credential, so not in this migration):
--       insert into public.report_route_secret (secret_sha256)
--       values (sha256(convert_to('<REPORT_ROUTE_SECRET value>', 'UTF8')))
--       on conflict (id) do update set secret_sha256 = excluded.secret_sha256;
--   * The secret must be long and random (at least 32 random bytes). The function has no rate limit of its own, so a
--     guessable secret could be brute-forced through the API.
--   * With no row in report_route_secret, every call fails: the function is closed until a secret is set.
--
-- WHAT IT RETURNS (jsonb), built only from the KPI views of 0009 (IC-07), nothing recomputed here:
--   { facility_name, revenue: { cash_paise, upi_paise, pass_paise },
--     hourly: [ { local_date, hour, entries, exits }, ... ] }
-- or SQL null when the facility does not exist. Revenue is summed over the days of the period (a day with no row adds 0).
-- No vehicle numbers appear (OQ-26). Sections that need more than the two views (utilisation by zone, stay distribution,
-- overrides by reason, shift variances, conflicts) are not returned: the Console shows them as "No data for this period."
-- until a decision defines their source.
--
-- ERRORS. 28000 for a missing or wrong secret (one message for both, no hint which); 22023 for a period that is null,
-- reversed or longer than 366 days.

create table public.report_route_secret (
  id boolean primary key default true check (id),
  secret_sha256 bytea not null check (length(secret_sha256) = 32)
);
alter table public.report_route_secret enable row level security;
revoke all on table public.report_route_secret from public, anon, authenticated;

create function public.report_data(p_secret text, p_facility_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_name text;
  v_revenue jsonb;
  v_hourly jsonb;
begin
  if p_secret is null
     or not exists (
       select 1 from public.report_route_secret
       where secret_sha256 = sha256(convert_to(p_secret, 'UTF8'))
     )
  then
    raise exception 'report_data: not authorised' using errcode = '28000';
  end if;

  if p_facility_id is null or p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'report_data: invalid period' using errcode = '22023';
  end if;

  select name into v_name from public.facilities where id = p_facility_id;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'cash_paise', coalesce(sum(cash_paise), 0)::bigint,
    'upi_paise', coalesce(sum(upi_paise), 0)::bigint,
    'pass_paise', coalesce(sum(pass_paise), 0)::bigint
  )
  into v_revenue
  from public.v_daily_kpis
  where facility_id = p_facility_id and local_date between p_from and p_to;

  select coalesce(jsonb_agg(
    jsonb_build_object('local_date', local_date, 'hour', hour, 'entries', entries, 'exits', exits)
    order by local_date, hour
  ), '[]'::jsonb)
  into v_hourly
  from public.v_hourly
  where facility_id = p_facility_id and local_date between p_from and p_to;

  return jsonb_build_object('facility_name', v_name, 'revenue', v_revenue, 'hourly', v_hourly);
end;
$$;

revoke all on function public.report_data(text, uuid, date, date) from public;
grant execute on function public.report_data(text, uuid, date, date) to anon, authenticated;
