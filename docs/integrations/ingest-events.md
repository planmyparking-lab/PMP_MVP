# ingest_events (SYNC-02)

`public.ingest_events(events jsonb) returns jsonb`, migration `0004_ingest_events.sql`. The complete envelope and payload validation described
below is added by an additive forward migration, `0011_ingest_events_payload_validation.sql` (`0004` itself is not edited). Promoted from
`supabase/proposed-migrations/0013_ingest_events_payload_validation.sql` once the number was settled (OQ-52).

## Security model

The function is **SECURITY DEFINER** (decision: Afzal). Devices are granted `EXECUTE` only; `INSERT` on `public.events` is revoked from
`authenticated` and `service_role`, so the function is the only write path. `search_path` is pinned to `pg_catalog, public, pg_temp`.
Because it runs with owner rights it checks everything itself:

- the caller (`auth.uid()`) must be an enrolled device with `revoked_at is null`, otherwise the call fails (`28000` no JWT, `42501` not a device);
- every event must carry that device's own `facility_id` and `device_id`;
- `staff_id` must be an **active** staff member of that facility.

## Call and result

Input: a JSON array of events in the envelope of `docs/integrations/event-envelope.md` (max 500 per call; larger batches fail with `22023`).
Output:

```json
{
  "results": [{ "id": "…", "status": "ACCEPTED" | "DUPLICATE" | "REJECTED", "reason": "…", "detail": "payload.fare_paise" }],
  "accepted": 1, "duplicates": 0, "rejected": 0,
  "min_supported_version": 1,
  "server_time": "2026-10-29T10:00:00.000Z"
}
```

Each event is handled in its own subtransaction: a rejected event never rolls back the others. `DUPLICATE` means the same id with identical content
(a harmless retry; the device should mark it synced). Reasons: `INVALID_ENVELOPE`, `INVALID_PAYLOAD`, `CLAIM_MISMATCH`, `STAFF_NOT_ACTIVE`,
`SCHEMA_VERSION_TOO_OLD`, `SCHEMA_VERSION_TOO_NEW`, `ID_COLLISION` (same id, different content). A rejected event is a permanent failure:
the outbox must not retry it unchanged (how the outbox currently retries is an open question, see the register).

Each result is `{ id?, status, reason?, detail? }`:

- `id` is the event id **exactly as the device sent it** (letter case included), and is present only when it is a valid uuid (zod `z.uuid()`). A malformed
  id is never echoed, so a result without an `id` means the server could not read one.
- `reason` is present on `REJECTED` results.
- `detail` is optional and only ever present on `REJECTED` results with reasons that name a field. It is a field path, never a message or a value. See
  "Result detail" below.

## Validation: the database checks everything

`ingest_events` is callable directly by any enrolled device, so it cannot rely on the gate app's zod validation. Every event is validated in SQL before
it is stored, in two steps that mirror `packages/contracts/src/events.ts`:

- `event_envelope_error(item)`: only the known envelope keys; UUIDv7 `id`; UUID `facility_id`, `device_id`, `staff_id`; `session_id` a UUID for
  `ENTRY`, `EXIT`, `PAYMENT`, `OVERRIDE` and `null` for the other types; `device_time` and the optional `recorded_at` as real UTC ISO times with `Z`;
  `source`; `schema_version` a whole number from 1 to 32767 (`1.0` is the same number as `1`; `1.4` is rejected); `payload` an object.
- `event_payload_error(type, payload)`: per type, exactly the keys zod allows (unknown keys rejected, optional keys may be absent but not `null`),
  integer amounts and counts within JavaScript's safe-integer range, the enums (`exit_method`, payment `mode`, `reason_code`), the short-code format, and
  the cross-field rules (`upi_attested` only with `UPI`; `note` required for reason `OTHER`).

Exact value rules (they follow zod 4.6.7, the version `packages/contracts` pins):

- **UUIDs** are zod `z.uuid()`: versions 1 to 8, variant `8`, `9`, `a` or `b`, any letter case, canonical hyphenated form only, plus the nil uuid and the
  lower-case max uuid. The upper-case max uuid is rejected. The event `id` and an override's `target_event_id` must also be version 7.
- **Times** (`device_time`, `recorded_at`) are `z.iso.datetime()`: seconds required, any number of fractional digits, a literal `Z` and no offset, a real
  calendar date. PostgreSQL stores microseconds, so longer fractions are rounded, and it cannot store year 0000, which zod accepts.
- **Integers** are whole numbers within ±9007199254740991 (JavaScript's safe-integer range): amounts and counts from 0, variances signed,
  `tariff_version` from 1.
- **Blank text**: `vehicle_class`, `vehicle_no` and the note required for reason `OTHER` are blank when empty after JavaScript `String.prototype.trim()`:
  U+0009 to U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. U+0085, U+180E and U+200B are not blank.
- **`session_id`** must be present: a uuid for `ENTRY`, `EXIT`, `PAYMENT`, `OVERRIDE`, an explicit JSON `null` for the others.

### Schema version

Two separate checks. First the contract (`events.ts`): a non-number, fractional, zero, negative or greater-than-32767 value is `INVALID_ENVELOPE` with
`detail: "schema_version"`. Then the server's range (`min_supported_schema_version()` to `max_supported_schema_version()`): a contract-valid version
outside it is `SCHEMA_VERSION_TOO_OLD` or `SCHEMA_VERSION_TOO_NEW`, also with `detail: "schema_version"`.

### Result detail

A rejected event returns `REJECTED` with a reason and, for validation failures, a `detail` that is a field path:

| Situation                                            | detail                                                                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| a known envelope field fails                         | the field name: `id`, `type`, `facility_id`, `device_id`, `staff_id`, `session_id`, `device_time`, `recorded_at`, `source`, `schema_version` |
| a known payload field fails                          | `payload.<field>`, for example `payload.fare_paise`                                                                                          |
| the payload key is missing or is not an object       | `payload` (a missing key is `INVALID_ENVELOPE`, a present non-object is `INVALID_PAYLOAD`)                                                   |
| the event is not a JSON object                       | `event`                                                                                                                                      |
| an unknown envelope key                              | `envelope.<key>`                                                                                                                             |
| an unknown payload key                               | `payload.<key>`                                                                                                                              |
| `CLAIM_MISMATCH`, `STAFF_NOT_ACTIVE`, `ID_COLLISION` | none                                                                                                                                         |

An unknown key is reflected only when it matches `^[A-Za-z0-9_]{1,40}$`; any other key (longer, or with other characters) is reported as `envelope.?` or
`payload.?`, so a response never contains arbitrary client text. With several unknown keys the first in byte order (C collation) is reported.

Order of checks: envelope, schema version (contract, then server range), device and facility claims, active staff, then payload, so an unauthorized
caller learns nothing about payload rules.

### recorded_at

The optional `recorded_at` is validated like `device_time` (an explicit `null` is rejected), stored in `events.recorded_at` (nullable, added with
`ADD COLUMN IF NOT EXISTS`) and compared when an id is re-sent. A row stored before the column existed has `NULL`; re-sending that event unchanged is a
`DUPLICATE`, while re-sending it with a `recorded_at` is an `ID_COLLISION`.

Zod stays the source of truth. **T-IC01-C1:** `supabase/tests/event_parity.test.sql` is generated from the shared fixtures in
`packages/contracts/fixtures/events` (`node scripts/gen-event-parity.mjs --write`) and sends each one through `ingest_events`: every valid fixture must be
`ACCEPTED`, every invalid one `REJECTED`. `pnpm test:scripts` fails when the generated file is out of date, so a new fixture or a rule changed on one side
only is caught. When you change a rule in `events.ts`, change `event_payload_error` / `event_envelope_error` in the same PR and add a fixture.

Not validated in SQL: nothing from the zod schemas. The `change` object of an override is only checked to be an object (zod also accepts any object). The
sign convention of the shift-close variances is an open specification item, so no cross-check exists in either layer.

## Tests

`supabase/tests/ingest_events.test.sql` (protocol, authorization and result shape), `supabase/tests/event_parity.test.sql` (generated from the
shared fixtures, runs every fixture through `ingest_events` and checks it agrees with zod) and `supabase/tests/event_payload_validation.test.sql`
(value rules: numbers, UUIDs, trim, `recorded_at`, the `schema_version` range, detail paths). Counts are in the files' `plan(...)` lines.

## open_sessions (0005)

`public.open_sessions` is derived from `events` by the trigger `events_10_apply_open_sessions`: an `ENTRY` opens a session, an `EXIT` closes it.

- **Key:** `(facility_id, session_id)`. Session ids are UUIDv7 values generated on the device and are practically unique, but the database does not
  rely on that across facilities: one facility can never collide with, block or close another facility's session.
- **Malformed data never blocks the event:** `ingest_events` already rejects an `ENTRY` with a bad `zone_id` or `pass_id` before it is stored. If an
  `ENTRY` that cannot be projected still reaches `events` (a raw insert by an admin or a test: missing keys, a `zone_id` that is not a UUID), it stays in
  `events`; no session is opened and a `WARNING` is logged. The event log is the source of truth and can be re-projected after a fix.
- **Access (CLD-03 requirement):** a device or guard may read only the rows of its own `facility_id`; nobody writes the table directly. A TODO
  assertion in `supabase/tests/open_sessions.test.sql` fails the suite once policies exist until its wrapper is removed.
