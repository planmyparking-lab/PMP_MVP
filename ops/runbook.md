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
  (see [supabase/README.md](../supabase/README.md)). **[run locally]** on 12 Nov 2026 `pnpm test:db` applied `0004`-`0006`
  on top of the local history (`0001`-`0003`) in a rolled-back transaction; every suite passed except
  `event_parity.test.sql` (27 of 37), which is the IC-01 `0004` validation gap described in the README.

## Pipelines (CLD-09)

- **[in repo]** `.github/workflows/ci.yml` on `main`: `secret-scan`, `check` (migration lint, script tests, format, lint,
  typecheck, unit tests, Console build), `android-bundle`, `branch-name`, advisory `audit`. Read-only token, no secrets,
  `pull_request` only, which is designed to be safe for forked PRs. **`main` runs no SQL tests in CI.**
- SQL tests in CI are proposed by PR #27 (`db-tests`: PostgreSQL 16 + pgTAP with a Supabase auth stub,
  `scripts/test-db-ci.mjs`, which drops its throwaway database in a `finally` block). It is not merged and is red
  until `event_parity.test.sql` passes, which needs the IC-01 `0004` validation decision (PR #26 or PR #30). No second
  SQL job is added here. Until #27 merges, run `pnpm test:db` locally (needs the local stack; see
  [supabase/README.md](../supabase/README.md)).
- **Not written:** `deploy-staging.yml` and `deploy-prod.yml`. They need hosted projects, GitHub environments and
  secrets that do not exist yet, and a decision on where the Console is hosted. Do not add them before CLD-01's
  **[manual]** steps are done.
- **[manual]** Add the SQL job to the required status checks only after it has been observed green on GitHub (the list
  is in [github-repository-settings.md](../docs/development/github-repository-settings.md)).
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
  - **[run locally]** `bash tools/restore/restore_drill.sh --synthetic` on 12 Nov 2026 with migrations `0001`-`0006`:
    16 tables, 2932 synthetic rows, MATCH (see [restore-log.md](restore-log.md)). `pnpm test:restore` (7 tests, 7
    passed) checks the expected event, open-session and conflict counts, the corrupted-row MISMATCH path, cleanup, and
    the refusal cases (missing container, non-`supabase_db_*` name, remote Docker env vars).
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

All **[manual]** and not started: Sentry projects (gate, console, functions) with DSNs in secrets; a Console
`/api/health` route (Anamika provides it, or Akanksha adds it with her review) that runs `select 1` plus one small
read and returns 200 or 503 with no data; an uptime monitor hitting it every minute, paging after 2 consecutive
failures; a named weekly on-call and the escalation order. Alert catalog: [alerts.md](alerts.md).
Escalation order, on-call roster and the secondary channel are **not decided** (needs the team).

## Weekly review

Database size, slow queries (indexes only from measured queries), bill. Owner: Akanksha.
