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

## What SQL validates

Envelope only: UUIDv7 `id`, `device_time` as UTC ISO with `Z`, numeric `schema_version`, type and `source` vocabularies, the session rule, and that
required payload keys exist. Full payload validation stays in the zod schemas (source of truth). The SQL/zod parity test (T-IC01-C1) is still open.

## Tests

`supabase/tests/ingest_events.test.sql` (33 assertions). Open: `open_sessions` and conflict detection (0005, 0006) will hook in after the insert.
