# Feature Traceability Matrix

Prepared 24 Oct 2026. **Updated 12 Nov 2026 by Akanksha (Member 04)** against `main` at `2faf3ec` (merge of PR #29) and
the open pull requests as they stood that day. Companion to [README.md](README.md). Chain: product requirement → feature
ID → owner → implementation location → acceptance criteria → test cases → verification status.

## 0. How to read this matrix

The 24 Oct version said the repository contained no code. That is no longer true. Each row now records what actually
exists, with file paths and test evidence. A feature's acceptance criteria and specified tests (the `T-<ID>-*` counts)
are still those in the owner's sheet (sections B and E); a specified test is not the same as a test file that exists.

**Status** (one per row):

| Status                      | Meaning                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Merged                      | The implementation named in the row is on `main`. It may still miss parts of the spec; the row says which.       |
| Merged (partial)            | Some of the feature is on `main`; named parts are missing or exist only in an open PR.                           |
| Open PR                     | The implementation exists only in an open pull request. It is **not** on `main` and must not be counted as done. |
| Partial (dev runtime)       | Screens and logic are on `main` but run on a labelled fake data layer until the sync client exists.              |
| Templates only              | Blank sheets, calculators or documents exist; the activity itself (fieldwork, pilot) has not happened.           |
| Not implemented             | Nothing in the repository or in an open PR.                                                                      |
| Blocked                     | Not implemented, and waiting on a named decision, external setup or another feature.                             |
| Outside the repository      | The deliverable is not code (for example a partner agreement); nothing here can verify it.                       |

**Verification** (what evidence exists, never more):

- **CI**: covered by tests that GitHub Actions ran and passed on `main` at `2faf3ec` (`check` runs every package's
  unit tests and the Console build; `android-bundle` resolves the gate app bundle). CI runs **no SQL tests** on `main`.
- **Local SQL**: pgTAP suites run with `pnpm test:db` against the local Supabase stack (Docker) on 12 Nov 2026, in a
  rolled-back transaction. Not repeatable from CI until PR #27 merges.
- **Not verified**: no test evidence, or the evidence covers only part of the acceptance criteria. No row is verified
  against a hosted environment, a real device or real pilot data: none of those exists yet.

Evidence for the counts below: CI run on `2faf3ec` (`check`, `android-bundle`, `secret-scan`, `audit` all passed):
`packages/contracts` 78 tests, `packages/sync-rules` 21, `packages/domain` 109, `apps/gate` 238, `apps/console` 238.
Local SQL on `main` (12 Nov 2026): `base_schema` 53/53, `events_schema` 71/71, `ingest_events` 36/36, `conflicts` 28/28,
`open_sessions` 26/27 (1 TODO blocked on CLD-03), `event_parity` 27/37 (10 failing, see SYNC-01 and SYNC-02).

## 1. Matrix

| Requirement source | Feature ID | Feature | Owner | Status | Implementation on `main` | Open PR or branch | Test evidence | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Handbook shared contracts; PRD FR-04, FR-55 (event record) | SYNC-01 | Contracts package | Afzal | Merged | `packages/contracts/src/{events,money,uuid,version,reasonCodes,tariffs}.ts` (PR #8, #12, #13) | #20 (OQ-42 docs follow-up) | 4 unit files (78 tests); SQL/zod parity `supabase/tests/event_parity.test.sql` (T-IC01-C1) | CI (unit). Parity: Local SQL fails 10 of 37, because `0004` does not validate payload values |
| P0-12; PRD FR-44, FR-45 | SYNC-02 | Outbox and idempotent ingest | Afzal | Merged (partial) | `packages/sync-rules/src/{outbox,backoff,ingestResponse}.ts` (PR #18); `supabase/migrations/0004_ingest_events.sql` (PR #15); `0005_open_sessions.sql` (PR #16). The sheet's `connector.ts` and `0004_events_ingest.sql` names were not used | #26 and #30: two competing fixes for SQL payload validation (team decision pending; tracked as OQ-52 in #30) | `sync-rules` 21 unit tests; `ingest_events.test.sql`, `open_sessions.test.sql`, `scripts/test-db-concurrency.mjs` | CI (unit); Local SQL. Payload validation in SQL is missing on `main` |
| P0-12; PRD FR-44 | SYNC-03 | Download sync | Afzal | Not implemented | No pull endpoint or download client | — | — | Not verified |
| P0-4; PRD FR-09 | SYNC-04 | Occupancy computation | Afzal | Open PR | — | #28 (changes requested: baseline and exit rule) | Tests exist only in #28 | Not verified on `main` |
| P0-12; PRD FR-46, FR-22 (partial) | SYNC-05 | Conflict detection | Afzal | Merged | `supabase/migrations/0006_conflict_detector.sql` (PR #17). No TypeScript `conflicts.ts`; detection is in SQL | — | `conflicts.test.sql`, `scripts/test-db-concurrency.mjs` | Local SQL |
| P0-12; PRD FR-47, FR-42 (partial) | SYNC-06 | Sync health, heartbeat sender, quarantine | Afzal | Open PR (15 Nov 2026 update) | Quarantine after repeated rejection (`outbox.ts`, PR #18, merged). `health.ts` (`composeHealth`, `readHealth`, `listQuarantined`) and `heartbeat.ts` (`HeartbeatSender`, the 5-minute rate limit, battery-null handling) now written against `heartbeat()` (CLD-04, merged via #31). Not yet wired into the gate app shell (`FakeSync` is still the only client the screens use, same as every other GATE-* row); `quarantined()` is an optional `OutboxStore` member with no implementation yet (OQ-66, Nikhil's). Banner derivation (`deriveBanners.ts`) and the diagnostics blob (`diag.ts`) stay on the gate side by design, not duplicated here (see this PR's README note) | This PR (not yet merged) | `health.test.ts`, `heartbeat.test.ts` (19 new tests); `outbox.test.ts` | CI (unit, 98/98 in the package) |
| P0-12 evidence; PRD 9.6 offline target | SYNC-07 | Simulation harness | Afzal | Not implemented | No `tools/sim/` | — | — | Not verified |
| Handbook; PRD 11.2 DevOps (simplified) | REL-01 | Monorepo, rules, release | Afzal | Merged (partial) | pnpm monorepo, `CLAUDE.md`, `.github/CODEOWNERS`, `scripts/check-branch-name.mjs`, `docs/development/github-repository-settings.md` (PR #1, #4). No `docs/release.md`; the branch ruleset is documented but recorded as not applied | #27 (second CODEOWNERS owner per path) | `branch-name` CI job | Not verified (ruleset not applied) |
| Phase 2 plan section 8, E7 | PRT-01 | Partner pipeline and pilot agreements | Afzal | Outside the repository | — | — | — | Not verified |
| P0-2; PRD FR-02, FR-04, FR-06 (FR-01 ANPR excluded) | GATE-01 | Vehicle entry | Nikhil | Partial (dev runtime) | `apps/gate/app/entry.tsx`, `src/domain/{entryFlow,token,suggestZone}.ts`, `src/data/writeEvent.ts` (PR #7) | — | `apps/gate/test/{domain,flow,data}.test.ts` | CI (unit). Not on a device; no real sync |
| P0-3; PRD FR-16 | GATE-02 | Vehicle exit, lost token | Nikhil | Partial (dev runtime) | `apps/gate/app/exit.tsx`, `src/domain/{exitFlow,findOpenSession}.ts` (PR #7) | — | `apps/gate/test/{flow,domain}.test.ts` | CI (unit) |
| P0-3; PRD FR-16, FR-20 (time tiers only) | GATE-03 | Fare engine | Nikhil | Merged | `packages/domain/src/{fare,explainFare}.ts` (PR #6, #13) | — | `packages/domain/test/fare.test.ts` (109 tests) | CI |
| P0-3; PRD FR-17 (recorded, not processed) | GATE-04 | Payment recording, UPI attestation | Nikhil | Partial (dev runtime) | `apps/gate/src/domain/{paymentRules,paise}.ts` (PR #7) | — | `apps/gate/test/{rules,paise}.test.ts` | CI (unit) |
| P0-5; PRD FR-51 (partial) | GATE-05 | Monthly pass validation | Nikhil | Partial (dev runtime) | `apps/gate/app/pass.tsx`, `src/domain/pass.ts` (PR #7) | — | `apps/gate/test/rules.test.ts` | CI (unit) |
| P0-6; PRD FR-21 | GATE-06 | Shift open and close (guard) | Nikhil | Partial (dev runtime) | `apps/gate/app/shift/{open,close}.tsx`, `src/domain/shiftTotals.ts` (PR #7) | — | `apps/gate/test/flow.test.ts` | CI (unit) |
| P0-7; PRD FR-06, FR-30 | GATE-07 | Override flow | Nikhil | Partial (dev runtime) | `apps/gate/app/override.tsx`, `src/domain/override.ts` (PR #7) | — | `apps/gate/test/flow.test.ts` | CI (unit) |
| P0-4; Phase 2 plan drift correction | GATE-08 | Zone count entry | Nikhil | Partial (dev runtime) | `apps/gate/app/zone-count.tsx`, `src/domain/zoneCount.ts` (PR #7) | — | `apps/gate/test/domain.test.ts` | CI (unit). Count limit undecided (OQ-43) |
| P0-11; PRD FR-48, 11.1 offline auth | GATE-09 | PIN login, offline auth, enrollment | Nikhil | Partial (dev runtime) | `apps/gate/app/(auth)/{login,enroll}.tsx`, `src/auth/{pinSession,lockout,secureIdentity,submissionGuard}.ts` (PR #7). PIN hashes are not verified on the device (IC-06 hashing scheme not agreed) | Server side (`enroll_device`, CLD-03) not written | `apps/gate/test/{auth,pinsession,secureidentity,lockoutStorage}.test.ts` | CI (unit) |
| P0-2; PRD FR-02 | GATE-10 | Printer, QR, fallback | Nikhil | Partial (dev runtime) | `apps/gate/src/print/{escpos,printMachine,printer,qr}.ts`, `app/settings/printer.tsx` (PR #7) | — | `apps/gate/test/{print,printmachine,qr}.test.ts` | CI (unit). No physical printer test |
| Handbook; PRD 9.5 graceful degradation | GATE-11 | Paper backfill | Nikhil | Partial (dev runtime) | `apps/gate/app/backfill.tsx`, `src/domain/backfill.ts` (PR #7); validation only | — | `apps/gate/test/backfill.test.ts` | CI (unit) |
| Handbook; Phase 2 plan Hindi and English | GATE-12 | App shell, i18n, diagnostics | Nikhil | Partial (dev runtime) | `apps/gate/app/{_layout,index,status}.tsx`, `src/i18n/*`, `src/syncGate.ts` (PR #7). The status screen reports "never synced" truthfully | — | `apps/gate/test/{i18n,i18nconfig,diag,syncGate,errorboundary}.test.ts`; `android-bundle` CI job | CI (unit, bundle resolves) |
| P0-1; PRD FR-49 | CON-01 | Setup wizard, tariff editor | Anamika | Merged (partial) | `apps/console/app/setup` (save: `app/setup/actions.ts`), `src/lib/{setupDraft,setupSave,tariffRules,fareTryIt}.ts` (PR #10, #14, #21). "Save to this facility" writes zones and new tariff versions to the selected facility (rules OQ-67). No new-facility creation, draft table, activation or overstay storage | Activation and the draft table need Akanksha's tables; overstay storage is CON-09 | `apps/console/test/{setupDraft,setupSave,consoleLogic}.test.ts` | CI (unit); save runs end to end on a local stack (owner, manager, repeat save) |
| P0-11; PRD FR-27, FR-48, FR-53 (blocklist excluded) | CON-02 | Staff, devices, roles, site switcher | Anamika | Merged (partial) | `apps/console/app/devices` (revoke a phone, deactivate a guard: `app/devices/actions.ts`), `src/lib/{permissions,pinPolicy,deviceHealth,credentialActions}.ts` | Writes need the #34 policies; adding a guard or phone and reactivating need `set_staff_pin`, `create_enrollment_code` (not written) | `apps/console/test/{lib,liveData,credentialAndNotes}.test.ts` | CI (unit); revoke and deactivate run end to end on a local stack with #34 applied |
| P0-11; PRD FR-48 | CON-03 | Console login and session | Anamika | Merged | `apps/console/app/login`, `src/lib/{session,safeRedirect}.ts`, `src/lib/supabase/*` (PR #24, #25) | — | `apps/console/test/{lib,menuEscape}.test.ts` | CI (unit). Live data needs RLS (CLD-03, OQ-50) |
| P0-4; PRD FR-23 | CON-04 | Occupancy board | Anamika | Merged (partial) | `apps/console/app/occupancy`, `src/lib/{occupancyBand,openSessions}.ts`; counts `open_sessions` rows until `v_zone_now` exists (OQ-50) | — | `apps/console/test/{openSessions,liveData}.test.ts` | CI (unit) |
| P0-8; PRD FR-23, FR-24, FR-25 | CON-05 | Dashboard | Anamika | Merged (partial) | `apps/console/app/page.tsx`, `src/lib/kpi.ts`; reads tables directly until the KPI views exist on `main` | KPI views in #33 | `apps/console/test/{consoleLogic,liveData}.test.ts` | CI (unit) |
| P0-6; PRD FR-21 | CON-06 | Shift review and sign-off | Anamika | Merged (partial) | `apps/console/app/shifts`, `src/lib/shifts.ts`, `src/lib/data/shifts.ts` (PR #29); read only, built from events (OQ-51) | Sign-off table `shift_reviews` in #31 | `apps/console/test/shiftsAndOverstay.test.ts` | CI (unit) |
| P0-12; PRD FR-46 | CON-07 | Conflicts inbox | Anamika | Merged (partial) | `apps/console/app/conflicts` (Add note: `app/conflicts/actions.ts`), `src/lib/{conflicts,conflictNotes}.ts`; Keep first, Keep second and Mark as test disabled until `resolve_conflict` and OQ-49 | Notes need the #34 policies; deciding needs `resolve_conflict` | `apps/console/test/{conflicts,conflictsView,credentialAndNotes}.test.ts` | CI (unit); Add note runs end to end on a local stack with #34 applied |
| P0-9; PRD FR-24, FR-25, FR-26, FR-28 | CON-08 | Report templates and render route | Anamika | Merged (partial) | `apps/console/app/api/reports/[type]/route.ts`, `src/lib/reports/*` (PR #3); answers 501 for real data until the KPI views exist (OQ-40) | KPI views in #33 | `apps/console/test/{reportRoute,reportModel,reportTemplates,reportParams,reportPeriod,demoReport}.test.ts` | CI (unit). No real PDF rendered on a host (OQ-40) |
| P0-10 (Phase 2 plan; no PRD FR) | CON-09 | Overstay list and settings | Anamika | Merged (partial) | `apps/console/app/overstay`, `src/lib/{overstay,overstayList,csv}.ts` (PR #23, #29); the threshold is not stored (OQ-46 default undecided) | — | `apps/console/test/{overstay,shiftsAndOverstay,reviewFollowups29}.test.ts` | CI (unit) |
| Handbook; PRD FR-50 (partial) | CON-10 | Pilot health page | Anamika | Merged (partial) | Health rules in `apps/console/src/lib/deviceHealth.ts`; no heartbeat data on `main` | `device_heartbeats` in #31 | `apps/console/test/lib.test.ts` | CI (unit) |
| Handbook; Phase 2 plan clickable prototype | CON-11 | Seed data and demo | Anamika | Merged (partial) | Labelled demo report data `apps/console/src/lib/reports/demoData.ts`. No `supabase/seed.sql` | — | `apps/console/test/demoReport.test.ts` | CI (unit, demo report only) |
| Phase 2 plan E1, E2 | CON-12 | Baseline study and ROI | Anamika | Templates only | `field/cons12/` (sheets, `roi.mjs`, `roi-statement.md`); no fieldwork done | — | `field/cons12/roi.test.mjs`, run in CI by `pnpm test:pilot` (`check` job) | Not verified |
| Handbook; PRD 9.9 | CLD-01 | Environments and secrets | Akanksha | Merged (partial) | `ops/secrets-inventory.md`, `secret-scan` (gitleaks) job in `.github/workflows/ci.yml`, `.env.example` (PR #9). No Supabase projects or GitHub environments exist | #32 (service-role key kept out of client bundles, T-CLD-01-N1) | `secret-scan` CI job; #32 adds `scripts/check-client-bundles.test.mjs` | CI (secret scan). T-CLD-01-I1, X1 blocked on hosted projects |
| Handbook; PRD ch.8 data needs | CLD-02 | Schema migrations | Akanksha | Merged (partial) | `supabase/migrations/0001..0003` (PR #5); test runner and forward rehearsal `scripts/{test-db,rehearse-forward,check-migrations}.mjs` (PR #5, #19). No generated types package | `0007`, `0008` in #31; `0009` in #33; `0010` in #34 | `base_schema.test.sql`, `events_schema.test.sql`; `scripts/*.test.mjs` (87 tests in `pnpm test:scripts`) | CI (script tests, migration lint); Local SQL |
| P0-11; PRD FR-48, 9.3 security, 9.4 multi-tenant | CLD-03 | RLS, device auth, enroll_device | Akanksha | Open PR | RLS is enabled on every table with no policy, so every non-superuser role is denied | #34 (`0010_rls.sql`, policies for every table; fail-closed choices recorded as assumption OQ-58 in #34). `enroll_device` not written (IC-05 not agreed) | `rls_policies.test.sql`, `rls_sync_tables.test.sql` in #34 | Not verified on `main`. Local SQL on the integrated branch only |
| Handbook; PRD FR-42, FR-50 (partial) | CLD-04 | Heartbeat | Akanksha | Open PR | — | #31 (`0008_device_heartbeats.sql`) | `device_heartbeats.test.sql` in #31 | Not verified on `main`. Reviewer ran it locally (48/48) |
| P0-8; PRD FR-24, FR-25 | CLD-05 | KPI views | Akanksha | Open PR | — | #33 (`0009_views_kpis.sql`: `v_daily_kpis`, `v_hourly`; WAIVED excluded from every revenue total). `v_zone_now` not written (waits on SYNC-04, #28) | `kpi_views.test.sql`, `kpi_oracle.test.sql`, `kpi_golden_day.test.sql` in #33 | Not verified on `main`. Performance target open (OQ-56 in #33) |
| P0-9; PRD FR-28 | CLD-06 | Report scheduler and email | Anamika | Not implemented | No `pg_cron` job, storage bucket or Resend integration. The render route it would call is CON-08 | — | — | Not verified |
| P0-10; PRD FR-29 (partial), FR-42 (partial) | CLD-07 | Overstay and stale-device alerts | Akanksha | Blocked | — | — | — | Blocked: default threshold (OQ-46), opening hours (OQ-47), delivery contract (OQ-48), migration number |
| PRD FR-56, 15.1 legal risk | CLD-08 | Retention, export, delete | Akanksha | Blocked | — | — | — | Blocked: legal review of retention (OQ-12) |
| Handbook; PRD 11.2 DevOps (simplified) | CLD-09 | CI/CD | Akanksha | Merged (partial) | `.github/workflows/ci.yml`: `secret-scan`, `check`, `android-bundle`, `branch-name`, `audit` (PR #1, #9). No SQL job, no deploy workflows | #27 (SQL tests in CI, `db-tests`) | CI runs on every PR and push to `main` | CI. Staging and production deploys not implemented (no hosted projects, CLD-01) |
| PRD 9.2, 9.7 | CLD-10 | Monitoring, backups, restore drill | Akanksha | Open PR | — | #35 (local restore drill `tools/restore/*`, `ops/runbook.md`, `ops/alerts.md`, `ops/restore-log.md`) | `tools/restore/restore_drill.test.mjs` (`pnpm test:restore`) in #35 | Not verified on `main`. Sentry, uptime, backups and the production drill need accounts (OQ-07) |
| Phase 2 plan E3 | MET-01 | Physical occupancy audits | Anamika | Templates only | `ops/metrics/audit-sheet.csv`, `ops/metrics/pilot-metrics.mjs` | — | `ops/metrics/pilot-metrics.test.mjs`, run in CI by `pnpm test:pilot` (`check` job) | Not verified (no pilot) |
| Phase 2 plan E4 | MET-02 | Adherence checks | Anamika | Templates only | `ops/metrics/adherence-sheet.csv`, `ops/metrics/adherence.sql` | — | As MET-01 | Not verified (no pilot) |
| Phase 2 plan metrics section | MET-03 | Weekly metrics pack | Anamika | Templates only | `ops/metrics/weekly-pack.md`, `ops/metrics/weekly.sql` | — | As MET-01 | Not verified (no pilot) |

Total specified test cases (owner sheets): **422**. Features: **46**.

Status count (46): Merged 4 (SYNC-01, SYNC-05, GATE-03, CON-03); Merged (partial) 16; Partial (dev runtime) 11 (GATE-01,
GATE-02, GATE-04 to GATE-12); Open PR 5 (SYNC-04, CLD-03, CLD-04, CLD-05, CLD-10); Templates only 4 (CON-12, MET-01 to
MET-03); Not implemented 3 (SYNC-03, SYNC-07, CLD-06); Blocked 2 (CLD-07, CLD-08); Outside the repository 1 (PRT-01).
OQ-52 to OQ-58 cited in this matrix are proposed in open PRs; on `main` the register ends at OQ-51.

## 2. Gap and conflict analysis

- **Features with no owner:** none. Every feature has exactly one primary owner (README section 3).
- **Features with duplicate or conflicting ownership:** none by ID. Three capabilities are split across owners and need
  one definition: (1) device enrollment: CON-02 (QR screen), CLD-03 (`enroll_device`, not written), GATE-09 (scan);
  (2) occupancy: SYNC-04 (`occupancy.ts`, PR #28) versus CLD-05 (`v_zone_now`, not written) must use the same rule,
  and PR #28 has open review findings on exactly that rule; (3) fare: GATE-03 owns `fare.ts`, CON-01 imports it (done).
- **Competing implementations:** SQL payload validation for `ingest_events` exists twice, in PR #26 (edits merged
  migration `0004`) and PR #30 (forward migration). Only one can merge (OQ-52, proposed in PR #30).
- **Verification gaps:** CI runs no SQL tests on `main`; every database row is verified locally only until PR #27 merges.
  `event_parity.test.sql` fails 10 of 37 on `main`. Two test files (`ops/metrics/pilot-metrics.test.mjs`,
  `field/cons12/roi.test.mjs`) are not run by any script. Nothing is verified on hardware, a hosted project or pilot data.
- **Dependencies without an assigned owner:** Hindi string review by a real guard (OQ-11); legal review of retention and
  consent text (OQ-12); procurement of the test phone, spare devices and thermal printers (OQ-15, OQ-31); access to
  partner facilities and rate cards (OQ-13, OQ-14); the incumbent system export question (OQ-06).
- **Existing MVP functionality to preserve:** the merged code listed in section 1; changes to it follow the shared-package
  review rule in `CLAUDE.md`.
- **Verification status summary:** 0 of 46 features are verified against all of their acceptance criteria. 4 are merged
  with test evidence for their own scope (SYNC-01, GATE-03 and CON-03 by CI; SYNC-05 by local SQL only); the rest are
  partial, in an open PR, blocked or not started.

## 3. PRD v1.1 functional requirements not covered, or only partly covered, by the MVP

The PRD lists 56 functional requirements (FR-01 to FR-56). The MVP is the Phase 2 P0 list, so many are deliberately excluded. This table prevents silent loss.

| PRD requirement | Disposition | Covered by | Note |
| --- | --- | --- | --- |
| FR-01 ANPR plate read | Out of MVP scope | none | Optional adapter only if a partner already owns cameras (OQ-21) |
| FR-02 QR fallback entry | Covered | GATE-01, GATE-10 | QR token is the primary entry token in the MVP |
| FR-03 FASTag identification | Out of MVP scope | none | OQ-21 |
| FR-04 Log entry with zone | Covered | GATE-01, SYNC-01 | Zone suggestion; vehicle number optional (OQ-03, OQ-04) |
| FR-05 Two-wheeler plate model | Out of MVP scope | none | Needs ANPR |
| FR-06 Staff manual override | Covered | GATE-07 | Reason code required |
| FR-07 Detect vehicle class | Changed | GATE-01 | Guard selects class manually |
| FR-08 Blocklist | Deferred | none | Should-have in PRD, not in P0 |
| FR-09 Occupancy per zone | Covered | SYNC-04 | Derived from events |
| FR-10 Allocate by occupancy and class | Partly covered | GATE-01 | Zone suggestion only; no allocation engine (OQ-28) |
| FR-11 to FR-14 Reservations, visitor slots, emergency lane, truck zones | Deferred | none | Not in P0 |
| FR-15 EV slots | Deferred | none | Could-have |
| FR-16 Automatic fee | Covered | GATE-02, GATE-03 | OQ-20 |
| FR-17 UPI and card at exit | Changed | GATE-04 | Payment recorded, not processed; operator's own QR (OQ-05) |
| FR-18 FASTag payment | Out of MVP scope | none |  |
| FR-19 Digital receipt via app or SMS | Partly covered | GATE-10 | Printed or on-screen token only; no SMS receipt |
| FR-20 Time-of-day tiers | Partly covered | GATE-03 | Night rate and slabs; no demand pricing |
| FR-21 Automatic shift summary | Covered | GATE-06, CON-06 |  |
| FR-22 Flag billing discrepancies | Partly covered | SYNC-05, GATE-06 | Orphan exit and variance flags |
| FR-23 to FR-25 Dashboard and reports | Covered | CON-04, CON-05, CON-08 |  |
| FR-26 Peak-hour analytics | Covered | CON-08 | Peak heatmap in reports |
| FR-27 Multi-facility view | Covered | CON-02 |  |
| FR-28 Export CSV or PDF | Covered | CON-08, CLD-06 | PDF and Excel |
| FR-29 Capacity alerts to operators | Deferred | none | Not in P0; overstay alerts only (CLD-07) |
| FR-30 Log overrides with staff id | Covered | GATE-07 | Events carry `staff_id` |
| FR-31 to FR-36 AI prediction and pricing | Deferred | none | Needs 30+ days of data |
| FR-37 to FR-39 Find My Vehicle | Deferred | none | P1 only if a partner commits to signage |
| FR-40 to FR-41, FR-43 Driver notifications | Deferred | none |  |
| FR-42 Hardware failure alerts | Partly covered | CLD-07, SYNC-06 | Stale-device alert instead of hardware alerts |
| FR-44 to FR-47 Offline mode | Covered | SYNC-02 to SYNC-06, GATE-11 |  |
| FR-48 Role-based access | Covered | CLD-03, CON-02 |  |
| FR-49 Facility onboarding | Covered | CON-01 |  |
| FR-50 System health | Partly covered | CON-10, CLD-04 |  |
| FR-51 Resident whitelist | Partly covered | GATE-05 | Passes cover regular vehicles |
| FR-52 Admin audit log | Partly covered | CLD-02 | Events are append-only; no separate admin-change log specified yet |
| FR-53 Blocklist management | Deferred | none |  |
| FR-54 CCTV link | Out of MVP scope | none |  |
| FR-55 Tamper-evident audit trail | Covered | SYNC-01, CLD-03 | Append-only events, revoked update and delete |
| FR-56 Retention | Covered | CLD-08 | OQ-12 |

## 4. Phase 2 plan items traced

| Plan item | Feature IDs |
| --- | --- |
| P0-1 Facility setup | CON-01, CLD-02 |
| P0-2 Entry offline | GATE-01, GATE-10, GATE-12 |
| P0-3 Exit, fare, collection | GATE-02, GATE-03, GATE-04 |
| P0-4 Zone occupancy board | SYNC-04, CON-04, GATE-08, CLD-05 |
| P0-5 Monthly pass validation | GATE-05 |
| P0-6 Shift-close reconciliation | GATE-06, CON-06 |
| P0-7 Override logging | GATE-07 |
| P0-8 Console dashboard | CON-05, CLD-05 |
| P0-9 Automated reports | CON-08, CLD-06 |
| P0-10 Overstay flagging | CLD-07, CON-09 |
| P0-11 Roles and multi-site switcher | CLD-03, CON-02, CON-03, GATE-09 |
| P0-12 Sync integrity and conflict log | SYNC-02 to SYNC-07, CON-07 |
| E1/E2 baseline and ROI | CON-12 |
| E3 occupancy accuracy | MET-01 |
| E4 adherence | MET-02 |
| E7 pricing and day-30 meeting | PRT-01 |
