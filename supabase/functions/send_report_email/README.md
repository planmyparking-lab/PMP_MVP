# send_report_email (CLD-06)

Edge Function that finishes one scheduled report run. `public.run_report_job()` (migration `0014`) starts it through `pg_net`, one call per facility and period. Logic and tests are in `reportJob.mjs` and `reportJob.test.mjs` (`pnpm test:scripts`); `index.ts` is only the Deno wrapper.

**Status: not run.** The local stack has no Edge runtime, no Storage and no Resend account. The logic is tested with fakes; the wrapper, Storage, the signed links and a real email are unverified until deployed to staging.

## Function secrets (`supabase secrets set`)

| Name                                        | What                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `REPORT_JOB_KEY`                            | Must equal the Vault secret `report_job_key`: the bearer key `run_report_job` sends            |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Provided by the platform                                                                       |
| `CONSOLE_URL`                               | Base URL of the deployed Console (the report route lives at `/api/reports/...`)                |
| `REPORT_ROUTE_SECRET`                       | The same value as the Console's, and the one whose SHA-256 is in `report_route_secret` (OQ-72) |
| `RESEND_API_KEY`, `REPORT_MAIL_FROM`        | Resend key and a sender on a verified domain                                                   |

## Database setup (once per environment, by an administrator)

1. Vault secrets `report_job_url` (this function's URL) and `report_job_key`.
2. Recipients: `insert into report_recipients (facility_id, email, cadence) values (...)`, cadence `daily`, `weekly` or `monthly`.
3. Enable `pg_cron` and `pg_net` (Dashboard, Database, Extensions) before applying `0014`, or the jobs are not scheduled.

A run with a missing Vault secret is recorded in `job_runs` as `failed` with `vault_secrets_missing`; a facility with no recipient as `skipped`.
