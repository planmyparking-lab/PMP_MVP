# GitHub repository settings: administrator handoff checklist

**This file does not configure anything.** The rules below are settings an administrator applies in
GitHub. Until they are applied and verified, none of them is in force. Nothing in this repository
(workflows, CODEOWNERS, templates) can enforce them by itself.

Status of each item must be recorded by the administrator in the "Applied (date / who)" column.

| #   | Setting (Settings > Rules > Rulesets, target: default branch `main`) | Recommended value                                                                                                                                       | Applied (date / who) |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | Ruleset enforcement                                                  | Active                                                                                                                                                  | TBD                  |
| 2   | Restrict deletions                                                   | On                                                                                                                                                      | TBD                  |
| 3   | Block force pushes                                                   | On                                                                                                                                                      | TBD                  |
| 4   | Require a pull request before merging                                | On (this also blocks direct pushes)                                                                                                                     | TBD                  |
| 5   | Required approvals                                                   | 1                                                                                                                                                       | TBD                  |
| 6   | Require review from Code Owners                                      | On (requires valid owners with write access)                                                                                                            | TBD                  |
| 7   | Dismiss stale approvals on new commits                               | On                                                                                                                                                      | TBD                  |
| 8   | Require approval of the most recent reviewable push                  | On (this is what prevents an author approving their own last push by proxy; GitHub already stops authors approving their own PR)                        | TBD                  |
| 9   | Require conversation resolution                                      | On                                                                                                                                                      | TBD                  |
| 10  | Require status checks                                                | Target: `check`, `branch-name`, `secret-scan`; require branches up to date. Names appear only after CI has run once. `audit` is advisory, leave it out. | TBD                  |
| 11  | Allowed merge methods                                                | Squash only (team choice)                                                                                                                               | TBD                  |
| 12  | Require linear history                                               | On if squash only                                                                                                                                       | TBD                  |
| 13  | Bypass list                                                          | Empty, or Repository admin with "For pull requests only"; revisit after the first weeks                                                                 | TBD                  |
| 14  | Automatically delete head branches (Settings > General)              | On                                                                                                                                                      | TBD                  |
| 15  | Collaborators                                                        | Each CODEOWNERS user has Write access; exact roles TBD                                                                                                  | TBD                  |

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
  anyone else. Shared paths (`packages/domain`, `supabase/migrations`) now have two owners each; for single-owner paths add a second owner or use the
  bypass setting deliberately.
