import type { Event } from "@pmp/contracts";

/**
 * Gate-side port (typelevel) of Afzal's IC-02 sync client API — member-01-afzal.md IC-02 "Local
 * write API", provider Afzal, counterpart Nikhil:
 *
 *   `writeEvent`, `observeOccupancy`, `health`
 *   "Write errors thrown to caller, which shows the paper-sheet screen (GATE-11)"
 *   Shared contract test: fake and real implementations pass the SAME suite (T-IC02-GATE-1).
 *
 * Afzal's `packages/sync-rules` is an empty stub today, so these TYPES mirror the documented
 * behaviour for the gate's data layer until his package exports the canonical ones. They are
 * deliberately structural (no fake nominal identity): when `packages/sync-rules` ships, its
 * client satisfies this port as-is if signatures agree, and any divergence surfaces as a diff
 * against this one file rather than being discovered at runtime. Do NOT invent extra semantics
 * here — new surface requires a documented IC-01/IC-02 decision from Afzal first.
 *
 * Exit/payment atomicity (GATE-02 sequence 4.5: "writeExit() ... writes EXIT and PAYMENT in one
 * transaction (both events or neither)"; T-GATE-02-I1, T-GATE-04-I2/N3) needs a batch write on
 * the client. `writeTransaction` is that IC-02 extension — canonical name/shape confirmed by
 * Afzal (open-questions-and-assumptions.md OQ-37, Resolved, PR #67 review, 18 Nov 2026); the
 * gate must not hand-roll its own SQLite paths next to the sync package's (C.0 rule 1).
 *
 * OQ-37's resolution also confirms a committed-events read, `listEvents(): Promise<readonly
 * Event[]>` (a local snapshot for the duplicate guards behind `WriteDeps.readEvents`, no network
 * access) — not declared as a `SyncClient` member below because `FakeSync` and
 * `SqliteOutboxStore` both sit below the full facade Afzal's package will eventually compose
 * (`observeOccupancy`/`health` are confirmed follow-up, not part of this resolution). This
 * comment is `listEvents`'s contract record until that composition exists and it can be added
 * here directly.
 */

/** SYNC-06 health metrics (member-01: "queueDepth, oldestUnsyncedAgeMs, lastSyncAt, online,
 * quarantinedCount, syncBlocked"). Banner derivation belongs to the provider; the gate only
 * renders (GATE-12 uses this snapshot plus device inputs). */
export type HealthSnapshot = {
  queueDepth: number;
  oldestUnsyncedAgeMs: number;
  /** null = never synced (GATE-12 status screen shows "never"). */
  lastSyncAt: string | null; // UTC ISO
  online: boolean;
  quarantinedCount: number;
  syncBlocked: boolean;
};

/** One zone of the SYNC-04 occupancy output: `Record<zoneId, {count, capacity, baselineAt}>`
 * with negative-drift `warnings` (member-01 SYNC-04; counts derived, never stored). */
export type OccupancyZone = {
  count: number;
  capacity: number;
  /** UTC ISO of the ZONE_COUNT baseline used, when one exists. */
  baselineAt: string | null;
};

export type OccupancySnapshot = {
  zones: Record<string, OccupancyZone>;
  /** SYNC-04 "flag negative drift, do not hide it". */
  warnings: string[];
};

export interface SyncClient {
  /** One event, one local transaction (IC-02). Resolves after the local commit; never waits for
   * the network. Throws on validation/commit failure (caller shows the paper-sheet screen). */
  writeEvent(event: Event): Promise<void>;

  /** All-or-nothing multi-event write backing `writeExit` (EXIT + PAYMENT [+ OVERRIDE on
   * waiver]). Confirmed IC-02 extension (OQ-37, Resolved): non-empty batch; resolves after the
   * local commit; never waits for network sync. */
  writeTransaction(events: readonly Event[]): Promise<void>;

  /** SYNC-04: snapshot now, then re-deliver on local DB changes. Returns the unsubscribe fn. */
  observeOccupancy(facilityId: string, onChange: (snapshot: OccupancySnapshot) => void): () => void;

  /** SYNC-06 health snapshot (banner inputs, status screen, diagnostics blob). */
  health(): HealthSnapshot;
}
