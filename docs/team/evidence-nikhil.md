# Evidence log: Nikhil (GATE-01..12, IC-02 SyncClient integration)

Prepared 30 Oct 2026, updated 30 Oct 2026 (audit follow-up), updated again 30 Oct 2026
(`queueHealth`), updated again 31 Oct 2026 (independent code review, commit, PR-readiness audit),
updated again 12 Nov 2026 (PR #39 review findings fixed).
Author: Nikhil. Scope: `apps/gate`,
`packages/domain` (per [README.md](README.md) "Responsibilities, owned paths"). This file records
what each session implemented and verified; it does not restate the full feature sheet
([member-02-nikhil.md](member-02-nikhil.md)) or re-litigate work from earlier sessions.

**Location note.** No `doc/team-implementation/evidence/` directory exists anywhere in this
repository, and no other evidence log of that shape exists to follow. The established convention
for Nikhil's workstream documents is a flat file under `docs/team/` (see `feature-traceability.md`,
`cld-02-events-review.md`, the member sheets). This file follows that convention instead of
inventing a new directory.

**Honesty labels**, matching `cld-02-events-review.md`: **VERIFIED** (a command was actually run
and its output read), **NOT RUN** (not executed — hardware, physical device, or another
owner's dependency), **BLOCKED** (cannot be done at all without someone else's missing work).

## This session's scope

Afzal's `packages/sync-rules` exports the storage-agnostic `OutboxStore` / `IngestTransport` ports
and the `Uploader` that drives them (SYNC-02), but no `SyncClient` facade yet — `packages/domain`
and `apps/gate/src/data/ic02.ts` are the only places the real IC-02 shape exists today, and
`FakeSync` is the only client that implements it. The two pieces **this session adds** are the
concrete implementations of Afzal's two ports, which `docs/team/README.md` and
`packages/sync-rules/README.md` both assign to the gate app ("the gate app implements": SQLite and
the Supabase RPC):

- `apps/gate/src/data/gateSqliteDb.ts` — the storage-agnostic `GateSqliteDb` port.
- `apps/gate/src/data/sqliteOutboxStore.ts` — `SqliteOutboxStore implements OutboxStore`: one
  atomic `withTransactionAsync` writes the event row (`gate_events`) and its outbox row
  (`gate_outbox`) together; `apply()` never deletes or edits `gate_events`.
- `apps/gate/src/data/expoGateDb.ts` — production `GateSqliteDb` opener via `expo-sqlite`
  (`openDatabaseAsync`). **NOT RUN** on any device or emulator this session (no physical-device or
  Expo dev-build evidence exists for this file — see "Physical-device / manual evidence" below).
- `apps/gate/src/data/supabaseIngestTransport.ts` — `SupabaseIngestTransport implements
  IngestTransport`, calling the real `public.ingest_events(events jsonb)` RPC
  (`supabase/migrations/0004_ingest_events.sql`) as `rpc("ingest_events", { events })`, mapping
  SQLSTATE `28000`/`42501` (not authenticated / not an enrolled device, per
  `docs/integrations/ingest-events.md`) to `AuthError` and everything else to a retryable failure.
- `apps/gate/src/data/supabaseClient.ts` — production `@supabase/supabase-js` client factory.
  Holds no device session itself (see "BLOCKED: CLD-03" below).

**What this is not**: a real `SyncClient` wired into the app shell. The pasted brief explicitly
says "do not build a parallel SyncClient facade if Afzal's implementation is not yet available."
`FakeSync` remains what `apps/gate/src/syncGate.ts` and the screens use today; the new
`SqliteOutboxStore`/`SupabaseIngestTransport` are independently testable building blocks for
whichever `SyncClient` eventually composes `Uploader` + these two ports (Afzal's call, OQ-37) —
not a second client competing with `FakeSync`. No screen or `PortProvider` wiring changed.

**Dependencies added** (Nikhil-owned `apps/gate/package.json`, not a shared package): `expo-sqlite`
`~58.0.14` (via `npx expo install expo-sqlite`, matching the installed Expo 58 line),
`@supabase/supabase-js` `^2.118.0`, `@pmp/sync-rules` (workspace link, so `apps/gate` can implement
its ports), `@types/node` `^22` (dev, for the Node-only test helpers). `pnpm-lock.yaml` updated by
`pnpm install`; no `packages/*` or `supabase/migrations` file touched.

## IC-02 interface: confirmed, not changed

The pasted brief assumed a target interface of `writeEvent(event)`, `observeOccupancy(listener):
() => void`, `health()`. The **actual** interface already implemented and in active use
(`apps/gate/src/data/ic02.ts`, consumed by `fakeSync.ts` and `writeEvent.ts`) is:

```ts
writeEvent(event: Event): Promise<void>;
writeTransaction(events: readonly Event[]): Promise<void>; // proposed extension, OQ-37, Afzal to confirm
observeOccupancy(facilityId: string, onChange: (snapshot: OccupancySnapshot) => void): () => void;
health(): HealthSnapshot; // { queueDepth, oldestUnsyncedAgeMs, lastSyncAt, online, quarantinedCount, syncBlocked }
```

Differences from the brief's assumed shape: `observeOccupancy` takes a `facilityId` plus a
richer `OccupancySnapshot` (zones + warnings), not a bare listener; `health()` returns five fields,
not three; `writeTransaction` exists for the exit/payment atomicity (EXIT+PAYMENT[+OVERRIDE] in one
write) that the fare/payment flow needs and that the brief's shape has no room for. This file is
already the registered OQ-37 proposal to Afzal, not something to silently rewrite — per the
brief's own rule ("Do not change IC-02 interface signatures independently"), **no change was made
here**; the new store and transport are typed against the *real* file, not the brief's draft.

## Audit follow-up (same day): `writeEventsAndEnqueue` + production-risk mitigations

A read-only integration-readiness audit of the above (prompted separately, not re-transcribed
here) found one concrete gap and two unverified production risks. This section records what was
done about each; the audit's own findings are not repeated beyond what's needed to state the fix.

**Gap closed — multi-event atomic write.** `SqliteOutboxStore` had only
`writeEventAndEnqueue(event: Event)`; IC-02's proposed `writeTransaction(events: readonly
Event[])` (OQ-37) needs a batch write for EXIT+PAYMENT[+OVERRIDE]. Added
`writeEventsAndEnqueue(events: readonly Event[]): Promise<void>`
(`apps/gate/src/data/sqliteOutboxStore.ts`): validates every event (IC-01) before opening any
transaction, then inserts every event row and its outbox row inside ONE `withTransactionAsync`
call via a shared private `insertEventRow` helper. `writeEventAndEnqueue` is now defined as
`writeEventsAndEnqueue([event])`, so the two paths cannot drift apart — this is a refactor of the
existing method, not a new parallel code path, and the original 12 `writeEventAndEnqueue` tests
pass unchanged against it. An empty array is a safe no-op (no transaction opened). Duplicate ids
follow the existing single-event rule (identical content no-ops; differing content raises
`OutboxCollisionError` and rolls back the WHOLE batch), applied per event, including two entries of
the same batch sharing an id.

**Risk investigated — `withExclusiveTransactionAsync`.** `expo-sqlite`'s own docs say
`withTransactionAsync` "is not exclusive and can be interrupted by other async queries," and
recommend `withExclusiveTransactionAsync` instead. Investigated and **not adopted**:
`withExclusiveTransactionAsync` hands its callback a separate `txn` object with its own
`execAsync`/`runAsync`/`getAllAsync` — a different shape from `GateSqliteDb.withTransactionAsync(task:
() => Promise<void>)` — so adopting it would mean changing the `GateSqliteDb` port and rewriting
every call site to use `txn` instead of `this.db`, based on a native-binding guarantee this
environment has no device to verify. Rejected as too invasive to "implement only safe, verified
changes" for this session.

**Risk closed — app-level write-serialization queue (implemented instead).** Added a private FIFO
queue (`withWriteLock`) in `SqliteOutboxStore` wrapping its only two write-transaction entry points
(`writeEventsAndEnqueue`, `apply`): a `writeQueue: Promise<void>` that each call chains onto via
`.then(task, task)`, normalized afterward so one failed write never blocks the next. This gives the
actual guarantee needed — this store never has two `withTransactionAsync` calls in flight on the
same connection at once — without depending on `expo-sqlite`'s internal locking at all, and it is
fully verified against `node:sqlite` (see tests below). **Verified the risk was real, not
theoretical**: temporarily removing the lock and re-running the new concurrency test reproduced an
actual failure — `node:sqlite` threw `"cannot start a transaction within a transaction"` when two
`writeEventsAndEnqueue` calls ran concurrently without it. The lock was then restored and the test
suite re-run clean. Whether the real `expo-sqlite` native binding would throw the same loud error or
silently interleave statements is **unverified** (no device); the lock removes the question
entirely by never letting two write transactions start concurrently in the first place.

**Risk closed — foreign-key enforcement.** Plain SQLite does not enforce `REFERENCES` unless a
connection turns it on; `node:sqlite` happens to default `PRAGMA foreign_keys` to `1` (confirmed by
querying a fresh `DatabaseSync`), the opposite of plain SQLite's own default, which is what
`expo-sqlite`'s native binding uses (nothing in its typings sets this pragma). `init()` now issues
`PRAGMA foreign_keys = ON` before creating the tables, so both drivers enforce
`gate_outbox.id REFERENCES gate_events(id)` the same way regardless of each engine's default. Verified
against `node:sqlite` only (a direct `INSERT` into `gate_outbox` with no matching `gate_events` row
now throws); **not verified** against the real `expo-sqlite` binding on a device.

**Tests added** (`apps/gate/test/sqliteOutboxStore.test.ts`, all against `node:sqlite`):
multi-event persistence with per-event outbox rows in input order; empty-array no-op (asserted via
a transaction-call counter, not just "no error"); invalid event anywhere in the batch rejects
before any write; failure on the second event's insert rolls back the whole batch; failure on an
outbox insert rolls back the whole batch; a prior successful write survives a later failed batch;
duplicate ids within one batch and against an earlier call; foreign-key enforcement; two concurrent
`writeEventsAndEnqueue` calls never overlap (`maxConcurrent() === 1`, measured via a
`withTransactionAsync` call counter); a `writeEventsAndEnqueue` racing an `apply` never overlap
either; a mid-transaction failure does not jam the queue for the next write.

**Command and result**: `pnpm --filter @pmp/gate test -- test/sqliteOutboxStore.test.ts` —
**VERIFIED**, 24/24 passed (up from 12; 12 new this round). Full `pnpm --filter @pmp/gate test` —
**VERIFIED**, 271/271 passed (29 files). `pnpm --filter @pmp/gate typecheck` — **VERIFIED**, clean.
Root `pnpm check` — **VERIFIED**, exit 0.

**Also fixed**: two source comments (`expoGateDb.ts`, `supabaseIngestTransport.ts`) pointed at
`docs/team-implementation/evidence/nikhil.md`, a path that doesn't exist — a leftover from before
this file's actual location was decided. Corrected to `docs/team/evidence-nikhil.md`.

**Still unresolved after this round**: no `writeEventsAndEnqueue`/`apply` call has ever run against
the real `expo-sqlite` binding or a real device — everything above is `node:sqlite`-verified only.
The write-lock serializes within one `SqliteOutboxStore` instance; it says nothing about two
separate instances (e.g., two `openDatabaseAsync` calls) pointed at the same file, which this app
is not expected to do but which nothing currently prevents. The `queueDepth`/`oldestUnsyncedAgeMs`/
`quarantinedCount` aggregation queries this paragraph originally flagged as missing are now
implemented — see the next section — `observeOccupancy` is not addressed by this file and remains
Afzal's SYNC-04 ownership.

## Third round (same day): `queueHealth()` — the health-summary queries

Next identified gap: a future `SyncClient.health()` needs `queueDepth`, `oldestUnsyncedAgeMs` and
`quarantinedCount` from somewhere, and nothing on `SqliteOutboxStore` answered them.

**The actual type, read fresh rather than assumed.** `apps/gate/src/data/ic02.ts` exports
`HealthSnapshot` (there is no `SyncHealth` type anywhere in this repository):

```ts
export type HealthSnapshot = {
  queueDepth: number;
  oldestUnsyncedAgeMs: number;
  lastSyncAt: string | null; // UTC ISO; null = never synced
  online: boolean;
  quarantinedCount: number;
  syncBlocked: boolean;
};
```

**Implemented**: `apps/gate/src/data/sqliteOutboxStore.ts` —
`queueHealth(): Promise<QueueHealth>`, where `QueueHealth = Pick<HealthSnapshot, "queueDepth" |
"oldestUnsyncedAgeMs" | "quarantinedCount">` (the `Pick` ties the return type directly to the real
IC-02 type, so a future field rename there is a compile error here, not a silent drift). One
parameterless aggregate SQL query (conditional `SUM`/`MIN` over a single `gate_outbox JOIN
gate_events` pass) computes all three fields in one round trip:

```sql
SELECT
  SUM(CASE WHEN o.state = 'PENDING' THEN 1 ELSE 0 END) as pending_count,
  SUM(CASE WHEN o.state = 'QUARANTINED' THEN 1 ELSE 0 END) as quarantined_count,
  MIN(CASE WHEN o.state = 'PENDING' THEN e.device_time ELSE NULL END) as oldest_pending_device_time
FROM gate_outbox o JOIN gate_events e ON e.id = o.id
```

A private `ageMs(deviceTimeIso: string | null): number` helper turns the raw `MIN(...)` result into
a clamped, never-`NaN` millisecond age.

**Timestamp semantics — read, not assumed.** Age is measured from `device_time`, matching
`FakeSync.health()` (`apps/gate/src/data/fakeSync.ts`), which computes `oldestUnsyncedAgeMs` from
`Date.parse(e.device_time)`, not any `created_at`/`recorded_at` field (FakeSync has neither). Using
the same field means a real `SyncClient` built on `SqliteOutboxStore` answers the `T-IC02-GATE-1`
shared contract suite ("fake and real implementations pass the SAME suite") the same way, rather
than a newly invented timestamp rule.

**Which `HealthSnapshot` fields this supports vs. not:**

| Field | Status |
| --- | --- |
| `queueDepth` | **Supported** — `queueHealth().queueDepth`, count of `PENDING` rows |
| `oldestUnsyncedAgeMs` | **Supported** — `queueHealth().oldestUnsyncedAgeMs`, age of the oldest `PENDING` row by `device_time` |
| `quarantinedCount` | **Supported** — `queueHealth().quarantinedCount`, count of `QUARANTINED` rows |
| `lastSyncAt` | **NOT supported here, not invented.** No table in this store records when an upload last succeeded. Must come from whatever composes `Uploader`'s `UploadOutcome` history into a real `SyncClient`. |
| `online` | **NOT supported here, not invented.** This store has no network awareness at all (device online/offline is not something a SQLite store can answer). Belongs to the transport/network layer. |
| `syncBlocked` | **NOT supported here, not invented.** `apps/gate/src/syncGate.ts`'s `isSyncBlocked(minSupportedVersion)` already computes this, but `minSupportedVersion` only becomes known from an `Uploader`'s `UploadOutcome.minSupportedVersion` after an upload — composition work, not a store-level query. |

**Concurrency**: `queueHealth()` is a plain read (like `listEvents()`/`pending()` before it) and is
deliberately NOT routed through `withWriteLock` — it does not write, and wrapping a read in the
write queue would only make a status-screen poll wait behind unrelated writes for no correctness
benefit. No schema change beyond `queueHealth()`'s own query; `gate_events`/`gate_outbox` are
unchanged from the previous round.

**Tests added** (`apps/gate/test/sqliteOutboxStore.test.ts`, `describe("SqliteOutboxStore.queueHealth
...")`, all against `node:sqlite` with an injected clock via the existing `now` constructor
parameter): empty database (all zeros, not null/NaN); one pending row; multiple pending rows (age
from the OLDEST, not newest); no pending rows though events exist (all `SENT`); quarantined rows
counted separately; `SENT` rows excluded from `queueDepth` even with an earlier `device_time`;
mixed `PENDING`/`SENT`/`QUARANTINED` in one database (each field reflects only its own subset, and
`listEvents()` confirms nothing was deleted by the read); a future `device_time` (clock skew) clamps
to 0 instead of going negative; an unparseable `device_time` (planted via a direct SQL insert that
bypasses this store's own IC-01-validated write path, the same technique as the earlier
foreign-key-enforcement test) returns 0, never `NaN`.

**Commands and results**:
- `pnpm --filter @pmp/gate test -- test/sqliteOutboxStore.test.ts` — **VERIFIED**, 33/33 passed (up
  from 24; 9 new this round).
- `pnpm --filter @pmp/gate test` (full suite) — **VERIFIED**, 280/280 passed (29 files).
- `pnpm --filter @pmp/gate typecheck` — **VERIFIED**, clean.
- Root `pnpm check` — **VERIFIED**, exit 0, re-run after this round's changes.

**Still unresolved**: `queueHealth()` is verified against `node:sqlite` only, not the real
`expo-sqlite` binding or a physical device. `lastSyncAt`, `online` and `syncBlocked` remain
unimplemented anywhere in this codebase; a real `SyncClient.health()` cannot be fully built until
whatever composes `Uploader` + this store + the network/version-gate layer exists (Afzal's facade,
OQ-37) and decides how it tracks those three.

## GATE-01..12 acceptance rows

| ID | Acceptance criterion (summary) | Implementation files | Test files | Test command / result | Manual/device evidence | Reviewer sign-off | Blockers / OQs | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GATE-01 | Entry saved in one transaction, token-first, offline | `app/entry.tsx`, `src/domain/suggestZone.ts`, `src/domain/token.ts`, `src/data/writeEvent.ts`, `src/data/fakeSync.ts` (dev client); **new**: `src/data/sqliteOutboxStore.ts` (incl. `writeEventsAndEnqueue`, write-serialization lock, FK pragma, `queueHealth`), `src/data/gateSqliteDb.ts`, `src/data/expoGateDb.ts` | `test/domain.test.ts`, `test/data.test.ts`, `test/flow.test.ts`, `test/sqliteOutboxStore.test.ts` | `pnpm --filter @pmp/gate test` — **VERIFIED**, 280/280 passed (29 files) | Stopwatch/airplane-mode device run (T-GATE-01-X1..X3): **NOT RUN** — no physical test phone used this session | None recorded | Real local persistence (`FakeSync` → `SqliteOutboxStore`) not yet wired into the app shell (see "What this is not" above); `expo-sqlite` itself is PROPOSED, not approved (OQ-59) | PARTIALLY COMPLETE |
| GATE-02 | Exit + payment atomic, offline, lost-token search | `app/exit.tsx`, `src/domain/findOpenSession.ts`, `src/domain/tariffFor.ts`, `src/data/writeEvent.ts` (`writeExit`); batch-atomic backing now available via `sqliteOutboxStore.ts`'s `writeEventsAndEnqueue` (not yet wired to `writeExit`) | `test/data.test.ts`, `test/domain.test.ts`, `test/sqliteOutboxStore.test.ts` | `pnpm --filter @pmp/gate test` — **VERIFIED**, 280/280 passed | Scan/typed/lost-token timing (T-GATE-02-X1/X2): **NOT RUN** | None recorded | Same local-persistence wiring gap as GATE-01; OQ-59 (expo-sqlite approval) | PARTIALLY COMPLETE |
| GATE-03 | Fare engine, 60-case table | `packages/domain/src/fare.ts`, `explainFare.ts`, `fixtures/fareCases.json` | `packages/domain/test/fare.test.ts` | `pnpm --filter @pmp/domain test` — **VERIFIED**, 109/109 passed | n/a (pure function) | Anamika review (consumer, per sheet DoD): **not recorded** | None from this session (pre-existing; not touched) | COMPLETE (unit-level; cross-check with Console per sheet DoD not verified this session) |
| GATE-04 | One PAYMENT per exit, UPI attestation attributable | `src/domain/paymentRules.ts`, `src/data/writeEvent.ts` | `test/data.test.ts`, `test/rules.test.ts` | `pnpm --filter @pmp/gate test` — **VERIFIED** (included in the 259) | n/a | None recorded | No dedicated `PaySheet` UI component found under `src/ui/`; payment selection logic exists, screen may be folded into `exit.tsx` — not independently confirmed this session | PARTIALLY COMPLETE |
| GATE-05 | Pass lookup offline, states VALID/EXPIRED/NOT_FOUND/DUES | `app/pass.tsx`, `src/domain/pass.ts` | `test/domain.test.ts` | `pnpm --filter @pmp/gate test` — **VERIFIED** | 5,000-row p95 lookup timing (T-GATE-05 acceptance): **NOT RUN** | None recorded | OQ-41 (dues settlement mode) open | PARTIALLY COMPLETE |
| GATE-06 | Shift open/close, variance computed | `app/shift/open.tsx`, `close.tsx`, `src/domain/shiftTotals.ts` | `test/data.test.ts`, `test/domain.test.ts` | `pnpm --filter @pmp/gate test` — **VERIFIED** | Timed close-under-5-minutes run: **NOT RUN** | None recorded | None new | PARTIALLY COMPLETE |
| GATE-07 | Override + reason codes, corrections are new events | `app/override.tsx`, `src/domain/override.ts` | `test/data.test.ts` | `pnpm --filter @pmp/gate test` — **VERIFIED** | n/a | None recorded | None new | COMPLETE (unit/integration level) |
| GATE-08 | Zone count entry + reminders | `app/zone-count.tsx`, `src/domain/zoneCount.ts`, `src/notifications/zoneReminders.ts` | `test/domain.test.ts` | `pnpm --filter @pmp/gate test` — **VERIFIED** | Airplane-mode reminder firing: **NOT RUN** | None recorded | OQ-43 (count safety-limit reading conflict) open | PARTIALLY COMPLETE |
| GATE-09 | Offline PIN login, device enrollment | `app/(auth)/login.tsx`, `enroll.tsx`, `src/auth/pinSession.ts`, `lockout.ts`, `secureIdentity.ts`, `submissionGuard.ts` | `test/auth.test.ts`, `test/lockoutStorage.test.ts`, `test/pinsession.test.ts`, `test/secureidentity.test.ts` | `pnpm --filter @pmp/gate test` — **VERIFIED** | Real enrollment / login on a device: **NOT RUN** | None recorded | **BLOCKED**: no `enroll_device` function exists in `supabase/migrations/` (CLD-03 not started — confirmed by `grep -rl enroll_device supabase/migrations` returning nothing); no staff PIN hash parameters from Akanksha (IC-06) | BLOCKED (logic layer only; cannot enroll/authenticate against real infrastructure) |
| GATE-10 | Bluetooth printer + fallback | `src/print/escpos.ts`, `printer.ts`, `printMachine.ts`, `qr.ts`, `src/ui/Scanner.tsx`, `TokenFullScreen.tsx`, `app/settings/printer.tsx` | `test/print.test.ts`, `test/printmachine.test.ts`, `test/qr.test.ts` | `pnpm --filter @pmp/gate test` — **VERIFIED** | Real printer model test (sheet DoD: "at least one real printer model"): **NOT RUN** | None recorded | None new | PARTIALLY COMPLETE (fakes verified; no hardware evidence) |
| GATE-11 | Paper-sheet backfill, flagged and syncable | `app/backfill.tsx`, `src/domain/backfill.ts` | `test/backfill.test.ts` | `pnpm --filter @pmp/gate test` — **VERIFIED** | n/a | None recorded | OQ-42 open (no `recorded_at` envelope field yet; Afzal) | PARTIALLY COMPLETE |
| GATE-12 | App shell, i18n parity, banners, diagnostics | `app/_layout.tsx`, `index.tsx`, `status.tsx`, `src/ui/deriveBanners.ts`, `useSyncState.ts`, `src/i18n/*`, `src/lib/log.ts`, `diag.ts` | `test/i18n.test.ts`, `test/i18nconfig.test.ts`, `test/languagePreference.test.ts`, `test/diag.test.ts`, `test/log.test.ts` | `pnpm --filter @pmp/gate test` — **VERIFIED** | Guard-reviewed Hindi pass (sheet DoD): **NOT RUN** | None recorded | None new | PARTIALLY COMPLETE (no human Hindi review on record) |

No GATE-xx row is marked COMPLETE end-to-end: every row with a device/timing/human-review
acceptance criterion in the sheet is PARTIALLY COMPLETE until that evidence exists, per this
session's instruction to never mark hardware or sign-off requirements COMPLETE without it.

## Full test run (this session)

| Package | Command | Result |
| --- | --- | --- |
| `@pmp/contracts` | `pnpm --filter @pmp/contracts test` | **VERIFIED** — 78/78 passed (4 files) |
| `@pmp/domain` | `pnpm --filter @pmp/domain test` | **VERIFIED** — 109/109 passed (1 file) |
| `@pmp/sync-rules` | `pnpm --filter @pmp/sync-rules test` | **VERIFIED** — 21/21 passed (2 files) |
| `@pmp/gate` | `pnpm --filter @pmp/gate test` | **VERIFIED** — 280/280 passed (29 files; 42 new across all three rounds: 33 in `sqliteOutboxStore.test.ts`, 9 in `supabaseIngestTransport.test.ts`) |
| `@pmp/gate` typecheck | `pnpm --filter @pmp/gate typecheck` | **VERIFIED** — clean, no errors |
| `apps/console` | `pnpm --filter @pmp/console test` | **VERIFIED** — 179/179 passed (10 files; untouched this session) |
| Whole repo | `pnpm check` (repo checks, migrations, scripts, format, lint, typecheck, every package's tests, build) | **VERIFIED** — exit 0, all green (re-run after the audit follow-up) |

No test file was edited to hide a failure; no test was skipped or marked `.skip`/`.todo`.

## Physical-device / manual evidence still required

Every row above marked **NOT RUN** needs an actual device/emulator run or a human review before it
can be called COMPLETE: entry/exit timing in airplane mode (T-GATE-01-X1..X3, T-GATE-02-X1/X2),
pass-lookup timing (GATE-05), shift-close timing (GATE-06), zone-count reminder firing (GATE-08),
printer hardware test (GATE-10, at least one real model), Hindi guard review (GATE-12), and the
whole GATE-09 enrollment/login flow against real Supabase infrastructure (blocked until CLD-03
ships — see below). None of these were run or claimed to have run in this session.

## Blockers and OQs

- **BLOCKED — CLD-03 (device auth, `enroll_device`)**: `supabase/migrations/` has no
  `enroll_device` function and no RLS policies for devices (confirmed: `grep -rl enroll_device
  supabase/migrations` returns nothing; `0002_staff_devices_memberships.sql`'s own header says "no
  enrollment function, no code generation and no policies (CLD-03)"). `ingest_events` is `SECURITY
  DEFINER` and authorizes the caller via `auth.uid()` against `public.devices.auth_user_id`
  (`0004_ingest_events.sql`), so `SupabaseIngestTransport` cannot be exercised against a real
  database until a device can actually sign in. This session's transport takes an
  already-authenticated client and does not invent a sign-in shortcut, per the brief's "do not
  bypass authentication." Owner: Akanksha (CLD-03), consumer: Nikhil (GATE-09).
- **OPEN — OQ-37** (`docs/team/open-questions-and-assumptions.md`): `writeTransaction` and an
  events-read API are Nikhil's proposed IC-02 extension, not yet confirmed by Afzal. Still open;
  not touched this session beyond relying on the existing proposal.
- **OPEN — SyncClient composition**: no file in `packages/sync-rules` yet composes `Uploader` +
  `OutboxStore` + `IngestTransport` + occupancy/health into something satisfying
  `apps/gate/src/data/ic02.ts`'s `SyncClient`. Until that exists (Afzal's call), `FakeSync` stays
  the only client wired into the app shell; `SqliteOutboxStore`/`SupabaseIngestTransport` are ready
  to be composed into it.
- **OPEN — OQ-41, OQ-42, OQ-43**: pre-existing, unrelated to this session's changes, listed above
  against their rows for completeness.

## Fourth round (31 Oct 2026): independent review, local commit, explicit dependency/status audit

An independent read-only code review of the 14 files above (OutboxStore/IngestTransport interface
conformance, atomicity/rollback, duplicate handling, FK enforcement, auth-error mapping, sensitive-
data handling, unrelated-file check) found **no critical bugs**. Two non-blocking findings were
raised and are recorded as open items rather than silently fixed: (1) `expo-sqlite` was not yet
recorded against the approved native-module list — see "Expo SQLite approval status" below and
OQ-59; (2) `supabaseClient.ts` sets `autoRefreshToken: true` without the React-Native-specific
`AppState`-driven `startAutoRefresh`/`stopAutoRefresh` pairing Supabase's own docs call for — not
wired into the app yet, so not blocking, but tracked here so it isn't forgotten when a real
`SyncClient` composes this client.

The 14 files were then committed verbatim (byte-for-byte checksum-verified against the reviewed
content before commit) on `feature/gate-sqlite-sync`: commit `8eff474777cbe7ef855ed3b8b7dd2cf8c4f069d4`,
message `feat(gate): add SQLite outbox store and Supabase ingest transport`. Not pushed, no PR opened.

**Re-verified this round, not assumed from earlier rounds:**

- **Expo SQLite approval status: PROPOSED, NOT APPROVED.** `expo-sqlite` is absent from both the
  approved list and the explicitly-not-approved list in member-02-nikhil.md's "Dependencies without
  a code contract" line. **OQ-59** was filed this round (`open-questions-and-assumptions.md`), renumbered from the originally-assigned OQ-45 after a fresh check (12 Nov 2026) found OQ-45 already resolved on main as a different, unrelated question and OQ-55-58 reserved by open PRs #33/#34 (main was at OQ-54). Asking
  Afzal to approve it, modelled on the OQ-29 precedent for `expo-battery`/`expo-file-system`.
  member-02-nikhil.md's dependency line was updated to note the proposal. No approval was invented;
  status remains Open until Afzal decides.
- **SyncClient dependency: still open, OQ-37 unresolved.** `packages/sync-rules/src/` contains
  exactly 4 files (`backoff.ts`, `index.ts`, `ingestResponse.ts`, `outbox.ts`) — no composition
  facade exists anywhere in the repository. The only `SyncClient`-shaped implementation in the
  codebase is still `FakeSync` (`apps/gate/src/data/fakeSync.ts`); `SqliteOutboxStore` and
  `SupabaseIngestTransport` are standalone, adapter-ready, and not wired into it.
- **CLD-03 dependency: still BLOCKED.** Re-confirmed this round: `grep -rl enroll_device
  supabase/migrations/` returns nothing. `SupabaseIngestTransport` cannot be exercised against a
  real database until a device can sign in; no sign-in shortcut was added.
- **Real-device verification: NOT RUN.** No physical device or emulator was used this round for any
  file in this commit. Everything is `node:sqlite`-verified only.
- **Airplane-mode verification: NOT RUN.** Unaffected by this round (no screen wiring changed);
  still outstanding against GATE-01/02/08's acceptance criteria from earlier rounds.
- **Printer verification: NOT RUN; out of scope this round.** No file in this commit touches
  `src/print/*` or GATE-10.
- **Console round-trip verification: NOT RUN, NOT POSSIBLE YET.** Console only ever observes events
  that reach `public.events` via `ingest_events`. Since CLD-03 blocks any real `ingest_events` call
  and nothing from this commit is wired into the app shell, no event from this implementation has
  ever reached Supabase, so a Gate→Console round trip cannot exist to verify yet.

**Tests re-run fresh this round** (not reused from earlier rounds):

| Command | Result |
| --- | --- |
| `pnpm --filter @pmp/gate typecheck` | **VERIFIED** — exit 0, clean |
| `pnpm --filter @pmp/gate test` | **VERIFIED** — exit 0, 280/280 passed (29 files) |
| `pnpm --filter @pmp/gate test -- test/sqliteOutboxStore.test.ts` (direct vitest invocation) | **VERIFIED** — exit 0, 33/33 passed |
| `pnpm --filter @pmp/gate test -- test/supabaseIngestTransport.test.ts` (direct vitest invocation) | **VERIFIED** — exit 0, 9/9 passed |
| `pnpm --filter @pmp/sync-rules test` | **VERIFIED** — exit 0, 21/21 passed (2 files) |
| Root `pnpm check` | **VERIFIED** — exit 0, all green (repo checks, migrations, scripts, format, lint, typecheck, every package's tests, build) |

## Fifth round (12 Nov 2026): PR #39 review findings fixed

PR #39 (`feature/gate-sqlite-sync` → `main`) was opened and reviewed by Akanksha and tanamikaa,
both CHANGES_REQUESTED. tanamikaa independently wrote and ran probe tests against `node:sqlite`
that reproduced a real bug; Akanksha found the same one from a different angle. This round fixes
all three blocking/important findings. Scope: `apps/gate/src/data/sqliteOutboxStore.ts`,
`apps/gate/src/data/supabaseIngestTransport.ts`, and their two test files — no other file touched.

**1. Read/write race — fixed.** `pending()`, `listEvents()` and `queueHealth()` now go through the
existing `withWriteLock` queue, the same one `writeEventsAndEnqueue`/`apply` already used. Before
this, a read could observe a row from a batch that was still open and later rolled back — SQLite's
own isolation is between connections, not within one, so the store's single connection could see
its own uncommitted writes. Concretely: `pending()` could hand `Uploader` an event whose batch then
failed on a later collision and rolled back, so the server could end up holding an event the phone
no longer has. Fixed by serializing reads behind the same lock as writes.

**2. `device_time` ordering — fixed.** Added a `device_time_ms INTEGER` column, populated via
`Date.parse(device_time)` on every write. `ORDER BY`/`MIN()` in `pending()`, `listEvents()` and
`queueHealth()` now use it instead of the `device_time` TEXT column — a string comparison put
`...10:00:00.500Z` before `...10:00:00Z` even though it is the later instant, since `.` sorts
before `Z`. A `migrateDeviceTimeMs()` step in `init()` (`PRAGMA table_info` check, `ALTER TABLE ADD
COLUMN`, then a backfill `UPDATE` from the existing `device_time` text) adds and backfills the
column for a `gate_events` table created before this fix, so existing local data is not lost or
left unordered.

**3. `AuthError` missing 401/403 — fixed.** `SupabaseRpcClient`'s return type gained an optional
`status?: number` field, matching `@supabase/postgrest-js`'s actual response shape (`status` is a
sibling of `error`, not nested inside it — read from that package's own source, not guessed).
`ingest()` now treats HTTP 401/403 as an auth failure alongside the existing SQLSTATE check, which
only ever fires for a rejection raised inside `ingest_events` itself — an expired or invalid JWT is
rejected by PostgREST's own auth layer before the function ever runs, with a `PGRST3xx`-style code
and no SQLSTATE, which previously fell through to the retryable-failure path instead of
`AUTH_REQUIRED`.

**Regression tests added** (12 new, 0 existing tests weakened or removed — one existing test was
split in two to match the new schema, both its original assertions kept): 3 for the read/write race
(one per method, using a new `withPauseAfter` test helper that suspends a write mid-transaction to
create a real interleaving window — confirmed node:sqlite's synchronous internals mean a plain
concurrent `await` never naturally interleaves, so this is necessary, not decorative), 5 for
`device_time_ms` ordering (one per read method, plus a restart-recovery test that manually recreates
the pre-fix schema, inserts rows directly, reopens via `init()`, and asserts the column is backfilled
and ordering is correct afterward), 4 for the 401/403 mapping (both statuses, one non-matching
status to prove the check isn't over-broad, and one through `Uploader` end to end).

**Verified each of the 3 fixes is load-bearing, not cosmetic**: reverted each one individually and
re-ran its regression test, confirming a real, reproducible failure each time (not just a changed
assertion), then restored and re-ran the full suite clean.

**Commands and results** (all run fresh this round, in a separate clone since the primary working
tree was read-only — see "Reviewer / sign-off status" below):

| Command | Result |
| --- | --- |
| `apps/gate` full test suite | **VERIFIED** — 292/292 passed (29 files; was 280) |
| `sqliteOutboxStore.test.ts` alone | **VERIFIED** — 41/41 passed (was 33) |
| `supabaseIngestTransport.test.ts` alone | **VERIFIED** — 13/13 passed (was 9) |
| `pnpm --filter @pmp/gate typecheck` | **VERIFIED** — exit 0, clean |
| `eslint` (4 changed files) | **VERIFIED** — exit 0, clean |
| `prettier --check` (4 changed files) | **VERIFIED** — exit 0, clean |

**Not run, not claimed**: `apps/gate`'s Android bundle (`bundle:android`/Expo export). None of the
four changed files are imported by any screen yet (unchanged from earlier rounds — still unwired
from the app shell), so a bundle build would not exercise this round's changes; it was skipped
rather than claimed.

## Reviewer / sign-off status

PR #39 is open on GitHub (`feature/gate-sqlite-sync` → `main`), reviewed by Akanksha and tanamikaa
(both CHANGES_REQUESTED, now addressed above — their reviews have not been re-requested or cleared
yet; that is their call, not recorded here as done). `packages/sync-rules` was read but not
modified, so no second-workstream-owner review is required by `CLAUDE.md`'s "Shared packages ...
need a second workstream owner's review" rule for that package — but `expo-sqlite`'s addition to
`apps/gate/package.json`/`app.json` still needs Afzal's sign-off per OQ-59 before this should be
treated as fully reviewed. Akanksha separately flagged that OQ-59 itself may collide with a
private, not-yet-pushed follow-up on her side; unresolved as of this round.

## Sixth round (18 Nov 2026): OQ-37 async events-read, plus the OQ-59 device-evidence checklist

Scope: `apps/gate/src/data/fakeSync.ts`, `apps/gate/src/data/writeEvent.ts`,
`apps/gate/src/ui/port.tsx`, `apps/gate/test/data.test.ts`, and the new
`apps/gate/test/ic02GateContract.test.ts`. PR #67 (`feature/gate-oq37-async-events` → `main`),
Afzal's review requested; not merged.

**Change.** `FakeSync.listEvents()` is now `async` (`Promise<readonly Event[]>`), matching
`SqliteOutboxStore.listEvents()`'s pre-existing contract. `WriteDeps.readEvents` follows suit;
`writeExit`'s `ALREADY_EXITED`/`SECOND_PAYMENT` guards now `await` it. The dev-shell's render-time
read (`PortRuntime.readEvents`, used by all nine gate screens) was deliberately left synchronous —
it is a separate surface from the IC-02 contract, not something this feedback asked to change — and
now delegates to a new `FakeSync.listEventsSync()` instead.

**New: T-IC02-GATE-1**, the shared contract suite the sheets and `ic02.ts`/`sqliteOutboxStore.ts`
have described since the first round but never implemented. `describe.each` runs three scenarios
against both a `FakeSync`-backed and a `SqliteOutboxStore`-backed `WriteDeps`: rolled-back batch,
already-exited guard, second-payment guard. `SqliteOutboxStore` only implements `OutboxStore`, not
the full `SyncClient`, so the suite's test-only `clientFor()` adapter implements just
`writeTransaction` (the one member `writeExit` calls) and throws if anything else is invoked.

**Commands and results (run fresh this round):**

| Command | Result |
| --- | --- |
| `pnpm --filter @pmp/gate typecheck` | **VERIFIED** — exit 0, clean |
| `pnpm --filter @pmp/gate test` | **VERIFIED** — 298/298 passed (30 files; was 292, +6 new T-IC02-GATE-1 cases) |
| `eslint` (5 changed/added files) | **VERIFIED** — exit 0, clean |
| `prettier --check` (5 changed/added files) | **VERIFIED** — exit 0, clean |
| `pnpm install --frozen-lockfile` then root `pnpm check` | **VERIFIED** — exit 0; fixed a stale `node_modules` in this environment (`zod`/`@supabase/*` were in the lockfile but not installed), no lockfile change |

**Not run, not claimed**: any real-device/emulator test — same standing limitation as every prior
round's `apps/gate` SQLite work.

**OQ-37 status**: not closed. This round makes the gate's two local implementations
(`FakeSync`, `SqliteOutboxStore`) consistent with each other under a Promise-based events-read; it
does not invent new IC-02 surface or substitute for Afzal's confirmation of the canonical
`writeTransaction`/events-read name and shape.

### OQ-59 evidence checklist: native SQLite on a real device/emulator

OQ-59 is still **PROPOSED (not approved)** — `expo-sqlite` has only ever been exercised against
`node:sqlite` in this repo. The checklist below is what "approved" should require as evidence,
scoped exactly to OQ-59's own three named risk areas for `writeEventsAndEnqueue`/`apply`. Nothing
on it has been run; this is the plan, not a result.

**0. Prerequisites (once, logged in the evidence that cites this checklist)**
- [ ] Device/emulator model, OS/API level, available storage, and the exact `expo-sqlite` version
  and Expo SDK version under test (must match `app.json`'s configured plugin version).
- [ ] Confirm `PRAGMA foreign_keys` reads `1` on a fresh connection from this build (the
  `node:sqlite` test double defaults it on; plain SQLite — what `expo-sqlite`'s native binding
  uses — defaults it off, per `sqliteOutboxStore.ts`'s `ENABLE_FOREIGN_KEYS` comment. This is the
  one assumption in the whole store that `node:sqlite` cannot itself prove, because it does not
  reproduce SQLite's real default).

**1. Restart recovery**
- [ ] Write N events via `writeEventAndEnqueue`/`writeEventsAndEnqueue` (mix of single and batch),
  force-kill the process (not a clean exit) immediately after a logged "local commit" event, before
  any `apply()` call, and confirm on relaunch that `init()` reports the same N rows via
  `listEvents()` with no duplicates and no missing rows.
- [ ] Repeat, force-killing mid-batch (after the first event's `INSERT INTO gate_events` but before
  the second's, reproducible by pausing in a debug build) — confirm on relaunch that **neither**
  event of that batch is present (the all-or-nothing guarantee `writeEventsAndEnqueue` exists for,
  verified so far only via the synchronous `node:sqlite` engine's own `BEGIN`/`COMMIT`/`ROLLBACK`,
  never against a process that was actually killed mid-write).
- [ ] Confirm `migrateDeviceTimeMs()`'s idempotent `ALTER TABLE`/backfill path: seed a database file
  without the `device_time_ms` column (or reuse one from before this column existed), relaunch, and
  confirm `init()` adds and backfills it without data loss, then confirm a second `init()` call is a
  silent no-op.
- [ ] Confirm `apply()`'s outbox-state updates (PENDING → SENT/QUARANTINED) survive the same
  force-kill-and-relaunch pattern with no event row ever erased (`apply()` must never touch
  `gate_events`).

**2. Concurrent writes**
- [ ] Fire two overlapping `writeEventsAndEnqueue` calls (e.g., from two screens or two rapid
  taps) against the SAME live `expo-sqlite` connection and confirm the in-process `withWriteLock`
  queue actually serializes them on-device — i.e., confirm `expo-sqlite`'s own documented warning
  ("`withTransactionAsync` is not exclusive and can be interrupted by other async queries") is in
  fact what `withWriteLock` is protecting against, not a risk already absent on this binding.
  Record whether any interleaving was observed with the lock artificially disabled, as a control.
- [ ] Confirm a `listEvents()`/`pending()`/`queueHealth()` read issued while a write is in flight
  never observes a row from that write until it commits (the `withWriteLock`-covers-reads behavior,
  PR #39's review finding) — on the real binding, not just the `node:sqlite` double.
- [ ] Confirm two near-simultaneous writes sharing an event id (the double-tap / retry case) still
  resolve per `insertEventRow`'s rule: identical content is a silent no-op, differing content raises
  `OutboxCollisionError`, on-device.

**3. Foreign-key enforcement**
- [ ] With `PRAGMA foreign_keys = ON` confirmed per step 0, attempt to insert a `gate_outbox` row
  whose `id` has no matching `gate_events` row (requires calling the insert path directly, bypassing
  `writeEventsAndEnqueue`'s normal ordering, to prove the constraint — not just that normal code
  never triggers it) and confirm the native binding actually rejects it, matching
  `node:sqlite`'s behavior rather than silently accepting it the way plain SQLite would with the
  pragma off.
- [ ] Confirm the reverse is never attempted by this store's own code (every write path inserts
  `gate_events` before the matching `gate_outbox` row within the same transaction) by code
  inspection plus a passing run of the restart-recovery cases above, which would surface an orphan
  otherwise.

**Sign-off**: OQ-59 moves from PROPOSED to Resolved only on Afzal's review of this evidence (his
row in OQ-59) once it exists — not on this checklist alone, which is deliberately all "not run" per
the brief's "do not claim device/emulator testing unless actually performed."

## Seventh round (18 Nov 2026, later same day): OQ-37 resolved — Afzal's PR #67 review

Afzal reviewed PR #67 and submitted a real GitHub review — verified directly against the API, not
assumed from a chat message: `gh pr view 67 --json reviews,reviewDecision` returns
`"reviewDecision":"APPROVED"` with one review, author `afzl-raza`, state `APPROVED`, submitted
`2026-11-18T16:43:32Z`. His review body confirms the implementation is correct as submitted
("correctly makes readEvents Promise-based, awaits it in writeExit, keeps the UI-only synchronous
accessor separate, and tests rollback, duplicate-exit, and duplicate-payment behavior against both
FakeSync and SqliteOutboxStore. All six CI checks pass.") and states the canonical IC-02 contract,
now recorded as OQ-37's resolution in `docs/team/open-questions-and-assumptions.md`:

- `writeTransaction(events: readonly Event[]): Promise<void>` — non-empty, all-or-nothing local
  transaction; resolves after the local commit; never waits for network sync.
- `listEvents(): Promise<readonly Event[]>` — committed local snapshot for the duplicate guards; no
  network access.
- `writeEvent(event)` stays the single-event convenience operation.
- `WriteDeps.readEvents` remains an async injected adapter delegating to `listEvents()`.
- `PortRuntime.readEvents` stays synchronous and UI-only, outside IC-02.

Afzal's one explicit non-blocking follow-up: `T-IC02-GATE-1` currently covers only the
write/duplicate-guard subset, not the eventual full `SyncClient` facade (`observeOccupancy`/
`health` composed with a real transport) — recorded as confirmed future work, not a blocker for
this PR or for closing OQ-37.

**OQ-37 status: Resolved.** This supersedes the "OPEN — OQ-37" line under "Blockers and OQs" above
and the Sixth round's "not closed" note — both were accurate at the time they were written, before
this review landed, and are left as-is rather than rewritten.

No code change this round: PR #67's implementation was already correct per Afzal's review: this
round is the OQ register update and this log entry only.

**Commands run this round:**

| Command | Result |
| --- | --- |
| `gh pr view 67 --json reviews,reviewDecision` | **VERIFIED** — real GitHub `APPROVED` review by `afzl-raza`, not inferred from any chat message |
| `prettier --check` (both changed `.md` files) | **VERIFIED** — exit 0, clean |
| `pnpm --filter @pmp/gate test` | **VERIFIED** — 298/298 passed, unchanged (docs-only round) |
| root `pnpm check` | **VERIFIED** — exit 0 |

## Eighth round (18 Nov 2026, later same day): PR #64 hardening, OQ-59 environment check

**PR #64 (`feature/gate-oq66-quarantined`, open, not merged, 0 reviews — Afzal's review request
is still outstanding; nothing to verify or address there beyond code inspection, since no review
or comment exists on it yet).** `quarantined()`'s `JSON.parse(row.event_json)` ran unguarded
inside its `.map()`: one corrupted row would throw and take down the entire listing, hiding every
other already-quarantined row with it. Fixed with a per-row `quarantinedRowType()` helper that
never throws — a row whose JSON cannot be parsed, or parses without a string `type`, is labelled
`UNPARSEABLE_EVENT` and kept, not dropped (`id`/`attempts`/`code`/`createdAt` come from separate
SQL columns, unaffected by the JSON's health). Two new tests. `pending()`/`listEvents()` have the
identical unguarded pattern but are deliberately untouched — out of scope for this fix (not what
was asked, and both are already on `main`, so changing them is a separate change with its own
review, not something to fold in silently here).

| Command | Result |
| --- | --- |
| `pnpm --filter @pmp/gate typecheck` | **VERIFIED** — exit 0 |
| `pnpm --filter @pmp/gate test` | **VERIFIED** — 301/301 (299 baseline on that branch + 2 new) |
| `eslint` (2 changed files) | **VERIFIED** — exit 0 |
| `prettier --check` (2 changed files) | **VERIFIED** — exit 0 (after one `--write` pass) |
| root `pnpm check` on that branch | **VERIFIED** — exit 0 |
| GitHub CI on PR #64 after push | **VERIFIED** — all 6 checks pass |

**OQ-59 — environment check for native SQLite evidence.** Checked this session's environment
directly rather than assuming: no Android SDK, no `adb`, no `emulator`/`avdmanager`/`sdkmanager`
binary, no `ANDROID_HOME`/`ANDROID_SDK_ROOT`, no `~/.android`. `/dev/kvm` exists and the host has
12 CPUs, but only ~1.5 GiB free RAM at check time. **Conclusion: no Android emulator or physical
device is available in this environment; none of the OQ-59 checklist's restart-recovery,
concurrent-write or foreign-key items were run.** Provisioning an emulator from scratch (SDK +
system image download, likely several GB, plus emulator RAM headroom this host does not currently
have free) was not attempted without being asked — that is a separate, resource-heavy decision,
not a side effect of this task. OQ-59 stays **Open**, not claimed as resolved or partially
resolved by anything in this round.

**Message drafted for Afzal** (not yet posted anywhere — flagged back to the user to decide where/
whether to send it, since it is addressed to a teammate):

> OQ-59: I don't have an Android emulator or device available in my current working environment —
> no SDK, no `adb`, nothing to run the restart-recovery/concurrent-write/foreign-key checklist
> against a real `expo-sqlite` binding. The checklist itself is written and precise (evidence-
> nikhil.md, Sixth round) so whoever does have a device/emulator can run it directly. If you or
> Akanksha have access to one, that's the fastest path; otherwise let me know what testing setup
> the team actually has for Android native-module verification and I'll run the checklist there.
> Keeping OQ-59 Open either way until that evidence exists — not claiming it from the `node:sqlite`
> double alone.
