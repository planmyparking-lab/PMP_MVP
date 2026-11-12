# Deployment workflows (CLD-09)

Owner: Akanksha (Member 04). Release process from REL-01 (`docs/team/member-01-afzal.md`, step 6): a merge to `main`
deploys staging; a release tag deploys production after manual approval. Workflow names and the `v*` tag follow
CLD-09 (`docs/team/member-04-akanksha.md`).

**Status: the database part is implemented and switched off.** No Supabase project, GitHub environment or deploy
secret exists yet (CLD-01), so nothing has been deployed and neither workflow has run on GitHub. They stay skipped
until an administrator completes the "Deployment environments" checklist in
[github-repository-settings.md](github-repository-settings.md) and sets the repository variable `DEPLOY_ENABLED`.

## What each workflow does

| Workflow             | Trigger                                                                          | Steps                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy-staging.yml` | CI (`ci.yml`) completed successfully for a **push** to `main` in this repository | Check out the exact commit CI tested; preflight; `supabase link`; `supabase db push --dry-run`; `supabase db push`; migration list in the job summary. Environment `staging`.                                           |
| `deploy-prod.yml`    | A pushed tag matching `v*`                                                       | `verify-release` (no secrets): tag is `vMAJOR.MINOR.PATCH[-pre]`, the tagged commit is on `main`, CI job `check` passed for it. Then `deploy-production` in environment `production` (approval), same steps as staging. |

Safety rules built in (and asserted by `scripts/deploy-workflows.test.mjs`, which `pnpm test:scripts` runs in CI):

- No deploy workflow has a `pull_request` trigger, a branch trigger for production, or `workflow_dispatch`.
- Every action is pinned to a full commit SHA; the workflow token is `contents: read` (plus `checks: read` for the
  release check only).
- Secrets reach a job only through its `env:` mapping, by the names in `ops/secrets-inventory.md`
  (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` as secrets; `SUPABASE_PROJECT_REF` as a variable). No script
  interpolates a secret.
- `scripts/deploy-preflight.mjs` runs before anything touches a hosted project and fails with the **names** of missing
  settings, never their values (CLD-09 step 10).
- One deploy per environment at a time; a queued deploy waits instead of cancelling one in progress.
- Migrations are previewed (`--dry-run`) before they are applied. Migrations are forward-only, so a database rollback
  is a new corrective migration, not a revert.

## Not implemented, and why

| Part (CLD-09 / REL-01)                      | Blocker                                                                                                                                                                                                   | Owner                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Supabase projects, environments, secrets    | Need Supabase and GitHub administrator access (CLD-01; T-CLD-01-I1).                                                                                                                                      | Repository administrator, Akanksha |
| Console deploy                              | The Console is hosted on Vercel (`docs/architecture/overview.md`), but no Vercel project exists and how deploys are triggered (Vercel Git integration or a CLI step with project secrets) is not decided. | Anamika, Afzal                     |
| Edge Functions deploy                       | `supabase/functions/` does not exist; no function is written.                                                                                                                                             | Akanksha                           |
| Post-deploy health check                    | The Console route `/api/health` (CLD-10) does not exist yet.                                                                                                                                              | Anamika                            |
| Gate app EAS build and OTA channel          | No `eas.json` and no Expo project or `EXPO_TOKEN`.                                                                                                                                                        | Nikhil                             |
| Tagging convention, rollback drill          | `docs/release.md` (REL-01) is not written; the preflight accepts `vMAJOR.MINOR.PATCH[-pre]` until it is.                                                                                                  | Afzal                              |
| Requirement that a tag first ran on staging | Needs a recorded staging deploy per commit; add once staging deploys run.                                                                                                                                 | Akanksha                           |
| Dry runs T-CLD-09-I2, I3, N1, X1            | Need a sandbox repository or the real environments.                                                                                                                                                       | Akanksha                           |

## Turning deploys on (administrator, in order)

1. Create the staging and production Supabase projects (CLD-01) and record their refs in the runbook.
2. Apply items D1 to D6 of [github-repository-settings.md](github-repository-settings.md).
3. Set `DEPLOY_ENABLED` to `true` (item D7).
4. Merge a trivial change to `main` and confirm `deploy-staging` runs after CI and lists the migrations.
5. Push a pre-release tag such as `v0.0.0-test` on a commit of `main`; confirm the run waits for approval (T-CLD-09-I3).
