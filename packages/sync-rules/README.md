# @pmp/sync-rules

Sync logic shared by the gate app, with no storage or network code of its own (SYNC-02).

- `Uploader` (`src/outbox.ts`): takes up to 50 `PENDING` events ordered by `device_time` then `id`, sends them to `ingest_events`, and writes the results
  back in one local transaction. `ACCEPTED` and `DUPLICATE` become `SENT`. `REJECTED` counts an attempt and moves to `QUARANTINED` after 5. Network or
  server errors keep events `PENDING` and back off (`nextDelay`: 2 s doubling to 5 min, +/-20% jitter). A 401 (`AuthError`) stops uploading and
  returns `AUTH_REQUIRED`; nothing is dropped. Only one upload runs at a time.
- `OutboxStore` and `IngestTransport` are the two interfaces the gate app implements (SQLite and the Supabase RPC).
- `IngestResponse` validates the `ingest_events` result (see `docs/integrations/ingest-events.md`).
- Safe retry: if the app dies after the server stored an event but before the local write, the re-send returns `DUPLICATE`, which counts as success.

Decision: hand-rolled outbox, no PowerSync. Download sync (SYNC-03) and occupancy (SYNC-04) come later.
