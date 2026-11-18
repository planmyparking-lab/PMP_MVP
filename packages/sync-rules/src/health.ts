// Sync health (SYNC-06). Storage-agnostic, like outbox.ts: this module composes the snapshot and shapes the
// quarantine list; the gate's OutboxStore (SqliteOutboxStore) does the actual counting in SQL (queueHealth(),
// quarantined()) because that is real storage work, the same division outbox.ts already uses for pending()/apply().
//
// `lastSyncAt`, `online` and `syncBlocked` are NOT derived here: they depend on the network and version-gate layer
// (SYNC-03), not on the outbox's own tables. The caller tracks them from its own Uploader (lastSyncAt: the last
// UPLOADED outcome's time; syncBlocked: isSyncBlocked() against the last outcome's minSupportedVersion) and passes
// them in. Inventing them from outbox state alone would be guessing (see SqliteOutboxStore's own note on this).
import type { OutboxStore, QueueHealth, QuarantinedRow } from "./outbox";

/** GATE-12's status screen and diagnostics blob; CON-10's health page reads the same fields via device_heartbeats. */
export interface HealthSnapshot {
  queueDepth: number;
  oldestUnsyncedAgeMs: number;
  /** null = never synced. */
  lastSyncAt: string | null;
  online: boolean;
  quarantinedCount: number;
  syncBlocked: boolean;
}

export interface HealthContext {
  lastSyncAt: string | null;
  online: boolean;
  syncBlocked: boolean;
}

/** Combines a fresh `queueHealth()` read with the caller's network/version-gate state. Pure: takes the numbers, does
 * not read the store itself, so it is trivial to test without a database. */
export function composeHealth(queue: QueueHealth, context: HealthContext): HealthSnapshot {
  return {
    queueDepth: queue.queueDepth,
    oldestUnsyncedAgeMs: queue.oldestUnsyncedAgeMs,
    quarantinedCount: queue.quarantinedCount,
    lastSyncAt: context.lastSyncAt,
    online: context.online,
    syncBlocked: context.syncBlocked,
  };
}

/** Reads the store and composes the snapshot in one call, for the common case of a status screen or heartbeat
 * sender that just wants the current numbers. Throws if the store does not implement queueHealth() (it is optional
 * on OutboxStore) rather than guessing zeros, which would hide a real wiring gap as a quiet, wrong "all clear". */
export async function readHealth(
  store: OutboxStore,
  context: HealthContext,
): Promise<HealthSnapshot> {
  if (!store.queueHealth) throw new Error("this OutboxStore does not implement queueHealth()");
  return composeHealth(await store.queueHealth(), context);
}

/** GATE-12's quarantine list (`listQuarantined`): list fields only, no payload, no vehicle number. A payload is
 * fetched separately, on demand, for one event id — this module does not expose one, since that needs a different
 * store read (by id) and carries the field this list deliberately omits. Throws if the store does not implement
 * quarantined() (it is optional on OutboxStore), the same choice readHealth() makes and for the same reason. */
export async function listQuarantined(store: OutboxStore, limit = 50): Promise<QuarantinedRow[]> {
  if (!store.quarantined) throw new Error("this OutboxStore does not implement quarantined()");
  return store.quarantined(limit);
}
