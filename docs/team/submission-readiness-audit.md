# Submission readiness audit: `feature/pmp-submission-completion`

Prepared 12 Nov 2026 by Akanksha (Member 04). Read-only audit: the audited branch was not changed. Evidence is cited as
commit hashes, pull request numbers, file paths and test output. Statements about other members' work describe the
repository and GitHub state only.

## 1. Executive summary

`feature/pmp-submission-completion` (`c89c50f`, pushed, no pull request) is an **integration branch**: `main` at
`2faf3ec` plus PR #31, PR #32 and the CLD-05, CLD-03 and CLD-10 work. Almost all of its content is already proposed in
open pull requests #31 to #35, which are the review path for that work. Only three small documentation changes exist
nowhere else.

**Assessment: not ready to submit as a pull request, and it should not be merged.** Opening it would duplicate PRs
#31 to #35 for reviewers. The work it integrates tests well locally, but the team-level blockers below are outside
this branch: an undecided ingest-validation fix (`event_parity` fails 10 of 37 on `main`), no SQL tests in CI, no CI
at all on the stacked PRs #33 to #35, and outstanding review approvals.

## 2. Scope and methodology

| Compared                    | How                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Latest `main`               | `origin/main` = GitHub `main` = `2faf3ec` (checked through the GitHub API, no fetch needed).            |
| Open pull requests          | #20, #26, #27, #28, #30, #31, #32, #33, #34, #35: head commits, review decisions, CI check runs.        |
| Commit-level duplication    | `git patch-id --stable` of every non-merge commit on the branch against every commit in each open PR.   |
| Content-level duplication   | `git diff` between the branch and the top of the stacked PRs (#35), plus PR #32's file list.            |
| Deliverables                | `docs/team/member-04-akanksha.md` section I.1 (required deliverables) and the 46 features in            |
|                             | `docs/team/feature-traceability.md` (updated the same day on `docs/feature-traceability-member-04`).    |
| Decisions                   | `docs/team/open-questions-and-assumptions.md` (reconciled the same day on                              |
|                             | `docs/oq-register-reconciliation-member-04`).                                                          |
| Tests                       | Results of runs on the branch head `c89c50f` on 12 Nov 2026 (local Supabase stack, Docker); not CI.     |

Limit: the repository contains no separate course or client "submission" specification. Readiness is judged
against the member sheet's required deliverables and the team's own merge rules (`CLAUDE.md`).

## 3. What the branch contains, and where each part already lives

| Branch commit | Content                                                                 | Also in                          |
| ------------- | ----------------------------------------------------------------------- | -------------------------------- |
| `4eaf088`, `ee77f8a` | `0007`, `0008` and their tests (CLD-02, CLD-04)                  | PR #31 (same commits)            |
| `0acaeaa`, `380dd54` | Client bundle secret check; node-forge 1.4.3 (CLD-01)            | PR #32 (same commits)            |
| `0d62a27`     | `events_schema.test.sql` header notes aligned with the merged contract  | **Nowhere else**                 |
| `a22a4dc`     | `supabase/README.md` rewritten against the real migrations              | **Nowhere else** (see `c89c50f`) |
| `4928e6d`, `6abf47a` | Local restore drill, runbook, alert catalog, restore log (CLD-10) | PR #35 (`e9c69a8`, `a479b77`, same patches) |
| `9ff3e86`, `ddef674`, `d4ee25a` | KPI views, oracle and golden-day tests (CLD-05)       | PR #33 (`5f21c80`, `a9431e7`, `45c7352`, `43606cd`; same files, differing only in table padding and the `OQ-A7` references below) |
| `dcfd4a0`     | `0010_rls.sql` and RLS tests (CLD-03)                                   | PR #34 (`678bd1d`, same patch)   |
| `c89c50f`     | README for `0007`-`0010`; `OQ-A7` references replaced by SYNC-04 (PR #28) in `0009_views_kpis.sql`, `kpi_views.test.sql`, `docs/integrations/cld-05-kpi-views.md` | **Nowhere else** |
| merges        | PR #31 and PR #32 merged locally                                         | —                                |

The remaining 19 files that differ from PR #35 (Console files, `docs/development/dependency-security.md`, lockfile)
come from `main` (PR #29): the branch starts at `2faf3ec`, the stacked PRs at the older `ce170f7`.

## 4. Completed work (on `main`, CI green at `2faf3ec`)

Summarised from `feature-traceability.md`: contracts (SYNC-01), outbox and ingest (SYNC-02, without SQL payload
validation), conflict detector (SYNC-05), fare engine (GATE-03), Console sign-in (CON-03), the gate app on a labelled
fake data layer (GATE-01 to GATE-12), Console screens that read live tables (CON-01 to CON-11, partial), migrations
`0001`-`0006` with pgTAP tests, the test runner and forward rehearsal, the secrets inventory and secret scan, and CI
(`secret-scan`, `check`, `android-bundle`, `branch-name`, `audit`).

Member 04 work in open pull requests: CLD-01 bundle check (#32), `0007`/`0008` (#31), KPI views (#33), RLS (#34),
local restore drill and runbooks (#35), strict ingest validation (#30).

## 5. Test evidence for the branch (12 Nov 2026, head `c89c50f`, local)

| Check                                      | Result                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `pnpm test:db` (local Supabase, rolled back) | 13 of 14 suites pass, including `rls_policies` 100/100, `rls_sync_tables` 40/40, `open_sessions` 27/27, `kpi_views` 37/37, `kpi_oracle` 25/25, `kpi_golden_day` 5/5, `device_heartbeats` 48/48, `shift_reviews_conflict_resolutions` 56/56. **`event_parity` fails 10 of 37** (the `0004` gap, also on `main`). State unchanged afterwards. |
| `pnpm rehearse:forward`                    | Passed (synthetic-row count preservation).                                                    |
| `pnpm test:restore`                        | 7/7; drill 19 tables, 2979 rows, 40 policies, 3 views, MATCH.                                 |
| `pnpm test:scripts`                        | 103/103.                                                                                      |
| Repo, migration lint, format, lint, typecheck | Pass.                                                                                      |
| Console tests, build, bundle check         | 238/238; build succeeds; `check:bundles console` OK.                                          |
| Gate tests                                 | 237/238 under the parallel `pnpm test`: one 10,000-iteration test exceeds its 5 s timeout on this machine. The same failure reproduces on a `main`-based worktree; the file passes alone (34/34) and in GitHub CI. Not caused by this branch. |
| GitHub CI on the branch                    | **None**: no pull request exists, and CI runs only for pull requests into `main`.              |

## 6. Missing work

Required deliverables (member sheet I.1) not present on `main` or in any open pull request:

| Deliverable                                         | State                                     | Why                                                         |
| --------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| Three configured environments                       | Not done                                  | Needs Supabase and GitHub administrator access (CLD-01).    |
| Generated types (`packages/db-types`)               | Not done                                  | Waits for the migration chain to settle (#31, #33, #34, IC-01 decision). |
| `enroll_device` and the console write functions     | Not done                                  | IC-05 and IC-06 contracts not agreed (enrollment shape, PIN hashing). |
| `0011` (scheduler, alerts, retention, export)       | Not done                                  | OQ-12 (legal), OQ-46 default threshold, OQ-47, OQ-48; the number itself is unassigned. |
| Deployment pipelines                                | Not done on `main`                        | CLD-09 deploy workflows; prepared separately on `feat/cld-09-deployment-workflows-member-04`. They cannot deploy until CLD-01 exists. |
| k6 load script (`tools/load/`)                      | Not done                                  | Needs a staging project and device enrollment.              |
| RLS matrix document, DPDP procedure, known-limitations list | Not done                          | RLS choices are recorded as OQ-58 (#34); DPDP waits on OQ-12. |
| Test evidence linked from `feature-traceability.md` | Done on `docs/feature-traceability-member-04` | Not merged.                                              |

## 7. Duplicate and overlapping work

1. **The branch duplicates PRs #31 to #35.** Every functional change in it is under review there. A pull request from
   this branch would present the same SQL to reviewers twice, and merging both paths would create conflicting
   histories (cherry-picked copies of #33's commits have different hashes).
2. **Copies inside the PR stack.** Anamika's review of #33 (12 Nov) flagged that #31's `0007`/`0008` were copied into
   it; #33 now targets #31's branch, which resolves the copy if the stack is merged in order (#31, #33, #34, #35).
3. **IC-01 is implemented twice**, in PR #26 (edits merged `0004`) and PR #30 (forward migration). Only one can merge.
4. **SQL CI**: PR #27 is the team's SQL test job; the branch rightly adds no second job.

## 8. Incorrect or stale documentation found

| Where                                                  | Problem                                                                    | Fixed where                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------- |
| `docs/team/feature-traceability.md` on `main`          | Says the repository contains no code.                                       | `docs/feature-traceability-member-04` |
| `docs/team/open-questions-and-assumptions.md` on `main` | "Established facts" says no code; OQ-49 calls merged PR #23 unmerged; OQ-42 predates the merged `recorded_at`. | `docs/oq-register-reconciliation-member-04` (recorded, row text unchanged) |
| `supabase/README.md` on `main` and in PRs #31 to #35   | Says `migrations/` does not exist and the stack is not run in CI.          | Only on this branch (`a22a4dc`, `c89c50f`) |
| `supabase/tests/events_schema.test.sql` on `main` and in the PRs | Header calls `0003` proposed and the contract not updated.      | Only on this branch (`0d62a27`)    |
| PR #33 to #35: `0009_views_kpis.sql`, `kpi_views.test.sql`, `docs/integrations/cld-05-kpi-views.md` | Cite `OQ-A7`, an id that exists in no committed register. | Only on this branch (`c89c50f`)    |
| IC-07 `v_hourly` column shape                         | Listed as unsettled in `docs/integrations/ic-07-console-requirements.md`; Anamika accepted `local_date`, `hour` in her PR #33 review (12 Nov), but no document records it yet. | Not recorded anywhere yet |

## 9. Risks and blockers

| #  | Blocker or risk                                                                                       | Owner                     |
| -- | ----------------------------------------------------------------------------------------------------- | ------------------------- |
| B1 | IC-01: choose PR #26 or PR #30. Until then `event_parity` fails 10 of 37 on `main` and on every branch. | Afzal, with Akanksha       |
| B2 | No SQL tests in CI (PR #27 is red: its `db-tests` hits B1, its `check` fails Prettier, and it conflicts with `main`). | Afzal                      |
| B3 | Stacked PRs #33, #34, #35 have **no CI runs**: `ci.yml` triggers only on pull requests into `main`. | Akanksha                   |
| B4 | Approvals: #31 has a stale changes-requested review (the fix `ee77f8a` is pushed); #33 has changes requested (Anamika); `0010` needs Afzal's permission review (OQ-58). | Afzal, Anamika             |
| B5 | `v_zone_now` and the occupancy parity test wait on PR #28's baseline rule.                           | Afzal                      |
| B6 | Hosted environments, secrets, backups, monitoring (CLD-01, CLD-10) need administrator accounts.      | Repository administrator, Afzal |
| R1 | The gate test timeout above can fail a local `pnpm check` on a loaded machine.                       | Nikhil                     |

## 10. Prioritised recommendations

1. **Do not open a pull request from `feature/pmp-submission-completion`**, and do not merge it. Keep it as the record
   that the integrated stack applies and passes locally.
2. Move its three unique changes into reviewable pull requests from `main`: the `events_schema.test.sql` notes
   (`0d62a27`), the `supabase/README.md` update (`a22a4dc`, `c89c50f`, rebased so the README describes only what is
   merged at that time), and the `OQ-A7` reference fix (`c89c50f`), the last one into the relevant stacked PR.
3. Get CI onto the stacked PRs: retarget each to `main` once the PR below it merges, or merge the stack in order
   #31 → #33 → #34 → #35 so each is retargeted to `main` in turn (B3).
4. Ask Afzal for the IC-01 decision (B1) and for re-review of #31 and the `0010` permission choices (B4, OQ-58).
5. Record Anamika's acceptance of the `v_hourly` columns in the IC-07 document or the register.
6. Merge the documentation branches `docs/feature-traceability-member-04` and `docs/oq-register-reconciliation-member-04`.

## 11. Final assessment

| Question                                               | Answer                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Does the integrated work apply and pass locally?       | Yes, except the pre-existing `event_parity` gap (B1).                   |
| Is it verified in CI?                                  | No (B2, B3).                                                           |
| Is the branch itself the right vehicle for submission? | No: the reviewable path is PRs #31 to #35; this branch duplicates them. |
| Are member 04's required deliverables complete?        | No: see section 6. Several are blocked on decisions or accounts.        |
| **Overall**                                            | **Not submission-ready.** Ready for review, pending B1 to B4.            |
