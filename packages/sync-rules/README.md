# @pmp/sync-rules

Sync logic shared by the gate app, with no storage or network code of its own (SYNC-02).

- `Uploader` (`src/outbox.ts`): takes up to 50 `PENDING` events ordered by `device_time` then `id`, sends them to `ingest_events`, and writes the results
  back in one local transaction. `ACCEPTED` and `DUPLICATE` become `SENT`. `REJECTED` counts an attempt and moves to `QUARANTINED` after 5. Network or
  server errors keep events `PENDING` and back off (`nextDelay`: 2 s doubling to 5 min, +/-20% jitter). A 401 (`AuthError`) stops uploading and
  returns `AUTH_REQUIRED`; nothing is dropped. Only one upload runs at a time.
- `OutboxStore` and `IngestTransport` are the two interfaces the gate app implements (SQLite and the Supabase RPC).
- `IngestResponse` validates the `ingest_events` result (see `docs/integrations/ingest-events.md`).
- Safe retry: if the app dies after the server stored an event but before the local write, the re-send returns `DUPLICATE`, which counts as success.

## Occupancy (SYNC-04)

`computeOccupancy({ zones, openSessions, localEvents, zoneCounts, now? })` (`src/occupancy.ts`) is a pure function. Counts are derived, never stored as an
incremented counter.

- **With a physical `ZONE_COUNT` baseline** for a zone: `count = counted + entries after the baseline - exits after it` (strictly later `device_time`).
- **Without one:** vehicles in the `open_sessions` snapshot plus local entries not yet in it, minus local exits.
- Entries are matched by session id and events by event id, so a record seen twice counts once, a second exit for a session removes one vehicle, and the
  result does not depend on the order of the inputs.
- Displayed `count` is clamped at 0. `rawCount` keeps the real value and a `NEGATIVE` warning is raised.
- Warnings: `NEGATIVE`, `OVER_CAPACITY` (the guard may still let a vehicle in; policy, see OQ-23), `STALE_BASELINE` (older than 24 h, needs `now`),
  `ORPHAN_EXIT` (exit for a session unknown here: not decremented), `FUTURE_EVENT_IGNORED` (device clock more than 5 minutes ahead of `now`).
  The handbook lists only the first three; the last two come from the SYNC-04 edge cases.
- A zone mentioned by the data but missing from `zones` returns `{ ok: false, error: "MISSING_ZONE_CONFIG", zoneIds }`, never zeros.
- `drift(zoneCounts, zoneId)` is `counted - system_count_at_time` of the latest count; `isDriftFlagged(counted, system)` is the Console's 3% rule.

Limit (by design): a phone sees its own events at once and another phone's only after sync, so a vehicle that left through another gate after the
baseline shows only once `open_sessions` is refreshed. The Console computes the merged truth.

`observeOccupancy(facilityId)` (recompute on local DB changes) belongs to the gate app and is not in this package.

Decision: hand-rolled outbox, no PowerSync. Download sync (SYNC-03) comes later.
