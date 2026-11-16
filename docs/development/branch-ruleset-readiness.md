# Branch ruleset readiness review

Owner: Akanksha (Member 04). Written 16 Nov 2026 against `main` at `c1236f0`.

**This file configures nothing and no setting described here has been applied.** It reviews the proposed ruleset in
[github-repository-settings.md](github-repository-settings.md) against the repository as it is, lists what would go
wrong or be awkward, and gives an ordered checklist for an administrator. Applying any team-wide setting needs the
repository owner's explicit approval after this review.

## 1. Blocker: the plan may not allow any of it

- `main` has no branch protection today (the protection API answers 404, checked 16 Nov 2026).
- Open pull request #60 (OQ-65, Afzal) reports that both Rulesets and classic branch protection return 403
  "Upgrade to GitHub Pro or make this repository public" for this private repository, also when called as the
  `planmyparking-lab` administrator. This review did not repeat those calls.
- GitHub documents environments, environment secrets and deployment protection rules for **private** repositories as
  a paid-plan feature. If that applies here, items D1 to D5 of the settings file (required reviewers on `production`,
  deployment branch and tag limits) cannot be applied either, and `deploy-prod.yml`'s `environment: production`
  "approval gate" would have no reviewers behind it. Check this on the real account **before** setting
  `DEPLOY_ENABLED`. Until D3 is verified, production deploys must stay off.

Until the plan changes (paid plan, or a public repository), the only safeguard is the team-discipline list in
pull request #60. Nothing enforces it.

## 2. Required checks: proposal against what CI really runs

CI is `.github/workflows/ci.yml`. Job names are the names a ruleset matches.

| CI job           | Runs on               | In the proposed required list (item 10) | In the production release gate (`deploy-prod.yml`) | Finding                                                                                                                                      |
| ---------------- | --------------------- | --------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `check`          | pull request and push | Yes                                     | Yes                                                | Matches.                                                                                                                                     |
| `db-tests`       | pull request and push | Yes                                     | Yes                                                | Matches.                                                                                                                                     |
| `secret-scan`    | pull request and push | Yes                                     | **No**                                             | A tagged commit can be released while `secret-scan` is red. Add `--require secret-scan` to the release gate or accept the gap on purpose.    |
| `branch-name`    | **pull request only** | Yes                                     | No (correct: it never runs on a tag)               | Fine as a required check on pull requests. It is skipped on push, so it must never be added to the release gate.                             |
| `android-bundle` | pull request and push | **No**                                  | No                                                 | A deliberate omission is not recorded anywhere. Decide: required (Gate builds must not break) or advisory (it needs more CI time and cache). |
| `audit`          | pull request and push | No (documented as advisory)             | No                                                 | Correct: new advisories can appear without a code change.                                                                                    |

Other points on checks:

- `concurrency: cancel-in-progress: true` (group `ci-<workflow>-<ref>`) cancels an older run when a newer push
  arrives. A required check that ends **cancelled** does not satisfy a ruleset, so the latest run must finish. For the
  production gate this is already documented (`deployment.md`): a commit whose CI was cancelled cannot be released.
- `secret-scan` runs gitleaks in `dir` mode, so it scans the checked-out files, not the git history. It does not catch a
  secret that was committed and later deleted.
- Check names appear in the ruleset picker only after they have run once on the default branch. All six have.

## 3. Impact on how the team works today

Evidence is the history of `main` and the open pull requests on 16 Nov 2026.

1. **"Squash only" (item 11) and "linear history" (item 12) do not match current practice.** All 42 pull request merges on `main`
   are merge commits (`Merge pull request #N`); none is a squash. The team also stacks pull requests (#51 on #50, #52 on
   #51, #35 on #34). Stacking already causes conflicts with merge commits (#52 reported `CONFLICTING` on 15 Nov while
   it carried #51's original commits). Squashing the base of a stack replaces it with one new commit, which makes that
   systematic: every pull request built on it conflicts until it is rebased. Recommendation: allow merge commits for
   now, and revisit squash only if the team stops stacking.
2. **Stacked pull requests are outside the ruleset.** A ruleset on `main` does nothing for a pull request whose base is
   another branch: pull request #35 merged into #34's branch at 10:54 UTC on 13 Nov, after #34 reached `main` at
   10:38 UTC, and its runbook and restore drill never reached `main`. Item 14 (delete head branches on merge) helps:
   GitHub then retargets open pull requests that were based on the deleted branch. Test that on a throwaway pair
   before relying on it.
3. **"Require branches up to date" (item 10) with "dismiss stale approvals" (item 7) and "approval of the most recent
   push" (item 8)** means each merge to `main` invalidates every open pull request: update, re-run CI, re-approve. With
   four people and several open pull requests this is a lot of churn, and every reviewer's approval is lost each time
   a pull request is brought up to date by merging `main`. Recommendation: switch "up to date" **off** at first, keep
   items 7 and 8 on, and turn "up to date" on only if a broken `main` actually happens.
4. **Code owner review (item 6) with one approval makes Afzal the bottleneck.** `.github/CODEOWNERS` lists him on all
   12 of its lines. Who must approve whose work:

   | Author   | Typical paths                                                                | Approver that satisfies code owners |
   | -------- | ---------------------------------------------------------------------------- | ----------------------------------- |
   | Afzal    | `packages/sync-rules/`, `packages/contracts/`, `supabase/migrations/`        | Akanksha                            |
   | Afzal    | `docs/team/`, and anything under `*` (`ops/`, `docs/development/`, `tools/`) | Nikhil                              |
   | Akanksha | `supabase/`, `scripts/`, `.github/`                                          | Afzal                               |
   | Akanksha | `ops/`, `docs/` outside `docs/team/`, `tools/` (fall under `*`)              | Afzal or Nikhil                     |
   | Anamika  | `apps/console/`                                                              | Afzal (the only other owner)        |
   | Nikhil   | `apps/gate/`, `packages/domain/`                                             | Afzal (the only other owner)        |

   Every Console and Gate pull request therefore needs Afzal. If he is away, nothing in those paths merges unless the
   bypass list (item 13) is used. Recommendation: add a second reviewer to `/apps/console/` and `/apps/gate/` (Akanksha
   is the natural cross-reviewer, as the sheets already ask for a second workstream owner on shared packages), or accept
   the bottleneck knowingly.

5. **`CLAUDE.md` asks for a second workstream owner's review on `packages/*` and `supabase/migrations`.** CODEOWNERS
   already encodes that for those paths. The ruleset's single required approval does not add a second one. If two are wanted
   on shared paths, GitHub has no per-path approval count; it needs a second reviewer norm, not a setting.
6. **Required checks are a subset of what a reviewer should see.** A green `check` includes unit tests but the Console
   and Gate behaviour is not exercised end to end. The ruleset does not change that, and reviewers should not read a
   required-check pass as a review.

## 4. Recommended values (needs the owner's approval)

Changes to the table in `github-repository-settings.md`, with the reason:

| #   | Proposed today                    | Recommended                                               | Reason                            |
| --- | --------------------------------- | --------------------------------------------------------- | --------------------------------- |
| 10  | Require branches up to date: on   | Off to start                                              | Section 3, point 3.               |
| 10  | Required: four checks             | Add `android-bundle` or record why it is advisory         | Section 2.                        |
| 11  | Squash only                       | Merge commits allowed (current practice); squash optional | Section 3, point 1.               |
| 12  | Linear history: on                | Off (it forbids merge commits)                            | Follows from item 11.             |
| 14  | Delete head branches: on          | On, after the throwaway-pair test of retargeting          | Section 3, point 2.               |
| D6  | Tag ruleset for `v*`              | Keep; same plan limit as section 1                        | Release approvers named by Afzal. |
| -   | Release gate: `check`, `db-tests` | Add `secret-scan`                                         | Section 2.                        |

## 5. Implementation checklist for an administrator

Do these in order, and record date and person in the settings file. Stop at any step that fails.

1. Confirm the account plan allows rulesets and environment protection on this repository (section 1). If not, stop
   and keep the team-discipline list from pull request #60 as the only control.
2. Decide the open points in section 4 and record them in `docs/team/open-questions-and-assumptions.md` (the decider
   is the repository owner).
3. Create a **throwaway repository** with the same `ci.yml` and CODEOWNERS and apply the planned ruleset there first.
   Run the five checks of "Verification (after applying)" and the stacked-pull-request retargeting test (section 3, point 2).
4. Apply the `main` ruleset on the real repository in the order of the settings file (items 1 to 15). Leave the bypass list
   empty or limited to the administrator account "for pull requests only" for the first weeks.
5. Create the `staging` and `production` environments (D1 to D5), the `v*` tag ruleset (D6). Verify that a run of
   `deploy-prod.yml` on a pre-release tag **waits** for approval before any job that holds a secret starts.
6. Only then set `DEPLOY_ENABLED` (D7).
7. Open a throwaway pull request and check, in this order: the required checks appear; the right code owner is requested;
   merge is blocked without approval; a direct `git push origin main` is rejected; a force push is rejected.
8. Announce the change, and re-check section 3 after two weeks of real use (merge churn, approvals lost, Afzal's queue).

## 6. What this review did not do

It did not call any GitHub settings API, apply or change any setting, or reproduce the 403 responses reported in
pull request #60. The statement about GitHub's plan limits for environments comes from GitHub's documentation and
must be confirmed on the real account.
