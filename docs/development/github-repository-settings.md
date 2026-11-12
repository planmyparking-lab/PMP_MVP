# GitHub repository settings: administrator handoff checklist

**This file does not configure anything.** The rules below are settings an administrator applies in
GitHub. Until they are applied and verified, none of them is in force. Nothing in this repository
(workflows, CODEOWNERS, templates) can enforce them by itself.

Status of each item must be recorded by the administrator in the "Applied (date / who)" column.

| #   | Setting (Settings > Rules > Rulesets, target: default branch `main`) | Recommended value                                                                                                                                                   | Applied (date / who) |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | Ruleset enforcement                                                  | Active                                                                                                                                                              | TBD                  |
| 2   | Restrict deletions                                                   | On                                                                                                                                                                  | TBD                  |
| 3   | Block force pushes                                                   | On                                                                                                                                                                  | TBD                  |
| 4   | Require a pull request before merging                                | On (this also blocks direct pushes)                                                                                                                                 | TBD                  |
| 5   | Required approvals                                                   | 1                                                                                                                                                                   | TBD                  |
| 6   | Require review from Code Owners                                      | On (requires valid owners with write access)                                                                                                                        | TBD                  |
| 7   | Dismiss stale approvals on new commits                               | On                                                                                                                                                                  | TBD                  |
| 8   | Require approval of the most recent reviewable push                  | On (this is what prevents an author approving their own last push by proxy; GitHub already stops authors approving their own PR)                                    | TBD                  |
| 9   | Require conversation resolution                                      | On                                                                                                                                                                  | TBD                  |
| 10  | Require status checks                                                | Target: `check`, `branch-name`, `secret-scan`, `db-tests`; require branches up to date. Names appear only after CI has run once. `audit` is advisory, leave it out. | TBD                  |
| 11  | Allowed merge methods                                                | Squash only (team choice)                                                                                                                                           | TBD                  |
| 12  | Require linear history                                               | On if squash only                                                                                                                                                   | TBD                  |
| 13  | Bypass list                                                          | Empty, or Repository admin with "For pull requests only"; revisit after the first weeks                                                                             | TBD                  |
| 14  | Automatically delete head branches (Settings > General)              | On                                                                                                                                                                  | TBD                  |
| 15  | Collaborators                                                        | Each CODEOWNERS user has Write access; exact roles TBD                                                                                                              | TBD                  |

## Deployment environments (CLD-09)

Used by `.github/workflows/deploy-staging.yml` and `deploy-prod.yml` (see
[deployment.md](deployment.md)). Apply these **before** setting `DEPLOY_ENABLED`: GitHub creates an
environment that a workflow names but that does not exist yet, **without** protection rules.

| #   | Setting (Settings > Environments, Settings > Secrets and variables > Actions) | Recommended value                                                                                                    | Applied (date / who) |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------- |
| D1  | Environment `staging`: deployment branches and tags                           | Selected branches: `main` only                                                                                       | TBD                  |
| D2  | Environment `staging`: secrets and variables                                  | Secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`; variable `SUPABASE_PROJECT_REF` (the staging project)       | TBD                  |
| D3  | Environment `production`: required reviewers                                  | Named by Afzal (CLD-01 step 2); "Prevent self-review" on                                                             | TBD                  |
| D4  | Environment `production`: deployment branches and tags                        | Selected tags: `v*` only                                                                                             | TBD                  |
| D5  | Environment `production`: secrets and variables                               | Same three names as D2, for the production project; never shared with staging                                        | TBD                  |
| D6  | Ruleset for tags `v*`                                                         | Restrict creation, update and deletion to the release approvers                                                      | TBD                  |
| D7  | Repository variable `DEPLOY_ENABLED`                                          | `true`, set last, after D1 to D6 and after the Supabase projects exist (CLD-01). Until then both deploys are skipped | TBD                  |

## Verification (after applying)

1. Open a throwaway PR: `check`, `branch-name`, and `secret-scan` run and show up in the merge box.
2. The correct code owner is requested automatically.
3. Merge is blocked without approval.
4. `git push origin main` from a normal clone is rejected.
5. Record results here. Until this is done, treat protection as unconfigured.

## Known limits

- Code owner review needs every handle in `.github/CODEOWNERS` to be a real user with write access.
  GitHub shows a red "CODEOWNERS file contains errors" banner otherwise.
- With a team this small, a PR in a path where the author is the only code owner cannot be approved by
  anyone else. Every path in `.github/CODEOWNERS` now has at least two owners, so no author is the only code owner of their own PR. Keep it that
  way when adding paths; a new single-owner line brings the deadlock back (the only way out is the bypass list).
