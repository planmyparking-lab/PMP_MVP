-- 0014 (CLD-06, OQ-73): the database side of scheduled report email.
--
-- FLOW. pg_cron -> run_report_job(cadence) -> one HTTP POST per facility to the Edge Function `send_report_email`
-- (supabase/functions/send_report_email) -> that function asks the Console report route (IC-08, CON-08) for the PDF and the
-- Excel file, stores both in the private `reports` bucket, signs 7-day links, emails them with Resend, and finishes the
-- job_runs row. SQL cannot write Storage objects or call Resend itself, so the Edge Function does everything after the POST.
--
-- WHAT THIS FILE CREATES
--   report_recipients  who gets which cadence, per facility. RLS on, no policy and no grant for anon or authenticated:
--                      fail-closed until a Console screen and its policies are specified (the sheet defines none).
--                      An administrator manages rows with the service role.
--   job_runs           one row per (job, facility, period). The UNIQUE key is the idempotency key (sheet: "(job,
--                      facility_id, period_start)"), so a duplicate cron invocation cannot send a second email. RLS on,
--                      no policy: written by run_report_job and the Edge Function (service role), read by nobody else.
--   reports bucket     private, created only when the storage schema exists (a plain Postgres, such as CI's, has none).
--   run_report_job()   the cron entry point. Not callable by anon or authenticated.
--   three cron jobs    daily 06:30 IST, weekly Monday 07:00 IST, monthly 1st 07:00 IST (pg_cron runs in UTC), only when
--                      pg_cron is available.
--
-- CONFIGURATION IT NEEDS (credentials, so never in this file). Two Vault secrets, set once per environment:
--   report_job_url   the Edge Function URL (https://<project>.supabase.co/functions/v1/send_report_email)
--   report_job_key   the key the function expects in the Authorization header (a service-role JWT)
-- If either is missing, or pg_net is not installed, run_report_job records the facility's job_runs row as 'failed' with the
-- reason. It never skips silently. The Edge Function's own secrets are listed in its README.
--
-- PERIODS. Computed in each facility's own timezone, for the period that has just ended: daily = yesterday, weekly = the
-- previous Monday to Sunday, monthly = the previous calendar month. period_start is the idempotency date.
--
-- NOT BUILT HERE (see OQ-73): the Resend bounce/complaint webhook and the CLD-10 alert on a failed run. job_runs is where
-- both would read and write; a failed row is the signal until CLD-10 exists.

create table public.report_recipients (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  created_at timestamptz not null default now(),
  unique (facility_id, email, cadence)
);
create index report_recipients_facility_idx on public.report_recipients (facility_id, cadence);
alter table public.report_recipients enable row level security;
revoke all on table public.report_recipients from public, anon, authenticated;
grant select, insert, update, delete on table public.report_recipients to service_role;

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null check (job in ('daily_report', 'weekly_report', 'monthly_report')),
  facility_id uuid not null references public.facilities (id),
  period_start date not null,
  period_end date not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  -- Reasons and counts only: never an email address, a signed link or a secret.
  detail jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check (period_end >= period_start),
  unique (job, facility_id, period_start)
);
alter table public.job_runs enable row level security;
revoke all on table public.job_runs from public, anon, authenticated;
grant select, insert, update on table public.job_runs to service_role;

-- A private bucket, only where Storage exists.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('reports', 'reports', false)
    on conflict (id) do update set public = false;
  end if;
end $$;

-- Starts one cadence's run for every facility. Returns how many facilities were started.
create function public.run_report_job(p_cadence text) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  f record;
  v_job text;
  v_url text;
  v_key text;
  v_local_today date;
  v_start date;
  v_end date;
  v_run uuid;
  v_recipients integer;
  v_started integer := 0;
begin
  if p_cadence not in ('daily', 'weekly', 'monthly') then
    raise exception 'run_report_job: unknown cadence' using errcode = '22023';
  end if;
  v_job := p_cadence || '_report';

  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'report_job_url';
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'report_job_key';
  exception when others then
    v_url := null;
    v_key := null;
  end;

  for f in select id, timezone from public.facilities order by id loop
    v_run := null;
    -- One facility's problem never blocks the others.
    begin
      v_local_today := (now() at time zone f.timezone)::date;
      if p_cadence = 'daily' then
        v_start := v_local_today - 1;
        v_end := v_start;
      elsif p_cadence = 'weekly' then
        v_start := date_trunc('week', v_local_today)::date - 7;
        v_end := v_start + 6;
      else
        v_start := (date_trunc('month', v_local_today) - interval '1 month')::date;
        v_end := (date_trunc('month', v_local_today) - interval '1 day')::date;
      end if;

      select count(*) into v_recipients
      from public.report_recipients where facility_id = f.id and cadence = p_cadence;

      if v_recipients = 0 then
        insert into public.job_runs (job, facility_id, period_start, period_end, status, detail, finished_at)
        values (v_job, f.id, v_start, v_end, 'skipped', '{"reason":"no_recipients"}', now())
        on conflict (job, facility_id, period_start) do nothing;
        continue;
      end if;

      -- The idempotency key: a second invocation for the same period finds the row and does nothing,
      -- unless the earlier attempt failed, in which case it is retried (and only then).
      insert into public.job_runs (job, facility_id, period_start, period_end, status)
      values (v_job, f.id, v_start, v_end, 'running')
      on conflict (job, facility_id, period_start) do update
        set status = 'running', detail = '{}'::jsonb, started_at = now(), finished_at = null
        where public.job_runs.status = 'failed'
      returning id into v_run;
      if v_run is null then
        continue; -- already running, succeeded or skipped for this period
      end if;

      if v_url is null or v_key is null then
        update public.job_runs set status = 'failed', finished_at = now(),
          detail = '{"reason":"vault_secrets_missing"}' where id = v_run;
        continue;
      end if;

      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object(
          'job_run_id', v_run, 'cadence', p_cadence, 'facility_id', f.id,
          'period_start', v_start, 'period_end', v_end),
        timeout_milliseconds := 5000
      );
      v_started := v_started + 1;
    exception when others then
      -- Only the SQLSTATE: a message can quote a URL or a key.
      if v_run is not null then
        update public.job_runs set status = 'failed', finished_at = now(),
          detail = jsonb_build_object('reason', 'dispatch_failed', 'sqlstate', sqlstate) where id = v_run;
      end if;
    end;
  end loop;

  return v_started;
end;
$$;
revoke all on function public.run_report_job(text) from public, anon, authenticated;

-- Schedules (UTC = IST - 5:30). Skipped, with a notice, where pg_cron does not exist.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('daily_report', '0 1 * * *', $c$ select public.run_report_job('daily') $c$);
    perform cron.schedule('weekly_report', '30 1 * * 1', $c$ select public.run_report_job('weekly') $c$);
    perform cron.schedule('monthly_report', '30 1 1 * *', $c$ select public.run_report_job('monthly') $c$);
  else
    raise notice '0014: pg_cron is not available here; the report jobs were NOT scheduled';
  end if;
end $$;
