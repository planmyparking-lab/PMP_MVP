# Branch ruleset readiness review

Owner: Akanksha (Member 04). Written 16 Nov 2026 against `main` at `c1236f0`; updated 18 Nov 2026 after review, against
`main` at `298afa6` (the 16 Nov history counts in section 3 are unchanged).

**This file configures nothing and no setting described here has been applied.** It reviews the proposed ruleset in
[github-repository-settings.md](github-repository-settings.md) against the repository as it is, lists what would go
wrong or be awkward, and gives an ordered checklist for an administrator. Applying any team-wide setting needs the
repository owner's explicit approval after this review.

## 1. Blocker: the plan does not allow the ruleset or branch protection

- `main` has no branch protection today (the protection API answered 404 on 16 Nov and again on 18 Nov 2026, called as
  a write-level account).
- **Confirmed, no longer a possibility:** [OQ-65](../team/open-questions-and-assumptions.md) (Afzal, 16 Nov 2026, merged
  in pull request #60) records that both Rulesets and classic branch protection return 403 "Upgrade to GitHub Pro or
  make this repository public" for this private repository, both as `afzl-raza` and as the `planmyparking-lab`
  administrator. This review did not repeat the 403 calls.
- GitHub documents environments, environment secrets and deployment protection rules for **private** repositories as
  a paid-plan feature. If that applies here, items D1 to D5 of the settings file (required reviewers on `production`,
  deployment branch and tag limits) cannot be applied either, and `deploy-prod.yml`'s `environment: production`
  "approval gate" would have no reviewers behind it. Check this on the real account **before** setting
  `DEPLOY_ENABLED`. Until D3 is verified, production deploys must stay off.

Until the plan changes (paid plan, or a public repository), the only safeguard is the team-discipline list recorded
in OQ-65 and in `github-repository-settings.md`. Nothing enforces it. Everything below is what to check **if and when**
enforcement becomes possible.

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
  secret that was committed and later deleted. **Recommended fix** (owner: Akanksha, CLD-01/CLD-09, as a separate pull
  request): run gitleaks in `git` mode over the commits of the pull request (`--log-opts` with the base and head
  commits; for a push, the pushed range), which needs `fetch-depth: 0` on the checkout. Keep the `dir` scan as well, it
  catches files that were never committed to history. Neither mode helps once a secret has already reached `main`: that
  needs the key rotated (`ops/secrets-inventory.md`).
- **Do not assume all six checks are listed in the ruleset's check picker.** `branch-name` runs on pull requests only,
  so it has never run on a push to `main`. My understanding is that the picker offers checks that ran recently anywhere
  in the repository, pull request runs included, but this was not tested. Check the real picker in checklist step 4 and
  reword this section with what it shows.

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
   four people and several open pull requests this is a lot of churn, and approvals may be lost each time a pull
   request is brought up to date by merging `main`. Whether a merge of `main` into the branch (as opposed to a push of
   new changes) dismisses an approval has changed in GitHub before, so **confirm it on the throwaway repository**
   (checklist step 3) before relying on it. Recommendation: switch "up to date" **off** at first, keep
   items 7 and 8 on, and turn "up to date" on only if a broken `main` actually happens.
4. **Code owner review (item 6) with one approval makes Afzal the bottleneck.** `.github/CODEOWNERS` lists him on all
   12 of its lines. Who must approve whose work:

   | Author   | Typical paths                                                                | Approver that satisfies code owners |
   | -------- | ---------------------------------------------------------------------------- | ----------------------------------- |
   | Afzal    | `packages/sync-rules/`, `packages/contracts/`, `supabase/migrations/`        | Akanksha                            |
   | Afzal    | `docs/team/`, and anything under `*` (`ops/`, `docs/development/`, `tools/`) | Nikhil                              |
   | Akanksha | `supabase/`, `scripts/`, `.github/`                                          | Afzal                               |
   | Akanksha | `ops/`, `docs/` outside `docs/team/`, `tools/` (fall under `*`)              | Afzal or Nikhil                     |
   | Akanksha | `docs/team/` (for example an open-questions row)                             | Afzal or Nikhil                     |
   | Anamika  | `apps/console/`                                                              | Afzal (the only other owner)        |
   | Anamika  | `docs/team/` (an open-questions row added with a Console change)             | Afzal or Nikhil                     |
   | Nikhil   | `apps/gate/`, `packages/domain/`                                             | Afzal (the only other owner)        |
   | Nikhil   | `docs/team/` (an open-questions row added with a Gate change)                | Afzal (the only other owner)        |

   Every Console and Gate pull request therefore needs Afzal. If he is away, nothing in those paths merges unless the
   bypass list (item 13) is used. The bottleneck is wider than Console and Gate: many pull requests (for example #51,
   #52 and #58) also add a row to `docs/team/open-questions-and-assumptions.md`, and `/docs/team/` is owned only by
   Afzal and Nikhil. A second owner on `/apps/console/` alone would therefore not remove the need for one of them on
   such a pull request. Recommendation: add a second owner to `/apps/console/` and `/apps/gate/`, and consider one on
   `/docs/team/` as well (Akanksha is the natural cross-reviewer on Console and Gate, as the sheets already ask for a
   second workstream owner on shared packages; Akanksha or Anamika could join `/docs/team/`), or accept the bottleneck
   knowingly. This is a CODEOWNERS change and the repository owner's decision, so it should be recorded as an
   open-questions row (decider Afzal) rather than made in this document. Today Akanksha reviews Anamika's Console
   pull requests, but because she is not a code owner of `/apps/console/`, her approval would not count once item 6
   is on.

5. **`CLAUDE.md` asks for a second workstream owner's review on `packages/*` and `supabase/migrations`.** CODEOWNERS
   already encodes that for those paths. The ruleset's single required approval does not add a second one. If two are wanted
   on shared paths, GitHub has no per-path approval count; it needs a second reviewer norm, not a setting.
6. **Required checks are a subset of what a reviewer should see.** A green `check` includes unit tests but the Console
   and Gate behaviour is not exercised end to end. The ruleset does not change that, and reviewers should not read a
   required-check pass as a review.

## 4. Recommended values (needs the owner's approval)

Changes to the table in `github-repository-settings.md`, with the reason:

| #   | Proposed today                    | Recommended                                                                           | Reason                                                                  |
| --- | --------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 10  | Require branches up to date: on   | Off to start                                                                          | Section 3, point 3.                                                     |
| 10  | Required: four checks             | Add `android-bundle` or record why it is advisory                                     | Section 2.                                                              |
| 6   | Code owner review: on             | On, with a second owner on `/apps/console/`, `/apps/gate/` and possibly `/docs/team/` | Section 3, point 4 (owner's decision, record as an open-questions row). |
| 11  | Squash only                       | Merge commits allowed (current practice); squash optional                             | Section 3, point 1.                                                     |
| 12  | Linear history: on                | Off (it forbids merge commits)                                                        | Follows from item 11.                                                   |
| 14  | Delete head branches: on          | On, after the throwaway-pair test of retargeting                                      | Section 3, point 2.                                                     |
| D6  | Tag ruleset for `v*`              | Keep; same plan limit as section 1                                                    | Release approvers named by Afzal.                                       |
| -   | Release gate: `check`, `db-tests` | Add `secret-scan`                                                                     | Section 2.                                                              |
| -   | `secret-scan` (dir mode only)     | Add a git-mode scan of the pull request's commits                                     | Section 2 (owner: Akanksha).                                            |

## 5. Implementation checklist for an administrator

Do these in order, and record date and person in the settings file. Stop at any step that fails.

1. Confirm the account plan allows rulesets and environment protection on this repository (section 1; today OQ-65
   says it does not). If not, stop and keep the team-discipline list from OQ-65 as the only control.
2. Decide the open points in section 4 and record them in `docs/team/open-questions-and-assumptions.md` (the decider
   is the repository owner).
3. Create a **throwaway repository** with the same `ci.yml` and CODEOWNERS and apply the planned ruleset there first.
   Run the five checks of "Verification (after applying)", the stacked-pull-request retargeting test (section 3, point 2),
   and a test that merging `main` into a pull request branch does or does not dismiss its approval (section 3, point 3).
4. Apply the `main` ruleset on the real repository in the order of the settings file (items 1 to 15). Leave the bypass list
   empty or limited to the administrator account "for pull requests only" for the first weeks.
5. Create the `staging` and `production` environments (D1 to D5), the `v*` tag ruleset (D6). Verify that a run of
   `deploy-prod.yml` on a pre-release tag **waits** for approval before any job that holds a secret starts.
6. Only then set `DEPLOY_ENABLED` (D7).
7. Open a throwaway pull request and check, in this order: the required checks appear; the right code owner is requested;
   merge is blocked without approval; a direct `git push origin main` is rejected; a force push is rejected.
8. Announce the change, and re-check section 3 after two weeks of real use (merge churn, approvals lost, Afzal's queue).

## 6. What this review did not do

It did not apply or change any GitHub setting or reproduce the 403 responses recorded in OQ-65. Its only API call was a
read of the branch-protection endpoint on 18 Nov 2026 (404). The statement about GitHub's plan limits for environments comes from GitHub's documentation and
must be confirmed on the real account.
