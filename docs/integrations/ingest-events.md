# ingest_events (SYNC-02)

`public.ingest_events(events jsonb) returns jsonb`, migration `0004_ingest_events.sql`.

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
the outbox must not retry it unchanged.

## Validation: the database checks everything

`ingest_events` is callable directly by any enrolled device, so it cannot rely on the gate app's zod validation. Every event is validated in SQL before
it is stored, in two steps that mirror `packages/contracts/src/events.ts`:

- `event_envelope_error(item)`: only the known envelope keys; UUIDv7 `id`; UUID `facility_id`, `device_id`, `staff_id`; `session_id` a UUID for
  `ENTRY`, `EXIT`, `PAYMENT`, `OVERRIDE` and `null` for the other types; `device_time` and the optional `recorded_at` as real UTC ISO times with `Z`;
  `source`; `schema_version` a whole number (`1.0` is the same number as `1`; `1.4` is rejected); `payload` an object.
- `event_payload_error(type, payload)`: per type, exactly the keys zod allows (unknown keys rejected, optional keys may be absent but not `null`),
  integer amounts and counts within JavaScript's safe-integer range, the enums (`exit_method`, payment `mode`, `reason_code`), the short-code format, and
  the cross-field rules (`upi_attested` only with `UPI`; `note` required for reason `OTHER`).

A rejected event returns `REJECTED` with reason `INVALID_ENVELOPE` or `INVALID_PAYLOAD` and a `detail` such as `payload.fare_paise` (field name only,
never the value). Order of checks: envelope, schema version range, device and facility claims, active staff, then payload, so an unauthorized caller
learns nothing about payload rules.

Zod stays the source of truth. **T-IC01-C1:** `supabase/tests/event_parity.test.sql` is generated from the shared fixtures in
`packages/contracts/fixtures/events` (`node scripts/gen-event-parity.mjs --write`) and sends each one through `ingest_events`: every valid fixture must be
`ACCEPTED`, every invalid one `REJECTED`. `pnpm test:scripts` fails when the generated file is out of date, so a new fixture or a rule changed on one side
only is caught. When you change a rule in `events.ts`, change `event_payload_error` / `event_envelope_error` in the same PR and add a fixture.

Not validated in SQL: nothing from the zod schemas. The `change` object of an override is only checked to be an object (zod also accepts any object). The
sign convention of the shift-close variances is an open specification item, so no cross-check exists in either layer.

## Tests

`supabase/tests/ingest_events.test.sql` (47 assertions) and `supabase/tests/event_parity.test.sql` (37 assertions, generated).

## open_sessions (0005)

`public.open_sessions` is derived from `events` by the trigger `events_10_apply_open_sessions`: an `ENTRY` opens a session, an `EXIT` closes it.

- **Key:** `(facility_id, session_id)`. Session ids are UUIDv7 values generated on the device and are practically unique, but the database does not
  rely on that across facilities: one facility can never collide with, block or close another facility's session.
- **Malformed data never blocks the event:** `ingest_events` already rejects an `ENTRY` with a bad `zone_id` or `pass_id` before it is stored. If an
  `ENTRY` that cannot be projected still reaches `events` (a raw insert by an admin or a test: missing keys, a `zone_id` that is not a UUID), it stays in
  `events`; no session is opened and a `WARNING` is logged. The event log is the source of truth and can be re-projected after a fix.
- **Access (CLD-03 requirement):** a device or guard may read only the rows of its own `facility_id`; nobody writes the table directly. A TODO
  assertion in `supabase/tests/open_sessions.test.sql` fails the suite once policies exist until its wrapper is removed.
