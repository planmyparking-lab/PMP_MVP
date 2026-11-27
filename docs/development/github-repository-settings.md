# GitHub repository settings: administrator handoff checklist

**This file does not configure anything.** The rules below are settings an administrator applies in
GitHub. Until they are applied and verified, none of them is in force. Nothing in this repository
(workflows, CODEOWNERS, templates) can enforce them by itself.

Status of each item must be recorded by the administrator in the "Applied (date / who)" column.

## Native enforcement is currently unavailable (OQ-65)

Confirmed 16 Nov 2026 (Afzal): **neither mechanism in this table can be applied on this repository
today**, for a plan reason, not a permissions or syntax one.

- `Settings > Rules > Rulesets` (the newer mechanism, what the table above was originally written
  against): `gh api repos/planmyparking-lab/PMP_MVP/rulesets` → `403`, `"Upgrade to GitHub Pro or
make this repository public to enable this feature."`
- Classic `Settings > Branches` protection (`PUT .../branches/main/protection`), tried as a fallback:
  first attempt returned `404` under afzl-raza's account, which looked like a permissions issue
  (`afzl-raza`, like every other team member, holds `write`, not `admin`, on this repo — only the
  `planmyparking-lab` account itself is `admin`). Re-run logged in as `planmyparking-lab`
  (confirmed `admin: true`), with both the full payload and a minimal one (status checks only,
  every other field `null`): same result both times, `403`, same "Upgrade to GitHub Pro or make
  this repository public" message. So it is not a permissions gap either — GitHub Free does not
  offer branch protection on a **private** repository at all, regardless of who asks.

Until one of the conditions below changes, treat every row in the table as **not enforceable** and
use the team-discipline substitute instead.

### What would unblock it

1. `planmyparking-lab` (or whichever account ends up owning the repo) gets GitHub Pro/Team/Enterprise
   — for example via GitHub Education (Student Developer Pack / Global Campus), which several of us
   may be eligible for through our `@sitare.org` addresses. This is the most likely explanation for
   why some other campus project's private repo already has working branch protection: that repo's
   owner already has the paid tier, typically through an education benefit, not a different API call.
2. The repository is made public (branch protection and Rulesets are free on Free for public repos).
   Not recommended while there's anything in here not meant for public release.
3. We decide to pay for the plan upgrade ourselves.

### Team-discipline substitute (in force now, no GitHub setting behind it)

Nothing below is enforced by GitHub. Every one of these is a norm the four of us agree to follow
by hand; a slip is a process failure to flag in standup, not something CI or the merge button will
catch for us.

- **Never push directly to `main`.** Always branch, always open a PR, even for a one-line doc fix.
- **Never merge your own PR until `gh pr checks <N>` (or the PR page) shows every required job green**
  — `check`, `branch-name`, `secret-scan`, `db-tests`. A red or still-running check means wait, not
  "merge now and fix forward."
- **Get the second workstream-owner review `CLAUDE.md` already asks for** on any shared-package path,
  before merging — nothing blocks a merge without it, so this is on the reviewer and the author both.
- **Never force-push `main`**, and avoid force-pushing any shared branch another PR is stacked on.
- **Don't delete a branch until its PR is merged** (or explicitly abandoned and said so).
- **Resolve PR conversations before merging**, don't leave open threads behind.
- Re-run this checklist's verification steps below by hand on the next PR as a spot-check, since
  nothing will do it automatically.

Revisit this section (and re-attempt the table above) the moment any of the three unblock conditions
changes.

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

| #   | Setting (Settings > Environments, Settings > Secrets and variables > Actions) | Recommended value                                                                                                    | Applied (date / who)                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Environment `staging`: deployment branches and tags                           | Selected branches: `main` only                                                                                       | TBD                                                                                                                                                                                  |
| D2  | Environment `staging`: secrets and variables                                  | Secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`; variable `SUPABASE_PROJECT_REF` (the staging project)       | TBD                                                                                                                                                                                  |
| D3  | Environment `production`: required reviewers                                  | Named by Afzal (CLD-01 step 2); "Prevent self-review" on                                                             | TBD                                                                                                                                                                                  |
| D4  | Environment `production`: deployment branches and tags                        | Selected tags: `v*` only                                                                                             | TBD                                                                                                                                                                                  |
| D5  | Environment `production`: secrets and variables                               | Same three names as D2, for the production project; never shared with staging                                        | TBD                                                                                                                                                                                  |
| D6  | Ruleset for tags `v*`                                                         | Restrict creation, update and deletion to the release approvers                                                      | TBD                                                                                                                                                                                  |
| D7  | Repository variable `DEPLOY_ENABLED`                                          | `true`, set last, after D1 to D6 and after the Supabase projects exist (CLD-01). Until then both deploys are skipped | Applied (27 Nov 2026, Afzal); set after D6 despite D6 itself being blocked (OQ-68) — D6's gap is about who can create a release tag, which only gates `deploy-prod.yml`, not staging |

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
