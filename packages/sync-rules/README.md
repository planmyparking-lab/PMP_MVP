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

`computeOccupancy({ zones, openSessions, localEvents, zoneCounts, closedSessions?, now? })` (`src/occupancy.ts`) is a pure function. Counts are derived,
never stored as an incremented counter.

- **With a physical `ZONE_COUNT` baseline** for a zone: `count = counted + entries after the baseline - exits after it` (strictly later `device_time`).
  A session is subtracted once its **earliest** known exit — from a local `EXIT` event or a `closedSessions` record, whichever is earlier — is after
  the baseline; a later or duplicate report from either source can never re-subtract it. Its zone always comes from a known `ENTRY` (local or
  `open_sessions`) when there is one, never from `closedSessions.zoneId`, which this device cannot verify (see below).
- **Without one:** sessions with a known `ENTRY` (`open_sessions`, local, or `closedSessions`-only) and no known exit yet, from either source.
- Entries are matched by session id and events by event id, so a record seen twice counts once, a second exit for a session removes one vehicle, and the
  result does not depend on the order of the inputs.
- Displayed `count` is clamped at 0. `rawCount` keeps the real value and a `NEGATIVE` warning is raised.
- Warnings: `NEGATIVE`, `OVER_CAPACITY` (the guard may still let a vehicle in; policy, see OQ-23), `STALE_BASELINE` (older than 24 h, needs `now`),
  `ORPHAN_EXIT` (a local `EXIT` event for a session unknown here: not decremented, even if `closedSessions` separately corrects the count),
  `FUTURE_EVENT_IGNORED` (any timestamp-bearing input more than 5 minutes ahead of `now`, or malformed: a local event, an `open_sessions` entry, a
  `ZONE_COUNT` baseline, or a `closedSessions` record — none is a trusted exception, and a malformed timestamp is dropped the same way even without
  `now`, since an unguarded one can silently misbehave rather than simply being ignored). The handbook lists only the first three; the last two come
  from the SYNC-04 edge cases.
- A zone mentioned by the data but missing from `zones` returns `{ ok: false, error: "MISSING_ZONE_CONFIG", zoneIds }`, never zeros.
- `drift(zoneCounts, zoneId, now?)` is `counted - system_count_at_time` of the latest count (a future-dated count is dropped first, same as the baseline
  `computeOccupancy` selects); `isDriftFlagged(counted, system)` is the Console's 3% rule.

**Cross-device exits (OQ-16 amendment).** A baseline-branch exit used to be subtracted only when the session was still in `entries` — the
`open_sessions` snapshot plus local `ENTRY` events. But `0005_open_sessions.sql` deletes a session's row on `EXIT`, and a cross-device exit never
reaches this device's local events, so a vehicle that left through another gate after the baseline was never subtracted, not just delayed: the count
stayed stale-high permanently, even after `open_sessions` refreshed (the opposite of what an earlier version of this README claimed). `closedSessions`
(`{ sessionId, zoneId, entryTime, exitTime }[]`) fixes this — reported by any device, regardless of whether this device ever saw the `ENTRY` or `EXIT`
locally — for a session counted either at the baseline (`entryTime <= baselineTime`) or through a local entry after it, provided its earliest known
exit (local or `closedSessions`, whichever is earlier) is after the baseline. A session's zone always comes from a known `ENTRY` when there is one;
`closedSessions.zoneId` is only trusted for a session this device has never seen an `ENTRY` for at all.

This is download sync (SYNC-03), which does not exist yet — callers must pass `closedSessions: []` until it does, so cross-device exits are **not**
corrected in practice before SYNC-03 ships; only the API and the correction logic are in place now, so no further signature change is needed once it
does. The Console computes the merged truth independently in the meantime and is unaffected by this gap.

`observeOccupancy(facilityId)` (recompute on local DB changes) belongs to the gate app and is not in this package.

Decision: hand-rolled outbox, no PowerSync. Download sync (SYNC-03) comes later.
