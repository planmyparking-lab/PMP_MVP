# Implementation Sheet: Nikhil (Gate App and Fare Engine)

Workstream prefix: `GATE`. Source of truth for IDs, owners and dependencies: [README.md](README.md). Prepared 24 Oct 2026.

## 0. Reading conventions and honesty statement

- **The repository has no code.** Every feature here has status **Not implemented**. No test has been run; every verification status is **Not verified**.
- Labels used for names of files, tables, functions and commands:
  - **(S)** = Specified in the ParkOS Engineering Handbook or MVP PRD (proposal documents written 24 Oct 2026; they describe intended design, not existing code).
  - **(R)** = Recommended (does not exist yet). Anything unlabelled in a path or signature is (R) unless it also appears in the Handbook list in section C.0.
- Commands are **recommended, to be confirmed once the repo is scaffolded**.
- No dates or time estimates. Ordering follows the dependency waves in README section 6.
- Ownership and status come from README. If anything in this sheet disagrees with README, README wins and the disagreement goes to Afzal as a pull request.

---

## A. Role and Ownership

**Objective.** Deliver the Android app a guard holds (`apps/gate`) so that a guard can open a shift, record every entry and exit in four taps, collect cash or UPI, and close the shift, all with no internet, while never being stuck at a barrier. Also deliver the fare function shared with the Console (`packages/domain`).

**Exact scope.** Everything a guard touches, plus the pure fare calculation. The app never opens its own network connection to Supabase; all data goes through Afzal's sync package.

**Features owned (primary owner = Nikhil):** GATE-01 to GATE-12 (section B).

**Explicitly outside scope (owner in brackets):**

- Sync queue, outbox, retry, conflict detection, occupancy math (Afzal: SYNC-02 to SYNC-06).
- Event schemas, money helper, reason code enum, schema version (Afzal: SYNC-01). Nikhil consumes them and may propose changes by pull request.
- Database tables, row-level security, `enroll_device`, heartbeat table (Akanksha: CLD-02, CLD-03, CLD-04).
- Console screens, tariff editor, QR screen for enrollment, PIN-setting UI (Anamika: CON-01, CON-02).
- Number-plate recognition, FASTag, payment-gateway integration, maps, GPS (not in MVP).

**Modules and files (all (R) unless marked (S)).** Handbook list (S): `apps/gate/app/(auth)/login.tsx`, `shift/open.tsx`, `entry.tsx`, `exit.tsx`, `pass.tsx`, `zone-count.tsx`, `override.tsx`, `shift/close.tsx`, `backfill.tsx`, `status.tsx`; `src/domain/fare.ts` (moved to `packages/domain/fare.ts`, see README section 8), `src/domain/token.ts`, `src/data/useOccupancy.ts`, `src/data/writeEvent.ts`, `src/auth/pinAuth.ts`, `src/print/escpos.ts`, `src/ui/*`, `src/i18n/en.json`, `src/i18n/hi.json`.

**Dependencies on other members.**

| Needs | From | Contract |
| --- | --- | --- |
| Event schemas, money helper, reason codes, `SCHEMA_VERSION` | Afzal | IC-01 |
| `writeEvent`, `observeOccupancy`, `health()` | Afzal | IC-02 |
| Idempotent ingest (indirect) | Afzal / Akanksha | IC-03 |
| Device enrollment code exchange | Akanksha | IC-05 |
| Enrollment QR screen | Anamika | IC-05 |
| Staff PIN hashes synced to the device | Akanksha / Anamika | IC-06 |
| Tariff rule JSON written by the Console wizard | Anamika | IC-04 (Nikhil provides the schema consumer; Anamika writes data) |

**Decisions Nikhil can make alone:** screen layouts, button sizes (minimum 56 dp), copy wording subject to guard review, UI library choices inside the gate app, Maestro test structure, internal module structure of `apps/gate`, which printer library to use (record choice in the sheet's decision log).

**Decisions needing approval:**

| Decision | Approver |
| --- | --- |
| Any change to event payload shape or a new event type | Afzal and all four (IC-01 rule) |
| Any new native module beyond the allowed list | Afzal |
| Anything touching sync, permissions or payment attestation | Afzal review |
| Changing fare rule JSON fields | Anamika and Afzal |
| Token format or QR payload changes after partner printing | Afzal and Anamika |
| Plate-number requirement at entry (OQ-03) | Afzal, with partner feedback |
| UPI attestation wording and policy (OQ-05) | Afzal |

---

## B. Feature Inventory

All statuses: **Not implemented**. Priority: Critical = pilot cannot start without it; High = needed in first pilot week; Medium = needed before the first full shift review.

| ID | Feature | Business purpose | User / system | Required final behaviour | Priority | Dependencies | Acceptance criteria (summary; full list in C) | Testing requirements (summary; detail in D) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GATE-01 | Vehicle entry, token-first, offline | Replace paper tickets with a fast, offline digital entry (P0-2) | Guard | Tap class, tap zone, tap Confirm; `ENTRY` event saved in one transaction; token (5-char code + QR) shown or printed; plate optional | Critical | SYNC-01, SYNC-03, GATE-09, GATE-12 | Median 4 taps and under 8 s in airplane mode on test phone; save under 100 ms; no duplicate short code among open sessions | Unit (token, zone suggestion), integration (writeEvent), e2e (Maestro), negative, stopwatch |
| GATE-02 | Vehicle exit and lost-token lookup | Fast exit with correct fare (P0-3) | Guard | Scan QR or type code; fare shown; pay mode chosen; `EXIT` and `PAYMENT` events saved atomically; lost-token search by number or by class and time window | Critical | GATE-01, GATE-03 | Median exit under 10 s with scan; exit saved offline; double exit blocked locally | Unit, integration, e2e, negative (unknown code, double exit) |
| GATE-03 | Fare engine in `packages/domain` | One fare calculation shared by gate and Console (P0-3, IC-04) | Gate app, Console | Pure function `fare(tariff, entryAt, exitAt, vehicleClass) -> paise` supporting grace, hourly slabs, flat, day cap, night rate, effective dates, vehicle classes | Critical | SYNC-01 | 100% match on the 60-case table plus 20 hand-checked cases; identical results in Console | Unit (table-driven), property tests, contract test with Console |
| GATE-04 | Payment recording and UPI attestation | Record how each vehicle paid without a gateway (P0-3) | Guard | Cash, UPI received (sets `upi_attested = true` by that guard), Pass, Waive (reason code required); integer paise | Critical | GATE-02 | Every exit has exactly one `PAYMENT`; UPI attestation attributable to a staff id; waive needs reason | Unit, integration, e2e, negative |
| GATE-05 | Monthly pass validation | Let pass holders bypass fares (P0-5) | Guard | Lookup by number or QR; shows validity and dues; works offline; expired pass falls back to fare or override | High | SYNC-03 | Lookup under 3 s offline; expiry and dues displayed correctly | Unit, integration (synced `passes`), e2e |
| GATE-06 | Shift open and close, guard side | Reconciliation without hand-matching (P0-6) | Guard, supervisor | Open with float; close shows expected cash and attested UPI, asks counted cash and UPI app total, computes variance, requires reason above threshold, writes `SHIFT_CLOSE` | Critical | GATE-04 | Close in under 5 minutes; variance computed in paise correctly; cannot close with unexplained variance above threshold | Unit, integration, e2e, negative |
| GATE-07 | Override flow and reason codes | Log every manual exception (P0-7) | Guard | Override sheet with fixed reason codes; `OTHER` requires note; correction events (never edits) within 2 minutes | High | SYNC-01 | Every override has reason code and staff id; wrong-class correction produces new event | Unit, integration, e2e, negative |
| GATE-08 | Zone count entry and reminders | Self-correcting occupancy (P0-4) | Guard | Enter real count per zone; `ZONE_COUNT` event; local reminders at one-third and two-thirds of shift | High | SYNC-04 | Reminders fire offline; count event saved; baseline used by occupancy | Unit, integration, e2e |
| GATE-09 | PIN login, offline auth and device enrollment | Secure but offline guard identity (P0-11) | Guard, manager | Enrollment by scanning one-time QR; PIN verified locally against synced salted hashes; 5 wrong tries lock for 5 minutes; devices unsynced 14 days refuse logins | Critical | CLD-03, CON-02 | Enrollment works with valid code; PIN check works offline; lockout enforced; deactivated guard rejected after sync | Unit, integration, e2e, negative, security |
| GATE-10 | Bluetooth printer, QR display and scan, print fallback | Physical or on-screen token with no blocking (P0-2) | Guard | Print receipt via Bluetooth ESC/POS; on any print failure show full-screen token and QR automatically; camera scan with typed-code fallback | High | GATE-01 | Entry already saved before printing; fallback shown in every failure case | Unit, integration (mock printer), e2e, hardware tests |
| GATE-11 | Paper-sheet backfill | Recover after a local database failure | Guard, supervisor | Backfill screen to key in paper entries and exits with `source = PAPER_BACKFILL`; used after "Use the paper sheet" fallback | Medium | GATE-01, GATE-02 | Backfilled events syncable, flagged, and visible to operator | Unit, integration, e2e |
| GATE-12 | App shell, Hindi/English, status and diagnostics screen, banners | Make failures visible and usable by low-technical guards | Guard, support | Navigation under two screens deep; Hindi default option; banners for offline, queue age, low battery, low storage, clock skew, old build; diagnostics screen with copy-to-WhatsApp blob | Critical | SYNC-06 | All banners trigger from their conditions; diagnostics screen lists all required fields; every string exists in both languages | Unit (i18n completeness), integration (health mock), e2e, accessibility |

---

## C. Feature-by-Feature Implementation Instructions

### C.0 Shared architecture rules for the gate app

1. **One action = one `writeEvent` call = one SQLite transaction.** The function (R: `apps/gate/src/data/writeEvent.ts`, listed in the Handbook (S)) validates the event with the IC-01 zod schema, stamps `id` (UUIDv7), `device_id`, `staff_id`, `device_time`, and delegates to Afzal's sync package (IC-02). It returns after the local commit; it never waits for the network.
2. **No network code in the app.** If data is missing, ask Afzal to add it to the sync rules.
3. **Stack (S):** Expo development build (not Expo Go), React Native, TypeScript, `expo-router`, `expo-camera`, `expo-secure-store`, MMKV for UI preferences, `i18next`, Sentry. No Redux. Allowed native modules: SQLite (via the sync package), camera, secure store, notifications, Bluetooth printer.
4. **Performance budgets (S):** cold start under 3 s, entry save under 100 ms, release APK under 40 MB.
5. **UI rules (S):** buttons at least 56 dp tall, high contrast, haptic on every tap, readable in sunlight, never more than two screens from home to any action, portrait only, screen kept awake during a shift.
6. **Corrections are events.** Never update or delete an event; a correction is a new `OVERRIDE` event referencing the original `session_id` or `event_id`.
7. **Logging.** Use one `log(event, fields)` helper (R: `src/lib/log.ts`) that writes a bounded local ring buffer (last 500 lines) and sends warnings and errors to Sentry. Never log plain PINs, tokens, credentials or full phone numbers.
8. **Time.** Use `device_time` UTC ISO 8601 for events; display in IST. Do not trust `Date.now()` for ordering when the clock-skew banner is active.

**Recommended event payloads (R; the authoritative shape is IC-01, owned by Afzal).** Verify against IC-01 once it exists.

| Event | Required fields beyond the common envelope | Notes |
| --- | --- | --- |
| `ENTRY` | `session_id`, `short_code`, `vehicle_class`, `zone_id`, optional `vehicle_no` | token-first; plate optional |
| `EXIT` | `session_id`, `fare_paise`, `tariff_id`, `tariff_version` | links to `ENTRY` by `session_id` |
| `PAYMENT` | `session_id`, `mode` (`CASH`, `UPI`, `PASS`, `WAIVED`), `amount_paise`, `upi_attested` | one per exit |
| `OVERRIDE` | `target_event_id` or `session_id`, `reason_code`, optional `note`, optional `correction` | `OTHER` requires `note` |
| `ZONE_COUNT` | `zone_id`, `actual_count`, `system_count` | baseline for occupancy |
| `SHIFT_OPEN` | `shift_id`, `float_paise` | |
| `SHIFT_CLOSE` | `shift_id`, `expected_cash_paise`, `counted_cash_paise`, `upi_attested_total_paise`, `upi_declared_total_paise`, `cash_variance_paise`, `upi_variance_paise`, optional `variance_reason` | |

Common envelope: `id`, `type`, `facility_id`, `device_id`, `staff_id`, `device_time`, `source` (`GATE` or `PAPER_BACKFILL`), `schema_version`.

---

### GATE-01 Vehicle entry, token-first, offline

1. **Problem.** Paper tickets are slow, reconciliation is manual, and ANPR is out of scope. The guard needs a four-tap digital entry that keeps working with no internet.
2. **Expected behaviour.** Guard taps a vehicle class button; the zone is pre-selected to the first zone with space for that class; guard taps the zone (to confirm or change) and taps Confirm; token appears (or prints). Plate is optional: an "Add number" button is offered but not required, except for pass holders (GATE-05).
3. **Preconditions.** Device enrolled (GATE-09); a guard logged in; a shift open (GATE-06); facility config (zones, classes) synced (SYNC-03); occupancy available (SYNC-04). If config has never synced, show a blocking "Setup not synced yet, connect once" state; do not allow entry without zones.
4. **Implementation sequence.**
   1. Build `ClassPad` (R: `src/ui/ClassPad.tsx`) rendering configured vehicle classes as large buttons (from synced `zones.vehicle_class` and facility class list).
   2. Implement zone suggestion `suggestZone(classId, occupancy, zones)` (R: `src/domain/suggestZone.ts`): first zone, in configured order, whose allowed classes include the class and whose occupancy is below capacity; if none has space, return the first allowed zone with `full = true` so the guard can still admit with an override (GATE-07).
   3. Implement `token.ts` (S): generate UUIDv7 `session_id`; generate a 5-character Crockford base32 short code; reject and regenerate if it collides with any open session on this device (open sessions from synced snapshot plus local entries); QR payload `parkos:<facilityId>:<code>:<sessionId>` (S).
   4. Implement `entry.tsx` (S): screen state machine `idle -> classChosen -> zoneChosen -> saving -> tokenShown`. Record `entry_started_at` on first tap for the timing metric.
   5. On Confirm call `writeEvent({type:'ENTRY', ...})`; await local commit; then trigger print (GATE-10) without awaiting it.
   6. Show token screen with a "New vehicle" button (resets to idle) and an auto-return after 10 s of inactivity.
   7. Emit metric `entry_ms` (first tap to token shown) and `entry_taps`.
5. **Files.** `app/entry.tsx` (S); `src/ui/ClassPad.tsx`, `src/domain/suggestZone.ts` (R); `src/domain/token.ts` (S); `src/data/writeEvent.ts`, `src/data/useOccupancy.ts` (S).
6. **Functions and models.** `suggestZone`, `generateToken(openShortCodes) -> {sessionId, shortCode, qrPayload}`, `writeEvent`, `useOccupancy`.
7. **Input/output contract.** In: `vehicleClass`, `zoneId`, optional `vehicleNo`. Out: persisted `ENTRY` event (IC-01 shape) and an in-memory `TokenView {shortCode, qrPayload, enteredAt}`.
8. **Data flow.** Tap -> `entry.tsx` state -> `writeEvent` (validate, stamp, transaction) -> local SQLite `events` -> sync outbox (Afzal) -> cloud; screen reads token from the returned event, not from the network.
9. **Validation and business rules.** Class must exist in facility config; zone must allow the class; if `vehicleNo` supplied, normalize to uppercase alphanumerics (strip spaces and hyphens) and reject lengths below 4 or above 12; if the same normalized plate has an open session on this device, show a blocking warning "This vehicle is already inside" with Override option (the server `DUPLICATE_ENTRY` detector remains the backstop).
10. **Success behaviour.** Token visible within the budget; print attempted; occupancy decreases locally immediately.
11. **Failure behaviour.** Local write error: switch to the paper-sheet screen (C.0 and GATE-11); validation error: inline message in the active language; print failure: handled in GATE-10 with no effect on the saved entry.
12. **Edge cases.** All zones full; two taps on Confirm (debounce: ignore the second tap while `saving`); app killed during save (transaction is atomic: event fully saved or absent); clock far off (event still saved, GATE-12 banner shows); shift not open (route to GATE-06); config changed mid-shift (use the config snapshot at screen open; refresh on next screen).
13. **Security/authorization.** Only a logged-in guard of the device's facility; `staff_id` from the session; no data from other facilities is ever in local state.
14. **Logging/observability.** `entry_ms`, `entry_taps`, `short_code_regenerations`, `zone_full_admits`, save errors to Sentry.
15. **Tests summary.** T-GATE-01-U*, I*, E*, N*, R*, X* (section D).
16. **Acceptance criteria.** (a) Median 4 taps; (b) median under 8 s from first tap to token in airplane mode on the low-cost test phone over 50 entries; (c) event saved under 100 ms (p95 over 200 saves); (d) no short-code collision among open sessions across 10,000 simulated generations; (e) every ENTRY event validates against IC-01; (f) token screen survives rotation lock and app backgrounding.
17. **Definition of done.** Criteria above evidenced; Maestro entry flow green in CI; stopwatch sheet filed; code reviewed by a member outside the gate workstream; no open critical defects.

### GATE-02 Vehicle exit and lost-token lookup

1. **Problem.** Exit must be fast, produce a correct fare, and survive lost tokens.
2. **Expected behaviour.** Guard scans the QR (or types the 5-char code); app shows class, entry time, duration and fare; guard picks a payment mode (GATE-04); exit completes and the session leaves occupancy. Lost token: search open sessions by plate (if recorded) or by class plus an entry-time window (default: last 6 hours, adjustable).
3. **Preconditions.** Shift open; GATE-03 fare function and cached tariffs available; open-session list available locally (synced snapshot plus local entries).
4. **Implementation sequence.**
   1. Build `exit.tsx` (S) with three entry paths: camera scan (GATE-10), typed code keypad, "Lost token" button.
   2. Implement `findOpenSession(input, openSessions)` (R: `src/domain/findOpenSession.ts`) returning exactly one match, many matches (list), or none.
   3. Resolve tariff via `tariffFor(facilityTariffs, vehicleClass, exitAt)` (R) selecting the tariff effective at exit time (effective-dated).
   4. Call `fare(...)` from `packages/domain` (GATE-03) and render rupees through the shared money helper (IC-01).
   5. Hand off to GATE-04 payment sheet; on pay-mode choice call `writeExit()` (R: wrapper in `writeEvent.ts`) which writes `EXIT` and `PAYMENT` in **one transaction** (both events or neither).
   6. Block a second exit for the same `session_id` locally by checking local `EXIT` events before showing the fare.
   7. Emit `exit_ms`.
5. **Files.** `app/exit.tsx` (S); `src/domain/findOpenSession.ts`, `src/domain/tariffFor.ts` (R); `packages/domain/fare.ts` (R location, name per README).
6. **Contracts.** Input: scan payload or typed code or search criteria. Output: `EXIT` + `PAYMENT` events (IC-01); screen state `FareView {sessionId, class, enteredAt, exitedAt, durationMin, farePaise, tariffId}`.
7. **Data flow.** Scan -> parse payload -> verify `facilityId` matches device facility -> lookup open session -> fare -> payment mode -> atomic transaction -> outbox.
8. **Validation.** QR `facilityId` must equal this facility (otherwise "Wrong facility token"); short code case-insensitive and Crockford-normalized (I, L -> 1; O -> 0; U rejected); exit time not before entry time (if it is, use entry time + 0 min and flag `CLOCK_SKEW` hint to GATE-12).
9. **Success.** Fare displayed within the budget; exit recorded; session removed from local occupancy.
10. **Failure.** Unknown code: "Not found" with lost-token option; many matches: list sorted by entry time with class and plate; fare engine throws (missing tariff): show "No tariff for this class" and offer Waive with reason or call manager; write error: paper-sheet fallback.
11. **Edge cases.** Token scanned twice (second scan shows "Already exited at HH:MM"); exit across midnight and across tariff effective-date boundary (GATE-03 rules); exit by a different guard than entry (allowed; both ids stored); offline entry from another phone not yet synced to this phone (not found locally: show "Not found on this phone; sync or use lost-token search; if the vehicle truly entered elsewhere, create an exit with Override reason `LOST_TOKEN`" and rely on server `ORPHAN_EXIT` conflict for review).
12. **Security.** Same as GATE-01; payload parsing must reject anything not matching `^parkos:[0-9a-f-]{36}:[0-9A-Z]{5}:[0-9a-f-]{36}$` (R pattern).
13. **Logging.** `exit_ms`, scan failures, lost-token searches, orphan exits.
14. **Acceptance.** Median exit under 10 s with scan (50 exits), under 15 s with typed code (10), lost-token flow completes (10); atomic exit and payment verified by killing the app mid-write 20 times.
15. **Definition of done.** Evidence of the above; Maestro exit flow green; contract test T-GATE-03-I1 green for the fare function.

### GATE-03 Fare engine in `packages/domain`

1. **Problem.** Gate app and Console must compute identical fares; two copies will cause billing disputes.
2. **Expected behaviour.** Pure, deterministic function `fare(tariff, entryAt, exitAt, vehicleClass) -> paise` (IC-04). No I/O, no clock reads, no randomness.
3. **Preconditions.** IC-01 money helper exists; tariff rule JSON schema agreed with Anamika (IC-04).
4. **Rule model (R; fields from README IC-04).**

```text
Tariff {
  id, facilityId, vehicleClass, effectiveFrom (ISO date, IST), effectiveTo?,
  graceMinutes: int >= 0,
  model: 'HOURLY_SLABS' | 'FLAT' | 'PER_ENTRY',
  slabs?: [{ upToMinutes: int|null, pricePaise: int }]   // cumulative bands; null = open-ended repeat unit
  repeat?: { everyMinutes: int, pricePaise: int }         // price per additional unit after last slab
  flatPaise?: int,
  dayCapPaise?: int,                                       // max per 24h block counted from entry
  night?: { fromHHMM, toHHMM, multiplierPercent | surchargePaise }, // IST wall clock
  minimumPaise?: int
}
```
5. **Implementation sequence.**
   1. Write the zod schema for `Tariff` in `packages/contracts` proposal PR (Afzal approves) and the TypeScript types.
   2. Implement `durationMinutes(entryAt, exitAt)` using integer arithmetic on UTC milliseconds; round up to whole minutes.
   3. Apply `graceMinutes`: if duration <= grace, return 0.
   4. Pick the tariff effective at `exitAt` (or at `entryAt`, per decision OQ-20; default recommendation: the tariff effective at entry time, so a customer is charged under the rules they saw at entry; record `tariff_version` on the `EXIT` event). Document the chosen rule in the function's doc comment and tests.
   5. Compute base fare by model: slabs (find the band containing the duration; after the last band add `repeat` units rounded up), flat (constant), per-entry (constant regardless of duration).
   6. Apply night surcharge for each minute-block overlapping the night window (if configured) using IST wall time converted with a fixed +05:30 offset (India has no daylight saving; document this assumption).
   7. Apply `dayCapPaise` per 24-hour block from entry; total for multi-day stays is the sum of capped blocks plus the remainder capped.
   8. Apply `minimumPaise` last; return integer paise; never negative; never floating point.
   9. Export a `explainFare()` variant that returns the steps used (for the "try it" panel and dispute resolution).
6. **Files (R).** `packages/domain/src/fare.ts`, `packages/domain/src/fare.test.ts`, `packages/domain/src/fixtures/fareCases.json` (the 60-case table), `packages/domain/src/explainFare.ts`.
7. **Input/output.** In: validated `Tariff`, two ISO UTC instants, vehicle class string. Out: integer paise, or throws `FareError` with codes `NO_TARIFF`, `INVALID_RANGE`, `CLASS_MISMATCH`.
8. **Validation rules.** `exitAt >= entryAt` else `INVALID_RANGE`; tariff class must equal vehicle class else `CLASS_MISMATCH`; tariff must be effective on the chosen date else `NO_TARIFF`.
9. **Success.** Identical outputs across gate app and Console for every fixture row.
10. **Failure.** Typed errors, never silent zeros.
11. **Edge cases.** Exactly at grace boundary; exactly at a slab boundary (59, 60, 61 minutes); exits crossing midnight; DST is irrelevant (document); entry at 23:59 and exit at 00:01; day cap across 2 and 3 days; tariff effective-date change during a stay; zero-minute stay; very long stays (over 30 days) bounded loops (compute arithmetically, no per-minute iteration).
12. **Security/integrity.** Integer arithmetic only; no external input beyond validated tariff; no mutation of inputs.
13. **Logging.** None inside the pure function; the caller logs `tariff_id` and errors.
14. **Tests.** Section D (60-case table, property tests, Console contract test).
15. **Acceptance.** 100% of the 60 table cases and 20 hand-checked cases match; property tests green; Console calculator returns identical values for all 60 cases (T-GATE-03-I1).
16. **Definition of done.** Evidence of the above; reviewed by Anamika (consumer) and Afzal; fixture file frozen and versioned.

### GATE-04 Payment recording and UPI attestation

1. **Problem.** Partners collect UPI on their own QR (PhonePe, GPay or similar) so ParkOS cannot see payment confirmation. It must record how each vehicle paid and make the recording attributable.
2. **Expected behaviour.** After the fare appears the guard taps one of four buttons: **Cash**, **UPI received**, **Pass**, **Waive**. UPI received means the guard has seen or heard the confirmation in the operator's app or soundbox; the app stores `upi_attested = true` with the guard's `staff_id`. Waive opens the reason-code sheet (GATE-07). Pass opens pass lookup (GATE-05) if no pass is already attached.
3. **Preconditions.** An `EXIT` fare computed (GATE-02).
4. **Implementation sequence.**
   1. Build `PaySheet` (R: `src/ui/PaySheet.tsx`) with four large buttons and the amount in rupees.
   2. For **UPI received**, show the operator's static QR for the customer to scan: the image is configured per facility in the Console (Anamika; flagged as OQ for storage: image URL or base64 in facility config, Recommendation: a small image stored in Supabase Storage and cached on device). If no QR image is configured, show text "Ask customer to scan your UPI QR".
   3. On button tap call `writeExit()` (GATE-02) with `PAYMENT {mode, amount_paise, upi_attested}`.
   4. For **Cash**, optionally show a change calculator (amount tendered input, change returned); the tendered amount is not stored in v1 (decision: avoid data not needed for reconciliation).
   5. For **Pass**, `amount_paise = 0`, attach `pass_id`.
   6. For **Waive**, `amount_paise = 0`, require `reason_code`, create an `OVERRIDE` event in the same transaction.
5. **Files (R).** `src/ui/PaySheet.tsx`, `src/data/writeEvent.ts` extension.
6. **Contracts.** `PAYMENT` event fields in C.0; `upi_attested` boolean set only by the UPI path; modes enumerated in IC-01.
7. **Data flow.** Button -> `writeExit` transaction -> events table -> sync -> `shift` expected totals computed by GATE-06 from local `PAYMENT` events.
8. **Rules.** `amount_paise` for Cash and UPI equals the computed fare (no manual amount edit in v1; discount needs Waive or Override with reason); at most one `PAYMENT` per `session_id` (local check and server check).
9. **Success.** One `EXIT` and one `PAYMENT` stored; session closed.
10. **Failure.** Transaction failure leaves neither event; the guard sees an error and retries; repeated failure routes to paper fallback.
11. **Edge cases.** Customer pays cash after first choosing UPI (guard taps Back before saving; after saving, correction by OVERRIDE within 2 minutes changing mode, producing a new `PAYMENT_CORRECTION` described as an `OVERRIDE` with `correction.mode`; confirm exact shape with Afzal, OQ); customer disputes fare (Waive or Override with reason).
12. **Security.** UPI attestation is an honour-based flag: it is attributable (staff id, device id, time) but not verified. This limitation must appear in the guard training and the owner report (OQ-05). No payment credentials or customer UPI IDs are stored.
13. **Logging.** Count of UPI attested, waived, overrides per 100 vehicles.
14. **Acceptance.** Every exit in the 50-exit test has exactly one PAYMENT; attestation fields correct; waive always has a reason code.
15. **Definition of done.** Evidence of the above; Afzal's review of the payment path recorded in the pull request.

### GATE-05 Monthly pass validation

1. **Problem.** Regular customers hold monthly passes; the guard needs a quick validity check offline.
2. **Expected behaviour.** On the exit screen or entry screen, guard taps "Pass", scans the pass QR or types the vehicle number; the app shows holder (optional name), valid-to date, dues amount, and a green or red state. Valid pass: entry proceeds with `PASS` mode on exit; expired or dues > 0: red state with options "Charge normal fare", "Allow with override".
3. **Preconditions.** `passes` table (S: `passes(id, facility_id, vehicle_no, valid_to, dues)`) synced to the device (SYNC-03).
4. **Sequence.**
   1. `pass.tsx` (S) with scan and type paths.
   2. `lookupPass(vehicleNoOrQr, passes, now)` (R: `src/domain/pass.ts`) returning `{state: 'VALID'|'EXPIRED'|'NOT_FOUND'|'DUES', pass?}`.
   3. At entry for a pass holder, require plate (the one case where plate is mandatory), set `ENTRY.pass_id`.
   4. At exit, `PAYMENT.mode = 'PASS'` and amount 0 when VALID; for DUES show amount and let guard choose Cash or UPI received for dues if the facility setting allows (OQ).
5. **Files.** `app/pass.tsx` (S); `src/domain/pass.ts` (R).
6. **Contracts.** Pass fields from the synced `passes` rows (IC-02 download side); pass QR payload format to be agreed with Anamika (R: `parkos-pass:<facilityId>:<passId>`).
7. **Validation.** Normalize plate as in GATE-01; compare `valid_to` end-of-day IST; pass for another facility never appears (sync rules).
8. **Success.** Lookup in under 3 s offline.
9. **Failure.** `NOT_FOUND` offers "Charge normal fare"; stale pass data banner when last sync is older than 24 hours ("Pass list may be outdated").
10. **Edge cases.** Pass expires today; two passes for one plate (use the later `valid_to`); plate formatting variants; pass holder enters two vehicles (second entry raises the `DUPLICATE_ENTRY` server conflict if the same plate is open; allowed only with Override).
11. **Security.** Only passes of the facility are on the device; no personal data beyond plate and optional name.
12. **Logging.** Pass lookups, state outcomes, stale-data warnings.
13. **Acceptance.** Lookup under 3 s on 5,000 pass rows offline (p95 over 100 lookups); all states render correctly.
14. **DoD.** Evidence plus Maestro flow.

### GATE-06 Shift open and close, guard side

1. **Problem.** Shift-end cash and UPI matching is manual and error-prone.
2. **Expected behaviour.** **Open:** guard (or supervisor) enters opening float; app writes `SHIFT_OPEN`. **Close:** app shows expected cash (float plus sum of CASH payments in the shift), UPI attested total, and asks for counted cash and the UPI total read from the operator's business app. It computes `cash_variance = counted - expected` and `upi_variance = declared - attested` in paise, highlights variances beyond the facility threshold, requires a reason if beyond threshold, then writes `SHIFT_CLOSE` and shows a summary.
3. **Preconditions.** Payments recorded (GATE-04); facility variance threshold synced (Console wizard step 5, CON-01).
4. **Sequence.**
   1. `shift/open.tsx`, `shift/close.tsx` (S).
   2. `shiftTotals(events, shiftId)` (R: `src/domain/shiftTotals.ts`) computing totals by mode from local events whose `device_time` falls between open and close and whose shift id matches; include events from other devices of the same facility only if the facility setting says shifts span devices (OQ-23 default: shift is per guard per device).
   3. Variance logic and threshold check (`threshold_paise` from config; default if missing: 0 and require reason for any non-zero variance, flagged as a recommendation).
   4. Block closing while unsynced `PAYMENT` events are in the outbox? Decision: do not block; show "Not yet synced" count; the close event itself syncs later.
   5. Summary screen with counts: vehicles, cash, UPI attested, passes, waived, overrides.
5. **Files.** `app/shift/open.tsx`, `app/shift/close.tsx` (S); `src/domain/shiftTotals.ts` (R).
6. **Contracts.** `SHIFT_OPEN`, `SHIFT_CLOSE` payloads (C.0, IC-01); Console reads them (CON-06).
7. **Rules.** One open shift per guard per device; closing requires a counted cash value (0 is valid, empty is not); reason required beyond threshold; a closed shift cannot be reopened by the guard (owner event only, outside this sheet).
8. **Success.** Close completes in under 5 minutes of guard time; variances computed to the paisa.
9. **Failure.** No open shift: entry and exit route to open-shift; write error: paper fallback with instruction to record totals on paper.
10. **Edge cases.** Vehicles still inside at close (allowed; they carry into the next shift); phone clock changed mid-shift; two devices at one gate; shift left open overnight (banner after a configurable maximum, default 16 hours, recommendation).
11. **Security.** Only the shift's owner or a supervisor role (from membership synced as part of staff config) can close.
12. **Logging.** Variance magnitude, reasons, close duration.
13. **Acceptance.** 20 simulated shifts with known totals produce exact expected variances; close flow under 5 minutes in a timed run.
14. **DoD.** Evidence; Anamika confirms the Console review screen reads the event unmodified (T-GATE-06-I2).

### GATE-07 Override flow and reason codes

1. **Problem.** Exceptions must be possible without breaking the audit chain.
2. **Behaviour.** An override sheet lists the fixed reason codes (S): `LOST_TOKEN`, `DAMAGED_TOKEN`, `MISREAD_NUMBER`, `WRONG_CLASS`, `OWNER_WAIVER`, `STAFF_VEHICLE`, `OTHER` (note required). Each override writes an `OVERRIDE` event and, where relevant, the corrected data as a new event.
3. **Preconditions.** Logged-in guard.
4. **Sequence.** (1) `override.tsx` (S) as a bottom sheet reachable from entry, exit and payment. (2) `reasonCodes` imported from IC-01. (3) `writeOverride({targetEventId|sessionId, reasonCode, note?, correction?})` (R). (4) For `WRONG_CLASS` within 2 minutes of the entry, allow changing the class: write `OVERRIDE` with `correction.vehicle_class`; derived session view uses the latest correction. After 2 minutes, only a supervisor role can correct (R).
5. **Files.** `app/override.tsx` (S); `src/data/writeOverride.ts` (R).
6. **Contracts.** IC-01 `OVERRIDE`; derived-session interpretation of corrections is a shared rule with Afzal (SYNC-04) and Anamika (CON-05).
7. **Rules.** Reason code mandatory; `OTHER` requires 5 to 200 characters; note stored as text, not rendered as HTML; no override may delete or edit an event.
8. **Success/failure.** Success: event saved and badge counter increments; failure: same as other writes.
9. **Edge cases.** Two overrides on the same session; override on a session already exited; correction after sync; `STAFF_VEHICLE` entries with zero fare (use Waive path with that reason).
10. **Security.** Role check for corrections after the 2-minute window; reason notes limited in length; no personal data requested.
11. **Logging.** Overrides per 100 vehicles by reason code.
12. **Acceptance.** Every override in tests has reason code and staff id; derived session shows corrected class; original events unchanged.
13. **DoD.** Evidence plus Afzal's approval of the correction semantics.

### GATE-08 Zone count entry and reminders

1. **Problem.** Occupancy drifts; physical counts correct it.
2. **Behaviour.** Guard selects a zone, enters the actual number, app shows the system value and gap, writes `ZONE_COUNT`. Local notifications remind at one-third and two-thirds of the shift length.
3. **Preconditions.** Shift open; occupancy available.
4. **Sequence.** (1) `zone-count.tsx` (S). (2) `systemCount` from `observeOccupancy` (IC-02). (3) On submit: validate integer 0 to capacity + 50% (warn above capacity, allow with confirmation). (4) Schedule two local notifications with `expo-notifications` at shift open; cancel at close. (5) Reminder tap deep-links to the screen.
5. **Files.** `app/zone-count.tsx` (S); `src/notifications/zoneReminders.ts` (R).
6. **Contracts.** `ZONE_COUNT` payload (C.0); occupancy baseline semantics owned by Afzal (SYNC-04).
7. **Rules.** One count per zone per reminder window preferred but not enforced; counts are events, never edits.
8. **Success.** Event saved; the displayed occupancy equals the entered count immediately after save.
9. **Failure.** Notification permission denied: persistent in-app banner at the same moments; write failure as usual.
10. **Edge cases.** Shift length unknown (use facility default or 8 hours); phone off during a reminder (show missed reminder banner on start); guard enters a count while vehicles are mid-entry (accepted; baseline plus later events).
11. **Security.** None beyond standard.
12. **Logging.** Counts per shift, gap magnitude per zone (feeds MET-01).
13. **Acceptance.** Reminders fire in airplane mode on the test phone; count event changes displayed occupancy; gap logged.
14. **DoD.** Evidence plus Afzal confirming occupancy baseline behaviour against SYNC-04 tests.

### GATE-09 PIN login, offline auth and device enrollment

1. **Problem.** Guards need an identity on a shared phone with no internet, and phones must join a facility securely.
2. **Behaviour.** **Enrollment (once per device):** manager shows a one-time QR in the Console; guard device scans it; the app exchanges the code through the enrollment function (IC-05) and stores device credentials in secure storage. **Login (every shift):** the guard selects their name and enters a 4 to 6 digit PIN; the app verifies against the salted PIN hash synced for active staff of that facility. Five wrong tries lock the device for 5 minutes. A device that has not synced for 14 days refuses logins until it does (S).
3. **Preconditions.** Network connectivity at enrollment time; Console QR (CON-02); staff rows with PIN hashes synced (IC-06).
4. **Sequence.**
   1. Enrollment screen scanning `parkos-enroll:<code>` (R payload) and calling the enrollment function (IC-05).
   2. Store credentials with `expo-secure-store`; never in MMKV or logs.
   3. Trigger initial sync and block the login screen until config and staff hashes have arrived once.
   4. `pinAuth.ts` (S): `verifyPin(staffId, pin, staffRecord)` using the hash algorithm agreed with Akanksha (R: PBKDF2 or scrypt via a vetted library with a per-user salt; parameters recorded in IC-06; verification time under 300 ms on the test phone).
   5. Lockout counter stored in secure storage keyed by device; resets on success; survives app restarts.
   6. Staleness check: `lastSyncAt` older than 14 days -> refuse login with an explanation.
   7. Session: after login keep the guard logged in until shift close or manual logout; auto-lock screen after 15 minutes idle requires PIN again (R, recommendation; confirm with partners).
5. **Files.** `app/(auth)/login.tsx` (S); `app/(auth)/enroll.tsx` (R); `src/auth/pinAuth.ts` (S); `src/auth/lockout.ts` (R).
6. **Contracts.** IC-05 (code in, credentials out); IC-06 (hash record shape: `staff_id`, `name`, `pin_salt`, `pin_hash`, `active`, `role`).
7. **Rules.** Never store or log the plain PIN; PIN length 4 to 6 digits enforced at set time by the Console (Anamika) and at entry by the app; deactivated staff disappear from the picker after sync.
8. **Success.** Enrollment completes; login works in airplane mode.
9. **Failure.** Invalid or expired code: clear message and a retry; no network at enrollment: message "Connect to the internet once to enroll"; lockout shows remaining time.
10. **Edge cases.** Clock changed to bypass lockout (store lockout end as a monotonic elapsed value plus wall time; treat clock moving backwards as still locked, R); enrolled device wiped; guard deactivated while offline (still allowed until next sync; document as a known limitation); two guards share a phone (supported by the picker).
11. **Security.** Credentials in secure storage; PIN hash only; constant-time comparison; no PIN in crash reports; rate limiting by lockout; device-level revocation by the Console takes effect at next sync (document).
12. **Logging.** Login success and failure counts, lockouts, enrollment failures (no PIN data).
13. **Acceptance.** All tests in D pass: offline login, 5-try lockout, 14-day staleness, deactivated guard after sync, wrong-facility code rejected.
14. **DoD.** Evidence plus security review by Afzal and Akanksha of the hashing parameters and storage.

### GATE-10 Bluetooth printer, QR display and scan, print fallback

1. **Problem.** Printing is a convenience; a broken printer must never block a barrier.
2. **Behaviour.** After a saved entry, the app prints a receipt over Bluetooth ESC/POS (token code, QR, time, facility name, class) to the paired thermal printer. Any failure (not paired, offline, paper out, error) immediately shows the token and QR full-screen. Camera scan reads QR tokens at exit; if camera permission is denied or fails, the typed-code path is offered.
3. **Preconditions.** Printer paired once in settings (R: `settings/printer.tsx`); camera permission requested at first use with a plain explanation.
4. **Sequence.** (1) `escpos.ts` (S): receipt layout builder; QR as ESC/POS QR command or bitmap fallback. (2) Print queue with a 5-second timeout and one retry. (3) On failure or timeout set `printState = FAILED` and render `TokenFullScreen` (R: `src/ui/TokenFullScreen.tsx`). (4) `scan.tsx` component using `expo-camera` barcode scanning for QR. (5) Printer library selection (Nikhil decides; document the choice and its maintenance status in the decision log).
5. **Files.** `src/print/escpos.ts` (S); `src/ui/TokenFullScreen.tsx`, `settings/printer.tsx`, `src/ui/Scanner.tsx` (R).
6. **Contracts.** QR payload (GATE-01); no network contract.
7. **Rules.** Printing never precedes the local save; print failures never roll back an entry; at most one automatic retry; manual "Reprint" button available.
8. **Success.** Receipt printed; no screen change needed.
9. **Failure.** Fallback screen shown in all failure cases.
10. **Edge cases.** Printer out of paper mid-print; printer powered off; Bluetooth permission revoked; low light scanning (offer torch toggle); damaged QR (typed code).
11. **Security.** The receipt contains no personal data; QR contains only identifiers.
12. **Logging.** Print attempts, failures, fallbacks, scan failures.
13. **Acceptance.** 100 prints with 10 forced failures all produce fallback screens and zero lost entries; scan success rate at least 95% on printed receipts under normal indoor light (10 scans each of 20 receipts).
14. **DoD.** Evidence on at least one real printer model recorded in the sheet; list unsupported models.

### GATE-11 Paper-sheet backfill

1. **Problem.** If the local database fails, guards fall back to paper; entries must be recoverable later.
2. **Behaviour.** A backfill screen lets a guard or supervisor key in paper entries (class, zone, entry time, optional plate, optional token code) and paper exits (exit time, payment mode, amount) later. Events carry `source = PAPER_BACKFILL` and the original paper time as `device_time` with an additional `recorded_at`.
3. **Preconditions.** Working local database (after repair or on another device); supervisor role for bulk backfill (R).
4. **Sequence.** (1) `backfill.tsx` (S) with two tabs: entries, exits. (2) Time picker constrained to the current shift or the previous 24 hours. (3) Reuse `writeEvent` with `source: 'PAPER_BACKFILL'`. (4) Show a daily count of backfilled events on the diagnostics screen. (5) Print and distribute the paper sheet layout (R: `docs/paper-fallback-sheet.md`, Anamika owns copy wording).
5. **Files.** `app/backfill.tsx` (S).
6. **Contracts.** IC-01 `source` field includes `PAPER_BACKFILL`.
7. **Rules.** Backfilled events are visible to the operator and counted in reports with a flag; backfill fare uses the fare engine with the paper times unless an amount is typed (typed amount requires a reason code).
8. **Success.** Events saved and synced.
9. **Failure.** Database still failing: show instructions to use another phone or continue on paper; log a Sentry error.
10. **Edge cases.** Paper times in the future (rejected); entries older than 24 hours (supervisor only); duplicates of events already saved (warn on matching short code or plate within 10 minutes).
11. **Security.** Role restriction above; every event attributable.
12. **Logging.** Backfill counts per shift, reasons.
13. **Acceptance.** 30 backfilled entries and exits appear in cloud with flag and correct times.
14. **DoD.** Evidence plus Anamika confirms Console display of the flag.

### GATE-12 App shell, Hindi/English, status and diagnostics screen, banners

1. **Problem.** Failures must be visible and understandable to low-technical guards, and support needs facts quickly.
2. **Behaviour.** App shell with router, theme, error boundary; language switch (Hindi default for new guards, S); banners for offline, queue age (30 min), low battery (under 15%), low storage (under 300 MB), clock skew (over 5 minutes), old build below `min_supported_version`; **status screen** (S) listing last sync time, queue depth, oldest unsynced age, app version, schema version, device id, battery, free storage, current shift, plus a button copying a diagnostics blob into WhatsApp.
3. **Preconditions.** `health()` from the sync package (IC-02) exposing queue depth, oldest age, last sync, online.
4. **Sequence.** (1) Scaffold Expo app and router; Sentry init. (2) `i18n/en.json` and `hi.json` with a CI check that both files have the same keys. (3) `Banner` component and `useBanners()` hook (R) deriving from health, battery (`expo-battery`, R, confirm allowed native module list with Afzal: it is a small Expo module; if not allowed, read battery through an existing allowed API or skip), storage (`expo-file-system`, R, same check), clock skew from last server time. (4) `status.tsx` (S). (5) Diagnostics blob: JSON with the status fields plus the last 100 log lines, with no PINs, tokens or full phone numbers.
5. **Files.** `app/_layout.tsx`, `app/index.tsx` (R); `app/status.tsx`, `src/ui/*`, `src/i18n/*` (S); `src/ui/Banner.tsx`, `src/ui/useBanners.ts`, `src/lib/log.ts` (R).
6. **Contracts.** IC-02 `health()`; `min_supported_version` from sync config.
7. **Rules.** Never more than two screens from home; every string through i18n (no hard-coded text); Hindi strings reviewed by a real guard (OQ-11).
8. **Success.** Every banner condition triggers and clears correctly.
9. **Failure.** If battery or storage APIs are unavailable the banner is skipped and the status screen shows "unknown".
10. **Edge cases.** Multiple banners at once (stack by priority, max two visible); language change mid-flow preserves state; RTL not needed.
11. **Security.** Diagnostics blob scrubbed; status screen visible to any logged-in guard but device id only, not credentials.
12. **Logging.** Banner shows, language choice, diagnostics copies.
13. **Acceptance.** i18n key parity check green; each banner covered by an automated test; diagnostics blob contains all required fields and none of the forbidden ones.
14. **DoD.** Evidence plus a guard-reviewed Hindi pass.

---

## D. Detailed Testing Protocol

**Rules for this section.**

- Test ID format: `T-<FeatureID>-<kind><n>`; kinds: **U** unit, **I** integration, **E** end-to-end, **N** negative, **R** regression, **X** non-functional.
- All tests are **specified, not run**. A test counts as passed only when the author has executed it and attached the command output or recording as evidence (section E).
- Priority: Critical (blocks pilot), High, Medium, Low.
- Test phone = the lowest-spec Android phone the team intends to ship (about ₹7,000, 3 GB RAM or less, Android version to be recorded). Record model, Android version and app build on every evidence file.
- Frameworks (recommended, to be confirmed): Jest with `jest-expo` for unit and component tests; Maestro for end-to-end flows on emulator and real phone; Sentry for runtime metrics.
- Mocking: the sync package is mocked with an in-memory fake implementing IC-02 (`FakeSync`, R); the printer is mocked with a `FakePrinter` that can be told to succeed, time out, or throw; time is controlled with a fake clock helper injected into token, shift and PIN lockout code.

### D.1 GATE-01 Entry

| Test ID | Scenario | Preconditions | Test steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-GATE-01-U1 | Short code format | none | Generate 10,000 tokens with an empty open set | none | Every code matches `^[0-9A-HJKMNP-TV-Z]{5}$` (Crockford alphabet) | Jest assertion over all codes | High |
| T-GATE-01-U2 | Short code collision avoidance | Open set contains 1,000 codes | Generate 1,000 tokens | seeded open set | No generated code is in the open set; regeneration counter recorded | Jest assertion | High |
| T-GATE-01-U3 | QR payload format | none | Build payload from facility and session ids | known UUIDs | Equals `parkos:<facility>:<code>:<session>` exactly | string equality | High |
| T-GATE-01-U4 | Zone suggestion | Zones Z1 (cap 2, cars), Z2 (cap 5, cars, bikes) | Call `suggestZone` with occupancy Z1=2 for car; Z1=1 for car; bike | occupancy fixtures | Car: Z2 when Z1 full, Z1 when 1 free; bike: Z2 | Jest | High |
| T-GATE-01-U5 | All zones full | Occupancy at capacity | `suggestZone` for car | full fixture | Returns first allowed zone with `full=true` | Jest | Medium |
| T-GATE-01-U6 | Plate normalization | none | Normalize `up 32-AB 1234`, `UP32AB1234`, `ab1` | strings | `UP32AB1234`, `UP32AB1234`, rejected (length under 4) | Jest | Medium |
| T-GATE-01-I1 | Atomic save | `FakeSync` with transaction hooks | Confirm entry; inject failure after event stage | valid entry | Event fully present or fully absent; never partial | inspect fake store | Critical |
| T-GATE-01-I2 | Event validates against IC-01 | IC-01 schema package available | Save an entry; validate stored event | typical entry | Passes zod parse | Jest | Critical |
| T-GATE-01-I3 | Local occupancy updates | `useOccupancy` over fake | Save an entry; read occupancy | Z1=0 | Z1=1 immediately | hook assertion | High |
| T-GATE-01-E1 | Entry in airplane mode | Phone enrolled, shift open, config synced, airplane mode on | Maestro: tap Car, tap suggested zone, tap Confirm | class Car | Token screen with 5-char code and QR shown | Maestro assertions plus screen recording | Critical |
| T-GATE-01-E2 | Optional plate | As E1 | Tap Add number, enter plate, Confirm | `UP32AB1234` | Event contains normalized plate | read event from local DB via debug screen | Medium |
| T-GATE-01-N1 | Double tap on Confirm | As E1 | Tap Confirm twice within 200 ms | none | One `ENTRY` only | local DB count equals 1 | Critical |
| T-GATE-01-N2 | Duplicate plate already inside | Open session with the same plate | Enter same plate again | `UP32AB1234` | Blocking warning; no event until Override | UI check and DB count | High |
| T-GATE-01-N3 | Config never synced | Fresh enrolled device, no sync yet, airplane mode | Open entry screen | none | Blocking "Setup not synced" state; no entry possible | UI check | High |
| T-GATE-01-N4 | Local write failure | Force the fake store to throw | Confirm entry | none | Paper-sheet screen shown; no partial event | UI check and store inspection | Critical |
| T-GATE-01-N5 | Shift not open | No open shift | Open entry | none | Redirect to shift open | UI check | High |
| T-GATE-01-R1 | Regression after GATE-03 and GATE-09 land | Earlier suites | Re-run T-GATE-01-E1 and I1 | same | Still pass | CI result | High |
| T-GATE-01-X1 | Timing, median and taps | Test phone, airplane mode | Stopwatch protocol P1 (D.13): 50 entries by a team member, then 10 by a guard | classes mixed | Median under 8 s and 4 taps | timing sheet plus `entry_ms` metric | Critical |
| T-GATE-01-X2 | Save latency | Test phone | Instrumented 200 saves | none | p95 under 100 ms | `writeEvent` timing log | High |
| T-GATE-01-X3 | Cold start | Test phone, app killed | Launch 10 times | none | Median under 3 s to login screen | measured with recording or `adb` start time | Medium |

### D.2 GATE-02 Exit

| Test ID | Scenario | Preconditions | Test steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-GATE-02-U1 | QR payload parsing | none | Parse valid, wrong-facility, malformed payloads | strings | Valid parsed; wrong facility returns `WRONG_FACILITY`; malformed returns `INVALID` | Jest | High |
| T-GATE-02-U2 | Code normalization | none | Normalize `o0il`, lowercase, `u` | strings | O->0, I and L->1, lowercase upper-cased, U rejected | Jest | Medium |
| T-GATE-02-U3 | `findOpenSession` outcomes | Fixtures with 0, 1, 3 matches | Search by code and by plate and by class plus window | fixtures | none/one/many outcomes correct | Jest | High |
| T-GATE-02-U4 | Effective tariff selection | Tariff A until 30 Nov, B from 1 Dec | `tariffFor` for dates around the boundary | dates | Per rule chosen in OQ-20 (default: at entry) | Jest | High |
| T-GATE-02-I1 | Atomic EXIT plus PAYMENT | `FakeSync` | Complete an exit; inject a failure between events | valid | Either both or neither stored | store inspection | Critical |
| T-GATE-02-I2 | Fare from shared function | `packages/domain` present | Compute fare via screen logic and directly | CAR-A 90 min | Both give 6000 | Jest | Critical |
| T-GATE-02-E1 | Scan exit offline | Open session from E1; airplane mode | Maestro: scan token (prepared test QR), choose Cash | session | Exit saved; session gone from occupancy | Maestro plus DB | Critical |
| T-GATE-02-E2 | Typed code exit | As E1 | Type code, choose UPI received | code | Exit and attested payment saved | DB | High |
| T-GATE-02-E3 | Lost token by plate | Session with plate | Lost token > search plate | plate | Single match, exit proceeds | Maestro | High |
| T-GATE-02-E4 | Lost token by class and window | Three open cars | Lost token > class Car > window 6 h | none | List of 3 sorted by entry time | UI check | Medium |
| T-GATE-02-N1 | Unknown code | none | Type `ZZZZZ` | code | "Not found" with lost-token option | UI check | High |
| T-GATE-02-N2 | Double exit | Session already exited | Scan same token | token | "Already exited at HH:MM"; no new events | UI and DB | Critical |
| T-GATE-02-N3 | Wrong facility token | none | Scan token with another facility id | payload | "Wrong facility token" | UI | High |
| T-GATE-02-N4 | Missing tariff | No tariff for class | Exit | session | "No tariff for this class", Waive or manager call | UI | High |
| T-GATE-02-N5 | Exit before entry time | Clock skewed | Exit with earlier clock | skewed clock | Fare 0 minutes handling plus skew hint, no crash | UI and log | Medium |
| T-GATE-02-R1 | Re-run entry suite | Earlier waves | T-GATE-01-E1/I1 | same | Pass | CI | High |
| T-GATE-02-X1 | Exit timing | Test phone | Stopwatch P2: 50 scanned, 10 typed, 10 lost-token | mixed | Medians under 10 s, 15 s, and lost-token completes | timing sheet | Critical |
| T-GATE-02-X2 | Kill app mid-exit | Test phone | Kill process during save 20 times | none | After restart events are consistent (both or neither) | DB inspection script | Critical |

### D.3 GATE-03 Fare engine

**Fixture tariffs (R: `packages/domain/src/fixtures/tariffs.json`).** These are test inputs, not real prices.

| Tariff ID | Class | Model | Grace | Rules |
| --- | --- | --- | --- | --- |
| CAR-A | Car | HOURLY_SLABS | 15 min | up to 60 min = 3000; up to 180 min = 6000; after 180 add 2000 per started 60 min; day cap 30000 per 24 h block; effective to 2026-11-30 |
| CAR-B | Car | HOURLY_SLABS | 15 min | up to 60 = 4000; up to 180 = 7000; after 180 add 2500 per started 60; cap 35000; effective from 2026-12-01 |
| BIKE-A | Bike | HOURLY_SLABS | 15 min | up to 120 = 1000; after 120 add 500 per started 60; cap 10000 |
| TRUCK-A | Truck | PER_ENTRY | 10 min | 20000 once per entry |
| FLAT-A | Car | FLAT | 0 | 2000 per started 24 h block |
| NIGHT-A | Car | as CAR-A plus night | 15 min | night window 22:00 to 06:00 IST; surcharge 1000 once per stay if any minute overlaps |
| MIN-A | Car | HOURLY_SLABS | 10 min | up to 60 = 1500; up to 180 = 3000; after 180 add 1000 per started 60; minimum 2000 |

**Computation rules used for expected values (R; to be confirmed in OQ-20):** duration = whole minutes, rounded up; duration at or below grace = 0 (grace applies once to the whole stay); the tariff effective at **entry** time applies; stays are split into 1440-minute blocks counted from entry; each block priced from zero on the same slabs (no second grace) and capped; the night surcharge is added once after caps; minimum applies last; amounts in paise.

**The 60-case table (12 groups x 5). Groups F1 to F12.** All times IST unless stated. Expected values are computed from the rules above; the engineer must recompute each independently (not by running the code under test) and Anamika cross-checks them.

| ID | Tariff | Entry (IST) | Exit (IST) | Duration (min, rounded up) | Expected paise | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| F1-1 | CAR-A | 2026-11-10 10:00:00 | 10:00:00 | 0 | 0 | zero stay |
| F1-2 | CAR-A | 2026-11-10 10:00:00 | 10:14:59 | 15 | 0 | inside grace |
| F1-3 | CAR-A | 2026-11-10 10:00:00 | 10:15:00 | 15 | 0 | exactly grace |
| F1-4 | CAR-A | 2026-11-10 10:00:00 | 10:15:01 | 16 | 3000 | one second over grace rounds to 16 |
| F1-5 | CAR-A | 2026-11-10 10:00:00 | 10:16:00 | 16 | 3000 | |
| F2-1 | CAR-A | 2026-11-10 10:00:00 | 11:00:00 | 60 | 3000 | slab edge |
| F2-2 | CAR-A | 2026-11-10 10:00:00 | 11:01:00 | 61 | 6000 | next band |
| F2-3 | CAR-A | 2026-11-10 10:00:00 | 13:00:00 | 180 | 6000 | band edge |
| F2-4 | CAR-A | 2026-11-10 10:00:00 | 13:01:00 | 181 | 8000 | first repeat unit |
| F2-5 | CAR-A | 2026-11-10 10:00:00 | 14:01:00 | 241 | 10000 | second repeat unit |
| F3-1 | CAR-A | 2026-11-10 10:00:00 | 15:00:00 | 300 | 10000 | 6000 + 2 x 2000 |
| F3-2 | CAR-A | 2026-11-10 10:00:00 | 17:00:00 | 420 | 14000 | 6000 + 4 x 2000 |
| F3-3 | CAR-A | 2026-11-10 08:00:00 | 20:00:00 | 720 | 24000 | 6000 + 9 x 2000 |
| F3-4 | CAR-A | 2026-11-10 08:00:00 | 2026-11-11 07:00:00 | 1380 | 30000 | uncapped 46000, capped |
| F3-5 | CAR-A | 2026-11-10 08:00:00 | 2026-11-11 08:00:00 | 1440 | 30000 | exactly one block |
| F4-1 | CAR-A | 2026-11-10 08:00:00 | 2026-11-11 08:01:00 | 1441 | 33000 | block 30000 + 1-minute remainder 3000 (confirm in OQ-20) |
| F4-2 | CAR-A | 2026-11-10 08:00:00 | 2026-11-11 09:00:00 | 1500 | 33000 | remainder 60 min = 3000 |
| F4-3 | CAR-A | 2026-11-10 08:00:00 | 2026-11-12 08:00:00 | 2880 | 60000 | two full blocks |
| F4-4 | CAR-A | 2026-11-10 08:00:00 | 2026-11-12 08:01:00 | 2881 | 63000 | |
| F4-5 | CAR-A | 2026-11-10 08:00:00 | 2026-11-13 08:00:00 | 4320 | 90000 | three blocks |
| F5-1 | BIKE-A | 2026-11-10 10:00:00 | 10:15:00 | 15 | 0 | grace |
| F5-2 | BIKE-A | 2026-11-10 10:00:00 | 10:16:00 | 16 | 1000 | |
| F5-3 | BIKE-A | 2026-11-10 10:00:00 | 12:00:00 | 120 | 1000 | band edge |
| F5-4 | BIKE-A | 2026-11-10 10:00:00 | 12:01:00 | 121 | 1500 | |
| F5-5 | BIKE-A | 2026-11-10 08:00:00 | 18:00:00 | 600 | 5000 | 1000 + 8 x 500 |
| F6-1 | TRUCK-A | 2026-11-10 10:00:00 | 10:10:00 | 10 | 0 | grace |
| F6-2 | TRUCK-A | 2026-11-10 10:00:00 | 10:11:00 | 11 | 20000 | |
| F6-3 | TRUCK-A | 2026-11-10 08:00:00 | 18:00:00 | 600 | 20000 | |
| F6-4 | TRUCK-A | 2026-11-10 08:00:00 | 2026-11-12 08:00:00 | 2880 | 20000 | per entry, no daily repeat |
| F6-5 | TRUCK-A | 2026-11-10 10:00:00 | 10:00:00 | 0 | 0 | |
| F7-1 | FLAT-A | 2026-11-10 10:00:00 | 10:01:00 | 1 | 2000 | grace 0 |
| F7-2 | FLAT-A | 2026-11-10 10:00:00 | 2026-11-11 10:00:00 | 1440 | 2000 | |
| F7-3 | FLAT-A | 2026-11-10 10:00:00 | 2026-11-11 10:01:00 | 1441 | 4000 | second started block |
| F7-4 | FLAT-A | 2026-11-10 10:00:00 | 2026-11-12 10:00:00 | 2880 | 4000 | |
| F7-5 | FLAT-A | 2026-11-10 10:00:00 | 2026-11-12 10:01:00 | 2881 | 6000 | |
| F8-1 | NIGHT-A | 2026-11-10 20:00:00 | 21:00:00 | 60 | 3000 | no overlap |
| F8-2 | NIGHT-A | 2026-11-10 21:30:00 | 22:30:00 | 60 | 4000 | overlaps 22:00 to 22:30 |
| F8-3 | NIGHT-A | 2026-11-10 23:00:00 | 2026-11-11 00:30:00 | 90 | 7000 | 6000 + 1000 |
| F8-4 | NIGHT-A | 2026-11-11 05:30:00 | 06:30:00 | 60 | 4000 | overlaps until 06:00 |
| F8-5 | NIGHT-A | 2026-11-11 06:00:00 | 07:00:00 | 60 | 3000 | starts at window end: no overlap |
| F9-1 | CAR-A / CAR-B | 2026-11-30 23:00:00 | 2026-12-01 00:30:00 | 90 | 6000 | tariff at entry (CAR-A) |
| F9-2 | CAR-B | 2026-12-01 00:00:00 | 01:00:00 | 60 | 4000 | CAR-B |
| F9-3 | CAR-A | 2026-11-30 22:00:00 | 23:00:00 | 60 | 3000 | |
| F9-4 | CAR-A / CAR-B | 2026-11-30 23:00:00 | 2026-12-01 00:30:00 | 90 | 7000 | variant if OQ-20 decides tariff at exit; keep skipped until decided |
| F9-5 | none | 2026-10-31 10:00:00 | 11:00:00 | 60 | error `NO_TARIFF` | before earliest `effectiveFrom` 2026-11-01 (set fixture accordingly) |
| F10-1 | CAR-A | 2026-11-10 11:00:00 | 10:00:00 | n/a | error `INVALID_RANGE` | exit before entry |
| F10-2 | CAR-A for a Bike | 2026-11-10 10:00:00 | 11:00:00 | 60 | error `CLASS_MISMATCH` | |
| F10-3 | null tariff | any | any | n/a | error `NO_TARIFF` | |
| F10-4 | CAR-A | invalid date string | any | n/a | error `INVALID_RANGE` | input validation |
| F10-5 | CAR-A | 2026-11-10 10:00:00 | 11:00:00 with tariff `graceMinutes = -1` | n/a | schema rejection before computing | validate tariff first |
| F11-1 | CAR-A | 2026-12-31T18:29:00Z (23:59 IST) | 2026-12-31T18:31:00Z | 2 | 0 | crosses IST midnight, inside grace |
| F11-2 | CAR-A | 2026-12-31T18:00:00Z | 2026-12-31T19:40:00Z | 100 | 6000 | crosses IST midnight |
| F11-3 | CAR-A (effective set) | 2028-02-28T10:00:00Z | 2028-03-01T10:00:00Z | 2880 | 60000 | leap day included |
| F11-4 | CAR-A | 2026-11-10T04:30:00+05:30 | 2026-11-10T11:30:00+05:30 | 420 | 14000 | same instants as UTC offsets |
| F11-5 | CAR-A | 2026-11-10T10:00:00Z | 2026-11-10T11:00:00+00:00 | 60 | 3000 | identical to UTC `Z` |
| F12-1 | MIN-A | 2026-11-10 10:00:00 | 10:10:00 | 10 | 0 | grace 10 |
| F12-2 | MIN-A | 2026-11-10 10:00:00 | 10:11:00 | 11 | 2000 | minimum raises 1500 |
| F12-3 | MIN-A | 2026-11-10 10:00:00 | 11:00:00 | 60 | 2000 | |
| F12-4 | MIN-A | 2026-11-10 10:00:00 | 11:01:00 | 61 | 3000 | |
| F12-5 | MIN-A | 2026-11-10 10:00:00 | 13:01:00 | 181 | 4000 | 3000 + 1000 |

**Twenty hand-checked cases.** Created from real partner tariffs once collected (OQ-13, OQ-20): ten per partner site from the first two pilot facilities, checked by writing the fare on paper from the partner's own rate card and comparing, each signed by Anamika. Until real tariffs exist, this set is **not created**, and the 60-case table alone does not satisfy the 80-case acceptance bar.

| Test ID | Scenario | Preconditions | Test steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-GATE-03-U1 | Table-driven fixture run | `fareCases.json` and `tariffs.json` exist | Run `fare` over all 60 rows | table above | Every row equals expected or throws the expected error | Jest `test.each` | Critical |
| T-GATE-03-U2 | Independent recomputation | Spreadsheet or script outside the package | Recompute all 60 expected values from the rules; diff against the JSON | table | No differences | diff report attached | Critical |
| T-GATE-03-U3 | Property: monotonic | CAR-A, BIKE-A, FLAT-A, NIGHT-A | For durations 0 to 5,000 minutes in steps of 1, assert `fare(d+1) >= fare(d)` | generated | Always true | property test (e.g. `fast-check`, R) | High |
| T-GATE-03-U4 | Property: integers, non-negative | all tariffs | Random durations up to 50,000 | generated | Output integer and >= 0 | property test | Critical |
| T-GATE-03-U5 | Property: offset invariance | CAR-A | Same instants expressed in `Z` and `+05:30` | pairs | Equal fares | property test | High |
| T-GATE-03-U6 | Property: no per-minute loop | CAR-A | 30-day stay | 43,200 minutes | Completes under 5 ms | timing assertion | Medium |
| T-GATE-03-U7 | Typed errors | none | Trigger each `FareError` code | F10 rows | Correct code, never a number | Jest | Critical |
| T-GATE-03-U8 | Input immutability | none | Freeze tariff and call twice | frozen object | No throw, same output | Jest | Medium |
| T-GATE-03-I1 | Console contract | Anamika's "try it" panel imports the same function | Run 60 rows through the panel logic | table | Identical values | Console unit test imports same fixture | Critical |
| T-GATE-03-I2 | Gate app uses same code | gate app builds | Import from `packages/domain` in the gate app | none | No duplicate fare implementation present | grep check in CI (`fare` implemented once) | High |
| T-GATE-03-N1 | Schema rejection | zod `Tariff` | Feed negative slab price, unsorted slabs, missing `repeat` for open band | invalid tariffs | Rejected with clear message | Jest | High |
| T-GATE-03-R1 | Fixture freeze | git | CI fails if `fareCases.json` changes without a changelog line | change | CI red | CI | Medium |
| T-GATE-03-X1 | Bundle size | gate app | Measure bundle delta of the package | none | Under 50 KB (recommendation) | build report | Low |

### D.4 GATE-04 Payments

| Test ID | Scenario | Preconditions | Test steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-GATE-04-U1 | Mode to event mapping | none | Map each button to a `PAYMENT` payload | Cash, UPI, Pass, Waive | `upi_attested` true only for UPI; amount 0 for Pass and Waive | Jest | Critical |
| T-GATE-04-U2 | Amount equals fare | none | Build Cash payment for fare 6000 | 6000 | `amount_paise = 6000` | Jest | Critical |
| T-GATE-04-U3 | Waive requires reason | none | Waive without reason | none | Rejected | Jest | Critical |
| T-GATE-04-I1 | Exactly one PAYMENT per session | `FakeSync` | Attempt two payments for one session | session | Second rejected locally | store inspection | Critical |
| T-GATE-04-I2 | Waive creates OVERRIDE atomically | `FakeSync` | Waive with `OWNER_WAIVER` | session | `EXIT`, `PAYMENT`, `OVERRIDE` in one transaction | store inspection | High |
| T-GATE-04-E1 | UPI flow | Open session; facility QR image configured | Maestro: exit, UPI received | fare | Attested payment saved; QR image displayed during selection | Maestro plus DB | High |
| T-GATE-04-E2 | Cash with change calculator | Open session | Tendered 10000 for fare 6000 | 10000 | Shows change 4000; stored amount 6000 | UI and DB | Medium |
| T-GATE-04-N1 | No facility QR configured | Facility without QR | Choose UPI received | none | Text fallback "Ask customer to scan your UPI QR" | UI | Medium |
| T-GATE-04-N2 | Pass mode without pass | No pass attached | Choose Pass | none | Opens lookup; cannot save without valid pass | UI | High |
| T-GATE-04-N3 | Save failure | Fake throws | Choose Cash | none | No `EXIT` and no `PAYMENT`; error shown | store inspection | Critical |
| T-GATE-04-R1 | Re-run exit tests | Earlier waves | T-GATE-02-E1/E2 | same | Pass | CI | High |
| T-GATE-04-X1 | Honour-system disclosure | Training pack | Confirm disclosure text exists in guard guide and owner report | none | Present | review checklist | Medium |

### D.5 GATE-05 Passes

| Test ID | Scenario | Preconditions | Test steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-GATE-05-U1 | Pass states | Pass fixtures: valid, expires today, expired, dues > 0 | `lookupPass` each | fixtures + `now` | `VALID`, `VALID`, `EXPIRED`, `DUES` | Jest | High |
| T-GATE-05-U2 | Duplicate passes for plate | Two rows same plate | Lookup | fixtures | Later `valid_to` chosen | Jest | Medium |
| T-GATE-05-I1 | Synced passes available offline | `FakeSync` snapshot with 5,000 rows | Look up in airplane mode | random plates | Result under 3 s p95 | timing | High |
| T-GATE-05-E1 | Pass entry and exit | Pass synced | Enter with plate; exit with Pass | plate | `PAYMENT` mode PASS amount 0 | DB | High |
| T-GATE-05-N1 | Not found | none | Lookup unknown plate | plate | NOT_FOUND with "Charge normal fare" | UI | High |
| T-GATE-05-N2 | Expired pass | Expired fixture | Lookup | plate | Red state with options | UI | High |
| T-GATE-05-N3 | Stale pass list | Last sync older than 24 h | Lookup | none | "Pass list may be outdated" banner | UI | Medium |
| T-GATE-05-R1 | Regression entry | Earlier waves | T-GATE-01-E1 | same | Pass | CI | Medium |

### D.6 GATE-06 Shifts

| Test ID | Scenario | Preconditions | Test steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-GATE-06-U1 | Totals by mode | Event fixture of 20 payments | `shiftTotals` | known mix | Cash, UPI attested, pass, waived sums match fixture | Jest | Critical |
| T-GATE-06-U2 | Variance maths | none | Expected 120000, counted 119500; UPI attested 80000, declared 81000 | paise | cash variance -500; UPI variance +1000 | Jest | Critical |
| T-GATE-06-U3 | Threshold rule | Threshold 500 | Variance 500, 501 | paise | 500 allowed without reason; 501 requires reason | Jest | High |
| T-GATE-06-I1 | Open and close events | `FakeSync` | Open, record 5 sales, close | float 100000 | `SHIFT_OPEN` and `SHIFT_CLOSE` with correct fields | store inspection | Critical |
| T-GATE-06-I2 | Console reads unmodified | CON-06 ready | Send `SHIFT_CLOSE` through staging | event | Console shows identical numbers | cross-check script | High |
| T-GATE-06-E1 | Full shift offline | Test phone, airplane mode | Maestro: open, 10 entries/exits, close with counted values | script | Summary matches expected | Maestro plus DB | Critical |
| T-GATE-06-N1 | Close without counted cash | none | Leave counted empty | none | Blocked | UI | High |
| T-GATE-06-N2 | Unexplained variance | Threshold 500, variance 900 | Close without reason | none | Blocked until reason | UI | High |
| T-GATE-06-N3 | No open shift | none | Try entry | none | Redirect to open shift | UI | High |
| T-GATE-06-N4 | Vehicles inside at close | 3 open sessions | Close | none | Allowed; sessions persist to next shift | DB | Medium |
| T-GATE-06-R1 | Regression exit | Earlier | T-GATE-02-E1 | same | Pass | CI | Medium |
| T-GATE-06-X1 | Close duration | Test phone | Stopwatch P3: 5 closes by a guard | none | Median under 5 min | timing sheet | High |

### D.7 GATE-07 Overrides

| Test ID | Scenario | Preconditions | Test steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-GATE-07-U1 | Reason code validation | none | Validate each code; `OTHER` with and without note | codes | `OTHER` needs 5 to 200 chars | Jest | High |
| T-GATE-07-U2 | Derived class after correction | Session fixture with correction | Apply derivation | fixture | Latest class used | Jest (shared rule with SYNC-04) | High |
| T-GATE-07-I1 | Override event content | `FakeSync` | Save override | `MISREAD_NUMBER` | Event has code, staff id, target | store inspection | High |
| T-GATE-07-E1 | Wrong class within 2 minutes | Entry just saved | Change class via override | Car to Truck | New OVERRIDE; original unchanged | DB | High |
| T-GATE-07-N1 | Correction after 2 minutes by guard | Entry 3 minutes old | Attempt change | none | Blocked for guard; allowed for supervisor | UI with roles | High |
| T-GATE-07-N2 | HTML in note | none | Save `<script>x</script>` | string | Stored as text; displays escaped | UI check | Medium |
| T-GATE-07-N3 | No reason code | none | Submit | none | Blocked | UI | High |
| T-GATE-07-R1 | Regression entry/exit | Earlier | T-GATE-01-E1, T-GATE-02-E1 | same | Pass | CI | Medium |

### D.8 GATE-08 Zone counts

| Test ID | Scenario | Preconditions | Test steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-GATE-08-U1 | Reminder times | Shift open at T, length 9 h | Compute reminders | length | At T+3 h and T+6 h | Jest | Medium |
| T-GATE-08-U2 | Count validation | Capacity 50 | Counts 0, 50, 76, -1, 2.5 | numbers | 0 and 50 accepted; 76 warn+confirm; -1, 2.5 rejected | Jest | High |
| T-GATE-08-I1 | Baseline effect | `FakeSync` plus occupancy | Save count 12 when system says 15 | counts | Displayed occupancy 12; gap -3 stored | assertion | High |
| T-GATE-08-E1 | Reminder offline | Test phone, airplane mode, notification permission granted | Shorten schedule in a test build; wait | test schedule | Notification fires; tap opens screen | manual with recording | Medium |
| T-GATE-08-N1 | Permission denied | Notifications denied | Open shift | none | In-app banner at reminder times | UI | Medium |
| T-GATE-08-N2 | Missed reminder | App killed during reminder | Start app after | none | Missed-reminder banner | UI | Low |
| T-GATE-08-R1 | Regression occupancy | SYNC-04 tests | Re-run | same | Pass | CI | Medium |

### D.9 GATE-09 PIN login, enrollment

| Test ID | Scenario | Preconditions | Test steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-GATE-09-U1 | PIN verify correct and wrong | Staff record with hash and salt | `verifyPin` | right and wrong PINs | true / false | Jest | Critical |
| T-GATE-09-U2 | Verify duration | Test phone | 20 verifications | PINs | Median under 300 ms | timing | High |
| T-GATE-09-U3 | Lockout counter | Fake clock | 5 wrong tries; wait 5 minutes | PINs | Locked after 5th; unlocked after 5 min; counter resets on success | Jest | Critical |
| T-GATE-09-U4 | Lockout survives restart | Secure store fake | Restart module after 3 wrong tries | none | Counter persists | Jest | High |
| T-GATE-09-U5 | Clock moved backwards | Fake clock | Move clock back during lockout | none | Still locked | Jest | High |
| T-GATE-09-U6 | Staleness | Fake `lastSyncAt` 15 days ago | Login attempt | none | Refused with explanation | Jest | High |
| T-GATE-09-I1 | Enrollment exchange | Staging with IC-05 | Scan a valid code | code | Credentials stored in secure store; first sync starts | integration run | Critical |
| T-GATE-09-I2 | Hashes reach device | IC-06 in staging | Sync; read staff list | 3 guards | Staff picker shows 3 active guards, no inactive | UI and DB | Critical |
| T-GATE-09-E1 | Offline login | Enrolled, synced, airplane mode | Maestro: pick guard, enter PIN | right PIN | Logged in | Maestro | Critical |
| T-GATE-09-N1 | Expired code | Code older than 10 minutes | Scan | code | Clear error | UI | High |
| T-GATE-09-N2 | Code for other environment | Staging code on production build | Scan | code | Rejected | UI | Medium |
| T-GATE-09-N3 | No network at enrollment | Airplane mode | Scan | code | "Connect to the internet once" message | UI | High |
| T-GATE-09-N4 | Deactivated guard | Deactivate in Console; sync | Open picker | none | Guard absent after sync | UI | High |
| T-GATE-09-N5 | Log scrubbing | Debug logs on | Login with PIN `1234`; grep logs and Sentry payload | PIN | No PIN string anywhere | grep script | Critical |
| T-GATE-09-R1 | Regression all earlier | Earlier suites | Re-run login-dependent flows | same | Pass | CI | High |
| T-GATE-09-X1 | Hash parameters review | Hash design doc | Security review by Afzal and Akanksha | design | Recorded approval | PR approval | Critical |

### D.10 GATE-10 Printer, QR and scan

| Test ID | Scenario | Preconditions | Test steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-GATE-10-U1 | Receipt layout | none | Render receipt model | token | Contains code, QR data, time, facility, class; width 58 mm safe | snapshot test | Medium |
| T-GATE-10-U2 | Print state machine | `FakePrinter` | Succeed, timeout, throw | modes | States `OK`, `FAILED` correctly; one retry | Jest | High |
| T-GATE-10-I1 | Fallback on failure | `FakePrinter` failing | Save entry | none | `TokenFullScreen` shown; entry saved | UI test | Critical |
| T-GATE-10-E1 | Real printer | Paired printer | Print 100 entries; unplug for 10 | none | 90 prints OK; 10 fallbacks; 0 lost entries | tally sheet | High |
| T-GATE-10-E2 | Scan success | Printed receipts | 20 receipts x 10 scans | receipts | At least 95% success | tally sheet | High |
| T-GATE-10-N1 | Camera denied | Permission denied | Open scan | none | Typed code path offered | UI | High |
| T-GATE-10-N2 | Bluetooth off | Disabled | Print | none | Fallback screen plus hint | UI | Medium |
| T-GATE-10-N3 | Paper out | Real printer empty | Print | none | Fallback | UI | Medium |
| T-GATE-10-R1 | Entry regression | Earlier | T-GATE-01-E1 | same | Pass | CI | Medium |
| T-GATE-10-X1 | Low light scanning | Dim room | 10 scans with torch toggle | none | At least 90% with torch | tally | Low |

### D.11 GATE-11 Backfill

| Test ID | Scenario | Preconditions | Test steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-GATE-11-U1 | Time constraints | Fake clock | Future time; 25 hours old; within shift | times | Future rejected; 25 h supervisor only; in-shift accepted | Jest | High |
| T-GATE-11-U2 | Duplicate warning | Existing event | Backfill same plate within 10 minutes | data | Warning shown | Jest | Medium |
| T-GATE-11-I1 | Source flag | `FakeSync` | Backfill an entry | data | `source = PAPER_BACKFILL`, `device_time` = paper time | store inspection | Critical |
| T-GATE-11-E1 | Backfill 30 events | Test phone | Maestro or manual: enter 15 entries and 15 exits | sheet | All saved; synced later | cloud query (Afzal or Akanksha) | High |
| T-GATE-11-N1 | Typed amount without reason | none | Enter amount | none | Blocked | UI | Medium |
| T-GATE-11-N2 | Guard bulk backfill | Guard role | Try events older than the shift | none | Blocked | UI | Medium |
| T-GATE-11-R1 | Regression | Earlier | T-GATE-02-E1 | same | Pass | CI | Medium |

### D.12 GATE-12 Shell, i18n, status

| Test ID | Scenario | Preconditions | Test steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-GATE-12-U1 | i18n key parity | `en.json`, `hi.json` | Compare key sets | files | Identical keys; no empty strings | CI script | Critical |
| T-GATE-12-U2 | Banner rules | Fake health | Offline 10 s; queue age 31 min; battery 14%; storage 250 MB; skew 6 min; old build | inputs | Each banner appears; max two visible by priority | Jest | High |
| T-GATE-12-U3 | Diagnostics blob scrub | Fixture with PIN and token strings | Build blob | fixture | Contains required fields; no PIN, tokens, or full phone numbers | Jest with regex | Critical |
| T-GATE-12-I1 | Health from sync package | Real `health()` once available | Observe states | outages | Banners match real state | integration run | High |
| T-GATE-12-E1 | Language switch | App running | Switch Hindi/English mid-flow | none | State preserved; strings change | Maestro | Medium |
| T-GATE-12-E2 | Diagnostics copy | App running | Copy blob to clipboard | none | Clipboard contains blob with all fields | Maestro plus clipboard read | Medium |
| T-GATE-12-N1 | Battery API unavailable | Mock failing | Open status | none | Shows "unknown", no crash | UI | Low |
| T-GATE-12-N2 | Old build | `min_supported_version` above app | Start app | none | Offline work continues; sync blocked banner | UI | High |
| T-GATE-12-R1 | Full-suite regression | Earlier | Run entire Maestro suite | all flows | Pass | CI | High |
| T-GATE-12-X1 | Accessibility | Test phone, TalkBack on | Review main flows | none | Buttons labelled; touch targets at least 56 dp | manual checklist | Medium |
| T-GATE-12-X2 | APK size | Release build | Measure | none | Under 40 MB | build report | Medium |
| T-GATE-12-X3 | Hindi review | Guard reviewer | Review all strings | none | Written approval or edits | review log | High |

### D.13 Stopwatch protocols and Maestro flows

**P1 Entry timing.** Test phone, airplane mode, full battery. A team member performs 50 entries (mixed Bike, Car, Truck) starting a stopwatch at the first tap and stopping when the token is displayed; then three real guards perform 10 each after no training. Record time, taps, class. Pass: median under 8 s and median 4 taps. Cross-check with `entry_ms`.

**P2 Exit timing.** 50 scanned exits, 10 typed-code exits, 10 lost-token exits; start at screen open, stop at "Exit saved". Pass: scan median under 10 s; typed median under 15 s; all lost-token exits complete.

**P3 Shift close.** Five closes after simulated shifts of 20 vehicles each, by a guard. Pass: median under 5 minutes.

**Maestro flows (R: `apps/gate/.maestro/`).**

| Flow file | Steps covered | Used by |
| --- | --- | --- |
| `login.yaml` | pick guard, PIN, wrong PIN lockout | GATE-09 |
| `shift-open-close.yaml` | open with float, close with counted values | GATE-06 |
| `entry.yaml` | class, zone, confirm, token visible | GATE-01 |
| `exit-scan.yaml`, `exit-typed.yaml`, `exit-lost.yaml` | three exit paths | GATE-02 |
| `pay-modes.yaml` | cash, UPI received, pass, waive | GATE-04 |
| `override.yaml` | wrong class, `OTHER` with note | GATE-07 |
| `zone-count.yaml` | enter count | GATE-08 |
| `backfill.yaml` | entries and exits from paper | GATE-11 |
| `offline-full-shift.yaml` | everything above in airplane mode | all |

## D.14 Contract tests (provided and consumed)

| Test ID | Contract | Direction | What is verified | Verification |
| --- | --- | --- | --- | --- |
| T-IC01-GATE-1 | IC-01 events | consume | Every event the app writes parses with the IC-01 zod union, for all payloads in C.0 | Jest using the package |
| T-IC02-GATE-1 | IC-02 sync API | consume | `writeEvent`, `observeOccupancy`, `health()` signatures match; fake and real implementations pass the same test suite | shared test suite run against both |
| T-IC03-GATE-1 | IC-03 ingest | consume (indirect) | An event saved by the app reaches staging cloud exactly once after three forced resends | staging query |
| T-IC04-GATE-1 | IC-04 fare | provide | 60-case table passes in the Console panel (same as T-GATE-03-I1) | Console test |
| T-IC05-GATE-1 | IC-05 enrollment | consume | Valid code enrolls; expired and wrong-environment codes rejected | staging run |
| T-IC06-GATE-1 | IC-06 PIN hashes | consume | Hash created by the server verifies on the device with the agreed algorithm and parameters | cross-implementation test vector (server creates, device verifies) |
| T-IC09-GATE-1 | IC-09 heartbeat | consume (via sync package) | Fields shown on status screen equal those sent | comparison script |

---

## E. Acceptance and Completion Checklist

Nothing here is checked. No code exists yet (see section 0). A box may be ticked only when the evidence column is attached to the pull request or the sheet's evidence log. Criteria marked (S) come from the source documents, (R) are recommendations pending confirmation.

| Feature | Acceptance criteria (all must hold) | Evidence required |
|---|---|---|
| GATE-01 | Entry is 4 taps, median under 8 s on the low-cost test phone in airplane mode (S). One `ENTRY` event per action, saved in under 100 ms (R). Token with short code and QR is shown or printed. Duplicate tap does not create a second event. | Stopwatch log P1, `T-GATE-01-*` results, screen recording |
| GATE-02 | Exit by QR scan, by short code, and by plate lookup all resolve the right session. Lost-token path needs an override reason. Exit of an already-exited session is blocked locally and raises `DUPLICATE_EXIT` if it arrives from another device. | `T-GATE-02-*` results, two-device test log |
| GATE-03 | The 60-case fare table passes unchanged. Same inputs give the same paise on gate app and Console. Pure function, no I/O, no clock reads. | CI run of `packages/domain` tests, shared-case-table diff with Anamika's Console |
| GATE-04 | Cash and UPI-attested payments each write one `PAYMENT` event. Amount equals the fare shown unless an override exists. UPI is labelled as attestation, never as verified. | `T-GATE-04-*` results, UI screenshot of attestation wording |
| GATE-05 | Valid pass opens the gate with no fare. Expired, wrong-vehicle and unknown passes are refused with a clear message. Works offline from the synced pass list. | `T-GATE-05-*` results |
| GATE-06 | Shift open and close each write exactly one event. Close shows expected cash and asks for the declared UPI total. Variance is stored, not hidden. | `T-GATE-06-*` results |
| GATE-07 | Every override needs a reason code from the fixed list. Override writes one `OVERRIDE` event linked to the session. No override is possible without a logged-in guard. | `T-GATE-07-*` results |
| GATE-08 | Zone count prompt appears on schedule and can be entered offline. Count writes `ZONE_COUNT` with zone and number. | `T-GATE-08-*` results |
| GATE-09 | PIN verified locally. 5 wrong tries lock for 5 minutes. A device unsynced for 14 days refuses login. Enrollment accepts a one-time QR valid 10 minutes and refuses a used or expired one. | `T-GATE-09-*` results, expiry test log |
| GATE-10 | Printer pairs, prints, and on failure the full-screen token appears within one tap. QR scan works in sunlight and low light on the test phone. | Printer log with the real device model, `T-GATE-10-*` results |
| GATE-11 | Backfilled events carry `source=PAPER_BACKFILL` and the original time. They cannot overwrite live events. | `T-GATE-11-*` results |
| GATE-12 | Cold start under 3 s, APK under 40 MB (R). Hindi and English both complete every flow. Status screen shows sync state, pending count and last sync time. | Build size report, start-time log P3, screenshots in both languages |

### E.1 Completion rules
1. A feature is complete only when its acceptance row, its D-section tests, and its section J items are all met.
2. A test that was not run is recorded as "Not run", never "Passed".
3. Failed criteria stay open in the evidence log with the date and the owner.

---

## F. Dependencies and Integration Contracts

Contract IDs follow README. Contract details live in `packages/contracts`. Nikhil must not change a contract alone.

| Contract | Direction | Counterpart | What Nikhil relies on or provides | Contract test |
|---|---|---|---|---|
| IC-01 Event envelope and payloads | Consumes and co-defines | Afzal | Event shape, UUIDv7, paise, UTC. Nikhil defines payload meaning for gate events (section C.0). | `T-IC01-GATE-1` |
| IC-02 Local write API (`writeEvent`) | Consumes | Afzal | One action, one transaction, returns after commit. | `T-IC02-GATE-1` |
| IC-03 Ingest and conflicts | Consumes | Afzal, Akanksha | Gate app tolerates conflicts reported back and shows them in status. | `T-IC03-GATE-1` |
| IC-04 Download sync (open sessions, passes, tariffs, PIN hashes) | Consumes | Afzal, Akanksha | Read-only local tables. Nikhil never writes them. | `T-IC04-GATE-1` |
| IC-05 Enrollment and device auth | Consumes | Akanksha, Anamika | One-time QR format, claims, device token handling. | `T-IC05-GATE-1` |
| IC-06 Tariff schema | Consumes | Anamika, Akanksha | Fare engine input shape. Any new model type needs a schema change first. | `T-IC06-GATE-1` |
| IC-09 Fare function | Provides | Anamika | Pure function exported from `packages/domain`. | `T-IC09-GATE-1` |

Dependencies without a code contract: printer vendor protocol (OQ item), Expo native modules (`expo-camera`, `expo-secure-store`, MMKV; `expo-battery` and `expo-file-system` are not approved yet), and EAS build access.

Blocking order for Nikhil: SYNC-01 types, then CLD-02 schema, then SYNC-02 and SYNC-03 before GATE-01 can sync end to end. GATE-03 can start now because it needs only the tariff schema.

---

## G. Error Handling and Edge Cases

| Situation | Required behaviour | Test |
|---|---|---|
| Local write fails (disk full, DB locked) | Show a blocking error, do not show the token as saved, keep the form data, offer retry. | `T-GATE-01-E*` |
| Same token scanned twice at entry | Second attempt shows "already inside". No second event. | `T-GATE-01-E*` |
| Exit for a session not in the local snapshot | Allow with `ORPHAN_EXIT` handling by the cloud. Guard sees a neutral message. | `T-GATE-02-E*` |
| Two devices exit the same vehicle | Both events kept. Cloud flags `DUPLICATE_EXIT`. Nothing is deleted on the device. | `T-GATE-02-X*` |
| Device clock is wrong | Event keeps device time plus a monotonic marker. Cloud may flag `CLOCK_SKEW`. Show a banner if the clock is far from the last sync time. | `T-GATE-12-E*` |
| Stay crosses midnight, DST-free but day boundary | Fare uses UTC minutes and the tariff day rules, not local date formatting. | Fare table F-rows |
| Tariff changed during a stay | Tariff effective at entry applies (R, pending OQ-20). | Fare table |
| Zero-length or negative duration | Clamp to 0 minutes, raise a warning event field, never charge negative. | `T-GATE-03-E*` |
| Amount overflow or non-integer money | Reject. Money is integer paise everywhere. | `T-GATE-03-U*` |
| Printer disconnects mid-print | Full-screen token fallback, no duplicate event on reprint. | `T-GATE-10-E*` |
| Camera permission denied | Manual short-code entry stays available. | `T-GATE-10-E*` |
| App killed during an action | On restart the action is either fully saved or absent. No half events. | `T-GATE-01-R*` |
| Wrong PIN spam | Lockout as in GATE-09. Lockout survives app restart. | `T-GATE-09-X*` |
| Expired enrollment QR | Clear message, no partial device record. | `T-GATE-09-E*` |
| Low battery or low storage | Warning banner. Entry and exit are never blocked by the warning. | `T-GATE-12-E*` |
| Correction after payment | Correction is a new event inside the 2-minute guard window. Shape of `PAYMENT_CORRECTION` is undecided and listed as an open point. | pending decision |

Error messages are shown in both languages and contain no internal IDs or stack traces. Diagnostic detail goes to the log and Sentry only.

---

## H. Security, Privacy and Data Integrity

1. **Credentials.** No keys, tokens, or PINs in source, fixtures, screenshots, or this document. Device credentials live in `expo-secure-store` only.
2. **PIN handling.** Only hashes are stored locally. The hash scheme is set by Akanksha and Afzal and consumed here. PINs are never logged.
3. **Least privilege.** The device can call only `ingest_events` for writes. Gate code must not attempt direct table inserts.
4. **Append-only integrity.** The gate app never updates or deletes an event. Fixes are new events.
5. **Personal data.** Vehicle plate is the only personal-like field. It is optional, is not logged to Sentry, and is masked in the diagnostics screen.
6. **QR content.** The token QR carries only `parkos:<facilityId>:<code>:<sessionId>`. It carries no fare, no plate, and no personal data.
7. **Tamper limits.** Guard attestation of UPI and cash cannot be proven by the device. The design records who attested, when, and on which shift so that variance review is possible. This is a known limit and is tracked as OQ-05.
8. **Offline expiry.** The 14-day unsynced refusal limits the risk of a lost phone being used indefinitely.
9. **Logging.** Logs contain event IDs and action names, not amounts tied to plates.
10. **Dependencies.** New native modules need agreement before use, because they change the build and the APK size.

---

## I. Deliverables

| Deliverable | Required or optional | Path (recommended) |
|---|---|---|
| Gate app source for GATE-01 to GATE-12 | Required | `apps/gate/` |
| Fare engine and its tests | Required | `packages/domain/fare/` |
| Shared fare case table (JSON) used by gate and Console | Required | `packages/domain/fare/cases.json` |
| Local test fixtures (tariffs CAR-A, CAR-B, BIKE-A, TRUCK-A, FLAT-A, NIGHT-A, MIN-A) | Required | `packages/domain/fare/fixtures/` |
| Unit, integration and contract tests listed in section D | Required | alongside each module |
| Maestro flows listed in D.13 | Required | `apps/gate/e2e/` |
| Stopwatch protocol results (P1 to P3) with phone model | Required | evidence log |
| Hindi and English string files | Required | `apps/gate/locales/` |
| Printer compatibility note with the real printer model tested | Required | `apps/gate/docs/printer.md` |
| Evidence log of every acceptance row in section E | Required | `doc/team-implementation/evidence/nikhil.md` |
| Short guard quick-guide (one page, both languages) | Optional | with Akanksha's training material |

---

## J. Definition of Done

All items must be true for the whole member scope. Commands are recommended and must be confirmed once the repo is scaffolded.

1. Every GATE feature meets its row in section E, with evidence attached.
2. All tests in section D are written and run in CI. Failures are fixed or recorded as open with an owner. Tests never run are listed as "Not run".
3. The 60-case fare table passes on both the gate app and the Console build.
4. Contract tests for IC-01 to IC-06 and IC-09 pass against the current `packages/contracts`.
5. Lint, type check, and test commands pass in CI (recommended: `pnpm lint`, `pnpm typecheck`, `pnpm test`, to be confirmed).
6. A real-device run in airplane mode completes a full entry, exit and payment loop on the low-cost test phone.
7. The 6-hour simulation (SYNC-07) runs with Nikhil's flows and produces no data loss and no unflagged duplicate.
8. APK size and cold start budgets are measured and recorded.
9. No secrets in the repo, in logs, or in this sheet.
10. Open questions touching this scope (OQ-05, OQ-20, native module approval, printer model, `PAYMENT_CORRECTION` shape) are either answered by the decider or carried forward in `open-questions-and-assumptions.md`.
11. Afzal has reviewed the sync-facing parts and Anamika has confirmed the fare function against the Console.
12. This sheet is updated with real file paths and real test results, replacing every "Not implemented" and "Not run" that has become false.
