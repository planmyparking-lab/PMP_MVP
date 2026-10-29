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
  "results": [{ "id": "…", "status": "ACCEPTED" | "DUPLICATE" | "REJECTED", "reason": "…" }],
  "accepted": 1, "duplicates": 0, "rejected": 0,
  "min_supported_version": 1,
  "server_time": "2026-10-29T10:00:00.000Z"
}
```

Each event is handled in its own subtransaction: a rejected event never rolls back the others. `DUPLICATE` means the same id with identical content
(a harmless retry; the device should mark it synced). Reasons: `INVALID_ENVELOPE`, `INVALID_PAYLOAD`, `CLAIM_MISMATCH`, `STAFF_NOT_ACTIVE`,
`SCHEMA_VERSION_TOO_OLD`, `SCHEMA_VERSION_TOO_NEW`, `ID_COLLISION` (same id, different content). A rejected event is a permanent failure:
the outbox must not retry it unchanged.

## What SQL validates, and who guarantees the rest

SQL checks the **envelope**: UUIDv7 `id`, `device_time` as UTC ISO with `Z`, `schema_version` as a JSON number holding a whole number
(`1` and `1.0` are accepted as the same number, matching zod's `z.number().int()`; `1.4` and values outside the integer range are
`REJECTED: INVALID_ENVELOPE`), the type and `source` vocabularies, the session rule, and that the **required payload keys exist and are not null**.

SQL does **not** check payload value types (for example that `fare_paise` is a non-negative integer). Full payload validation is
guaranteed by a trusted client layer, not by the database boundary: the gate app validates with `parseEvent` from `packages/contracts` before
storing an event, and the outbox (`packages/sync-rules`) validates again before every upload. The zod schemas are the single source of truth
(owner decision, 26 Oct 2026). A client that bypasses zod could still store a wrongly typed payload; the claim checks above (device, facility,
active staff) bound who can do that, and projections (`open_sessions`) skip values they cannot cast without refusing the event.

The gap between the two layers is closed by the SQL/zod parity test (T-IC01-C1), still open: it runs the shared fixtures in
`packages/contracts/fixtures/events` through `ingest_events` and fails when SQL accepts an event that zod rejects, or the reverse for the
envelope fields. Until it exists, treat SQL as a safety net for the envelope, not as a payload validator.

## Tests

`supabase/tests/ingest_events.test.sql` (36 assertions). Open: `open_sessions` and conflict detection (0005, 0006) will hook in after the insert.

## open_sessions (0005)

`public.open_sessions` is derived from `events` by the trigger `events_10_apply_open_sessions`: an `ENTRY` opens a session, an `EXIT` closes it.

- **Key:** `(facility_id, session_id)`. Session ids are UUIDv7 values generated on the device and are practically unique, but the database does not
  rely on that across facilities: one facility can never collide with, block or close another facility's session.
- **Malformed data never blocks the event:** an `ENTRY` whose payload cannot be projected (missing keys, a `zone_id` or `pass_id` that is not a UUID)
  stays in `events`; no session is opened and a `WARNING` is logged. The event log is the source of truth and can be re-projected after a fix.
- **Access (CLD-03 requirement):** a device or guard may read only the rows of its own `facility_id`; nobody writes the table directly. A TODO
  assertion in `supabase/tests/open_sessions.test.sql` fails the suite once policies exist until its wrapper is removed.
