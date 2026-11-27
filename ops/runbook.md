# Operations runbook (CLD-01, CLD-09, CLD-10)

**Status: partly implemented.** Three labels are used:

- **[manual]**: needs a human with dashboard access; **not done** by anything in this repository.
- **[in repo]**: the code or document exists. It does **not** mean the hosted or CI behaviour has been observed.
- **[run locally]**: executed on the local Docker stack on the date stated, with the result stated. Local results are not production evidence.

Nothing here describes a configured hosted environment: no Supabase project, GitHub environment, Sentry project or
uptime monitor is known to exist yet. Record project refs (not keys) in the table below once they are created.

## Environments (CLD-01)

| Environment | Supabase project ref | Region | GitHub environment | Created (date / who) |
| ----------- | -------------------- | ------ | ------------------ | -------------------- |
| dev         | TBD                  | TBD    | none               | TBD                  |
| staging     | TBD                  | TBD    | `staging`          | TBD                  |
| production  | TBD                  | TBD    | `production`       | TBD                  |

- **[manual]** Create the three projects. The sheet says Mumbai; verify the exact region label in the dashboard.
- **[manual]** Create GitHub environments `staging` and `production`; require reviewers on `production` (approver named
  by Afzal). Store the per-environment names listed in [secrets-inventory.md](secrets-inventory.md). Never share a
  secret between environments.
- **[manual]** Restrict production project membership to owners only; remove leavers from GitHub and Supabase the same day.
- **[in repo]** Local stack for development and tests: `npx supabase@2.122.0 start`, then `pnpm test:db`
  (see [supabase/README.md](../supabase/README.md)). `pnpm test:db` applies every migration on `main`
  (`0001`-`0011`) in a rolled-back transaction. **[run locally]** on 12 Nov 2026, before `0011` existed, every suite
  passed except `event_parity.test.sql` (27 of 37), the IC-01 `0004` validation gap. `0011` closed that gap
  (OQ-52, PR #56): `event_parity.test.sql` now passes 37 of 37 (checked by Anamika on 18 Nov 2026, see the comment on PR #61).

## Pipelines (CLD-09)

- **[in repo]** `.github/workflows/ci.yml` on `main`: `secret-scan`, `check` (migration lint, script tests, format, lint,
  typecheck, unit tests, Console build), `db-tests` (PostgreSQL 16 + pgTAP with a minimal Supabase stub,
  `scripts/ci-supabase-stub.sql` and `scripts/test-db-ci.mjs`; applies every migration and runs `supabase/tests`),
  `android-bundle`, `branch-name` (pull requests only) and advisory `audit`. Read-only token, no secrets,
  `pull_request` only, which is designed to be safe for forked PRs. `db-tests` runs only on the stub, not on a real
  Supabase stack (see [supabase/README.md](../supabase/README.md)).
- **[in repo]** `.github/workflows/deploy-staging.yml` and `deploy-prod.yml` (CLD-09, pull request #42) are on `main` and
  **switched off**: they stay skipped until `DEPLOY_ENABLED` is set, and they need hosted projects, GitHub environments
  and secrets that do not exist yet. They have never run. See [deployment.md](../docs/development/deployment.md).
- **[manual]** Requiring `db-tests` (and the other checks) before merge is a repository setting
  ([github-repository-settings.md](../docs/development/github-repository-settings.md), item 10); nothing in this
  repository enforces it, and `main` has no branch protection today.
- Release policy (documented, not enforced by tooling): no Friday or pre-peak-weekend release to a live pilot.
- Rollback: migrations are forward-only, so a database rollback is a new corrective migration. Console: redeploy the
  previous build. Gate app: OTA channel can roll back JavaScript-only fixes.

## Backups and restore (CLD-10)

- **[manual]** Decide the backup mechanism (OQ-07): a Supabase plan with restorable daily backups, or a nightly
  `pg_dump` to encrypted storage. Nothing is configured and no backup exists today.
- **[in repo]** `tools/restore/restore_drill.sh`: a **local data-pipeline check**, not a restore-fidelity proof. It dumps
  `public` and `auth.users` from the local container (`pg_dump --no-owner --no-acl`), restores into a scratch database
  there, and compares. With `--synthetic` the source is a scratch database built from `auth.users` plus every file in
  `supabase/migrations`, seeded with organizations, facilities, zones, passes, staff, devices and events, so the
  trigger-derived `open_sessions` and `sync_conflicts` rows are dumped and restored too.
  - **Verified by the fingerprint:** row counts and an md5 of every row of every `public` table and `auth.users`; the
    count and names of public policies; the signatures of public functions; the names of public views.
  - **NOT verified:** privileges and ACLs (the dump omits them, so a restore would silently lose revokes such as the
    TRUNCATE revoke and still report MATCH), policy predicates (`USING` / `WITH CHECK`), function bodies, view
    definitions, indexes and constraints, the RLS-enabled flag, triggers, sequences, extensions, storage objects,
    and any schema other than `public` plus `auth.users`.
  - **[run locally]** `bash tools/restore/restore_drill.sh --synthetic` on 18 Nov 2026 with `main` including
    `0011`: migrations `0001`-`0011`, 19 tables, 2986 synthetic rows, 38 policies, 20 functions, 3 views, MATCH, no
    scratch database left behind (see [restore-log.md](restore-log.md); Anamika's independent run the same day also
    matched, with 2988 rows). The 12 Nov run with `0001`-`0010` reported 40 policies; the
    two fewer are intended: the review fix `1073188` (before PR #34 merged) removed `devices_insert` and
    `staff_insert` from `0010_rls.sql` and replaced them with column grants, and `0011` adds no policy.
    `pnpm test:restore` (7 tests, 7 passed, 0 skipped with the stack up) checks the expected event, open-session and conflict counts, that policies survive the restore,
    the corrupted-row MISMATCH path, cleanup, and the refusal cases (missing container, non-`supabase_db_*` name, remote
    Docker env vars). The scratch databases get Supabase's `auth` helper functions copied from the local database,
    because the `0010` policies reference `auth.uid()` and `auth.jwt()`. The drill tests in `pnpm test:restore` need the
    local Supabase stack and skip without it, and CI has no such stack, so they **never run in CI**: a green CI run says
    nothing about the restore drill.
  - It refuses to run when `DOCKER_HOST` or `DOCKER_CONTEXT` is set; a remote context set only in Docker's own config
    file is not detected. Cleanup runs on exit but not after `SIGKILL`.
- **[manual] Production drill (the only valid proof, T-CLD-10-E1):**
  1. Create a fresh, empty Supabase project. Never restore over production.
  2. Restore the latest backup into it (dumps stay encrypted at rest; decrypt only on the restoring machine; use the
     fresh project's database password from your password manager, never on a command line that is logged).
  3. Compare per-table row counts and checksums with the source (the query inside `restore_drill.sh`
     `fingerprint_sql` is reusable) **and** the things that script does not check: privileges, policy definitions,
     function and view definitions, indexes, RLS flags. Restore with grants included (no `--no-acl`).
  4. Record the result in [restore-log.md](restore-log.md). A failed restore is a Critical incident: treat the backup
     as non-existent.
  5. Repeat monthly and before the first pilot.
- Credentials: pass database passwords through the environment or a prompt; never paste them into chat, issues or logs.

## Monitoring and on-call (CLD-10)

The Console `/api/health` route **exists** (`apps/console/app/api/health/route.ts`, PR #40): it sends one zero-row anon
request to `facilities` and answers 200 or 503 with no data. A permission error (42501) still counts as "database
reachable", so it keeps working once the `0010` RLS policies are in force. Only a connection failure or a 5xx is 503.

All **[manual]** and not started: Sentry projects (gate, console, functions) with DSNs in secrets; an uptime monitor
hitting `/api/health` every minute, paging after 2 consecutive failures; a named weekly on-call and the escalation
order. Alert catalog: [alerts.md](alerts.md).
Escalation order, on-call roster and the secondary channel are **not decided** (needs the team).

## Weekly review

Database size, slow queries (indexes only from measured queries), bill. Owner: Akanksha.
