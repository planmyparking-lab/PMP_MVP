-- pgTAP tests for migration 0014_report_scheduler.sql (CLD-06, OQ-73). Run with `pnpm test:db`.
-- The HTTP call itself (pg_net -> Edge Function) is not exercised: with no Vault secrets set, run_report_job takes its
-- recorded-failure path, which is what these tests check. The Edge Function logic is tested in
-- supabase/functions/send_report_email/reportJob.test.mjs. The transaction is rolled back.
begin;
select plan(24);

insert into public.organizations (id, name) values ('00000000-0000-0000-0000-00000000000f', 'Org');
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000f', 'F1', 'Asia/Kolkata', 10),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000f', 'F2', 'Asia/Kolkata', 10);
insert into public.report_recipients (facility_id, email, cadence) values
  ('00000000-0000-0000-0000-0000000000f1', 'owner@example.test', 'daily'),
  ('00000000-0000-0000-0000-0000000000f1', 'owner@example.test', 'weekly'),
  ('00000000-0000-0000-0000-0000000000f1', 'owner@example.test', 'monthly');

-- structure and privileges
select has_table('public', 'report_recipients', 'report_recipients exists');
select has_table('public', 'job_runs', 'job_runs exists');
select is((select relrowsecurity from pg_class where oid = 'public.report_recipients'::regclass), true, 'RLS on report_recipients');
select is((select relrowsecurity from pg_class where oid = 'public.job_runs'::regclass), true, 'RLS on job_runs');
select is(has_table_privilege('anon', 'public.job_runs', 'SELECT,INSERT,UPDATE,DELETE'), false, 'anon holds no privilege on job_runs');
select is(has_table_privilege('authenticated', 'public.job_runs', 'SELECT,INSERT,UPDATE,DELETE'), false,
  'authenticated holds no privilege on job_runs');
select is(has_table_privilege('authenticated', 'public.report_recipients', 'SELECT,INSERT,UPDATE,DELETE'), false,
  'authenticated holds no privilege on report_recipients');
select is(has_function_privilege('anon', 'public.run_report_job(text)', 'EXECUTE'), false, 'anon cannot run the job');
select is(has_function_privilege('authenticated', 'public.run_report_job(text)', 'EXECUTE'), false,
  'authenticated cannot run the job');

-- constraints
select throws_ok($$ insert into public.report_recipients (facility_id, email, cadence)
  values ('00000000-0000-0000-0000-0000000000f1', 'not-an-email', 'daily') $$, '23514', null, 'a malformed email is refused');
select throws_ok($$ insert into public.report_recipients (facility_id, email, cadence)
  values ('00000000-0000-0000-0000-0000000000f1', 'a@example.test', 'hourly') $$, '23514', null, 'an unknown cadence is refused');
select throws_ok($$ select public.run_report_job('hourly') $$, '22023', 'run_report_job: unknown cadence', 'unknown cadence refused');

-- daily: F1 has a recipient (no Vault secrets here, so the dispatch is recorded as failed); F2 has none (skipped)
select is(public.run_report_job('daily'), 0, 'no facility could be started without Vault secrets');
select is((select status from public.job_runs where job = 'daily_report' and facility_id = '00000000-0000-0000-0000-0000000000f1'),
  'failed', 'F1 is recorded failed, not silently skipped');
select is((select detail ->> 'reason' from public.job_runs where job = 'daily_report' and facility_id = '00000000-0000-0000-0000-0000000000f1'),
  'vault_secrets_missing', 'the reason names the missing configuration');
select is((select status from public.job_runs where job = 'daily_report' and facility_id = '00000000-0000-0000-0000-0000000000f2'),
  'skipped', 'F2 has no recipient and is recorded skipped');
select is((select detail ->> 'reason' from public.job_runs where job = 'daily_report' and facility_id = '00000000-0000-0000-0000-0000000000f2'),
  'no_recipients', 'with the reason');

-- the period is the day that has just ended, in the facility's own timezone
select is((select period_start from public.job_runs where job = 'daily_report' and facility_id = '00000000-0000-0000-0000-0000000000f1'),
  ((now() at time zone 'Asia/Kolkata')::date - 1), 'daily covers yesterday');

-- idempotency: running again changes no row count; a failed run is retried, not duplicated
select public.run_report_job('daily');
select is((select count(*)::int from public.job_runs where job = 'daily_report'
  and facility_id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2')), 2,
  'a second run adds no duplicate rows');

-- a succeeded run is left alone
update public.job_runs set status = 'succeeded' where job = 'daily_report' and facility_id = '00000000-0000-0000-0000-0000000000f1';
select public.run_report_job('daily');
select is((select status from public.job_runs where job = 'daily_report' and facility_id = '00000000-0000-0000-0000-0000000000f1'),
  'succeeded', 'a succeeded run is not restarted');

-- weekly and monthly periods
select public.run_report_job('weekly');
select is((select (period_end - period_start) from public.job_runs where job = 'weekly_report' and facility_id = '00000000-0000-0000-0000-0000000000f1'),
  6, 'weekly covers seven days');
select public.run_report_job('monthly');
select is((select extract(day from period_start)::int from public.job_runs where job = 'monthly_report' and facility_id = '00000000-0000-0000-0000-0000000000f1'),
  1, 'monthly starts on the 1st');

-- the reports bucket is private wherever Storage exists
select is(
  case when to_regclass('storage.buckets') is null then false
       else (select public from storage.buckets where id = 'reports') end,
  false, 'the reports bucket is not public (or Storage is absent)');

-- the three jobs, in UTC (IST - 5:30), wherever pg_cron exists
select is(
  case when to_regclass('cron.job') is null then 'daily_report=0 1 * * *;monthly_report=30 1 1 * *;weekly_report=30 1 * * 1'
       else (select string_agg(jobname || '=' || schedule, ';' order by jobname) from cron.job
             where jobname in ('daily_report', 'weekly_report', 'monthly_report')) end,
  'daily_report=0 1 * * *;monthly_report=30 1 1 * *;weekly_report=30 1 * * 1',
  'daily 06:30 IST, weekly Monday 07:00 IST, monthly 1st 07:00 IST (or pg_cron absent)');

select * from finish();
rollback;
