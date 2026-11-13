# Event envelope and payloads (IC-01)

Implemented in `packages/contracts` (`src/events.ts`). Zod is the source of truth for payload shape.
`public.ingest_events` (migration `0004`) re-validates the envelope and every payload in SQL, because it can be called directly (see
`docs/integrations/ingest-events.md`). Owner: Afzal (SYNC-01). A contract change
needs a second workstream owner's review and, if breaking, a `SCHEMA_VERSION` bump.

## Envelope (one row in `events`)

| Field            | Type and rule                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | UUIDv7, generated on the device (`newId()`), primary key. Version 7 is checked in the contract and in SQL.                                   |
| `type`           | One of `ENTRY`, `EXIT`, `PAYMENT`, `OVERRIDE`, `ZONE_COUNT`, `SHIFT_OPEN`, `SHIFT_CLOSE`. `PAYMENT_CORRECTION` is NOT accepted (OQ-30 open). |
| `facility_id`    | uuid. `ingest_events` rejects a value different from the JWT facility claim.                                                                 |
| `device_id`      | uuid, equal to `devices.id` and the device claim.                                                                                            |
| `staff_id`       | uuid of an active staff member of the facility (checked by ingest).                                                                          |
| `session_id`     | uuid for `ENTRY`, `EXIT`, `PAYMENT`, `OVERRIDE`; `null` for `ZONE_COUNT`, `SHIFT_OPEN`, `SHIFT_CLOSE`.                                       |
| `device_time`    | UTC ISO 8601 with trailing `Z` (offsets rejected).                                                                                           |
| `recorded_at`    | UTC ISO 8601, optional; when a paper record was keyed in. See note below.                                                                    |
| `source`         | `LIVE` or `PAPER_BACKFILL`. Required in the contract; SQL also defaults to `LIVE`.                                                           |
| `schema_version` | Integer from 1 to 32767. SQL column is `integer`, no default.                                                                                |
| `payload`        | Object, per type (below).                                                                                                                    |
| `received_at`    | Server only (`default now()`); not part of the client contract.                                                                              |

`recorded_at` is for `PAPER_BACKFILL` events: `device_time` carries the stay's claimed time, and
`recorded_at` records when the guard actually keyed the paper record in; unset for `LIVE`. No SQL
column on `main` yet: today's `ingest_events` (`0004`) accepts and silently drops `recorded_at`
rather than rejecting it, since it has no unknown-key check either. The column and the unknown-key
rejection come with `0013` (staged in `supabase/proposed-migrations/`, #30) once it is promoted —
the migration number and promotion timing are OQ-52. (OQ-42)

Unknown keys are **rejected** in the envelope and in every payload (not stripped).

`parseEvent(input)` returns `{ ok: true, value }` or `{ ok: false, issues: [{ path, message }] }`,
never a partial event. Each issue's `path` is an array of Zod path components (for example
`["payload", "amount_paise"]`), not a dotted string — changed in `0751f38` so a path segment that
itself contains a dot (unlikely today, but not ruled out) cannot be misread; join with `.` only for
display. `packages/contracts/README.md` documents the same shape; see
`packages/contracts/test/events.test.ts` ("preserves array-shaped issue paths for existing
parseEvent consumers").

## Payloads

| Event         | Payload fields                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENTRY`       | `vehicle_class` (non-empty text), `zone_id` (uuid), `short_code` (5-char Crockford base32), optional `vehicle_no`, optional `pass_id` (uuid)                                                    |
| `EXIT`        | `fare_paise`, `exit_method` (`SCAN`, `CODE`, `LOOKUP`), optional `tariff_id` (uuid), optional `tariff_version` (int)                                                                            |
| `PAYMENT`     | `mode` (`CASH`, `UPI`, `PASS`, `WAIVED`), `amount_paise`, `upi_attested` (boolean; true only with `UPI`)                                                                                        |
| `OVERRIDE`    | `target_event_id` (UUIDv7), `reason_code`, optional `note` (required when `OTHER`), optional `change` (object)                                                                                  |
| `ZONE_COUNT`  | `zone_id`, `counted`, `system_count_at_time` (whole numbers >= 0)                                                                                                                               |
| `SHIFT_OPEN`  | `shift_id` (uuid), `opening_float_paise`                                                                                                                                                        |
| `SHIFT_CLOSE` | `shift_id`, `counted_cash_paise`, `expected_cash_paise`, `upi_total_declared_paise`, `upi_attested_sum_paise`, `variance_cash_paise` (signed), `variance_upi_paise` (signed), optional `reason` |

All `*_paise` values are integer paise. Money helpers (`toPaise`, `add`, `sub`, `signedDiff`, `formatRupees`) accept
decimal strings only, never floating-point numbers.

## Decisions (owner: Afzal)

1. to 10. As recorded in `docs/team/cld-02-events-review.md` section 7 (once that PR is merged): UUIDv7 ids,
   `facility_id`/`device_id`/`staff_id` in the envelope, nullable `session_id`, `source` vocabulary, payload in jsonb,
   `schema_version` in the envelope, `PAYMENT_CORRECTION` excluded, Zod as source of truth.
2. Payload field names follow Afzal's sheet (`member-01-afzal.md`), plus `shift_id` on both shift events (so open and
   close can be paired) and optional `tariff_id`/`tariff_version` on `EXIT` (fare audit). Nikhil's field names
   (`actual_count`, `float_paise`, `cash_variance_paise`, ...) are replaced.
3. The JSON-Schema export for SQL CHECK constraints (sheet SYNC-01 step 7) is dropped.
4. SQL enforces the `session_id` rule with a CHECK (change to `0003`, made by Akanksha; the contract enforces it too).
5. `schema_version` stays `integer`; the contract caps it at 32767.

## Open items (not decided, nothing invented)

- Sign convention of `variance_*` (for example counted minus expected) is not specified, so it is not cross-checked.
- `PAYMENT` for `PASS` payments: whether it carries `pass_id` (Nikhil's GATE-04 text) is undecided; it is not accepted now.
- `vehicle_class` is free text; the allowed classes are a tariff/config question (see OQ-20).
- `PAYMENT_CORRECTION` shape (OQ-30).
- OVERRIDE target: Nikhil's text allows `session_id` as an alternative to `target_event_id`; the contract requires `target_event_id`.

## Tests

`packages/contracts/test/*.test.ts` and `packages/contracts/fixtures/events/{valid,invalid}`: T-SYNC-01-U1..U7, N1, R1.
T-IC01-C1 (SQL mirrors the contract) is `supabase/tests/event_parity.test.sql`, generated from the same fixtures
(`node scripts/gen-event-parity.mjs --write`); every valid fixture must be accepted by `ingest_events` and every invalid one rejected.
Not yet written: T-SYNC-01-I1 (gate and console parse a shared sample).
