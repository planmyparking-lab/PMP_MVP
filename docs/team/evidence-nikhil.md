# Evidence log: Nikhil (GATE-01..12, IC-02 SyncClient integration)

Prepared 30 Oct 2026, updated 30 Oct 2026 (audit follow-up), updated again 30 Oct 2026
(`queueHealth`), updated again 31 Oct 2026 (independent code review, commit, PR-readiness audit).
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

## Reviewer / sign-off status

No pull request has been opened yet and no review has been requested on GitHub. 14 files are
committed locally (`8eff474`) on `feature/gate-sqlite-sync`, not pushed. `packages/sync-rules` was
read but not modified, so no second-workstream-owner review is required by `CLAUDE.md`'s "Shared
packages ... need a second workstream owner's review" rule for that package — but `expo-sqlite`'s
addition to `apps/gate/package.json`/`app.json` still needs Afzal's sign-off per OQ-59 before this
should be treated as fully reviewed.
