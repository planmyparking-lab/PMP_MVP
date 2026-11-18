import { parseEvent, type Event } from "@pmp/contracts";

import type { HealthSnapshot, OccupancySnapshot, OccupancyZone, SyncClient } from "./ic02";
import { formatEventIssues } from "./eventIssues";

/**
 * `FakeSync` — the in-memory IC-02 test double required by the sheets (member-02 D.15: "the sync
 * package is mocked with an in-memory fake implementing IC-02"; T-GATE-01-I1 and T-GATE-02-I1 are
 * explicit FakeSync tests). It must satisfy the SAME interface as the real client so that
 * T-IC02-GATE-1 can run one suite against both (member-01 IC-02 row).
 *
 * What it mimics: IC-01 validation at the write boundary (invalid events never land), one
 * transaction per write, whole-transaction atomicity with injected mid-transaction failures,
 * SYNC-04 occupancy re-computation, SYNC-06 health fields, and the PENDING outbox notion
 * (nothing is "synced" until the test calls markAllSynced).
 *
 * Test-only view helpers (clearly NOT IC-02 surface): `attachSessionZone` and `markAllSynced`.
 * ZONE ↔ session association is attached explicitly at setup (the way SYNC-03's `open_sessions`
 * snapshot will provide it) instead of being derived from stored ENTRY payloads — this keeps the
 * fake's occupancy baseline deterministic regardless of which events each test writes.
 *
 * The fake deliberately does NOT write SQLite, call the network, or emulate Afzal's conflict
 * detectors — production code consumes the `SyncClient` port, never this fake (integration with
 * the real package is Afzal's wave; see writeEvent.ts and OQ-37).
 */

export type FakeSyncOptions = {
  /** Facility zones with capacity (SYNC-03 config snapshot). */
  zones: Record<string, { capacity: number }>;
  /** Open sessions known at setup: SYNC-03's `open_sessions` snapshot ({sessionId, zoneId}). */
  openSessions?: { sessionId: string; zoneId: string }[];
  clock?: () => Date;
  online?: boolean;
  syncBlocked?: boolean;
};

export class FakeSync implements SyncClient {
  private readonly events: Event[] = [];
  private readonly zoneCapacity: Record<string, number>;
  private readonly sessionZone = new Map<string, string>();
  private readonly listeners = new Set<(snapshot: OccupancySnapshot) => void>();
  private readonly failureHooks = new Map<number, Error>();
  private nextFailureHookKey = 0;
  private readonly clock: () => Date;
  private online: boolean;
  private syncBlocked: boolean;
  private lastSyncAt: string | null = null;

  constructor(options: FakeSyncOptions) {
    for (const [id, zone] of Object.entries(options.zones)) {
      if (!Number.isSafeInteger(zone.capacity) || zone.capacity < 0) {
        throw new RangeError(`FakeSync: invalid capacity for zone ${id}`);
      }
    }
    this.zoneCapacity = Object.fromEntries(
      Object.entries(options.zones).map(([id, z]) => [id, z.capacity]),
    );
    for (const s of options.openSessions ?? []) this.attachSessionZone(s.sessionId, s.zoneId);
    this.clock = options.clock ?? (() => new Date());
    this.online = options.online ?? true;
    this.syncBlocked = options.syncBlocked ?? false;
  }

  /** One event, one transaction: validate (IC-01 zod) -> commit. Throws to the caller on a bad
   * event (T-GATE-01-I2) or on an injected failure (T-GATE-01-N4). */
  async writeEvent(event: Event): Promise<void> {
    await this.writeTransaction([event]);
  }

  /** staged batch with an atomic commit: the whole batch validates FIRST; if a failure hook
   * throws mid-commit the already-appended events are rolled back (both-or-neither,
   * T-GATE-02-I1 / T-GATE-04-N3). */
  async writeTransaction(events: readonly Event[]): Promise<void> {
    if (events.length === 0) throw new Error("FakeSync.writeTransaction: empty batch");
    for (const e of events) {
      const parsed = parseEvent(e);
      if (!parsed.ok) {
        throw new Error(
          `FakeSync: event failed IC-01 validation (${formatEventIssues(parsed.issues)})`,
        );
      }
    }
    const mark = this.events.length;
    try {
      for (const e of events) {
        const hook = this.failureHooks.get(this.nextFailureHookKey);
        this.nextFailureHookKey += 1;
        if (hook) {
          this.failureHooks.delete(this.nextFailureHookKey - 1);
          throw hook;
        }
        this.events.push(e);
      }
    } catch (error) {
      this.events.length = mark; // atomic rollback
      throw error;
    }
    this.notify();
  }

  /**
   * Inject a failure that fires at the Nth event position of the NEXT write(s) (0-based across
   * consecutive writes until consumed). This is the sheet's "inject a failure between events"
   * transaction hook (T-GATE-02-I1).
   */
  failOnEventPosition(position: number, error: Error): void {
    this.failureHooks.set(position, error);
    this.nextFailureHookKey = 0;
  }

  /** Test view: associate a session with a zone (as the SYNC-03 snapshot will supply). */
  attachSessionZone(sessionId: string, zoneId: string): void {
    if (!(zoneId in this.zoneCapacity)) {
      throw new Error(`FakeSync: unknown zone ${zoneId}`);
    }
    this.sessionZone.set(sessionId, zoneId);
  }

  /** Test view: pretend the outbox uploaded everything (SYNC-02). */
  markAllSynced(atIso: string | null = null): void {
    this.lastSyncAt = atIso ?? this.clock().toISOString();
  }

  /** Async IC-02 events-read (OQ-37, Resolved: the gate's duplicate guards must not assume a
   * synchronous store, because `SqliteOutboxStore.listEvents()` — the real on-device
   * implementation this fake stands in for — is inherently async). Same Promise-based contract on
   * both, so `WriteDeps.readEvents` binds to either without a call site change
   * (T-IC02-GATE-1 runs the identical guard suite against both). */
  async listEvents(): Promise<readonly Event[]> {
    return this.listEventsSync();
  }

  /** Synchronous snapshot — NOT IC-02 surface (same category as `attachSessionZone` and
   * `markAllSynced` above). `port.tsx` wires this to `PortRuntime.readEvents`, the dev shell's
   * render-time accessor for screens that recompute a view on every `eventsVersion` bump; that
   * surface predates, and is independent of, the async `listEvents()` contract above. Code that
   * gates a write decision (duplicate guards, anything reached through `WriteDeps.readEvents`)
   * must use `listEvents()`, not this. */
  listEventsSync(): readonly Event[] {
    return [...this.events];
  }

  observeOccupancy(
    _facilityId: string,
    onChange: (snapshot: OccupancySnapshot) => void,
  ): () => void {
    this.listeners.add(onChange);
    onChange(this.occupancyNow());
    return () => this.listeners.delete(onChange);
  }

  health(): HealthSnapshot {
    if (this.events.length === 0) {
      return {
        queueDepth: 0,
        oldestUnsyncedAgeMs: 0,
        lastSyncAt: this.lastSyncAt,
        online: this.online,
        quarantinedCount: 0,
        syncBlocked: this.syncBlocked,
      };
    }
    const oldest = Math.min(
      ...this.events.map((e) => Date.parse(e.device_time)).filter((n) => !Number.isNaN(n)),
    );
    return {
      queueDepth: this.events.length,
      oldestUnsyncedAgeMs: Math.max(0, this.clock().getTime() - oldest),
      lastSyncAt: this.lastSyncAt,
      online: this.online,
      quarantinedCount: 0,
      syncBlocked: this.syncBlocked,
    };
  }

  private occupancyNow(): OccupancySnapshot {
    const zones: Record<string, OccupancyZone> = {};
    for (const [id, capacity] of Object.entries(this.zoneCapacity)) {
      zones[id] = { count: 0, capacity, baselineAt: null };
    }
    // Open set = sessions from the synced snapshot (attach map) UNION this device's local ENTRY
    // events; an ENTRY for an already-known session is one session, never two. Zone association
    // comes from the attach map today (ENTRY payloads have no zone_id in IC-01 yet).
    const exited = new Set(this.events.filter((e) => e.type === "EXIT").map((e) => e.session_id));
    const open = new Set<string>(this.sessionZone.keys());
    for (const e of this.events) {
      if (e.type === "ENTRY") open.add(e.session_id);
    }
    for (const sessionId of open) {
      if (exited.has(sessionId)) continue;
      const zoneId = this.sessionZone.get(sessionId);
      const zone = zoneId === undefined ? undefined : zones[zoneId];
      if (zone) zone.count += 1;
    }
    return { zones, warnings: [] };
  }

  private notify(): void {
    const snapshot = this.occupancyNow();
    for (const listener of this.listeners) listener(snapshot);
  }
}
