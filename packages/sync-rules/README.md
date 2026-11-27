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

## Health and heartbeat (SYNC-06)

`OutboxStore` gained two **optional** methods for this (`src/outbox.ts`): `queueHealth(): Promise<QueueHealth>`
(`{ queueDepth, oldestUnsyncedAgeMs, quarantinedCount }`) and `quarantined(limit): Promise<QuarantinedRow[]>`. Optional
so adding them here was never a breaking change for an existing `OutboxStore` — the gate's `SqliteOutboxStore`
(`apps/gate/src/data/sqliteOutboxStore.ts`) already has a `queueHealth()` of this exact shape; nothing there needed to
change. `quarantined()` is new and not yet implemented by any store; `readHealth`/`listQuarantined` below throw a
clear error against a store that lacks the one it needs, rather than guessing zeros or an empty list.

- `composeHealth(queue, context)` (`src/health.ts`) is the pure merge: `queue` from `queueHealth()`, `context` —
  `{ lastSyncAt, online, syncBlocked }` — from the caller's own network/version-gate state. These three are
  deliberately **not** derived here: they depend on the transport and SYNC-03's version gate, not on the outbox's
  tables (see `apps/gate/src/data/sqliteOutboxStore.ts`'s own note on this and `apps/gate/src/syncGate.ts`'s
  `isSyncBlocked`). `readHealth(store, context)` does both steps against a real store in one call.
- `listQuarantined(store, limit?)` returns list fields only — id, type, attempts, the last rejection `code`, and
  `createdAt` — never the payload or a vehicle number; a payload is meant to be fetched separately, on demand, for
  one event id (not provided here).
- `HeartbeatSender` (`src/heartbeat.ts`) calls CLD-04's `heartbeat(device_id, queue_depth, oldest_unsynced_age,
app_version, schema_version, battery)` through an injected `HeartbeatTransport`, at most once every 5 minutes
  (`HEARTBEAT_INTERVAL_MS`), sent immediately on the first reconnect after being offline (`shouldSendHeartbeat` is the
  pure throttle rule). `oldest_unsynced_age` is **seconds**, not the snapshot's milliseconds — the stored column is
  `oldest_unsynced_age_s` and the SQL function passes it straight through with no conversion, so the sender floors
  `oldestUnsyncedAgeMs / 1000` at the call site. Battery is `null`, never `0`, when unavailable (OQ-29). A failed send
  (network error, or the server's own 5-minute window declining it) never throws and never advances the rate limit,
  so the next natural trigger retries — `maybeSend` is meant to be called from a timer or a reconnect event, not
  awaited from an entry/exit flow (SYNC-06: "never blocking entry and exit"). **Known limitation** (Akanksha's PR #57
  review, 16 Nov 2026): the client's own throttle sends immediately on reconnect (`shouldSendHeartbeat`), but
  `heartbeat()` (`0008_device_heartbeats.sql`) applies its own, independent 5-minute window keyed off the device's
  last _accepted_ row, not off this client-side state — a reconnect after a short outage (under 5 minutes since the
  last accepted heartbeat) is silently no-opped server-side (`accepted: false`), so the Console's queue-depth and
  oldest-unsynced-age figures for that device can stay stale for the rest of that window even though the device is
  back online. Nothing here retries faster to compensate (that would just race the server's own window); the next
  natural tick after it clears carries the real figures.
- `HealthSnapshot` is the canonical type (`queueDepth`, `oldestUnsyncedAgeMs`, `lastSyncAt`, `online`,
  `quarantinedCount`, `syncBlocked`) — `apps/gate/src/data/ic02.ts` currently has its own copy of this shape, written
  before this package exported one (its own comment says so); switching that import is a follow-up, not required for
  this to work, since the two are structurally identical.
