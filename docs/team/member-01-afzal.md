# Implementation Sheet: Afzal (Lead) — Architecture, Sync Core, Releases, Partners

Features: SYNC-01 to SYNC-07, REL-01, PRT-01. Master document: [README.md](README.md). Traceability: [feature-traceability.md](feature-traceability.md). Open questions: [open-questions-and-assumptions.md](open-questions-and-assumptions.md).

## 0. Honesty notes and labelling convention

- The repository contains **no application code, no git history, no tests, no CI**. Every feature below has status **Not implemented**. Nothing is "implemented and verified".
- **[SPEC]** marks a name or behaviour stated in the earlier PRD or Handbook documents (event types, table names such as `events`, `open_sessions`, `sync_conflicts`, `device_heartbeats`, view names, reason codes, conflict types, release protocol).
- **[REC]** marks **Recommended (does not exist yet)**: file names, function signatures, constants, commands and thresholds that are proposals for the team to confirm.
- No test in this sheet has been run. All verification statuses are **Not verified**.
- No dates or time estimates are given; ordering comes from README section 6.

---

## A. Role and Ownership

### A.1 Objective

Make ParkOS trustworthy offline. A record created on a guard phone with no internet must reach the cloud exactly once, land in the right place, and when two phones disagree the disagreement must be shown to a person, never silently resolved or dropped. Afzal also leads architecture, releases and the design-partner relationship.

### A.2 Scope of responsibility (owned entirely)

| Area | Owned artefact | Label |
| --- | --- | --- |
| Shared types | `packages/contracts` (event schemas, money, reason codes, schema version) | [SPEC] package; file names [REC] |
| Sync client | `packages/sync-rules` (local schema, upload connector, backoff, occupancy, conflict hints, health) | [SPEC] package; file names [REC] |
| Sync-critical SQL | Migrations for `ingest_events`, `open_sessions`, conflict detector (numbered 0004 to 0006 in Handbook) | [SPEC] |
| Simulation | `tools/sim/` harness | [REC] |
| Engineering process | `CLAUDE.md`, monorepo layout, branch rules, release tagging and rollback | [SPEC] CLAUDE.md; rest [REC] |
| Partners | Pilot pipeline, agreements, day-30 pricing meetings | [SPEC] (Phase 2 plan) |

### A.3 Features owned

SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, SYNC-06, SYNC-07, REL-01, PRT-01.

### A.4 Features explicitly outside scope

Gate app screens, fare engine, printer and PIN login (Nikhil). Console pages, report templates, wizard (Anamika). RLS policies, device enrollment function, KPI views, CI pipeline files, backups, scheduled jobs (Akanksha). Afzal reviews but does not own those. Physical audits (MET-01/02/03) are Akanksha's.

### A.5 Relevant modules and files (all [REC] unless noted)

```text
packages/contracts/src/{events.ts, money.ts, reasonCodes.ts, version.ts, index.ts}
packages/sync-rules/src/{schema.ts, powersync.yaml (or pull.ts if outbox), connector.ts,
                         backoff.ts, occupancy.ts, conflicts.ts, health.ts, index.ts}
supabase/migrations/0004_events_ingest.sql        [SPEC name]
supabase/migrations/0005_open_sessions.sql        [SPEC name]
supabase/migrations/0006_conflict_detector.sql    [SPEC name]
tools/sim/{run.ts, scenario.ts, oracle.ts, network.ts, report.ts}
CLAUDE.md, .github/CODEOWNERS, docs/release.md
```

### A.6 Dependencies on other members

| Needs | From | For |
| --- | --- | --- |
| Base tables (`facilities`, `zones`, `staff`, `devices`, `events`) | Akanksha CLD-02 | SYNC-02, SYNC-03, SYNC-05 |
| Device auth claims (`facility_id`, `device_id`, role `device`) | Akanksha CLD-03 | SYNC-02, SYNC-03 |
| `heartbeat(...)` function and `device_heartbeats` table | Akanksha CLD-04 | SYNC-06 |
| Gate flows that call `writeEvent` | Nikhil GATE-01, GATE-02 | SYNC-07 |
| ROI data from baseline studies | Anamika CON-12 | PRT-01 |

### A.7 Decisions Afzal can make independently

Sync architecture within the rules in this sheet; internal file structure of `sync-rules`; backoff constants; batch size; conflict-detection internals; simulation design; release cadence rules; which partner to approach first.

### A.8 Decisions requiring coordination

| Decision | With whom | Reason |
| --- | --- | --- |
| Any change to `packages/contracts` | All four (PR approval) | Every workstream imports it |
| PowerSync vs hand-rolled outbox result | Nikhil (API stays the same), Akanksha (infra) | Changes setup, cost and tests |
| Changing event types or reason codes | All four; Anamika for report wording | Reports and UI depend on them |
| Minimum supported schema version bump | Nikhil (rollout of app build), Akanksha (cloud config) | Blocks old apps from syncing |
| Pilot commercial terms | Product decision, see OQ-10 | Not an engineering choice |

---

## B. Feature Inventory

All statuses: **Not implemented**. Priorities: Critical, High, Medium.

| ID | Feature | Business purpose | User / system | Status | Required final behaviour | Priority | Dependencies | Acceptance criteria (summary) | Testing requirements |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SYNC-01 | Contracts package | One definition of every record so phone, cloud and Console cannot disagree | All code | Not implemented | Exports validated schemas and types for 7 event types, money helpers, reason codes, `SCHEMA_VERSION` | Critical | none | All event samples validate; invalid samples rejected; money never floating point | Unit tests for every schema and helper; contract tests IC-01 |
| SYNC-02 | Upload outbox and idempotent ingest | Phone records reach the cloud exactly once | Gate app, cloud | Not implemented | Unsent events batched, uploaded, marked sent; retries never duplicate; bad events quarantined | Critical | SYNC-01, CLD-02 | Same batch three times gives one row each; quarantine after 5 rejections | Unit, integration against a real Postgres, chaos tests |
| SYNC-03 | Download sync of config and `open_sessions` | Phone knows facility setup and who is inside, offline | Gate app | Not implemented | Config tables and `open_sessions` sync to the phone; stack decision (PowerSync or outbox) made with go/no-go | Critical | SYNC-01, CLD-02, CLD-03 | Config edit in Console appears on phone after sync; phone never edits config | Integration, spike evidence, e2e |
| SYNC-04 | Occupancy computation | Live zone counts that survive offline and drift | Gate app, Console | Not implemented | Pure function over open sessions, local events and latest zone count baseline | Critical | SYNC-01, SYNC-03 | Counts match oracle in every simulated checkpoint; never negative | Unit, property-based, simulation |
| SYNC-05 | Conflict detection and records | Show disagreements instead of hiding them | Cloud, Console | Not implemented | Four conflict types created without altering events | Critical | SYNC-02 | Each type fires on its crafted case and not on clean data | Unit (SQL), integration, simulation |
| SYNC-06 | Health signals, heartbeat sender, quarantine | Operators and team see sync trouble early | Gate app, Console, on-call | Not implemented | Exposes queue depth, oldest unsynced age, last sync, online flag; sends heartbeat at most every 5 minutes online; quarantine list | High | SYNC-02, CLD-04 | Metrics match injected backlog; heartbeat arrives within the interval | Unit, integration, e2e |
| SYNC-07 | Simulation harness | Proof of the offline promise before any pilot | Team | Not implemented | Replays 300 vehicles over a compressed 6-hour timeline with two virtual devices and outages; asserts against oracle | Critical | SYNC-02 to SYNC-05, GATE-01, GATE-02 | Zero lost or duplicated sessions; zone counts equal oracle at 6 checkpoints; only injected conflicts | The harness is the test; tested for determinism |
| REL-01 | Monorepo, CLAUDE.md, review and release rules | Small team stays consistent with AI-assisted coding | Team | Not implemented | Repo scaffold, ownership rules, release and rollback documented and enforced | High | none | CI-enforced reviews; documented rollback tested once | Process checks, rollback drill |
| PRT-01 | Partner pipeline, agreements, day-30 meeting | Convert pilots into paying customers | Afzal, partners | Not implemented | Named decision-maker and day-30 meeting booked before each pilot starts | High | CON-12 | No pilot starts without a booked day-30 meeting | Checklist audit |

---

## C. Feature-by-Feature Implementation Instructions

Conventions shared by SYNC features: IDs are UUIDv7 created on the device; timestamps are UTC ISO 8601 as `device_time`, with the server adding `received_at` [SPEC]; money is integer paise [SPEC]; events are insert-only [SPEC].

### SYNC-01: Contracts package

1. **Problem.** Three codebases (phone, Console, SQL) must agree on the shape of every record.
2. **Expected behaviour.** Importing `@parkos/contracts` [REC package name] gives typed, validated schemas. Parsing unknown data returns a typed error, never a partial object.
3. **Preconditions.** Monorepo scaffold from REL-01 exists. Event types and reason codes are fixed by the Handbook [SPEC]: `ENTRY`, `EXIT`, `PAYMENT`, `OVERRIDE`, `ZONE_COUNT`, `SHIFT_OPEN`, `SHIFT_CLOSE`; `LOST_TOKEN`, `DAMAGED_TOKEN`, `MISREAD_NUMBER`, `WRONG_CLASS`, `OWNER_WAIVER`, `STAFF_VEHICLE`, `OTHER`.
4. **Implementation sequence.**
   1. Define `BaseEvent` (zod, [REC]): `id` (UUIDv7 string), `type`, `facility_id`, `device_id`, `staff_id`, `session_id` (nullable for shift and zone events), `device_time`, `source` (`LIVE` or `PAPER_BACKFILL`), `schema_version`, `payload`.
   2. Define one payload schema per type and a discriminated union `Event`:
      - `ENTRY`: `vehicle_class`, `zone_id`, `short_code`, optional `vehicle_no`, optional `pass_id`.
      - `EXIT`: `fare_paise`, `exit_method` (`SCAN`, `CODE`, `LOOKUP`).
      - `PAYMENT`: `mode` (`CASH`, `UPI`, `PASS`, `WAIVED`), `amount_paise`, `upi_attested` boolean (true only when `mode = UPI`).
      - `OVERRIDE`: `target_event_id`, `reason_code`, optional `note` (required when `OTHER`), `change` (for example corrected class).
      - `ZONE_COUNT`: `zone_id`, `counted`, `system_count_at_time`.
      - `SHIFT_OPEN`: `opening_float_paise`.
      - `SHIFT_CLOSE`: `counted_cash_paise`, `expected_cash_paise`, `upi_total_declared_paise`, `upi_attested_sum_paise`, `variance_cash_paise`, `variance_upi_paise`, optional `reason`.
   3. `money.ts`: `toPaise(rupeesString)`, `formatRupees(paise)`, `add`, `sub`; reject floats and negative amounts where meaningless.
   4. `reasonCodes.ts`: const tuple and zod enum.
   5. `version.ts`: `SCHEMA_VERSION` integer, starting at 1; export `isSupported(version, min)`.
   6. `uuid.ts` [REC]: `newId()` returning UUIDv7.
   7. Export a JSON Schema generated from zod for the SQL side to mirror in CHECK constraints (Akanksha uses it in CLD-02).
5. **Files.** `packages/contracts/src/{events.ts, money.ts, reasonCodes.ts, version.ts, uuid.ts, index.ts}` [REC]; tests next to each file.
6. **Functions and models.** `Event`, `EventType`, `parseEvent(input): Result<Event, Issues>`, `toPaise`, `formatRupees`, `newId`, `SCHEMA_VERSION`, `ReasonCode`.
7. **Input and output contract.** Input: unknown JSON. Output: typed `Event` or a list of issues with paths. No partial acceptance.
8. **Data flow.** Gate app builds events with these types, sync package validates before storing, Console imports the same types, SQL CHECK constraints mirror the enums.
9. **Validation rules.** Amounts are non-negative integers; `upi_attested` true only with mode `UPI`; `note` required with `OTHER`; `session_id` required for `ENTRY`, `EXIT`, `PAYMENT`, `OVERRIDE`; `device_time` parses as UTC; unknown `type` rejected.
10. **Success behaviour.** Valid events parse and round-trip through JSON unchanged.
11. **Failure behaviour.** Invalid input returns issues; callers must not save the event.
12. **Edge cases.** Rupee strings like `"10.50"` and `"10.5"`; very large amounts beyond safe integers rejected; `session_id` reuse across types is expected (ENTRY and EXIT share it).
13. **Security.** No personal data beyond optional `vehicle_no`; no secrets; document that `vehicle_no` is personal data under the Digital Personal Data Protection Act, 2023.
14. **Logging.** None in this package; callers log parse failures with event id and issue paths, never the full payload.
15. **Tests summary.** Section D, T-SYNC-01-*.
16. **Acceptance criteria.** All sample events (one per type, at least two valid variants each) validate; at least 10 invalid samples rejected with correct issue paths; money helpers pass table tests; package builds and is imported by a dummy consumer in each of the two apps.
17. **Definition of done.** Merged with approval from all four (shared package rule); IC-01 contract test in CI; SCHEMA_VERSION documented in `docs/release.md` [REC]; Akanksha confirms SQL constraints mirror the enums.

### SYNC-02: Upload outbox and idempotent ingest

1. **Problem.** Phones go offline mid-batch, retry, reboot. Records must arrive once, never twice, never lost.
2. **Expected behaviour.** Events written locally are uploaded in order in batches of 50 [REC]. The cloud function `ingest_events` stores each event once (`on conflict (id) do nothing`) and returns per-event results (`accepted`, `duplicate`, `rejected` with code). Rejected events are retried up to 5 times and then moved to a local `quarantine` table with a visible banner.
3. **Preconditions.** SYNC-01 merged; `events` table exists with primary key `id uuid` (CLD-02, columns specified in Handbook); device credentials from CLD-03 work.
4. **Implementation sequence.**
   1. Local table `events` has a `sync_state` column (`PENDING`, `SENT`, `QUARANTINED`) and `attempts` [REC].
   2. `connector.ts` `uploadBatch()`: select up to 50 `PENDING` ordered by `device_time` then `id`; call RPC; apply results in one local transaction.
   3. SQL `ingest_events(events jsonb) returns jsonb` [SPEC name; body REC]: for each element validate required keys, check `staff_id` belongs to an active staff row of the caller's `facility_id` claim, check `device_id` equals the caller's claim, insert with `on conflict (id) do nothing`; return array of `{id, result, code}`.
   4. `backoff.ts`: delay = min(2s * 2^n, 5 min) with ±20% jitter; reset on success.
   5. Trigger an upload when: an event is written, the connection returns, or the timer fires.
   6. Rejection handling: a `rejected` result increments `attempts`; at 5 move to `QUARANTINED`, store the server code, raise a banner state through SYNC-06.
   7. Ensure only one upload runs at a time (mutex in `connector.ts`).
5. **Files.** `packages/sync-rules/src/connector.ts`, `backoff.ts`, `schema.ts`; `supabase/migrations/0004_events_ingest.sql` (all as named in Handbook; internals [REC]).
6. **Functions and endpoints.** `uploadBatch()`, `nextDelay(attempt)`, RPC `ingest_events` [SPEC].
7. **Contract.** Request: JSON array of events validated by IC-01. Response: array in the same order with `result` in `accepted | duplicate | rejected` and `code` in `UNKNOWN_STAFF | INACTIVE_STAFF | WRONG_FACILITY | WRONG_DEVICE | INVALID_SHAPE | UNSUPPORTED_VERSION` [REC codes].
8. **Data flow.** `writeEvent` → local insert (`PENDING`) → upload trigger → RPC → results → local `SENT` or retry or `QUARANTINED` → trigger in cloud updates `open_sessions` (SYNC-03) and the conflict detector (SYNC-05).
9. **Validation and business rules.** Duplicate event id returns `duplicate` and counts as success. A batch is processed event by event; one bad event never blocks the others. Events whose `schema_version` is below the cloud minimum are rejected with `UNSUPPORTED_VERSION` (and the app also blocks sync, see SYNC-03).
10. **Success.** All events `SENT`; cloud row count equals local `SENT` count.
11. **Failure.** Network error: keep `PENDING`, back off. 5xx: same. Validation rejection: attempts and eventual quarantine. Auth failure (401): stop uploading and show "Sign-in needed" banner; do not drop events.
12. **Edge cases.** App killed between RPC success and local update (event re-sent, server says `duplicate`); batch partly accepted; clock skew; two phones sending the same session's `EXIT`; very large backlog after a long outage (drain in order, keep UI responsive).
13. **Security.** Function runs with caller's JWT; never accepts a `facility_id` different from the claim; never trusts `staff_id` without checking; no `update` or `delete` on `events` for any role (revoked in CLD-03).
14. **Logging and observability.** Local debug log with batch size, result counts, delay; cloud `job_runs`-style counters optional [REC]; metrics `queueDepth`, `oldestUnsyncedAgeMs`, `quarantinedCount` via SYNC-06; never log payloads with vehicle numbers.
15. **Tests summary.** T-SYNC-02-*.
16. **Acceptance criteria.** Idempotency, ordering, quarantine, auth-failure and kill-mid-write behaviours pass; throughput of a 300-event backlog drains without error; no lost events in SYNC-07.
17. **Definition of done.** Merged with Akanksha's review of the migration and Nikhil's review of the client API; contract test IC-03 in CI; chaos cases C1 to C4 of SYNC-07 pass in the harness.

### SYNC-03: Download sync and stack decision

1. **Problem.** The phone must hold facility config and the set of vehicles currently inside, so entry, exit and occupancy work with no internet.
2. **Expected behaviour.** After enrollment and first sync the phone has `facilities`, `zones`, `tariffs`, `passes`, `staff` (id, name, role, PIN hash and salt, active flag) and `open_sessions` for its facility. Changes made in the Console reach the phone at the next sync. The phone never writes these tables.
3. **Preconditions.** CLD-02 tables; CLD-03 RLS and device auth; SYNC-01 types.
4. **Implementation sequence.**
   1. **Spike (go/no-go).** Evaluate PowerSync against the Handbook rules. Go criteria (all required): passes T-SYNC-05-I1 duplicate-exit test; passes a reduced SYNC-07 run; syncs the five config tables plus `open_sessions` through two buckets (`by_facility`, `own_events`); setup fits the team's operational ability; cost visible. If any fails, choose the hand-rolled outbox: SYNC-02 upload plus a `pull.ts` that calls `GET config since <cursor>` using `updated_at` cursors, with the same local schema. Do not build both. Record the decision, evidence and date in `docs/decisions/0001-sync-stack.md` [REC].
   2. Define local tables mirroring cloud config; mark them read-only in the data layer (the API in IC-02 exposes no write for them).
   3. `open_sessions` is maintained in the cloud by a trigger (migration 0005 [SPEC]): insert row on `ENTRY`, delete on the matching `EXIT`. Sync it down for the facility.
   4. Version gate: on start and at each sync, fetch `min_supported_version`; if `SCHEMA_VERSION` is lower, set `syncBlocked = true` (offline operation continues).
   5. Staff PIN hashes sync as part of `staff` (IC-06); the data layer never exposes raw hashes outside `pinAuth`.
5. **Files.** `packages/sync-rules/src/{powersync.yaml | pull.ts, schema.ts, versionGate.ts}`; migration `0005_open_sessions.sql` [SPEC]; decision record [REC].
6. **Functions and models.** `startSync(credentials)`, `stopSync()`, `getConfig(facilityId)`, `isSyncBlocked()`.
7. **Contract.** `getConfig` returns typed config objects validated against contracts; a missing table returns an explicit "not yet synced" state, not an empty list.
8. **Data flow.** Console write → cloud table → sync → phone local table → gate app reads. Entry on phone A → upload → `open_sessions` → sync down → phone B sees the vehicle inside.
9. **Validation and rules.** Config rows carry `updated_at`; phone applies in order; deleted config rows arrive as deactivation flags, not hard deletes [REC]. Phones must not attempt writes to config tables (enforced by RLS in CLD-03).
10. **Success.** After sync, config matches cloud; `open_sessions` count equals cloud count for the facility.
11. **Failure.** Sync error keeps last known config; banner "Using saved setup, last synced HH:MM". Version too old: sync blocked banner, entry and exit continue.
12. **Edge cases.** Tariff changed mid-day (effective-dated, existing open sessions use the tariff in force at entry [REC rule, see OQ-20]); guard deactivated while offline (still accepted locally until next sync; server rejects later events with `INACTIVE_STAFF`, quarantined with a visible banner); two gates at one facility each missing the other's offline events until both sync.
13. **Security.** Row-level rules limit the bucket to the device's facility; PIN hashes are salted hashes only; no raw PIN anywhere.
14. **Logging.** Sync start, success, failure with error class; last sync time exposed for the UI.
15. **Tests summary.** T-SYNC-03-*.
16. **Acceptance criteria.** Config round-trip works; decision record exists with evidence; version gate blocks sync only; no write path to config from the phone.
17. **Definition of done.** Decision record merged and acknowledged by Nikhil and Akanksha; integration tests against a staging Supabase project pass; IC-02 and IC-06 contract tests in CI.

### SYNC-04: Occupancy computation

1. **Problem.** A single barrier counter drifts; operators need per-zone truth that survives offline and can be corrected by a physical count.
2. **Expected behaviour.** `occupancy.ts` is a pure function: `computeOccupancy({ openSessions, localEvents, zoneCounts, zones }) -> Record<zoneId, {count, capacity, baselineAt}>`. Count = latest `ZONE_COUNT` baseline for the zone (if any), then apply `ENTRY` (+1) and `EXIT` (−1) events with `device_time` after the baseline; with no baseline, count = rows of `open_sessions` in the zone plus unsynced local entries not yet in the snapshot minus unsynced local exits. Counts are never stored as an incremented counter [SPEC rule: derived, never incremented].
3. **Preconditions.** SYNC-01 types; SYNC-03 provides `open_sessions`, zones and the zone-count history.
4. **Implementation sequence.**
   1. Write the function with no I/O; inputs are arrays.
   2. De-duplicate by event id and by session id (an entry already present in `open_sessions` is not counted twice when the same event is also local).
   3. Clamp displayed counts at 0 and flag "negative drift" through the return value (`warnings`), do not hide it.
   4. Add `observeOccupancy(facilityId)` in `index.ts` that re-computes on local DB changes.
   5. Provide `drift(zoneId)` = `counted − system_count_at_time` from the latest `ZONE_COUNT`, used by the Console for the 3% drift flag (rule from Phase 2 plan, section 7).
   6. Document the two-phones-one-gate rule in `CLAUDE.md`: each phone sees its own events immediately and the other's after sync; the Console shows the merged truth.
5. **Files.** `packages/sync-rules/src/occupancy.ts` and `occupancy.test.ts` [REC].
6. **Contract.** Returns counts per zone plus `warnings: Array<{zoneId, kind: 'NEGATIVE' | 'OVER_CAPACITY' | 'STALE_BASELINE'}>` [REC].
7. **Data flow.** Local DB → arrays → pure function → UI (GATE-01 suggests the zone with space; GATE-12 shows counts); Console computes the same from cloud tables through views (CLD-05), and a test asserts both agree on seed data.
8. **Rules.** Capacity comes from zone config; an entry may proceed when a zone is at or over capacity (guard decision, with a banner) because refusing a vehicle is an operator policy [REC, see OQ-23]; vehicle-class compatibility is applied by GATE-01 using zone config, not here.
9. **Success.** Counts equal the oracle in every simulated checkpoint.
10. **Failure.** Missing zone config returns an explicit error, not zeros.
11. **Edge cases.** Exit for a session unknown locally (orphan exit): do not decrement; surface in `warnings`; baseline set after events with later `device_time`; skewed device clocks (use `device_time` but ignore events more than 5 minutes ahead of the receiving clock until corrected [REC]); duplicate events across `open_sessions` and local store.
12. **Security.** Pure function; no personal data used.
13. **Logging.** Return `warnings`; GATE app logs counts of warnings, never vehicle numbers.
14. **Tests.** T-SYNC-04-*; includes property-based tests.
15. **Acceptance.** Property tests (random sequences never negative after clamp; order-independent for events after a baseline) pass; table tests for baseline correction pass; Console and phone agree on the seed scenario.
16. **Definition of done.** Merged with Nikhil and Anamika reviewing the return shape; `occupancy.ts` under test with coverage reported (target set in REL-01); used by GATE-12 and CON-04.

### SYNC-05: Conflict detection and records

1. **Problem.** Two offline phones, clock errors and staff mistakes produce records that disagree. Events must never be edited or dropped, so disagreement must be recorded for a person.
2. **Expected behaviour.** A trigger after insert on `events` writes to `sync_conflicts` [SPEC table] for four types [SPEC]: `DUPLICATE_EXIT` (two exits, one `session_id`), `ORPHAN_EXIT` (exit with no entry), `DUPLICATE_ENTRY` (same non-null vehicle number open in two sessions at once), `CLOCK_SKEW` (`device_time` more than 5 minutes from `received_at`).
3. **Preconditions.** `events` and `sync_conflicts` tables exist; SYNC-02 ingest in place.
4. **Implementation sequence.**
   1. `sync_conflicts` columns [REC]: `id`, `facility_id`, `type`, `event_ids uuid[]`, `session_id`, `status` (`OPEN`, `RESOLVED`), `detail jsonb`, `created_at`, `resolved_by`, `resolved_at`. Resolution rows live in `conflict_resolutions` (CON-07 writes them).
   2. Trigger function `detect_conflicts()` fires `after insert on events for each row`.
   3. `DUPLICATE_EXIT`: when inserting an `EXIT`, look for another `EXIT` with the same `session_id` and a different `id`; create one conflict containing both ids (create only if none open for that session).
   4. `ORPHAN_EXIT`: when inserting an `EXIT`, check an `ENTRY` exists for the `session_id`; if not, create a conflict (may resolve itself if the entry arrives later: a second trigger on `ENTRY` insert closes matching `ORPHAN_EXIT` conflicts automatically with `status RESOLVED` and note `entry_arrived` [REC]).
   5. `DUPLICATE_ENTRY`: when inserting an `ENTRY` with a vehicle number, if an open session for the same facility and number exists, create a conflict.
   6. `CLOCK_SKEW`: compare `device_time` with `received_at` at insert; threshold 5 minutes [SPEC].
   7. Never update or delete event rows (UPDATE and DELETE revoked for all roles in CLD-03).
5. **Files.** `supabase/migrations/0006_conflict_detector.sql` [SPEC name]; pgTAP tests `supabase/tests/conflicts.test.sql` [REC].
6. **Contract IC-10.** Conflict rows as above; Console reads, never writes them except through `conflict_resolutions`.
7. **Data flow.** Event insert → trigger → conflict row → Console inbox (CON-07) and alert counters (CLD-07/SYNC-06).
8. **Rules.** One open conflict per (type, session); detection is idempotent; trigger must not abort the event insert if conflict creation fails (log and continue) [REC].
9. **Success.** Each crafted case creates exactly one conflict; clean data creates none.
10. **Failure.** A trigger error must not lose the event: wrap conflict creation in an exception block.
11. **Edge cases.** `ENTRY` arrives after its `EXIT` (out-of-order sync) must not create a permanent `ORPHAN_EXIT`; pass holders re-entering after a proper exit are not duplicates; vehicle number casing and spacing normalized before comparison [REC: uppercase, strip spaces].
12. **Security.** Trigger runs as definer; conflict rows follow the same RLS (facility scope) as events.
13. **Logging.** Count of conflicts by type per facility per day exposed to the Console health page.
14. **Tests.** T-SYNC-05-*.
15. **Acceptance.** Four types tested positive and negative; out-of-order arrival test; conflicts visible through RLS to the right roles only.
16. **Definition of done.** Migration reviewed by Akanksha; pgTAP suite in CI; Anamika confirms the Console renders each type with the fields available.

### SYNC-06: Health signals, heartbeat sender, quarantine

1. **Problem.** Nobody notices a stuck queue until a month-end shortfall. Sync trouble must be visible to the guard, supervisor, Console and on-call.
2. **Expected behaviour.** `health.ts` exposes `queueDepth`, `oldestUnsyncedAgeMs`, `lastSyncAt`, `online`, `quarantinedCount`, `syncBlocked`. While online it calls `heartbeat(device_id, queue_depth, oldest_unsynced_age, app_version, schema_version, battery)` [SPEC] at most every 5 minutes.
3. **Preconditions.** SYNC-02 queue exists; CLD-04 function exists; Nikhil's status screen consumes the output.
4. **Implementation sequence.**
   1. Compute metrics from the local `events` table (counts and minimum `device_time` of `PENDING`).
   2. Derive banner states per the Handbook fallback table [SPEC]: offline for 10 seconds; unsynced older than 30 minutes while online (supervisor banner); older than 2 hours (server-side Sentry alert via the stale-device job).
   3. Heartbeat sender with a minimum interval of 5 minutes, sent immediately on reconnect after an outage, never blocking entry and exit.
   4. Quarantine list API: `listQuarantined()` returning event id, type, server code, attempts, created time (no payload with vehicle number shown in lists; payload viewable on demand).
   5. Expose `exportDiagnostics()` returning a text blob (device id, versions, metrics, last 50 log lines) for the guard to send by WhatsApp (used by GATE-12).
5. **Files.** `packages/sync-rules/src/health.ts`, `heartbeat.ts` [REC].
6. **Contract IC-09.** Heartbeat payload fields as above; accepted at most once per interval per device; server rejects spoofed `device_id` (claim mismatch).
7. **Data flow.** Local DB → `health()` → UI banners; same numbers → heartbeat → `device_heartbeats` → Console health page (CON-10) and stale-device alerts (CLD-07).
8. **Rules.** Healthy targets from the Handbook: queue under 50, oldest unsynced under 5 minutes online, sync latency p95 under 10 s, 0 to 2 conflicts per day per site; alert levels queue over 200, age over 30 minutes online, latency over 60 s, any quarantine, any device on old schema version [SPEC].
9. **Success.** Metrics match injected backlog; heartbeat appears within the interval.
10. **Failure.** Heartbeat failure is silent to the guard but retried; metric computation errors fall back to "unknown" state and are logged.
11. **Edge cases.** Device clock wrong (age calculation uses elapsed time between `device_time` and a monotonic clock where possible [REC]); no events yet (age 0); heartbeat flood after reconnect; battery API unavailable (send null).
12. **Security.** Diagnostics blob excludes PINs, tokens and vehicle numbers.
13. **Logging.** Rolling local log (last 500 lines) with levels; sync, heartbeat and banner transitions logged.
14. **Tests.** T-SYNC-06-*.
15. **Acceptance.** Banner thresholds trigger at the stated values on a controllable fake clock; heartbeat rate-limited; quarantine list correct after forced rejections.
16. **Definition of done.** Nikhil confirms GATE-12 renders every state; Anamika confirms CON-10 shows every field; contract test IC-09 in CI.

### SYNC-07: Simulation harness

1. **Problem.** The offline promise must be proven before any partner trusts it. The Phase 2 plan requires zero lost or duplicated sessions across a simulated 6-hour outage with 300 vehicles (P0-12).
2. **Expected behaviour.** `tools/sim/run.ts` [REC] drives two virtual gate devices against a staging Supabase project, replays 300 vehicles over a compressed 6-hour timeline, toggles the network (proxy such as Toxiproxy or emulator airplane mode), injects known conflicts, then compares cloud state to an independent oracle.
3. **Preconditions.** SYNC-02 to SYNC-05 working; a headless way to call `writeEvent` (the same package the gate app uses); staging project with CLD-02 and CLD-03 applied; at least GATE-01 and GATE-02 flows available for the end-to-end variant (the package-level variant can run before them).
4. **Implementation sequence.**
   1. `scenario.ts`: seeded random generator (fixed seed, so runs repeat) producing arrivals over virtual time with vehicle classes, dwell times, two devices, and deliberate injections (one duplicate exit across devices, one exit whose entry arrives late, one skewed clock).
   2. `oracle.ts`: independent in-memory model that computes expected events, sessions and zone counts without using the sync code.
   3. `network.ts`: schedule of outages (including one continuous 6-hour virtual outage) and intermittent failures; time warp so the run finishes in minutes.
   4. `run.ts`: execute, wait for queues to drain, query cloud.
   5. Assertions (from Handbook [SPEC]): cloud event count equals created count; no duplicate exit per `session_id` except injected; no orphan exits except injected; zone counts equal oracle at 6 checkpoints; every conflict present was injected and every injected conflict present.
   6. `report.ts`: write a machine-readable JSON and a human summary; store seed, versions and result in `tools/sim/reports/` [REC].
   7. Chaos scenarios C1 to C7 mirror the Handbook table [SPEC]: kill mid-save; reboot offline with 40 unsynced events; same batch three times; server 500 for 10 minutes; two phones exit the same vehicle offline; clock a day ahead; build below minimum version.
5. **Files.** `tools/sim/{run.ts, scenario.ts, oracle.ts, network.ts, report.ts}` [REC].
6. **Contract.** Exit code 0 only if all assertions pass; the JSON report lists each assertion with pass or fail and the seed.
7. **Data flow.** scenario → virtual devices → local DB → sync → staging cloud → comparison with oracle.
8. **Rules.** Deterministic given a seed; never runs against production; uses a dedicated test facility and cleans up by facility id after the run (test data only, never by deleting events in a real facility).
9. **Success.** All assertions pass on at least three different seeds.
10. **Failure.** Any mismatch prints the first differing record and exits non-zero.
11. **Edge cases.** Staging rate limits; Toxiproxy not installable (fall back to an in-process fake transport and record that the network layer was not covered); flaky time warp (use a virtual clock injected into the connector).
12. **Security.** Uses staging credentials from environment variables; no production data.
13. **Logging.** Per-phase logs and the final report.
14. **Tests.** The harness validates itself with T-SYNC-07-* (determinism, oracle correctness against a hand-made scenario, detection of an intentionally broken sync).
15. **Acceptance.** See E. A run is only claimed as passed with a stored report file.
16. **Definition of done.** Report stored for the final candidate build; Afzal signs the pilot-readiness gate item; harness runs in a manual CI job.

### REL-01: Monorepo, CLAUDE.md, review and release rules

1. **Problem.** Four people building with AI assistance drift apart without one set of rules.
2. **Expected behaviour.** One repository with the layout in the Handbook [SPEC], one `CLAUDE.md`, enforced reviews, repeatable release and rollback.
3. **Preconditions.** Team agrees on the repository host (OQ-01).
4. **Implementation sequence.**
   1. Scaffold: `apps/gate`, `apps/console`, `packages/contracts`, `packages/sync-rules`, `packages/domain`, `supabase/migrations`, `supabase/functions`, `tools/sim`, `.github/workflows` [SPEC layout; `packages/domain` added in Handbook].
   2. Workspace tooling (pnpm or npm workspaces, TypeScript project references) [REC]; one root `tsconfig`, one lint config, one formatter config.
   3. `CLAUDE.md` content [SPEC items]: stack, folder ownership, naming (snake_case in SQL, camelCase in TypeScript), reason codes, the "never do" list (no secrets in prompts, no schema change without a migration file, no editing events, no microservices, no payment-gateway or ANPR in the MVP), how to run tests, the one-gate-two-phones rule, money in paise.
   4. `.github/CODEOWNERS` [REC] reflecting section 8 of README.
   5. Branch protection on `main`: green CI and one approval from a different workstream; shared packages require all four.
   6. Release process [SPEC]: merge to `main` deploys staging; a tag deploys production after manual approval; Console rollback by redeploying the previous Vercel build; gate app through Expo EAS internal distribution with an over-the-air channel for JavaScript fixes and native rebuild only when needed; no Friday or pre-peak-weekend releases to a live pilot.
   7. Write `docs/release.md` [REC]: tagging convention, SCHEMA_VERSION bump procedure, minimum-supported-version change procedure, rollback steps.
   8. Perform one rollback drill on staging and record the result.
5. **Files.** Root config, `CLAUDE.md`, `.github/CODEOWNERS`, `docs/release.md` [REC].
6. **Contract.** Repository rules are the contract; deviations require a PR changing `CLAUDE.md`.
7. **Rules.** Every PR needs green CI plus a cross-workstream approval; money, sync, permissions and shift-close changes ship only with tests a human has read.
8. **Success.** A new contributor can clone, install, run lint and type checks, and see CI green.
9. **Failure.** A PR violating rules cannot merge.
10. **Edge cases.** A hotfix to a live pilot (documented fast path: one approval, same CI, tag, notify partners); secrets accidentally committed (rotate, purge history, record).
11. **Security.** Secrets scanning in CI [REC]; environment-scoped secrets only (Akanksha's CLD-01).
12. **Tests.** T-REL-01-*.
13. **Acceptance and DoD.** Rules enforced by repository settings, rollback drill recorded, `CLAUDE.md` approved by all four.

### PRT-01: Partner pipeline, agreements, day-30 meeting

1. **Problem.** Enthusiasm is cheap (Phase 2 plan). A pilot without a booked pricing decision teaches nothing.
2. **Expected behaviour.** Each pilot has a named decision-maker with budget authority, a signed pilot agreement and a day-30 pricing meeting already in the calendar before go-live.
3. **Preconditions.** Prospects list from the Phase 2 plan (Crescent Group of Malls, Sita Medical, Croma Parking, Palassio Mall as tier A) [SPEC]; pilot term sheet (Phase 2 appendix B) exists in the documents.
4. **Implementation sequence.**
   1. Maintain the pipeline in the CRM chosen by the team [REC], with fields: facility, size band, decision-maker, incumbent system, status, day-30 meeting date.
   2. Re-contact tier A with a date-bound offer; ask each partner whether the current system (for example Park+) exports a CSV (feeds OQ-06).
   3. Present the clickable prototype on-site in the partner's language.
   4. Sign the pilot agreement per the term sheet [SPEC]: free 30 days, founding-partner discount, exit clause with data export, named reference, permission to publish anonymised results.
   5. Book the day-30 meeting before go-live; record the attendee with budget authority.
   6. Run the pricing conversation after the ROI statement (from CON-12) using the Phase 2 sequence; capture the price-sensitivity responses.
5. **Contract.** Input from Anamika: ROI statement per facility. Output to the team: partner status and constraints (hardware present, incumbent, staff turnover, language).
6. **Rules.** Never lead with price; never ask a partner to remove an incumbent system during the pilot.
7. **Success.** Every pilot start is gated by the booked day-30 meeting.
8. **Failure.** Partner postpones the meeting twice: escalate per risk R1 of the Phase 2 plan.
9. **Edge cases.** Owner, not operator, holds the budget (map the buying committee); partner refuses to share revenue baseline (read-only reconciliation, written data ownership).
10. **Security and privacy.** Partner revenue data handled under the agreement; shared only in anonymised form.
11. **Tests.** T-PRT-01-* (checklist audits).
12. **Acceptance and DoD.** Checklist in section D passes for each pilot; agreement stored; meeting booked.

---

## D. Detailed Testing Protocol

Test ID format: `T-<FeatureID>-<kind><n>`; kinds: U unit, I integration, E end-to-end, N negative, R regression, X non-functional. Verification status for every test: **Not verified** (no code exists). "Fixture" names are [REC]. Priorities: C critical, H high, M medium. Regression tests (R) mean tests of earlier waves, since no previous MVP functionality exists.

### D.1 SYNC-01 Contracts

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-SYNC-01-U1 | Each event type parses | Package built | Parse one valid sample per type | `fixtures/events/valid/*.json` (2 per type) | All parse; output equals input after JSON round trip | Assertion | C |
| T-SYNC-01-U2 | Invalid samples rejected with paths | Same | Parse 10 invalid samples (missing `session_id` on EXIT, negative amount, unknown type, bad UUID, bad time) | `fixtures/events/invalid/*.json` | Each returns issues naming the failing path; none returns an object | Assertion | C |
| T-SYNC-01-U3 | UPI attestation rule | Same | PAYMENT with mode CASH and `upi_attested = true` | Sample | Rejected | Assertion | H |
| T-SYNC-01-U4 | `OTHER` requires note | Same | OVERRIDE with `OTHER` and no note | Sample | Rejected; with note accepted | Assertion | H |
| T-SYNC-01-U5 | Money helpers | Same | `toPaise('10.50')`, `'10.5'`, `'0'`, `'abc'`, `'-1'`, `12.5` (number) | Table | 1050, 1050, 0, error, error, error | Assertion | C |
| T-SYNC-01-U6 | Money never floating | Same | Sum 0.1 + 0.2 rupees via helpers | Strings | Exactly 30 paise | Assertion | H |
| T-SYNC-01-U7 | UUIDv7 ordering | Same | Generate 1,000 ids | none | Valid v7; sorted generation order equals lexical order within a millisecond-tolerant check | Assertion | M |
| T-SYNC-01-I1 | IC-01 contract test | Both apps compile | Dummy gate and Console modules import and parse a shared sample | Fixture | Both succeed; changing a field in contracts breaks both builds | CI build | C |
| T-SYNC-01-I2 | SQL mirrors enums | CLD-02 migration applied | Insert event with each reason code and type into a test table; insert unknown code | Fixture | Known accepted; unknown rejected by CHECK | SQL assertion | H |
| T-SYNC-01-N1 | Unknown extra fields | Same | Parse event with extra key | Sample | Rejected or stripped per documented rule (decide and test one) | Assertion | M |
| T-SYNC-01-R1 | Version helper | Same | `isSupported(1, 2)`, `(2, 2)`, `(3, 2)` | Table | false, true, true | Assertion | H |

### D.2 SYNC-02 Upload and ingest

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-SYNC-02-U1 | Backoff series | None | Compute delays for attempts 0 to 10 with seeded jitter | Table | 2 s doubling, capped at 5 min, within ±20% | Assertion | H |
| T-SYNC-02-U2 | Batch selection order | Local DB with 120 PENDING | Call batch selector | 120 events | 50 oldest by `device_time`, then id; never SENT rows | Assertion | C |
| T-SYNC-02-I1 | Idempotent ingest | Staging DB, enrolled device | Call `ingest_events` with the same 50-event batch three times | Fixture batch | Row count 50; second and third return `duplicate` | SQL count + response | C |
| T-SYNC-02-I2 | Partial acceptance | Same | Batch with 3 valid and 1 unknown-staff event | Fixture | 3 stored; 1 `rejected UNKNOWN_STAFF`; order preserved | Response + SQL | C |
| T-SYNC-02-I3 | Quarantine after 5 | Local DB, server forced to reject one event | Run upload 5 times | Poison event | State `QUARANTINED`; other events still sent; banner state set | DB + health output | C |
| T-SYNC-02-I4 | Wrong facility claim | Device of facility A | Send an event with facility B id | Fixture | `rejected WRONG_FACILITY`; nothing stored | Response + SQL | C |
| T-SYNC-02-I5 | Inactive staff | Staff deactivated in cloud | Upload event by that staff | Fixture | `rejected INACTIVE_STAFF` | Response | H |
| T-SYNC-02-E1 | Offline then online | Phone in airplane mode | Write 40 events, restore network | Gate harness | All 40 in cloud exactly once within the drain period | SQL count | C |
| T-SYNC-02-N1 | Kill after RPC, before local update | Fault injection | Kill process between steps; restart | 10 events | Resend produces duplicates only; final row count correct | SQL count | C |
| T-SYNC-02-N2 | 401 from server | Expired credentials | Upload | 5 events | No events dropped; "Sign-in needed" state; events remain PENDING | DB + state | H |
| T-SYNC-02-N3 | No update or delete | Staging | Try UPDATE and DELETE on `events` as device, manager, owner, service role used by app | SQL | Refused for all app roles | SQL error | C |
| T-SYNC-02-X1 | Throughput | Staging | Drain a 300-event backlog | 300 events | Completes without error; UI thread not blocked (frame check optional) | Timing log | M |
| T-SYNC-02-X2 | Concurrency | Two uploaders started at once | Start two `uploadBatch` calls | 100 events | Mutex ensures one; no double send in logs | Log + SQL | H |
| T-SYNC-02-R1 | Contract IC-03 | CI | Run T-SYNC-01-I1 and I2 | none | Still pass | CI | H |

### D.3 SYNC-03 Download sync and decision

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-SYNC-03-I1 | Config reaches the phone | Enrolled device, staging | Change a tariff in the cloud; sync | Fixture tariff | Local table has new row; version of row matches | Local DB query | C |
| T-SYNC-03-I2 | Phone cannot write config | Device user | Attempt insert into `zones` via API | SQL | Refused | Error | C |
| T-SYNC-03-I3 | `open_sessions` maintained | Staging | Insert ENTRY then EXIT events | Fixture | Row appears then disappears | SQL | C |
| T-SYNC-03-I4 | Facility isolation | Two facilities | Device of A syncs | Two seeded facilities | Only A's rows locally | Local DB query | C |
| T-SYNC-03-I5 | PIN hashes sync, hash only | Staff with PIN set | Sync then inspect local staff table | Fixture | Contains salted hash and salt; no plain PIN | Query | C |
| T-SYNC-03-E1 | Console change to phone | Console wizard (CON-01) | Edit zone capacity; sync phone | Manual or Playwright + harness | New capacity shown in gate | Combined check | H |
| T-SYNC-03-N1 | Sync error keeps last config | Block network after first sync | Restart app offline | none | Config still present; banner "Using saved setup" | State check | C |
| T-SYNC-03-N2 | Version gate | Cloud minimum raised | Start old build | Version 1 vs min 2 | Sync blocked; entry still works offline | State + behaviour | C |
| T-SYNC-03-N3 | Deactivated guard offline | Guard deactivated in cloud, device offline | Guard enters PIN on stale device | Fixture | Accepted until device syncs; after sync login refused | Behaviour | H |
| T-SYNC-03-X1 | Spike go/no-go | Spike branch | Run T-SYNC-05-I1 and a reduced SYNC-07 on the candidate stack | Candidate | All pass or decision to use outbox recorded | Decision record with evidence files | C |
| T-SYNC-03-X2 | Initial sync size | Seed facility with 1,000 passes and 100 zones | Cold sync on low-cost phone | Seed | Completes; time and size recorded | Log | M |

### D.4 SYNC-04 Occupancy

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-SYNC-04-U1 | Basic count | None | 5 entries, 2 exits, no baseline | Arrays | 3 | Assertion | C |
| T-SYNC-04-U2 | Baseline correction | None | System shows 40; ZONE_COUNT says 36; then 2 entries | Arrays | 38 | Assertion | C |
| T-SYNC-04-U3 | Clamp and warn | None | 1 exit, 0 entries | Arrays | Count 0; warning NEGATIVE | Assertion | C |
| T-SYNC-04-U4 | De-duplication | None | Same entry in `open_sessions` and local events | Arrays | Counted once | Assertion | C |
| T-SYNC-04-U5 | Orphan exit | None | Exit with unknown session | Arrays | No decrement; warning | Assertion | H |
| T-SYNC-04-U6 | Property: never negative after clamp | Property runner | 1,000 random event sequences | Generator | Count ≥ 0 always | Property test | C |
| T-SYNC-04-U7 | Property: order independence after baseline | Same | Shuffle events after baseline | Generator | Same total | Property test | H |
| T-SYNC-04-U8 | Over capacity | None | Count above capacity | Arrays | Warning OVER_CAPACITY; count unchanged | Assertion | M |
| T-SYNC-04-I1 | Phone and Console agree | Seed facility | Compute on phone data; query `v_zone_now` | Seed | Same per zone | Compare | C |
| T-SYNC-04-E1 | Drift flag | Seed with repeated drift > 3% | Read `drift` for the zone | Seed | Flag raised for the 3% rule | Assertion | H |
| T-SYNC-04-N1 | Missing zone config | No zones synced | Call function | Arrays | Explicit error, not zeros | Assertion | H |
| T-SYNC-04-N2 | Future-dated event | Event with `device_time` 10 minutes ahead | Compute | Arrays | Ignored until corrected per rule, with warning | Assertion | M |
| T-SYNC-04-R1 | Simulation checkpoints | SYNC-07 | Run | Seeds | Counts equal oracle at 6 checkpoints | Report | C |

### D.5 SYNC-05 Conflicts

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-SYNC-05-I1 | DUPLICATE_EXIT | pgTAP DB | Insert ENTRY, EXIT (device A), EXIT (device B) same session | Fixture | One OPEN conflict with both exit ids; three events intact | pgTAP | C |
| T-SYNC-05-I2 | ORPHAN_EXIT | Same | Insert EXIT with no ENTRY | Fixture | One OPEN conflict | pgTAP | C |
| T-SYNC-05-I3 | Orphan auto-closes | Same | Insert ENTRY after the orphan EXIT | Fixture | Conflict RESOLVED with note `entry_arrived` | pgTAP | C |
| T-SYNC-05-I4 | DUPLICATE_ENTRY | Same | Two ENTRY events with same normalized number, both open | `up32 AB 1234` and `UP32AB1234` | One conflict | pgTAP | H |
| T-SYNC-05-I5 | CLOCK_SKEW | Same | Insert with `device_time` 6 minutes away from `received_at` | Fixture | Conflict created; event kept | pgTAP | H |
| T-SYNC-05-I6 | Clean data | Same | Insert 300 consistent events | Seed | Zero conflicts | pgTAP | C |
| T-SYNC-05-N1 | Trigger failure does not lose event | Fault injected into conflict insert | Insert EXIT | Fixture | Event stored; error logged | pgTAP | C |
| T-SYNC-05-N2 | No event mutation | Any role | Attempt UPDATE/DELETE on events | SQL | Refused | pgTAP | C |
| T-SYNC-05-N3 | Visibility | Manager of facility B | Select conflicts of facility A | SQL | No rows | pgTAP | C |
| T-SYNC-05-E1 | Two phones exit same vehicle offline | SYNC-07 chaos C5 | Run | Seed | Exactly one DUPLICATE_EXIT, no data loss | Report | C |
| T-SYNC-05-X1 | Detector cost | 100,000 seed events | Insert 1,000 more | Seed | Insert latency not materially degraded (record numbers; threshold set by the team) | Timing log | M |

### D.6 SYNC-06 Health

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-SYNC-06-U1 | Metrics from backlog | Fake clock | 60 PENDING events, oldest 12 minutes | Fixture | depth 60; age 12 min | Assertion | C |
| T-SYNC-06-U2 | Banner thresholds | Fake clock | Move age to 31 min online | Fixture | Supervisor banner state on; at 29 min off | Assertion | C |
| T-SYNC-06-U3 | Offline 10 s | Fake clock | Drop connection 10 s | Fixture | Offline state at ≥10 s, not before | Assertion | H |
| T-SYNC-06-U4 | Heartbeat rate limit | Fake clock | Trigger 20 times in 4 minutes | Fixture | One send; next after 5 minutes; immediate on reconnect | Assertion | H |
| T-SYNC-06-I1 | Heartbeat stored | Staging | Send heartbeat | Fixture | One row upserted per device with all fields | SQL | C |
| T-SYNC-06-I2 | Spoofed device id | Device A credentials | Send heartbeat for device B | Fixture | Rejected | Response | C |
| T-SYNC-06-I3 | Quarantine list | T-SYNC-02-I3 state | List | none | Entries with code and attempts, no vehicle number in list view | Assertion | H |
| T-SYNC-06-E1 | Console health page | CON-10 | Create backlog on a device | Harness | Page shows depth and last sync within a heartbeat interval | UI check | H |
| T-SYNC-06-N1 | Metric failure | Corrupt state | Call `health()` | Fault | Returns unknown state, logs error | Assertion | M |
| T-SYNC-06-N2 | Diagnostics privacy | Diagnostics blob | Scan output | Fixture with PIN, token, plate | None present | Regex scan | C |

### D.7 SYNC-07 Simulation harness

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-SYNC-07-U1 | Determinism | None | Generate scenario twice, same seed | Seed 1 | Identical event lists | Assertion | H |
| T-SYNC-07-U2 | Oracle correctness | None | Hand-made 10-vehicle scenario with known answer | Table | Oracle equals hand answer | Assertion | C |
| T-SYNC-07-I1 | Harness detects a broken sync | Sync with intentional bug (drop 1 in 50) | Run | Seed | Run fails and names the missing event | Report | C |
| T-SYNC-07-E1 | Full 6-hour run | Staging, two devices | Run 300 vehicles, one continuous outage, injections | Seeds A, B, C | All assertions pass for all seeds; reports stored | Report files | C |
| T-SYNC-07-E2 | Chaos C1 to C7 | Same | Run each | Handbook table | Pass conditions of Handbook met | Report | C |
| T-SYNC-07-N1 | Staging only | Environment variable set to production | Run | none | Refuses to start | Exit code | C |
| T-SYNC-07-X1 | Network layer fallback | Toxiproxy unavailable | Run | none | Uses fake transport and marks `network_layer_covered = false` | Report | M |

### D.8 REL-01 and PRT-01

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-REL-01-I1 | Branch protection | Repo configured | Open PR with failing CI and no approval; try to merge | Test PR | Merge blocked | Repo settings screenshot or API | C |
| T-REL-01-I2 | CODEOWNERS | Same | PR touching `packages/contracts` | Test PR | Requires all four approvals | PR page | H |
| T-REL-01-E1 | Staging deploy | Pipeline from CLD-09 | Merge to main | Test change | Staging updated | Deployment log | H |
| T-REL-01-E2 | Rollback drill | Staging | Deploy bad Console build; roll back to previous | Test build | Previous build serving | Drill note stored | C |
| T-REL-01-N1 | Secret scan | CI | Commit a fake key on a branch | Fake key | CI fails | CI log | H |
| T-PRT-01-U1 | Pilot start gate | Pipeline sheet | Review each pilot record before go-live | Records | Day-30 meeting date and decision-maker filled | Checklist audit | C |
| T-PRT-01-U2 | Agreement completeness | Agreement | Compare to term sheet items | Document | All terms present | Checklist | H |
| T-PRT-01-N1 | Meeting postponed twice | Pilot record | Review status | Record | Escalation entered | Checklist | M |

---

## E. Acceptance Criteria and Completion Checklist

For every feature, "complete" requires all applicable boxes and the evidence listed. Evidence means a stored artefact (test report file, CI run link, simulation JSON report, decision record, screenshot, signed checklist), never a statement.

| Feature | Checklist | Required evidence |
| --- | --- | --- |
| SYNC-01 | [ ] Schemas for 7 events [ ] invalid samples rejected [ ] money helpers [ ] version helper [ ] SQL enums mirror [ ] approved by all four [ ] contract test IC-01 in CI | CI run, fixture folder, approvals |
| SYNC-02 | [ ] Idempotent ingest [ ] batch order [ ] backoff [ ] quarantine [ ] auth failure keeps events [ ] no update or delete [ ] IC-03 contract test | pgTAP and integration reports, chaos report |
| SYNC-03 | [ ] Config down-sync [ ] no write path [ ] facility isolation [ ] PIN hash only [ ] version gate [ ] decision record with go/no-go evidence | Decision record, integration report |
| SYNC-04 | [ ] Table tests [ ] property tests [ ] phone and Console agree [ ] warnings surfaced | Test report, comparison output |
| SYNC-05 | [ ] Four types positive and negative [ ] out-of-order arrival [ ] trigger failure safe [ ] RLS visibility | pgTAP report |
| SYNC-06 | [ ] Metrics and thresholds [ ] heartbeat rate [ ] spoof rejected [ ] quarantine list [ ] diagnostics privacy | Test report, Console screenshot |
| SYNC-07 | [ ] Three seeds pass [ ] chaos cases pass [ ] harness proven to detect a seeded bug [ ] reports stored | JSON reports |
| REL-01 | [ ] Branch protection [ ] CODEOWNERS [ ] CLAUDE.md approved [ ] release doc [ ] rollback drill | Settings export, drill note |
| PRT-01 | [ ] Pipeline sheet current [ ] each pilot has agreement and booked day-30 meeting | Agreement files, calendar entries |

Cross-cutting checklist for every pull request of this sheet:

- [ ] Functional requirements met and validation implemented.
- [ ] Success and error states handled; failure is visible (banner or conflict), never silent.
- [ ] Authorization enforced where applicable (device claims, staff check, RLS).
- [ ] Data persistence verified by query, not by UI.
- [ ] Unit, integration and relevant end-to-end tests pass, with the command and output stored.
- [ ] Earlier-wave tests still pass.
- [ ] No unresolved critical defect.
- [ ] Documentation updated (this sheet, README, `CLAUDE.md` if rules changed).
- [ ] Reviewed by a member of another workstream.
- [ ] Integration with dependent modules verified by the relevant contract test.

---

## F. Dependencies and Integration Contracts

| Contract | Afzal's role | Counterpart | Interface | Failure semantics | Milestone (ordering) | Contract test |
| --- | --- | --- | --- | --- | --- | --- |
| IC-01 Event schemas | Provider | Nikhil, Anamika, Akanksha | `@parkos/contracts` exports | Invalid input returns issues, never partial | Wave 0 | T-SYNC-01-I1, I2 |
| IC-02 Sync client API | Provider | Nikhil | `writeEvent`, `observeOccupancy`, `health` | Write errors thrown to caller, which shows the paper-sheet screen (GATE-11) | Wave 2 to 3 | T-SYNC-03-E1, T-SYNC-04-I1, T-SYNC-06-U1 |
| IC-03 Ingest function | Author | Akanksha (deploys, reviews) | `ingest_events(jsonb)` | Per-event result codes; batch continues past bad events | Wave 1 | T-SYNC-02-I1 to I5 |
| IC-04 Fare function | Consumer (SYNC-07 and e2e use it) | Nikhil | `fare(tariff, entryAt, exitAt, class)` | Returns error object for invalid tariff, not zero | Wave 1 | Case table shared with GATE-03 (T-GATE-03-U*) |
| IC-05 Device enrollment | Consumer | Akanksha | `enroll_device(code)` | Expired or reused code rejected | Wave 2 | T-SYNC-02-I4 uses enrolled claims; CLD-03 tests own the function |
| IC-06 Staff PIN hashes | Consumer (sync down) | Akanksha, Anamika, Nikhil | `staff` table synced with salted hash | Hash only; missing staff table means login refused offline | Wave 2 | T-SYNC-03-I5 |
| IC-07 KPI views | Consumer (comparison test) | Akanksha | `v_zone_now` for occupancy parity | n/a | Wave 4 | T-SYNC-04-I1 |
| IC-09 Heartbeat | Provider of sender | Akanksha, Anamika | `heartbeat(...)` | Silent retry; no UI impact | Wave 5 | T-SYNC-06-I1, I2 |
| IC-10 Conflict records | Provider | Anamika | `sync_conflicts` rows and statuses | Console never edits events | Wave 3 to 4 | T-SYNC-05-I1 to I5 |

Potential conflicts over shared files, and who decides:

| Shared item | Risk | Rule |
| --- | --- | --- |
| `packages/contracts` | Two people changing a field at once | Afzal merges in order; breaking changes need `SCHEMA_VERSION` bump and all four approvals |
| `events` table definition | Akanksha's CLD-02 and Afzal's SYNC-02 both need columns | Akanksha owns the file `0003`; Afzal requests changes by PR to it before it merges, never afterwards |
| Tariff rule JSON | Console form and gate fare function drift | Single schema in contracts; fare function in `packages/domain` (Nikhil) |
| `occupancy.ts` outputs | Phone and Console disagree | Parity test T-SYNC-04-I1 in CI |

---

## G. Error Handling and Edge Cases

| Situation | Expected behaviour | Where tested |
| --- | --- | --- |
| Duplicate upload after a crash | Server returns `duplicate`; local state moves to `SENT` | T-SYNC-02-N1 |
| One malformed event in a batch | That event rejected and eventually quarantined; others proceed | T-SYNC-02-I2, I3 |
| Credentials expired | Stop uploading, keep events, show sign-in banner | T-SYNC-02-N2 |
| Exit arrives before entry (out-of-order sync) | Temporary `ORPHAN_EXIT` closes itself when the entry arrives | T-SYNC-05-I3 |
| Two exits for the same vehicle | `DUPLICATE_EXIT` conflict for a person to resolve; both events kept | T-SYNC-05-I1 |
| Phone clock wrong | `CLOCK_SKEW` conflict; event kept; occupancy ignores far-future events with a warning | T-SYNC-05-I5, T-SYNC-04-N2 |
| Old app build | Offline use continues; sync blocked with update banner | T-SYNC-03-N2 |
| Config missing on a fresh phone | Entry and exit disabled with "Sync setup first" message; never use defaults silently | T-SYNC-03-N1 |
| Stale baseline | `STALE_BASELINE` warning if the last zone count is older than a shift [REC] | T-SYNC-04-U* |
| Huge backlog after long outage | Drain in order, bounded batches, UI responsive | T-SYNC-02-X1 |
| Trigger error in conflict detector | Event still stored | T-SYNC-05-N1 |
| Staff deactivated while offline | Accepted locally; server rejects later; quarantine banner for supervisor | T-SYNC-03-N3 |
| Simulation target mistaken for production | Refuses to run | T-SYNC-07-N1 |
| Pilot postponement | Escalate; no pilot start without booked day-30 meeting | T-PRT-01-N1 |

Retries and idempotency rule: every write path is safe to call twice with the same result; every failure raises a visible state.

---

## H. Security, Privacy and Data Integrity

- **Authentication and authorization.** Devices authenticate as users with claims `org_id`, `facility_id`, `device_id`, role `device` (CLD-03). `ingest_events` ignores any `facility_id` or `device_id` that differs from the claims and checks `staff_id` against active staff of that facility.
- **Input validation.** All events parsed by the shared schema before storage on the phone and again inside `ingest_events`; SQL CHECK constraints mirror enums.
- **Sensitive data.** `vehicle_no` and optional phone numbers are personal data under the Digital Personal Data Protection Act, 2023. PIN hashes are salted hashes only. No raw PINs, tokens or keys appear in logs, diagnostics, test fixtures or prompts.
- **Secrets.** Only in environment-scoped GitHub and Supabase secrets; simulation uses staging credentials; secret scanning in CI [REC].
- **Access control.** RLS (Akanksha) limits devices to their facility; managers to one facility; owners to their organization; no role can UPDATE or DELETE events.
- **Audit and integrity.** Events are append-only; corrections are new `OVERRIDE` events; conflict resolutions are separate records; the append-only record is the tamper-evident audit trail (PRD FR-55).
- **Secure error responses.** Per-event result codes expose reasons the device needs (for example `INACTIVE_STAFF`) but no internal details.
- **Transactions.** Local `writeEvent` is a single transaction; server batches are processed per event so one failure never rolls back others; conflict trigger failure never blocks the insert.
- **Abuse prevention.** Heartbeat limited to one per interval per device; batch size capped; request size limits at the function level [REC].
- **Privacy in tooling.** Simulation data is synthetic; AI-assisted coding sessions must not receive real vehicle data or partner revenue figures.

---

## I. Deliverables

Required:

| Deliverable | Features |
| --- | --- |
| `packages/contracts` with tests and fixtures | SYNC-01 |
| `packages/sync-rules` with tests (connector, backoff, occupancy, conflicts hints, health) | SYNC-02, 03, 04, 06 |
| Migrations 0004, 0005, 0006 and pgTAP tests | SYNC-02, 03, 05 |
| Decision record for the sync stack with go/no-go evidence | SYNC-03 |
| `tools/sim/` with stored reports from three seeds | SYNC-07 |
| Repo scaffold, `CLAUDE.md`, `CODEOWNERS`, branch protection, `docs/release.md`, rollback drill note | REL-01 |
| Pipeline sheet, signed agreements, booked day-30 meetings | PRT-01 |
| Known-limitations note per feature (appended to this sheet) | all |
| Test execution evidence (commands and outputs stored with the pull request) | all |

Optional improvements (only after all required items are done): richer simulation scenarios; a conflict explanation text per type for Anamika's inbox; dynamic-QR design note for the post-pilot payment upgrade; coverage thresholds in CI.

---

## J. Definition of Done

A feature is done only when **all** of the following are true: it is implemented; its tests in section D exist, run in CI where possible, and pass with stored evidence; negative and edge cases from section G are covered; integration contract tests with the counterpart pass; it has been reviewed by a member of another workstream; documentation and `CLAUDE.md` are updated if rules changed; no critical defect is open; and Afzal's own checklist items for the Pilot-Readiness Gate that it supports are ticked with evidence. Code that is merely written is not done.

Commands (**recommended, to be confirmed once the repo is scaffolded**; none can be established from the repository today because it contains no code):

```text
pnpm install
pnpm -r lint
pnpm -r typecheck
pnpm --filter @parkos/contracts test
pnpm --filter @parkos/sync-rules test
supabase start && supabase db reset && supabase test db     # pgTAP
pnpm tsx tools/sim/run.ts --seed 1 --env staging
```

If tests or infrastructure are unavailable at review time, record the limitation in the pull request; never record a pass that was not observed.

### Open questions that affect this sheet

OQ-01 (repository host), OQ-02 (PowerSync or outbox), OQ-05 (UPI attestation integrity), OQ-06 (incumbent export), OQ-16 (two phones at one gate), OQ-17 (weekly hours), OQ-20 (tariff coverage), OQ-23 (shift and gate definitions), OQ-24 (gate dates). See [open-questions-and-assumptions.md](open-questions-and-assumptions.md).
