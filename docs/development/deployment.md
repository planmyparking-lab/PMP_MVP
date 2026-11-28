# Deployment workflows (CLD-09)

Owner: Akanksha (Member 04). Release process from REL-01 (`docs/team/member-01-afzal.md`, step 6): a merge to `main`
deploys staging; a release tag deploys production after manual approval. Workflow names and the `v*` tag follow
CLD-09 (`docs/team/member-04-akanksha.md`).

**Status: live on staging.** The `staging` Supabase project, GitHub environment and deploy secrets exist (CLD-01);
`deploy-staging.yml` has run for real against it (`docs/development/github-repository-settings.md` D1-D2). Production
(`deploy-prod.yml`) is implemented and gated the same way, but the `production` Supabase project has never had a
migration applied, and the release-tag path (OQ-71) needs `RELEASE_TAG_PAT` set before a tag can even reach it.

## What each workflow does

| Workflow             | Trigger                                                                          | Steps                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy-staging.yml` | CI (`ci.yml`) completed successfully for a **push** to `main` in this repository | Check out the exact commit CI tested; preflight; `supabase link`; `supabase db push --dry-run`; `supabase db push`; migration list in the job summary; post-deploy health check against `/api/health` (CLD-10, only when the `CONSOLE_URL` variable is set). Environment `staging`.                                                                                                                  |
| `deploy-prod.yml`    | A pushed tag matching `v*`                                                       | `verify-release` (no secrets): tag is `vMAJOR.MINOR.PATCH[-pre]`, the tagged commit is on `main`, the CI jobs `check` **and** `db-tests` both passed for it (a failed, skipped, unfinished or missing job blocks the release), and this exact commit already has a successful `staging` deployment (REL-01). Then `deploy-production` in environment `production` (approval), same steps as staging. |

Safety rules built in (and asserted by `scripts/deploy-workflows.test.mjs`, which `pnpm test:scripts` runs in CI):

- No deploy workflow has a `pull_request` trigger, a branch trigger for production, or `workflow_dispatch`.
- Every action is pinned to a full commit SHA; the workflow token is `contents: read` (plus `checks: read` and
  `deployments: read` for the release-verification job only, to read CI check runs and the staging-deploy record).
- Secrets reach a job only through its `env:` mapping, by the names in `ops/secrets-inventory.md`
  (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` as secrets; `SUPABASE_PROJECT_REF`, and `CONSOLE_URL` on staging
  only, as variables). No script interpolates a secret.
- A release tag can only reach `deploy-production` once this exact commit already has a successful `staging-deploy`
  commit status (`scripts/verify-staging-deploy.mjs`), posted by `deploy-staging.yml`'s own last step against
  `github.event.workflow_run.head_sha`. Not the Deployment GitHub creates automatically for the job's `environment:
staging` key: for a `workflow_run`-triggered job, that Deployment is recorded against `GITHUB_SHA`, which is
  `main`'s tip when `deploy-staging.yml` itself runs, not the commit CI actually tested — the two can differ when two
  merges queue close together (found in review, PR #79).
- `scripts/deploy-preflight.mjs` runs before anything touches a hosted project and fails with the **names** of missing
  settings, never their values (CLD-09 step 10).
- One deploy per environment at a time; a queued deploy waits instead of cancelling one in progress.
- Migrations are previewed (`--dry-run`) before they are applied. Migrations are forward-only, so a database rollback
  is a new corrective migration, not a revert.
- The release gate counts only check runs created by GitHub Actions (`app.slug == "github-actions"`), so another app
  cannot satisfy it by posting a check run named `check` or `db-tests`.
- CI cancels a run in progress when a newer push arrives. With two quick merges to `main` the first commit's CI can be
  cancelled, and that commit can then never be released (the gate sees a cancelled run). This is safe. Tag the latest
  commit on `main`, or re-run CI on the older one.
- Tagging an older commit does **not** roll production back: `supabase db push` refuses when the remote database has
  migrations the checkout does not. That fits forward-only migrations: to undo a change, merge a corrective change and
  tag the new commit. Whoever is on call should not try a rollback by re-tagging.

## Not implemented, and why

| Part (CLD-09 / REL-01)                   | Blocker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Owner                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Supabase projects, environments, secrets | Need Supabase and GitHub administrator access (CLD-01; T-CLD-01-I1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Repository administrator, Akanksha |
| Console deploy                           | Resolved (27 Nov 2026, Afzal): Vercel project `pmp-mvp` under team `plan-my-parking`, Root Directory `apps/console`, connected via Vercel's own Git integration (chosen over a CLI step, for a fast first deploy — a CLI step integrated into the gated pipeline, matching Supabase's, is a possible later upgrade). Vercel's "Production" maps to `main`, same as the Supabase side's staging deploy, so this is effectively the staging Console for now; a true production Console needs a second Vercel project or environment tied to release tags. | Anamika, Afzal                     |
| Edge Functions deploy                    | `supabase/functions/` does not exist; no function is written.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Akanksha                           |
| Gate app EAS build and OTA channel       | No `eas.json` and no Expo project or `EXPO_TOKEN`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Nikhil                             |
| Rollback drill                           | `docs/release.md` (REL-01) documents the tagging convention, `SCHEMA_VERSION` bump and rollback steps; the drill itself (REL-01 step 8) still needs the real environments to exercise it against.                                                                                                                                                                                                                                                                                                                                                       | Afzal                              |
| Dry runs T-CLD-09-I2, I3, N1, X1         | Need a sandbox repository or the real environments.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Akanksha                           |

## Turning deploys on (administrator, in order)

1. Create the staging and production Supabase projects (CLD-01) and record their refs in the runbook.
2. Apply items D1 to D6 of [github-repository-settings.md](github-repository-settings.md).
3. Set `DEPLOY_ENABLED` to `true` (item D7).
4. Merge a trivial change to `main` and confirm `deploy-staging` runs after CI and lists the migrations.
5. Create the `release-approval` environment's `RELEASE_TAG_PAT` secret (OQ-71; `.github/workflows/create-release-tag.yml`
   fails fast, naming it, until this exists) — a fine-grained PAT, Contents: Read and write, scoped to only this
   repository.
6. Run `create-release-tag.yml` with a pre-release tag such as `v0.0.0-test`; confirm the run waits for approval
   (T-CLD-09-I3), and — this is the part a `GITHUB_TOKEN`-authored push would silently skip (OQ-71) — confirm
   `deploy-prod.yml` itself then runs for that tag. Delete the test tag and its `production` environment deployment
   record afterward.
