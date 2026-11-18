# Implementation Sheet: Akanksha (Cloud, Data, DevOps and Pilot Measurement)

Workstream prefixes: `CLD-01..CLD-05`, `CLD-07..CLD-10`. (`CLD-06` and `MET-01..MET-03` were reassigned to Anamika; see her sheet.) Master document: [README.md](README.md). Traceability: [feature-traceability.md](feature-traceability.md). Open questions: [open-questions-and-assumptions.md](open-questions-and-assumptions.md).

## 0. Ground truth and labelling conventions

**The repository contains no application code.** The folder holds only `doc/` with product documents. It is not a git repository. There are no migrations, no Supabase project configuration, no CI files, no tests. Therefore:

- Every feature in this sheet has status **Not implemented**.
- No test has been run. Every verification status is **Not verified**. Nothing here may be read as "passed".
- Source for the design: the Handbook tab for Akanksha ("4 Akanksha: backend") and the "Shared Contracts" section of the ParkOS Engineering Handbook (Claude Docs, 24 Oct 2026), plus the ParkOS MVP PRD and the Phase 2 plan in `doc/`.
- Labels used below:
  - **(H)** = specified in the Handbook or PRD documents. Still not built.
  - **(R)** = Recommended (does not exist yet). A proposal that needs verification when the repo is scaffolded.
- Any path, table, column, function or command with no label is **(R)**.
- No dates or time estimates are given. Ordering follows the waves in README section 6.
- Commands are **recommended, to be confirmed once the repo is scaffolded**.

Status vocabulary (from the task spec): Implemented and verified; Implemented but insufficiently tested; Partially implemented; Not implemented; Blocked by a dependency; Ambiguous or requiring a product decision. Where a feature is both Not implemented and blocked or ambiguous, the extra tag is written beside it.

---

> **Reassignment note.** `CLD-06` (report scheduler and email) and `MET-01..03` (pilot measurement) were moved to Anamika's sheet to balance workload. Where this sheet still mentions scheduler jobs, report delivery or measurement files, treat that text as context for the owner of those features. Akanksha stays the code owner of `supabase/functions`.

## A. Role and Ownership

### A.1 Objective

Build and keep running the cloud foundation of ParkOS so that (1) every guard phone writes records into the right facility and nothing else, (2) owners and managers see only what their role allows, (3) reports and alerts arrive without anyone pressing a button, (4) any merged change reaches staging and production through one repeatable pipeline, (5) a failure is detected by a machine before a partner reports it, and (6) the pilot produces trustworthy measurements (occupancy accuracy, staff adherence, weekly metrics pack).

### A.2 Exact scope of responsibility

| Area | What she owns completely |
| --- | --- |
| Environments | Three Supabase projects (dev, staging, production) in the Mumbai region (H), secrets, environment variables, access control to the projects |
| Schema | Migrations `0001`, `0002`, `0003`, `0007`, `0008`, `0009`, `0010`, and CLD-08's own migration (H list; no fixed number — assigned the next free contiguous number at promotion, OQ-64. `0011` went to the IC-01 validation migration instead, PR #56). Reviews and deploys `0004`, `0005`, `0006`, which Afzal writes. Generated types |
| Security model | Row-level security (RLS) policies, the `is_member(facility_id, roles text[])` helper (H), device auth, `enroll_device` |
| Heartbeat | `device_heartbeats` table and `heartbeat(...)` function (H) |
| Reporting data | SQL views `v_daily_kpis`, `v_zone_now`, `v_hourly` (H) |
| Scheduled jobs | `overstay_alerts`, `stale_devices`, `retention_purge` (H), the `job_runs` table (H), email via Resend, the private `reports` bucket (H) |
| Data rights | Retention, `data_export`, facility deletion (H) under India's Digital Personal Data Protection Act, 2023 |
| Pipeline | `.github/workflows/ci.yml`, `deploy-staging.yml`, `deploy-prod.yml` (H) |
| Operations | Sentry, uptime check, alert routing, backups, restore drills |

### A.3 Features owned (primary owner)

`CLD-01`, `CLD-02`, `CLD-03`, `CLD-04`, `CLD-05`, `CLD-07`, `CLD-08`, `CLD-09`, `CLD-10`. (Reassigned to Anamika: `CLD-06`, `MET-01`, `MET-02`, `MET-03`.)

### A.4 Explicitly outside her scope

| Not hers | Owner |
| --- | --- |
| Writing `ingest_events`, `open_sessions` trigger, conflict detector SQL (migrations 0004 to 0006) | Afzal (`SYNC-02`, `SYNC-05`); she reviews and deploys |
| `packages/contracts`, `packages/sync-rules`, occupancy computation | Afzal |
| Gate app screens, fare engine | Nikhil (`GATE-*`) |
| Console screens, report templates and the render route | Anamika (`CON-*`); the report scheduler and email (`CLD-06`) are now also Anamika's |
| Partner agreements and pricing | Afzal (`PRT-01`) |
| Baseline time-and-motion study and ROI statements | Anamika (`CON-12`) |

### A.5 Relevant modules and files (all (R) unless marked (H))

```text
supabase/
  config.toml
  migrations/0001..0010_*.sql, plus CLD-08's  # names (H); see CLD-02 step 9 — CLD-08's number is assigned at promotion, not fixed here (OQ-64)
  functions/enroll_device/index.ts     # (H) function name; path (R)
  functions/data_export/index.ts       # (H) function name; path (R)
  tests/*.sql                          # pgTAP
  seed.sql                             # shared with Anamika (CON-11)
.github/workflows/ci.yml  deploy-staging.yml  deploy-prod.yml   # (H) names
tools/load/ingest.k6.js
tools/restore/restore_drill.sh
ops/runbook.md  ops/alerts.md
(ops/metrics/* moved to Anamika's sheet with MET-01..03)
```

### A.6 Dependencies on other members

| Needs | From | For |
| --- | --- | --- |
| Contracts package types (`SCHEMA_VERSION`, event and reason-code enums) | Afzal (`SYNC-01`) | Mirror enums and check constraints in SQL |
| SQL for `ingest_events`, `open_sessions`, conflict detector | Afzal | Deploy; review |
| Set-PIN UI and enrollment QR UI | Anamika (`CON-02`) | Her functions are called by these screens |
| Health page | Anamika (`CON-10`) | Reads `device_heartbeats` |

### A.7 Decisions she can make independently

- Index additions backed by a measured slow query.
- Job schedules inside the IST windows already agreed (H), if the facility requires a different time of day.
- Alert thresholds within the ranges in section H of the Handbook (H), recorded in `ops/alerts.md`.
- Supabase plan choice, within the budget alert (see OQ-07).

### A.8 Decisions requiring approval or coordination

| Decision | Approver |
| --- | --- |
| Any change to `events` columns, event types, or `open_sessions` semantics | Afzal |
| Any change to RLS policy semantics or device claims | Afzal reviews, as a permission change |
| Adding a service not in the stack (queue, warehouse, ORM) | All four; default answer is no (H avoid list) |
| Production deploy | Manual approval through the GitHub environment (H); approver named by Afzal |
| Retention defaults and consent text | Needs legal review (OQ-12) |
| Moving a gate or cutting scope because of a blocked cloud item | Afzal |

---

## B. Feature Inventory

Common to every row: **Status = Not implemented**. Dependencies are exactly those in README section 3.

| ID | Feature | Business purpose | User / system | Required final behaviour | Priority | Dependencies | Acceptance criteria (summary; detail in C and E) | Testing requirements (summary; detail in D) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CLD-01 | Supabase environments, secrets, region | Safe separation of dev, staging, production | Team | Three projects in Mumbai; no shared data; secrets only in GitHub environments and Supabase secrets | Critical | none | Three projects exist; production secrets unreadable from dev; secrets inventory present | Config checks, secret-scan CI step, access review |
| CLD-02 | Schema migrations (non-sync) and generated types | Store facilities, staff, devices, shifts, views support | System | Migrations `0001`, `0002`, `0003`, `0007`, `0008`, `0009`, `0010`, plus CLD-08's own apply from scratch and forward-only (`0011` is the IC-01 validation migration; CLD-08's number is assigned at promotion, OQ-64); RLS on every table | Critical | SYNC-01 | Fresh apply succeeds; types generate and compile; every table RLS-enabled | Migration rehearsal, RLS-enabled catalog check, pgTAP schema tests |
| CLD-03 | RLS, device auth, `enroll_device` | Isolate data per org and facility; enroll phones safely | Guard devices, managers, owners | Role matrix enforced in the database; device = auth user with claims; one-time code valid 10 minutes | Critical | CLD-02 | Permission matrix all green; code expires; code single-use | pgTAP matrix, enrollment integration tests, abuse tests |
| CLD-04 | Heartbeat table and function | Detect stale or unhealthy devices | Gate app (through sync package), Console health page, `stale_devices` job | One row per device upserted at most every 5 minutes | High | CLD-02 | Upsert works; rate limited; readable only by authorized roles | pgTAP, integration, rate-limit test |
| CLD-05 | KPI SQL views | Dashboard and reports have a single source of truth | Console | `v_daily_kpis`, `v_zone_now`, `v_hourly` correct on seed and under load | High | CLD-02, SYNC-02 | Match independent oracle queries exactly; under 500 ms at end of load test | Oracle comparison, seed tests, k6 |
| CLD-07 | Overstay and stale-device alerts | Managers notified of long-stay vehicles; team of silent devices | `pg_cron` jobs, Resend or messaging | `overstay_alerts` every 10 minutes (once per session); `stale_devices` every 10 minutes when facility open | High | CLD-02, SYNC-03 | One alert per session; stale device flagged after 30 minutes silence in opening hours | Unit and integration with fixed clocks |
| CLD-08 | Retention, export, delete | Data rights under DPDP Act 2023 | Owners, support | `retention_purge` nightly; `data_export` CSV per facility; facility deletion removes rows and files | Medium (High before any real personal data is stored) | CLD-02 | Export is complete and scoped; purge honours settings; delete leaves no rows or files | Integration, negative authorization, completeness reconciliation |
| CLD-09 | CI/CD pipelines | Repeatable, gated delivery | GitHub | `ci.yml` on PR; `deploy-staging.yml` on push to `main`; `deploy-prod.yml` on tag `v*` with manual approval | High | REL-01 | CI blocks merges on failure; staging deploys on main; prod needs approval | Dry-run pipelines on a sandbox repo; failure injection |
| CLD-10 | Monitoring, backups, restore drill | Know first; be able to recover | Team | Sentry, uptime check on a health route, alert routing to named on-call, restorable backups, drill passes | Critical | CLD-01 | Alerts reach a human; restore drill logged with counts and checksums | Alert fire test, restore drill |

---

## C. Feature-by-Feature Implementation Instructions

### CLD-01: Supabase environments, secrets, region

1. **Problem.** Mixing dev, staging and production data or keys creates data leaks and un-restorable mistakes.
2. **Expected behaviour.** Three separate Supabase projects (H): `parkos-dev`, `parkos-staging`, `parkos-prod` (names (R)), region Mumbai (ap-south-1 equivalent in the Supabase region list; verify the exact label in the dashboard). Different database passwords, API keys and JWT secrets per project. No cross-project foreign access.
3. **Preconditions and assumptions.** A Supabase organization exists; the team lead's account owns billing. Assumption: Mumbai region is available for the chosen plan (verify). Production plan not yet chosen (OQ-07).
4. **Implementation sequence.**
   1. Create the three projects; record project refs in `ops/runbook.md` (refs are not secrets; keys are).
   2. Create GitHub repository environments `staging` and `production` (H: manual approval on production). Add required reviewers (named by Afzal).
   3. Store, per environment: `SUPABASE_ACCESS_TOKEN` (CI), `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `REPORT_ROUTE_SECRET`, `SENTRY_DSN`. Names (R).
   4. Set Supabase function secrets with `supabase secrets set` per project (recommended command).
   5. Write `ops/secrets-inventory.md`: name, where stored, owner, rotation rule. No values.
   6. Add a secret scanner (for example gitleaks) to `ci.yml` (R).
   7. Document least-privilege membership on each Supabase project: owners only on production.
5. **Files.** `ops/runbook.md`, `ops/secrets-inventory.md`, `.github/workflows/*.yml`, `.env.example` (R) with variable names only.
6. **Contracts.** Output: environment variable names consumed by Console (`NEXT_PUBLIC_SUPABASE_URL`, anon key) and gate app (R). Input: none.
7. **Data flow.** Not applicable, configuration only.
8. **Validation and rules.** Service-role key never appears in the gate app or Console client bundles. Staging never holds production data.
9. **Success.** A deployment to staging cannot read production; rotating a key in one environment does not affect another.
10. **Failure.** A missing secret fails CI early with the missing name (not value) in the log.
11. **Edge cases.** Key leaked in chat or log: rotate immediately (H rule); a team member leaves: remove from GitHub and Supabase the same day.
12. **Security.** Secrets only in GitHub environments and Supabase secrets (H). Production environment restricted to named reviewers.
13. **Logging.** Record each rotation in `ops/secrets-inventory.md` with date and reason.
14. **Tests.** T-CLD-01-U1, T-CLD-01-I1, T-CLD-01-N1, T-CLD-01-X1 (section D).
15. **Acceptance.** Three projects exist; inventory complete; scanner active; production reviewers set.
16. **Definition of done.** See E and J; evidence: screenshots or exported settings of the three projects (no secrets), CI log of the scanner run.

### CLD-02: Schema migrations (non-sync) and generated types

1. **Problem.** The data model must exist, evolve safely and be mirrored in types so the apps and database cannot drift.
2. **Expected behaviour.** Migration files (H list) apply from scratch on an empty database and forward on a copy of staging. Each file is immutable after merge.
3. **Preconditions.** `SYNC-01` defines event types, reason codes and `SCHEMA_VERSION`. Local Supabase stack runs through the Supabase CLI (R).
4. **Implementation sequence.**
   1. `0001_org_facility_zone_tariff_pass.sql`: `organizations(id, name)`, `facilities(id, org_id, name, timezone, slot_count)`, `zones(id, facility_id, name, capacity, vehicle_class)`, `tariffs(id, facility_id, vehicle_class, rule_json, effective_from)`, `passes(id, facility_id, vehicle_no, valid_to, dues)` (H column lists from the PRD appendix). Add primary keys, foreign keys, `created_at`. RLS enabled in the same file (H rule).
   2. `0002_staff_devices_memberships.sql`: `staff` with `pin_hash`, `pin_salt`, `active` (H), `devices(id, facility_id, name, enrolled_at, revoked_at, auth_user_id)` (R columns), `memberships(user_id, org_id, facility_id, role)` (H), role check constraint `owner | manager | guard` (H). Add `enrollment_codes(code_hash, facility_id, created_by, expires_at, used_at)` (R).
   3. `0003_events.sql`: `events(id uuid pk, facility_id, device_id, staff_id, type, session_id, payload jsonb, device_time, received_at default now(), source)` (H column list). Check constraint on `type` against the seven event types (H). Indexes `events (facility_id, device_time)` (H). `REVOKE UPDATE, DELETE ON events FROM` all roles (H append-only).
   4. Review Afzal's `0004`, `0005`, `0006` for: idempotency (`on conflict (id) do nothing`), `security definer` settings, `search_path` set, grants (R review checklist).
   5. `0007_shift_reviews_conflict_resolutions.sql`: `shift_reviews`, `conflict_resolutions` (H names; columns (R): id, shift or conflict id, reviewer, action, note, at). Also `sync_conflicts` if not created in `0006` (H lists it in the table list).
   6. `0008_device_heartbeats.sql`: see CLD-04.
   7. `0009_views_kpis.sql`: see CLD-05.
   8. `0010_rls.sql`: see CLD-03. (H: policies live here; the "RLS enabled in the creating migration" rule still applies, so enable in each earlier file and define policies here.)
   9. `<next-free>_retention_and_export.sql` (H name `retention_and_export`; no number fixed in advance — the previous attempt to pin `0011`, then `0012`, both collided with other work landing first, so OQ-64 settled on assigning the real next-free contiguous number only at the moment this migration is actually promoted): facility `retention_days` setting, purge function, export helper; also `job_runs(id, job, facility_id, started_at, finished_at, status, detail)` (H table name; columns (R)).
   10. Run `supabase gen types typescript` after every merged migration (H: generated types) and commit to `packages/db-types` (R path).
5. **Files.** `supabase/migrations/*.sql`, `packages/db-types/index.ts` (R).
6. **Contracts.** Input: IC-01 enumerations. Output: generated TypeScript types consumed by Console and the sync package; the table names used by IC-07 and IC-10.
7. **Data flow.** Not applicable; structure only.
8. **Validation and rules.** Money columns integer paise. `device_time` stored as `timestamptz` in UTC. Foreign keys everywhere. No soft-delete columns, no update triggers on `events` (H).
9. **Success.** `supabase db reset` applies all files with zero errors; types compile.
10. **Failure.** A migration failing in CI blocks merge and prints the file and statement.
11. **Edge cases.** Two PRs add migration numbers at once: renumber before merge (CI check that numbers are unique and contiguous). A column rename: do add-copy-drop across separate migrations, never in one.
12. **Security.** Every table RLS-enabled; no table readable by `anon`.
13. **Logging.** `supabase migration list` output stored as CI artifact on deploy.
14. **Tests.** T-CLD-02-U1..U2, I1..I2, N1, R1, X1.
15. **Acceptance.** All eleven files present, applied from scratch and forward-only; catalog query shows RLS enabled on every table in the public schema.
16. **Definition of done.** E and J; evidence: CI logs of from-scratch and forward-only runs.

### CLD-03: Row-level security, device auth and `enroll_device`

1. **Problem.** A guard phone must read and write only its facility; managers one facility; owners their organization; strangers nothing.
2. **Expected behaviour.**
   - Each enrolled phone is a Supabase auth user created by `enroll_device` after verifying a one-time code from the Console (H). `app_metadata` holds `org_id`, `facility_id`, `device_id`, `role = 'device'` (H).
   - Guard identity is `staff_id` on each event, checked inside `ingest_events` against active staff of the facility (H).
   - `is_member(facility_id, roles text[])` security-definer helper reads `auth.uid()` and `memberships` (H) and is used in select policies for people. Device users are restricted to their `facility_id` claim (H).
   - Direct `insert` on `events` is revoked; only `ingest_events` writes (H). Owners see all facilities of their organization, managers one, devices only their facility's config and `open_sessions` (H).
3. **Preconditions.** `CLD-02` tables exist. `ingest_events` exists from `SYNC-02`.
4. **Implementation sequence.**
   1. Write `is_member` with `set search_path = ''` and schema-qualified references.
   2. Write a second helper `device_facility()` (R) returning `auth.jwt() -> 'app_metadata' ->> 'facility_id'`.
   3. Per table, write select, insert, update, delete policies explicitly (deny by default). Table by table policy rules:
      - `organizations`, `facilities`: select for members of the org or facility; update only owner.
      - `zones`, `tariffs`, `passes`: select for members and the facility's devices; write for manager and owner only. Devices read only.
      - `staff`: select for managers and owners; devices read the `pin_hash`, `pin_salt` columns of their facility's active staff via a restricted view or sync rule (R: `staff_for_device` view exposing only id, name, pin_hash, pin_salt, active). Write: manager and owner.
      - `devices`, `enrollment_codes`: manager and owner; devices cannot read others.
      - `events`: select for members of the facility; no direct insert, update or delete for any role.
      - `open_sessions`: select for members and the facility's devices; writes only by trigger.
      - `sync_conflicts`: select for managers and owners; no direct writes except through functions.
      - `conflict_resolutions`, `shift_reviews`: insert by manager and owner; select by members (R: guard cannot read reviews).
      - `device_heartbeats`: writes only through `heartbeat()`; select for managers and owners.
      - `job_runs`: select for owners only (R) or service role.
   4. Write `enroll_device(code text, device_name text)` as an Edge Function (H name) that: hashes the code, looks up an unused, unexpired record (10 minutes (H)), creates an auth user (email pattern `device-<uuid>@<private-domain>`, random password, R) with `app_metadata` claims, inserts the `devices` row, marks the code used, returns the credentials once. Rate limit per IP and per code (R: 5 attempts per code, then burn it).
   5. Write a revocation path: setting `devices.revoked_at` or removing membership makes the next sync fail closed (H: "Next sync fails closed").
   6. Write the pgTAP matrix (section D, T-CLD-03-*).
5. **Files.** `supabase/migrations/0010_rls.sql`, `supabase/functions/enroll_device/index.ts`, `supabase/tests/rls_matrix.sql` (R paths).
6. **Contracts.** IC-05 (device enrollment): input `{code, device_name}`; output `{device_id, email, password, facility_id}` (R shape) once; error codes `CODE_INVALID`, `CODE_EXPIRED`, `CODE_USED`, `RATE_LIMITED`. IC-06 (staff PIN hashes) restricted exposure above.
7. **Data flow.** Manager clicks Add device in Console → Console writes an `enrollment_codes` row (hash) and shows plaintext code and QR for 10 minutes → guard phone scans and calls `enroll_device` → function creates the auth user and devices row → phone stores credentials in secure storage and syncs.
8. **Validation.** Code format at least 8 characters from a safe alphabet (R). Device name 1 to 60 characters. Code hashed with SHA-256 plus server pepper (R).
9. **Success.** Phone gets credentials; first sync downloads only that facility's data.
10. **Failure.** Expired, used or wrong code returns a generic failure with a specific machine code, no hint whether a code exists. Revoked device: sync fails with 401 and the app shows a message (Nikhil).
11. **Edge cases.** Code scanned twice (second fails); two phones race for one code (exactly one succeeds, use a single conditional update); manager removed while a code is outstanding (code becomes invalid); the same physical phone re-enrolled after wipe (creates a new device row; old one revoked by manager); clock skew near expiry (expiry decided by database time).
12. **Security.** Service role used only inside the function. Passwords never logged. Policies tested for every role. No `using (true)` policies (CI grep check (R)).
13. **Logging.** Insert a row in `audit_log` (H table) for enrollment, revocation and any policy-protected admin action; `job_runs` not used here.
14. **Tests.** T-CLD-03-U1..U2, I1..I4, E1, N1..N6, R1, X1..X2.
15. **Acceptance.** Matrix green; expiry and single-use verified; revocation fails closed.
16. **Definition of done.** E and J; evidence: pgTAP output, integration test output, matrix table committed in `ops/rls-matrix.md` (R).

### CLD-04: Heartbeat table and function

1. **Problem.** Without a heartbeat, a dead phone looks identical to a quiet gate.
2. **Expected behaviour.** `heartbeat(device_id, queue_depth, oldest_unsynced_age, app_version, schema_version, battery)` (H signature) upserts one row per device in `device_heartbeats`, at most one accepted write per device per 5 minutes (H); additional calls inside the window are ignored (not an error).
3. **Preconditions.** `CLD-02`, `CLD-03`.
4. **Implementation sequence.** (1) Migration `0008_device_heartbeats.sql`: columns `device_id pk`, `facility_id`, `received_at`, `queue_depth int`, `oldest_unsynced_age_s int`, `app_version text`, `schema_version int`, `battery_pct int` (R). (2) Function checks the caller's `device_id` claim equals the argument. (3) Upsert with `where received_at < now() - interval '5 minutes'` (R). (4) Policy: select for managers and owners; no direct writes.
5. **Files.** `supabase/migrations/0008_device_heartbeats.sql`.
6. **Contracts.** IC-09; sender is Afzal's `health.ts`, reader is Anamika's health page and `stale_devices`.
7. **Data flow.** Phone online → sync package calls `heartbeat` → row updated → Console and `stale_devices` read.
8. **Validation.** Non-negative integers; battery 0 to 100; `schema_version` integer.
9. **Success.** Row reflects latest accepted values.
10. **Failure.** Mismatched device id returns permission error; malformed values rejected.
11. **Edge cases.** Device offline for days then returns (first write immediately accepted); clock skew does not matter because `received_at` uses the database clock; revoked device writes rejected.
12. **Security.** A device can write only its own row.
13. **Logging.** None per call (volume); the `stale_devices` job logs outcomes.
14. **Tests.** T-CLD-04-U1, I1, N1..N2, X1.
15. **Acceptance.** Rate limit, ownership check and read policy verified.
16. **Definition of done.** E and J.

### CLD-05: KPI SQL views

1. **Problem.** Dashboard and reports must show the same correct numbers with no logic in the page.
2. **Expected behaviour.** Views `v_daily_kpis`, `v_zone_now`, `v_hourly` (H names). Content (R columns):
   - `v_daily_kpis(facility_id, local_date, vehicles, declared_revenue_paise, cash_paise, upi_attested_paise, pass_count, avg_stay_minutes, overrides, overrides_per_100)`.
   - `v_zone_now(facility_id, zone_id, zone_name, capacity, occupied, as_of)`.
   - `v_hourly(facility_id, local_date, hour, entries, exits)`.
3. **Preconditions.** `events` populated by `ingest_events`; `open_sessions` maintained by trigger (Afzal).
4. **Implementation sequence.** (1) Define a derived `sessions` view: pair `ENTRY` and `EXIT` events by `session_id` (H: sessions are derived). (2) Compute stay minutes from `device_time`. (3) Convert to facility local date using `facilities.timezone`. (4) Revenue only from `PAYMENT` events; UPI revenue is "attested" not "confirmed" (matches README OQ-05). (5) `v_zone_now` combines `open_sessions` count with the latest `ZONE_COUNT` baseline per the same rule as Afzal's `occupancy.ts` (agree one definition in writing with Afzal; the view must equal `occupancy.ts` on shared fixtures). (6) Use `security_invoker = true` so RLS applies to callers (R).
5. **Files.** `supabase/migrations/0009_views_kpis.sql`.
6. **Contracts.** IC-07: read-only; column names are the contract; changing one requires Anamika's approval.
7. **Data flow.** Events → views → Console pages and report templates.
8. **Validation and rules.** Money integer paise; an `EXIT` with no `ENTRY` excluded from stay stats and counted in an `orphans` column (R); overrides counted by `OVERRIDE` events.
9. **Success.** Views match oracle on seed.
10. **Failure.** Empty facility returns zero rows or zero values, never an error.
11. **Edge cases.** Sessions spanning midnight (attribute revenue to exit date, entries to entry date, documented); daylight saving not relevant in India but timezone column honoured; duplicate exit conflict rows (count first exit only, rest flagged); sessions never exited (appear in `open_sessions`, excluded from average stay).
12. **Security.** `security_invoker`; no grants to `anon`.
13. **Logging.** None; slow-query review weekly (CLD-10).
14. **Tests.** T-CLD-05-U1..U3, I1..I2, N1, R1, X1.
15. **Acceptance.** Exact oracle match; p95 under 500 ms at end of load test (H).
16. **Definition of done.** E and J.

### CLD-07: Overstay and stale-device alerts

1. **Problem.** Managers need to hear about long-stay vehicles and silent phones without watching a screen.
2. **Expected behaviour.** `overstay_alerts` every 10 minutes: find open sessions older than the facility threshold, notify the manager once per session (H). `stale_devices` every 10 minutes: flag devices with no heartbeat for 30 minutes while their facility is open (H).
3. **Preconditions.** `open_sessions` exists (Afzal); `facilities` have an `overstay_threshold_minutes` and opening hours (R columns; shape agreed with Anamika's settings screen `CON-09`).
4. **Implementation sequence.**
   1. Table `alert_log(id, kind, facility_id, subject_id, sent_at)` with unique `(kind, subject_id)` for overstay (R).
   2. Function `run_overstay_alerts()` selects candidates, inserts into `alert_log` with `on conflict do nothing returning`, and sends mail or message only for newly inserted rows.
   3. Function `run_stale_devices()` joins `devices` and `device_heartbeats` against facility opening hours (in local time) and inserts a stale marker per device episode; clear marker when a heartbeat arrives.
   4. Delivery: email through Resend; SMS or WhatsApp (MSG91) is an add-on (H) and not part of the base build.
   5. Schedule both jobs every 10 minutes with `pg_cron`; log into `job_runs`.
5. **Files.** `supabase/migrations/<next-free>_*` at promotion (R; `0011` is taken by the IC-01 validation migration, PR #56; no number fixed in advance, OQ-64), `ops/alerts.md`.
6. **Contracts.** Reads `open_sessions` (SYNC-03 contract), `device_heartbeats` (IC-09). Writes `alert_log`. Console `CON-09` reads the same threshold column.
7. **Data flow.** Jobs → tables → mail; Console health page reads stale markers.
8. **Validation and rules.** Threshold positive integer; opening hours default to always open if not configured (flag in the setup wizard).
9. **Success.** Exactly one overstay message per session; one stale alert per episode.
10. **Failure.** Mail failure leaves `alert_log` row unsent (R status column) and retries on the next run up to a cap, then raises an operational alert.
11. **Edge cases.** Session exits right after alert (no retraction needed; alert is historical); threshold changed mid-day (applies to new evaluations; already alerted sessions not re-alerted); facility closed overnight (no stale alerts); two jobs running concurrently (unique constraint prevents duplicates); phone replaced (old device revoked, no alert).
12. **Security.** Jobs run as a dedicated database role with minimum grants (R).
13. **Logging.** `job_runs` plus counts of candidates, sent, skipped.
14. **Tests.** T-CLD-07-U1..U3, I1..I2, N1, X1.
15. **Acceptance.** Fixed-clock tests show once-only and stale detection within the 30-minute rule.
16. **Definition of done.** E and J.

### CLD-08: Retention, export and delete

1. **Problem.** The PRD risk register requires DPDP Act 2023 compliance: consent, retention, export, deletion, built in from v1.
2. **Expected behaviour.** `retention_purge` nightly removes data older than each facility's `retention_days` (H "configurable retention"); `data_export` (H) returns one facility's events and config as CSV on an owner's request; deleting a facility removes its rows and storage files (H).
3. **Preconditions.** Legal review of defaults and consent text (OQ-12). `events` are append-only, so purge is a privileged exception (see rules).
4. **Implementation sequence.**
   1. Add `facilities.retention_days` (R) with a default decided in OQ-12.
   2. Purge function runs as a dedicated role that alone holds `DELETE` on `events` (R), executed only by the nightly job; the append-only protection for all application roles remains.
   3. Purge also removes expired report files from the `reports` bucket and old `job_runs` and `alert_log` rows.
   4. `data_export` Edge Function (H): input facility id; checks the caller is owner of the organization; streams CSVs for `events`, `facilities`, `zones`, `tariffs`, `passes`, `shifts`, `overrides` (R list) as a zip; logs to `audit_log`.
   5. Facility deletion function (R) with a two-step confirmation and a 7-day soft-hold flag (R, optional); then deletes rows in dependency order and storage objects, writes an `audit_log` entry that keeps the facility id and timestamp but no personal data.
   6. Personal data minimum: only vehicle number and optional phone number (H). Data subject request procedure documented in `ops/dpdp.md` (R).
5. **Files.** `<next-free>_retention_and_export.sql` (H name; number assigned at promotion, not fixed here — see CLD-02 step 9, OQ-64), `supabase/functions/data_export/index.ts` (R path), `ops/dpdp.md`.
6. **Contracts.** Output CSV column names stable and documented in `ops/dpdp.md`.
7. **Data flow.** Owner request → function → zip; nightly job → purge.
8. **Validation.** `retention_days` at least a minimum set in OQ-12; export limited to one facility per call.
9. **Success.** Export row counts equal database counts for that facility; purge removes only older rows.
10. **Failure.** Partial export is not delivered (all or nothing); purge errors leave data intact and alert.
11. **Edge cases.** Open sessions older than retention (never purge unexited sessions' entries; R rule); legal hold (not supported in pilot); concurrent export during purge (export reads a snapshot transaction); deleting a facility with unsynced phone data (warn: devices will fail closed; unsynced events lost).
12. **Security.** Owner-only; rate limited; link or response never public.
13. **Logging.** `audit_log` for every export and delete.
14. **Tests.** T-CLD-08-I1..I3, N1..N3, X1.
15. **Acceptance.** Reconciliation counts equal; deletion leaves no rows or objects for that facility.
16. **Definition of done.** E and J; consent text reviewed (OQ-12).

### CLD-09: CI/CD pipelines

1. **Problem.** Every merge must be tested the same way and reach environments through the same path.
2. **Expected behaviour (H).** `ci.yml` on pull request: install, lint, typecheck, unit tests for all packages; start local Supabase and run all migrations from scratch; run pgTAP tests (RLS matrix, ingest idempotency, conflict detector); build Console and run a Playwright smoke test. `deploy-staging.yml` on push to `main`: `supabase db push` (staging), deploy functions, deploy Console to staging. `deploy-prod.yml` on tag `v*`: manual approval via the GitHub environment, then db push, functions, Console; plus EAS build for the gate app (internal distribution) and OTA channel.
3. **Preconditions.** `REL-01` monorepo exists; secrets set (CLD-01).
4. **Implementation sequence.**
   1. Write `ci.yml` with jobs: `lint-typecheck-test`, `db` (local Supabase via CLI, migrations from scratch, pgTAP), `console-smoke` (build and Playwright), `secret-scan`, `migration-lint` (unique contiguous numbering, RLS enabled on new tables, no `using (true)`) (R extra jobs).
   2. Make `ci.yml` a required status check on `main` via branch protection (H: green CI and one approval from a different workstream).
   3. Write `deploy-staging.yml`: runs after CI passes on `main`; steps in order: `supabase db push`, functions deploy, Console deploy, a post-deploy health check hitting the health route.
   4. Write `deploy-prod.yml`: trigger `push: tags: v*`; `environment: production` for approval; steps as staging plus EAS build; post-deploy health check; on failure, document rollback in `ops/runbook.md` (Console redeploy previous build; migrations are forward-only so rollback is a new corrective migration; the gate app OTA channel can roll back JavaScript fixes).
   5. Add a deployment concurrency group so two deploys cannot overlap (R).
   6. Pin action versions and cache dependencies (R).
5. **Files.** `.github/workflows/ci.yml`, `deploy-staging.yml`, `deploy-prod.yml`.
6. **Contracts.** Branch protection and required checks list; environments `staging` and `production`.
7. **Data flow.** PR → CI → merge → staging deploy; tag → approval → production deploy.
8. **Validation and rules.** No production deploy without approval; no Friday or pre-peak-weekend releases to a live pilot (H rule: policy, not tooling; encode as a documented check in the tag checklist).
9. **Success.** Pipelines run green on a sandbox branch and repository; failure in any step stops the pipeline.
10. **Failure.** Failed migration in staging: pipeline stops before functions or Console deploy; alert in the team channel (R).
11. **Edge cases.** Migration succeeds but Console deploy fails (staging only; production requires pre-deploy staging run of the same tag, R rule); forked PRs have no secrets (CI tests must not need them); flaky Playwright (retry once, track flake rate); two tags pushed together (concurrency group).
12. **Security.** Least-privilege tokens per environment; no secrets in logs; production environment reviewers required.
13. **Logging.** Pipeline logs retained; deployment summary posted with version, migration list and health check result.
14. **Tests.** T-CLD-09-I1..I3, N1..N2, X1.
15. **Acceptance.** Dry runs on a sandbox repository succeed; injected failures stop the pipeline.
16. **Definition of done.** E and J.

### CLD-10: Monitoring, backups and restore drill

1. **Problem.** The team must learn about failure before partners do, and be able to recover.
2. **Expected behaviour (H).** Sentry for errors; an uptime check on a Console health route that queries the database, alerting after 2 failures in a row; alerts for failed scheduled jobs, report email bounce or failure, database size at 70% of plan limit, stale devices, function error spikes; named on-call; target cloud uptime 99.5% during the pilot; restorable daily backups; a restore drill before the first pilot and monthly thereafter.
3. **Preconditions.** CLD-01 environments; Console health route exists (Anamika provides `/api/health`, R, or Akanksha adds it with Anamika's review).
4. **Implementation sequence.**
   1. Create Sentry projects (gate, console, functions) with DSNs in secrets.
   2. Health route: runs `select 1` plus one read of a small table; returns 200 or 503 with no data.
   3. Uptime monitor (any hosted service) hitting the route every minute; two consecutive failures page the on-call person.
   4. Write `ops/alerts.md`: each alert, source, threshold, recipient, runbook link.
   5. Backups: check the production plan; free projects may not include restorable daily backups (H caveat). Either budget for a paid plan or run a nightly `pg_dump` job (GitHub Action or other scheduler) to encrypted storage with retention (R). Record the choice in OQ-07.
   6. Restore drill script `tools/restore/restore_drill.sh` (R): restore the latest backup into a fresh project, compare row counts and a checksum per table, record elapsed time in `ops/restore-log.md`.
   7. Weekly review: bill, database size, slow queries (index review from measured queries only, H rule).
   8. Name the on-call person per week; document the escalation order.
5. **Files.** `ops/alerts.md`, `ops/runbook.md`, `ops/restore-log.md`, `tools/restore/restore_drill.sh`.
6. **Contracts.** Health route contract: GET returns 200 when the database answers a trivial query.
7. **Data flow.** Events from Sentry, uptime service, `job_runs`, Resend webhooks, usage page → alert channel → on-call.
8. **Validation.** Every alert has a tested path to a human.
9. **Success.** A deliberately induced failure of each alert type reaches the on-call person.
10. **Failure.** If the alert channel itself is down, a secondary channel (SMS or call to the lead) exists (R).
11. **Edge cases.** Planned maintenance (silence rule with an expiry); alert flapping (require 2 consecutive failures); on-call unreachable (escalate to Afzal after a set time recorded in the runbook); backup succeeds but restore fails (the drill is the only valid proof).
12. **Security.** Restore into a fresh project, never over production; encrypted dumps; backup access restricted.
13. **Logging.** `ops/restore-log.md` entries: date, backup id, elapsed time, row counts, checksum result, who ran it.
14. **Tests.** T-CLD-10-I1..I3, E1, N1, X1.
15. **Acceptance.** Alert fire test for each row of `ops/alerts.md`; restore drill with matching counts and checksums.
16. **Definition of done.** E and J; Akanksha signs the cloud side of the pilot-readiness gate.

---

## D. Detailed Testing Protocol

All tests are **Not run**. Priorities: Critical, High, Medium, Low. "Verification method" names the evidence. Test tooling (all (R), to be confirmed): pgTAP for SQL, a TypeScript test runner for functions (for example Vitest), k6 for load, Playwright only for Console smoke (owned by Anamika; used here for the pipeline).

Test ID format: `T-<FeatureID>-<kind><n>`; kinds U unit, I integration, E end to end, N negative, R regression, X non-functional.

### D.1 CLD-01 Environments and secrets

| Test ID | Scenario | Preconditions | Test steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CLD-01-U1 | Secret scanner flags a planted secret | Scanner step in `ci.yml` | Commit a fake key string on a branch | `AKIA...`-style dummy and a fake JWT | CI step fails and names file and line, not the value | CI log | High |
| T-CLD-01-I1 | Environments are isolated | Three projects, staging deploy token | Use the staging token to attempt a read from production API | staging token, production URL | Request refused | Command output (HTTP status) | Critical |
| T-CLD-01-N1 | Client bundle has no service-role key | Console and gate builds available | Search built Console client output and gate bundle for the service-role key and for `service_role` | built artifacts | No match | Grep output in CI | Critical |
| T-CLD-01-X1 | Access review | Supabase and GitHub member lists | List members per project and environment reviewers | exported lists | Production restricted to named owners and reviewers | Screenshot or export in `ops/` | Medium |

### D.2 CLD-02 Schema and migrations

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CLD-02-U1 | Every table has RLS enabled | Local DB with all migrations | Query catalog for public tables where RLS is off | `pg_class.relrowsecurity` | Zero rows returned | pgTAP assertion | Critical |
| T-CLD-02-U2 | Event type and reason constraints | `0003` applied | Insert events with each valid type and one invalid type (superuser fixture) | seven types plus `BOGUS` | Valid accepted, invalid rejected by check constraint | pgTAP `throws_ok` | High |
| T-CLD-02-I1 | From-scratch apply | Empty local Supabase | `supabase db reset` | all migrations | Exit code 0, no errors | CI log | Critical |
| T-CLD-02-I2 | Forward-only migration rehearsal | Copy of staging data (anonymized) | Apply only new migrations on the copy | staging dump | No error, row counts unchanged for existing tables | Count comparison script output | Critical |
| T-CLD-02-N1 | Duplicate migration number | Two files with same prefix | Run `migration-lint` | `0012_a.sql`, `0012_b.sql` | CI fails with message | CI log | Medium |
| T-CLD-02-R1 | Generated types compile | Types generated | Typecheck Console and sync package | generated file | No type errors | CI log | High |
| T-CLD-02-X1 | Money and time types | Schema applied | Inspect column types for money and `device_time` | catalog | money integer, time `timestamptz` | pgTAP `col_type_is` | High |

### D.3 CLD-03 RLS, device auth, enrollment

**Permission matrix (pgTAP, T-CLD-03-N1 to N3 and I1).** Principals: **O** owner of org A; **M** manager of facility A1; **G** guard device enrolled at A1; **G2** device at A2 (same org); **X** device or owner of org B; **Anon**. Operations: S select, I insert, U update, D delete. Expected values: Y allowed, N denied, "own" restricted to own rows. Each cell is one assertion (`lives_ok` or `throws_ok` or row-count equals expected).

| Table | O (A1,A2) | M (A1) | G (A1) | G2 (A2) | X (org B) | Anon |
| --- | --- | --- | --- | --- | --- | --- |
| organizations | S Y, U Y, I N, D N | S own org, rest N | S N | S N | S N | all N |
| facilities | S Y (A1, A2), U Y | S A1, U N | S own facility | S own facility only (not A1) | N | N |
| zones, tariffs, passes | S Y, I U D Y | S Y, I U D Y (A1) | S A1 only, I U D N | S A2 only, I U D N | N | N |
| staff | S Y, I U D Y | S Y, I U D Y (A1) | via device view only: id, name, hash, salt, active for A1; base table N | own facility view only | N | N |
| devices | S I U D Y | S I U D Y (A1) | N | N | N | N |
| enrollment_codes | Y | Y (A1) | N | N | N | N |
| memberships | S I U D Y | S own facility rows, I U D N | N | N | N | N |
| events | S Y; I U D N | S A1; I U D N | S N or own facility per sync design; I U D N | N | N | N |
| open_sessions | S Y; writes N | S A1; writes N | S A1; writes N | S A2 only | N | N |
| sync_conflicts | S Y | S A1 | N | N | N | N |
| conflict_resolutions, shift_reviews | S I Y | S I Y (A1) | N | N | N | N |
| device_heartbeats | S Y | S A1 | I via `heartbeat()` only for own device | own device only | N | N |
| job_runs, alert_log | S Y (R) | N | N | N | N | N |
| audit_log | S Y | S A1 limited (R) | N | N | N | N |

Anyone not listed as allowed is denied; any `using (true)` policy fails T-CLD-03-N3.

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CLD-03-U1 | `is_member` returns correct booleans | Fixture orgs, facilities, memberships | Call helper under each principal with each facility | fixtures | True only for member facilities and allowed roles | pgTAP | Critical |
| T-CLD-03-U2 | Code hash and expiry logic | Function unit under test | Valid, 9 min old, 11 min old, used codes | 4 codes | Only first two accepted | Unit test | Critical |
| T-CLD-03-I1 | Full matrix | Fixture data above | Run every cell of matrix | matrix | Every assertion matches table | pgTAP output | Critical |
| T-CLD-03-I2 | Enrollment happy path | Console-created code | Call `enroll_device` with code | valid code, device name | Auth user created with correct claims; devices row exists; code marked used | DB query and response | Critical |
| T-CLD-03-I3 | Enrolled device reads only its facility | Device from I2 | Query zones, tariffs, open_sessions for A1 and A2 | claims for A1 | A1 rows returned, A2 none | pgTAP or API test | Critical |
| T-CLD-03-I4 | Revocation fails closed | Enrolled device | Set `revoked_at`; device calls sync endpoints | revoked device | 401 or 403 on next request | API response | High |
| T-CLD-03-E1 | Enrollment end to end with Console and gate stubs | Console code endpoint and gate scan stub | Generate code, scan, enroll, first sync | stubs | Device appears in Console list and syncs | Cross-team test log | High |
| T-CLD-03-N1 | Guard device attempts direct insert, update, delete on `events` | Device principal | Run each statement | sample event | All denied | pgTAP `throws_ok` | Critical |
| T-CLD-03-N2 | Cross-facility read | Device of A2 | Select A1 data | A1 ids | Zero rows | pgTAP | Critical |
| T-CLD-03-N3 | Permissive policy lint | All policies | Query policy definitions for literal `true` | catalog | None found | pgTAP | High |
| T-CLD-03-N4 | Code reuse | Used code | Call `enroll_device` again | same code | `CODE_USED`, no new user | Response and DB count | Critical |
| T-CLD-03-N5 | Brute force | One code, 6 wrong attempts | Call 6 times | wrong codes | After 5 attempts `RATE_LIMITED`; correct code now also fails | Response | High |
| T-CLD-03-N6 | Manager from another facility creates code for A1 | Manager of A2 | Insert enrollment code for A1 | A1 id | Denied | pgTAP | Critical |
| T-CLD-03-R1 | Earlier tests after policy change | Previous suites | Re-run `T-CLD-02-*` and ingest tests | suite | All pass | CI | High |
| T-CLD-03-X1 | Two phones race one code | One valid code | Two parallel calls | same code | Exactly one succeeds | Script and DB count | High |
| T-CLD-03-X2 | Expiry uses database time | Phone clock set ahead | Enroll with skewed client clock | skewed client | Expiry decided by server | Response | Medium |

### D.4 CLD-04 Heartbeat

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CLD-04-U1 | Value validation | Function | Call with negative queue, battery 120, null version | bad values | Rejected | pgTAP | Medium |
| T-CLD-04-I1 | Upsert and 5-minute window | Enrolled device | Call twice within 1 minute, then after window (time travel) | two payloads | First stored, second ignored, third stored | DB rows | High |
| T-CLD-04-N1 | Device writes another device's row | Two devices | Device A passes device B id | B id | Rejected | pgTAP | Critical |
| T-CLD-04-N2 | Guard-level read | Guard device | Select `device_heartbeats` | none | Denied except own row per matrix | pgTAP | Medium |
| T-CLD-04-X1 | Volume | 200 devices simulated | One call per device | 200 calls | No errors, upsert latency under 100 ms p95 | k6 | Medium |

### D.5 CLD-05 KPI views

Seed fixture: three facilities with known events (Anamika's seed, `CON-11`), plus a "golden day" with hand-computed answers: 100 entries, 90 exits, 10 overrides, 5 pass entries, known cash and UPI totals, one orphan exit, one duplicate exit, one midnight-spanning session.

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CLD-05-U1 | Daily KPIs on golden day | Golden fixture | Select `v_daily_kpis` | golden day | Equals hand-computed row exactly | pgTAP `results_eq` | Critical |
| T-CLD-05-U2 | Zone now equals occupancy definition | Golden fixture and Afzal's fixtures | Compare `v_zone_now` with `occupancy.ts` expected outputs | shared fixtures | Identical per zone | Cross-team test | Critical |
| T-CLD-05-U3 | Hourly bucket edges | Events at 00:00, 00:59:59, 01:00 local | Select `v_hourly` | edge events | Correct buckets; local timezone honoured | pgTAP | High |
| T-CLD-05-I1 | RLS applies through views | Manager and other-facility manager | Select views | two principals | Each sees only their facility | pgTAP | Critical |
| T-CLD-05-I2 | Oracle comparison | Seed with 30 days of events | Independent SQL (not views) computes same KPIs; compare | oracle query | Exact match | Script diff | High |
| T-CLD-05-N1 | Empty facility | Facility without events | Select views | none | Zero values, no error | pgTAP | Medium |
| T-CLD-05-R1 | Column contract unchanged | IC-07 column list file | Compare view columns to list | list | Same names and types | pgTAP | High |
| T-CLD-05-X1 | Performance after load | k6 run complete (D.10) | Time view queries | load data | p95 under 500 ms | k6 and `EXPLAIN` log | High |

### D.7 CLD-07 Alerts

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CLD-07-U1 | Overstay selection | Fixed clock, threshold 240 min | Sessions of 239, 240, 241 min | three sessions | Only 240+ selected (rule: at or over threshold, decide and document) | pgTAP | High |
| T-CLD-07-U2 | Once per session | Alert already logged | Run twice | same session | One log row, one send | pgTAP | Critical |
| T-CLD-07-U3 | Stale device rule | Heartbeat 29, 31 min old | Run `stale_devices` inside and outside opening hours | devices | Flag only 31 min inside hours | pgTAP | High |
| T-CLD-07-I1 | Delivery path | Resend sandbox | Run overstay job | one overstay | Email accepted; `alert_log` sent | Resend log | High |
| T-CLD-07-I2 | Recovery clears stale marker | Stale device | New heartbeat; run job | heartbeat | Marker cleared; next silence is a new episode | DB | Medium |
| T-CLD-07-N1 | Concurrent runs | Two overlapping invocations | Run in parallel | same data | No duplicates (unique constraint) | DB count | High |
| T-CLD-07-X1 | Scale | 500 open sessions | Run job | synthetic | Completes in under 10 s | job duration | Low |

### D.8 CLD-08 Retention, export, delete

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CLD-08-I1 | Purge by retention | Facility with 90-day data, retention 30 | Run `retention_purge` | seed | Only rows older than 30 days removed; open sessions kept | DB counts | High |
| T-CLD-08-I2 | Export completeness | Facility seed | Call `data_export` as owner | facility | CSV row counts equal DB counts; columns match documented list | Reconciliation script | High |
| T-CLD-08-I3 | Facility deletion | Facility with files in bucket | Run delete flow | facility | Zero rows and zero objects remain; `audit_log` entry has no personal data | DB and bucket listing | High |
| T-CLD-08-N1 | Export by non-owner | Manager and other-org owner | Call export | facility | Denied | Response | Critical |
| T-CLD-08-N2 | Application role cannot delete events | Guard device, manager, owner | `delete from events` | any | Denied for every role except purge role | pgTAP | Critical |
| T-CLD-08-N3 | Purge failure | Force error mid-run | Run purge | injected error | Data intact (transaction), alert raised | DB and alert | Medium |
| T-CLD-08-X1 | Export scale | 1 million events (synthetic) | Export | synthetic | Completes without timeout or in chunks; memory stable | Run log | Low |

### D.9 CLD-09 Pipelines

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CLD-09-I1 | CI green path | Sandbox repo | Open PR with trivial change | none | All jobs green; required checks listed | Actions log | High |
| T-CLD-09-I2 | Staging deploy | CI green | Merge to `main` | none | Migrations, functions, Console deployed; health check passes | Actions log | High |
| T-CLD-09-I3 | Production approval | Tag `v0.0.0-test` on sandbox | Push tag | tag | Waits for approval; proceeds only after reviewer approves | Actions UI | Critical |
| T-CLD-09-N1 | Failing migration | Broken SQL file | Open PR | broken migration | CI fails in `db` job; merge blocked | Actions log | High |
| T-CLD-09-N2 | Unapproved merge | Branch protection | Try to merge without approval | none | Blocked | Settings and attempt | High |
| T-CLD-09-X1 | Concurrent deploys | Two staging deploys queued | Trigger both | two commits | Run serially via concurrency group | Actions log | Medium |

### D.10 CLD-10 Monitoring and recovery, plus load test

**k6 ingest load test (T-CLD-10-X1 and T-CLD-05-X1 data).** Staging project, 20 simulated enrolled devices, each sending one event every 5 seconds for one hour (H), with batches arriving after simulated outages (devices paused 5 to 10 minutes then flushing). Pass: `ingest_events` p95 under 300 ms (H), no failed batches, views under 500 ms at the end of the test (H). Script `tools/load/ingest.k6.js` (R).

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CLD-10-I1 | Uptime alert | Uptime monitor live | Temporarily make health route return 503 | forced failure | Page to on-call after 2 failures | Alert received log | Critical |
| T-CLD-10-I2 | Failed job alert | Alert wired to `job_runs` | Insert a failing job run | fake failure | Alert received | Alert log | High |
| T-CLD-10-I3 | Email failure alert | Resend webhook | Send to a bounce test address | bounce address | Bounce recorded and alerted | Resend and alert log | Medium |
| T-CLD-10-E1 | Restore drill | A production-like backup exists | Run `restore_drill.sh`: restore to fresh project; compare row counts and per-table checksums | backup | Counts and checksums match; elapsed time logged | `ops/restore-log.md` | Critical |
| T-CLD-10-N1 | Silenced alert expiry | Silence rule with expiry | Wait past expiry in test | rule | Alert resumes | Alert log | Low |
| T-CLD-10-X1 | k6 ingest load | As above | Run one-hour test | 20 devices | Thresholds above | k6 summary | High |

### D.11 Migration rehearsal protocol (CLD-02, run before every production tag)

1. Take a logical copy of staging (anonymized, or only synthetic data in the pilot's early phase).
2. Restore it into a throwaway project.
3. Apply only the migrations that are new in the tag.
4. Run the pgTAP suite and the row-count script.
5. Record result in `ops/migration-rehearsals.md` (R): tag, migrations applied, duration, counts before and after.

## E. Acceptance Criteria and Completion Checklist

### E.1 Per feature checklist (adapt; not every item applies to every row)

| Feature | Checklist | Evidence required |
| --- | --- | --- |
| CLD-01 | [ ] three projects, Mumbai region [ ] secrets inventory [ ] scanner active [ ] production reviewers set [ ] T-CLD-01-* run | Exported settings, CI log, inventory file |
| CLD-02 | [ ] 0001..0010 plus CLD-08's applied from scratch [ ] forward rehearsal done [ ] RLS on every table [ ] types generated and compile [ ] T-CLD-02-* run | CI logs, rehearsal log |
| CLD-03 | [ ] matrix green [ ] enrollment single-use and expiring [ ] revocation fails closed [ ] no permissive policy [ ] Afzal reviewed permission change [ ] T-CLD-03-* run | pgTAP output, matrix doc, review approval |
| CLD-04 | [ ] 5-minute window [ ] own-device only [ ] read policy [ ] T-CLD-04-* run | pgTAP, k6 output |
| CLD-05 | [ ] oracle match [ ] same definition as `occupancy.ts` [ ] RLS through views [ ] p95 under 500 ms [ ] T-CLD-05-* run | pgTAP, diff output, k6 summary |
| CLD-07 | [ ] once-only overstay [ ] stale rule [ ] alert delivery [ ] T-CLD-07-* run | pgTAP, Resend log |
| CLD-08 | [ ] purge, export, delete verified [ ] events delete only by purge role [ ] legal review done (OQ-12) [ ] T-CLD-08-* run | Reconciliation output, review note |
| CLD-09 | [ ] CI required on `main` [ ] staging auto deploy [ ] production approval [ ] failure injection done [ ] T-CLD-09-* run | Actions logs, branch protection export |
| CLD-10 | [ ] every alert fire-tested [ ] on-call named [ ] backups restorable [ ] drill logged [ ] k6 pass [ ] T-CLD-10-* run | Alert logs, restore log, k6 summary |

### E.2 Global acceptance (applies to all CLD features)

- [ ] Functional requirements satisfied.
- [ ] Input validation present.
- [ ] Success and error states handled.
- [ ] Authorization enforced and tested in the database.
- [ ] Persistence verified by query.
- [ ] Required unit and integration tests written, run, and results attached.
- [ ] Relevant end to end tests run.
- [ ] Regression suite (earlier waves) run.
- [ ] No unresolved critical defects.
- [ ] Runbook or documentation updated.
- [ ] Code reviewed by a member of a different workstream.
- [ ] Integration with dependent modules verified by the contract tests in section F.

---

## F. Dependencies and Integration Contracts

All contract shapes are **(R)** unless stated; IC numbers and parties follow README section 5.

| IC | Role of Akanksha | Counterparty | Interface and formats | Failure semantics | Availability needed | Contract test |
| --- | --- | --- | --- | --- | --- | --- |
| IC-01 Event schemas | Consumer | Afzal (`SYNC-01`) | Event type list, reason codes, `SCHEMA_VERSION`; mirrored as SQL check constraints | Mismatch makes CI fail | Before `0003` merges | `T-IC01-C1`: script compares SQL enums to zod enums and fails on difference |
| IC-03 Ingest function | Deployer and reviewer | Afzal writes | `ingest_events(events jsonb)`; idempotent on id; rejects unknown or inactive staff into quarantine response | Validation failure returns per-event errors, never aborts the whole batch silently | Wave 1 | `T-IC03-C1`: replay same batch three times, one row each; unknown staff rejected; batch with one bad event stores the good ones and reports the bad one |
| IC-05 Device enrollment | Provider | Anamika (QR screen), Nikhil (scan) | Request `{code, device_name}`; response `{device_id, email, password, facility_id}` once; errors `CODE_INVALID`, `CODE_EXPIRED`, `CODE_USED`, `RATE_LIMITED` | Generic failure, no hints | Wave 2 | `T-IC05-C1`: stub client calls with valid, expired, used and wrong codes and asserts codes and shapes |
| IC-06 Staff PIN hashes | Provider of `staff` table and restricted device view | Anamika sets PIN; Nikhil verifies offline | Device view columns: id, name, pin_hash, pin_salt, active, for own facility only | Inactive staff excluded; device cannot see other facilities | Wave 2 | `T-IC06-C1`: device principal selects the view; asserts column list and facility scope; base table denied |
| IC-07 KPI views | Provider | Anamika | Column names and types of the three views | Empty facility returns zeros | Wave 4 | `T-CLD-05-R1` |
| IC-08 Report route | Consumer | Anamika | Route and secret header; PDF and Excel | Non-200 triggers retry, then failed run | Wave 5 | `T-IC08-C1`: job against a stub of the route with 200, 500, timeout |
| IC-09 Heartbeat | Provider | Afzal sender, Anamika reader | Function signature (H) and row columns | Ignored inside window; error on mismatched device | Wave 5 | `T-IC09-C1`: call with the exact signature; read as manager |
| IC-10 Conflict records | Reviewer of table and policy | Afzal writes detector; Anamika reads and resolves | `sync_conflicts` and `conflict_resolutions` columns and RLS | Resolution never edits events | Wave 3 and 4 | `T-IC10-C1`: manager can insert resolution, cannot update events; guard cannot read conflicts |

### F.1 Other dependencies

| Dependency | Owner | Needed for | Milestone (ordering) |
| --- | --- | --- | --- |
| Monorepo and branch rules | Afzal (`REL-01`) | `CLD-09` | Wave 0 |
| Fixtures for occupancy | Afzal | `T-CLD-05-U2` | Before views merge |
| Console `/api/health` route | Anamika | `CLD-10` | Wave 5 |
| Seed data | Anamika (`CON-11`) with Akanksha's `seed.sql` | Tests D.5 | Wave 1 |

### F.2 Likely conflicts over shared files

| Shared item | Risk | Rule |
| --- | --- | --- |
| `supabase/migrations/` | Two authors add the same number | CI uniqueness check; one migration PR at a time per number; Afzal's sync migrations reserve `0004` to `0006` |
| `0010_rls.sql` | Policies for tables created later | Each later migration adds its own policies in the same file; `0010` covers earlier tables only (clarify with Afzal, since the Handbook lists `0010` as "all policies": recommendation is to treat `0010` as the baseline file and add policies per new table in the migration that creates it) |
| View definitions | Console wants new columns | Additive change only; breaking change needs Anamika and a new view version |
| `ops/` runbooks | Multiple authors | Akanksha owns; others propose by PR |

---

## G. Error Handling and Edge Cases

| Situation | Expected behaviour |
| --- | --- |
| Migration fails midway | Whole migration is one transaction where possible; CI blocks; production deploy aborts before functions and Console |
| Edge Function timeout | Function returns controlled error; caller retries with idempotent keys |
| `pg_net` call fails silently | Job records `failed` after the timeout; alert raised; no partial email |
| Resend outage | Retry next run (bounded); `job_runs` shows pending; alert after cap |
| Duplicate scheduler invocation | Idempotency keys and unique constraints prevent duplicates |
| Clock differences | Database clock decides expiry and heartbeat windows; `device_time` never used for security |
| Revoked device or removed member | Next request fails closed; no stale cache grants access |
| Stale views | Views are computed on read (no materialization in pilot); if materialized later, the Console must show "as of" |
| Backup exists but restore fails | Treat as no backup; drill failure is a Critical incident |
| Facility deleted with unsynced phone data | Warn before deletion; devices fail closed; unsynced events are lost and the owner is told |
| Large export | Chunked streaming; never load the whole file in memory |
| Time zone ambiguity | Facility `timezone` column drives all local date logic |
| Disk or plan limit hit | Alert at 70% of plan limit (H); runbook step to archive or upgrade |
| Key leak | Rotate immediately (H); redeploy; inventory updated |

---

## H. Security, Privacy and Data Integrity

- **Access control.** RLS on every table, policies per role as the matrix in D.3; `anon` has nothing. No `using (true)`.
- **Append-only events.** `UPDATE` and `DELETE` revoked for every application role (H). The only exception is the purge role used by the nightly retention job, documented and audited.
- **Authentication.** Devices are Supabase auth users created only by `enroll_device`; no guard passwords in Supabase (H). Enrollment codes hashed at rest, single use, 10 minute lifetime.
- **Secrets.** In GitHub environments and Supabase secrets only; no secrets in repository, prompts, chat or logs (H). Service-role key only inside functions and CI.
- **Personal data.** Vehicle number and optional phone number only (H). No plate numbers on measurement sheets. Encryption in transit and at rest provided by the platform (verify in project settings).
- **DPDP Act 2023.** Consent text, retention per facility, export and deletion built in (CLD-08). Defaults and wording need legal review (OQ-12).
- **Audit.** `audit_log` is append-only and records enrollment, revocation, exports, deletions and policy-protected admin actions.
- **Abuse prevention.** Rate limits on `enroll_device` and `heartbeat`; export limited to one facility per call; signed URLs expire in 7 days.
- **Error responses.** Generic messages to clients; detail only in server logs.
- **Integrity.** Idempotent writes; unique constraints for once-only behaviours; transactions around purge and delete.
- **Supply chain.** Pin versions of actions and dependencies; secret scanner in CI.

---

## I. Deliverables

### I.1 Required

| Deliverable | Where |
| --- | --- |
| Three configured environments and secrets inventory | Supabase, GitHub, `ops/secrets-inventory.md` |
| Migrations `0001`, `0002`, `0003`, `0007` to `0010`, plus CLD-08's own (`0011` is the IC-01 validation migration, PR #56; CLD-08's number is assigned at promotion, not fixed here, OQ-64) and review sign-off of `0004` to `0006` | `supabase/migrations/` |
| Generated types | `packages/db-types` |
| RLS policies, helper functions, `enroll_device` | `0010_rls.sql`, `supabase/functions/enroll_device` |
| Heartbeat table and function | `0008_device_heartbeats.sql` |
| Views | `0009_views_kpis.sql` |
| Scheduler jobs, report email function, alert jobs | `<next-free>_*` (CLD-08's own migration, OQ-64), `supabase/functions/send_report_email` |
| Export, purge, delete | `<next-free>_retention_and_export.sql` (OQ-64), `supabase/functions/data_export` |
| Pipelines | `.github/workflows/` |
| pgTAP suite, k6 script, restore drill script | `supabase/tests/`, `tools/load/`, `tools/restore/` |
| Runbook, alert catalog, RLS matrix, DPDP procedure | `ops/` |
| Measurement sheets, calculation scripts, weekly pack template and queries | `ops/metrics/` |
| Test execution evidence for every feature | Attached to pull requests and linked from `feature-traceability.md` |
| Known limitations list | `ops/known-limitations.md` (R) |

### I.2 Optional improvements (only after the pilot-readiness gate)

- SMS or WhatsApp for overstay alerts (MSG91, add-on per Handbook).
- Dynamic per-vehicle UPI QR confirmation (post-pilot; README OQ-05).
- Materialized views if view latency requires it.
- Terraform or equivalent for projects (not needed for three projects).

---

## J. Definition of Done

A feature is done only when all of the following hold:

1. Implemented as specified in C, with every file listed in "Files" existing and reviewed.
2. Every test in D for that feature has been written, executed, and its output attached. Tests that cannot run because infrastructure is missing are recorded as "not run, reason", never as passed.
3. Acceptance criteria in E are all ticked with evidence.
4. Contract tests in F for any contract the feature provides or consumes pass in CI.
5. Reviewed and approved by a member of a different workstream; permission, payment and sync changes also approved by Afzal.
6. Runbook or documentation updated; alerts added to `ops/alerts.md` where the feature can fail.
7. No unresolved critical defect.
8. Traceability row updated in `feature-traceability.md` with status "Implemented and verified" only after items 1 to 7.

**Commands (recommended, to be confirmed once the repo is scaffolded; none has been run).**

```text
supabase start                         # local stack
supabase db reset                      # apply all migrations from scratch
supabase test db                       # run pgTAP tests in supabase/tests
supabase gen types typescript --local > packages/db-types/index.ts
supabase db push                       # staging or production (CI only)
supabase functions deploy enroll_device
supabase functions serve               # local function testing
k6 run tools/load/ingest.k6.js         # load test against staging
bash tools/restore/restore_drill.sh    # restore drill into a fresh project
```

**Cloud pilot-readiness sign-off (Akanksha's part of the gate, README section 12):** permission tests green, restore drill logged, alerts reaching a named person, uptime check live, k6 thresholds met, deliverability proven.

## K. Known gaps in this sheet

- No code, migrations or configuration exist to verify any claim of implementation.
- Table columns and function shapes marked (R) need agreement with Afzal and Anamika when written.
- The `0010_rls.sql` scope (all policies vs per-migration policies) differs between the Handbook wording and the recommendation in F.2; resolve with Afzal.
- Retention defaults, consent text and the production backup plan are open (OQ-07, OQ-12).
- The report route contract (single file per request vs both files) needs Anamika's decision.
