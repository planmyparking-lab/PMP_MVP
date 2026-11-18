import { parseEvent, type Event } from "@pmp/contracts";
import type { OutboxRow, OutboxStore, QuarantinedRow, RowUpdate } from "@pmp/sync-rules";

import type { GateSqliteDb } from "./gateSqliteDb";
import { formatEventIssues } from "./eventIssues";
import type { HealthSnapshot } from "./ic02";

/**
 * Gate-owned SQLite persistence (pasted brief Step 3; `apps/gate` is Nikhil's path per
 * `docs/team/README.md` section "Responsibilities, owned paths"). Implements the `OutboxStore`
 * port `@pmp/sync-rules` defines (Afzal's package, not modified here) so `Uploader` from that
 * package can drive uploads against real on-device storage.
 *
 * Two tables, written together:
 * - `gate_events`: the durable local event log (append-only; `apply()` NEVER deletes or edits a
 *   row here — a failed or quarantined upload must never erase a locally persisted event, per the
 *   brief and GATE-11's paper-fallback guarantee).
 * - `gate_outbox`: sync queue state per event id (`PENDING` -> `SENT` | `QUARANTINED`), one row
 *   per event, 1:1 with `gate_events`.
 *
 * `writeEventAndEnqueue` is the one-action-one-transaction boundary (C.0 rule 1 in
 * member-02-nikhil.md): the event row and its outbox row land in the SAME `withTransactionAsync`
 * call, so a crash or a thrown error mid-write leaves neither — never an orphaned outbox row with
 * no event, and never an event with no queue entry to retry it.
 *
 * `writeEventsAndEnqueue` is the batch form backing IC-02's proposed `writeTransaction` (OQ-37,
 * `apps/gate/src/data/ic02.ts`): EXIT+PAYMENT[+OVERRIDE] land in the SAME transaction, so a crash
 * mid-batch leaves none of them, never a subset. `writeEventAndEnqueue` is defined in terms of it
 * (a one-event batch), so the two can never drift apart.
 */

export class OutboxValidationError extends Error {
  constructor(readonly detail: string) {
    super(`event failed IC-01 validation (${detail})`);
  }
}

/** Same id written twice with DIFFERENT content. Same id with identical content is a harmless,
 * idempotent retry (a guard double-tapping after a slow commit) and resolves silently — the same
 * leniency `ingest_events` itself applies server-side (DUPLICATE, see docs/integrations/ingest-events.md). */
export class OutboxCollisionError extends Error {
  constructor(readonly id: string) {
    super(`event id ${id} already stored with different content`);
  }
}

/** SQLite does not enforce `REFERENCES` by default (`PRAGMA foreign_keys` is OFF unless a
 * connection turns it on). Node's `node:sqlite` happens to default it ON (verified: a fresh
 * `DatabaseSync` reports `PRAGMA foreign_keys` = 1) — the opposite of plain SQLite's own default,
 * which is what `expo-sqlite`'s native binding uses (nothing in its typings sets this pragma, and
 * its docs do not claim otherwise). Without this, the two drivers would silently enforce
 * `gate_outbox.id REFERENCES gate_events(id)` differently. Set explicitly so both behave the same
 * way regardless of each engine's default — this is NOT verified against the real expo-sqlite
 * native binding on a device, only against `node:sqlite` (see docs/team/evidence-nikhil.md). */
const ENABLE_FOREIGN_KEYS = "PRAGMA foreign_keys = ON";

/** `device_time_ms` is the sortable form of `device_time`: `ORDER BY device_time` (TEXT) compares
 * strings, and the envelope's ISO timestamp allows any fractional-second precision or none, so
 * `...10:00:00.500Z` sorts BEFORE `...10:00:00Z` even though it is later. `device_time_ms` is
 * `Date.parse(device_time)`, computed once on write, and is what every ordering/age query below
 * uses instead. `device_time` itself is kept as the source of truth for the stored event's own
 * content (round-tripped through `listEvents()`/`pending()`'s `event_json`), never derived back
 * from the integer column. */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS gate_events (
    id TEXT PRIMARY KEY,
    event_json TEXT NOT NULL,
    device_time TEXT NOT NULL,
    device_time_ms INTEGER,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS gate_outbox (
    id TEXT PRIMARY KEY REFERENCES gate_events(id),
    state TEXT NOT NULL CHECK (state IN ('PENDING','SENT','QUARANTINED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    code TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS gate_outbox_state_idx ON gate_outbox (state)`,
];

/** Run only after `migrateDeviceTimeMs()` has guaranteed the column exists — a `gate_events` table
 * created before this fix exists without it, and `CREATE TABLE IF NOT EXISTS` above never adds a
 * column to an already-existing table. */
const DEVICE_TIME_MS_INDEX =
  "CREATE INDEX IF NOT EXISTS gate_events_device_time_ms_idx ON gate_events (device_time_ms, id)";

/** Deterministic (sorted-key) JSON for the duplicate-id content comparison; object key order from
 * a stored row re-parsed by `JSON.parse` need not match the original write. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** `type` field of a quarantined row's stored JSON, for `quarantined()`'s display list — never
 * throws, so one corrupt `event_json` row can never take down the whole listing (the row's
 * id/attempts/code/createdAt all come from separate SQL columns and stay intact either way). A
 * row whose JSON cannot be parsed, or parses to a shape with no string `type`, is still returned
 * labelled `UNPARSEABLE_EVENT` rather than dropped — dropping it would hide a real, already-
 * quarantined row from the operator who needs to see it. Can never collide with a real IC-01
 * event type (`ENTRY`/`EXIT`/`PAYMENT`/`OVERRIDE`/`ZONE_COUNT`/`SHIFT_OPEN`/`SHIFT_CLOSE`). */
function quarantinedRowType(eventJson: string): string {
  try {
    const parsed: unknown = JSON.parse(eventJson);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as { type?: unknown }).type === "string"
    ) {
      return (parsed as { type: string }).type;
    }
    return "UNPARSEABLE_EVENT";
  } catch {
    return "UNPARSEABLE_EVENT";
  }
}

interface EventRow {
  id: string;
  event_json: string;
  device_time: string;
}
interface OutboxJoinRow {
  id: string;
  event_json: string;
  device_time: string;
  attempts: number;
}
interface QueueHealthRow {
  pending_count: number | null;
  quarantined_count: number | null;
  oldest_pending_device_time_ms: number | null;
}
interface QuarantinedJoinRow {
  id: string;
  event_json: string;
  device_time: string;
  attempts: number;
  code: string | null;
}
interface DeviceTimeMsMigrationRow {
  id: string;
  device_time: string;
}

/** The subset of IC-02's `HealthSnapshot` (`apps/gate/src/data/ic02.ts`) `SqliteOutboxStore` can
 * answer from its own tables alone — see `queueHealth()`'s doc comment for which fields are
 * deliberately NOT here and why. */
export type QueueHealth = Pick<
  HealthSnapshot,
  "queueDepth" | "oldestUnsyncedAgeMs" | "quarantinedCount"
>;

export class SqliteOutboxStore implements OutboxStore {
  /** In-process write lock (see "Concurrency" below). Resolves when the previously queued write
   * has settled (success or failure); the queue itself never carries a rejection forward. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: GateSqliteDb,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Concurrency: `expo-sqlite`'s own docs warn that `withTransactionAsync` "is not exclusive and
   * can be interrupted by other async queries" on the same connection, and recommend
   * `withExclusiveTransactionAsync` if order matters — but that method hands the callback a
   * separate `txn` object with its own `execAsync`/`runAsync`/`getAllAsync`, a different shape
   * from `GateSqliteDb.withTransactionAsync(task: () => Promise<void>)`. Adopting it would mean
   * changing the `GateSqliteDb` port (every call site rewritten to use `txn` instead of `this.db`
   * inside a transaction) based on a native-binding guarantee this environment cannot verify — no
   * device exists to confirm it behaves as documented. Serializing in plain JS instead — a FIFO
   * queue around the only two write-transaction entry points (`writeEventsAndEnqueue`, `apply`) —
   * gives the actual guarantee needed (this store never has two `withTransactionAsync` calls
   * in flight on the same connection at once) without depending on engine internals, and it is
   * fully verifiable here (see "serializes overlapping writes" in the test file).
   *
   * Reads (`listEvents`, `pending`, `queueHealth`) go through the SAME queue (review finding,
   * `feature/gate-sqlite-sync` PR #39): a connection sees its own uncommitted rows mid-transaction
   * (SQLite's isolation is between connections, not within one), so a read that ran concurrently
   * with a write could observe a row from a batch that then rolls back — `Uploader` could then
   * send the server an event the device no longer has locally, breaking the all-or-nothing
   * guarantee `writeEventsAndEnqueue` exists for. Routing reads through `withWriteLock` costs
   * little (they are cheap) and removes the question entirely, at the cost of reads no longer
   * running concurrently with each other either — an accepted trade confirmed in review.
   */
  private withWriteLock<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(task, task);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Idempotent; safe to call on every app start (restart recovery: CREATE TABLE IF NOT EXISTS
   * never touches existing rows). `PRAGMA foreign_keys` is a per-connection setting in SQLite —
   * every open connection must re-issue it, so it runs here rather than once at table-creation
   * time. */
  async init(): Promise<void> {
    await this.db.execAsync(ENABLE_FOREIGN_KEYS);
    for (const statement of SCHEMA) await this.db.execAsync(statement);
    await this.migrateDeviceTimeMs();
    await this.db.execAsync(DEVICE_TIME_MS_INDEX);
  }

  /** Adds `device_time_ms` and backfills it from the already-stored `device_time` text, for a
   * `gate_events` table created by a connection before this column existed. A fresh table already
   * declares the column (SCHEMA above), so this is a no-op there — `PRAGMA table_info` is read
   * before every `ALTER TABLE` to keep `init()` idempotent across restarts either way. */
  private async migrateDeviceTimeMs(): Promise<void> {
    const columns = await this.db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(gate_events)",
      [],
    );
    if (columns.some((c) => c.name === "device_time_ms")) return;
    await this.db.execAsync("ALTER TABLE gate_events ADD COLUMN device_time_ms INTEGER");
    const rows = await this.db.getAllAsync<DeviceTimeMsMigrationRow>(
      "SELECT id, device_time FROM gate_events",
      [],
    );
    for (const row of rows) {
      await this.db.runAsync("UPDATE gate_events SET device_time_ms = ? WHERE id = ?", [
        Date.parse(row.device_time),
        row.id,
      ]);
    }
  }

  /** Validate (IC-01), then persist the event and its outbox row atomically. Resolves after the
   * local commit; never calls the network (the caller triggers `Uploader.uploadBatch()` after, as
   * C.0 rule 1 requires: "it returns after the local commit; it never waits for the network").
   * Defined as the one-event case of `writeEventsAndEnqueue` so the two never diverge. */
  async writeEventAndEnqueue(event: Event): Promise<void> {
    return this.writeEventsAndEnqueue([event]);
  }

  /** Batch form backing IC-02's proposed `writeTransaction` (OQ-37): every event and its outbox
   * row are inserted in ONE `withTransactionAsync` call, so a batch is stored whole or not at all —
   * never a subset (the GATE-02/GATE-04 EXIT+PAYMENT[+OVERRIDE] requirement). An empty array is a
   * safe no-op: nothing to validate, no transaction opened. Every event is IC-01-validated BEFORE
   * the transaction opens (same ordering as the single-event path), so a bad event anywhere in the
   * batch never touches the database. Duplicate ids follow `writeEventAndEnqueue`'s own rule,
   * applied per event, including across two entries of the SAME batch that share an id (the second
   * sees the first's not-yet-committed row within the same transaction): identical content is a
   * silent no-op, differing content raises `OutboxCollisionError` and rolls back the whole batch. */
  async writeEventsAndEnqueue(events: readonly Event[]): Promise<void> {
    if (events.length === 0) return;
    const stored: Event[] = [];
    for (const event of events) {
      const parsed = parseEvent(event);
      if (!parsed.ok) throw new OutboxValidationError(formatEventIssues(parsed.issues));
      stored.push(parsed.value);
    }
    const createdAt = this.now();

    return this.withWriteLock(() =>
      this.db.withTransactionAsync(async () => {
        for (const ev of stored) await this.insertEventRow(ev, createdAt);
      }),
    );
  }

  /** One event's insert-or-no-op-or-collide step, reused by both write entry points. Caller
   * provides the (already transaction-scoped) connection via `this.db` and must run this inside
   * `withTransactionAsync` for atomicity — it issues no transaction of its own. */
  private async insertEventRow(stored: Event, createdAt: string): Promise<void> {
    const existing = await this.db.getAllAsync<EventRow>(
      "SELECT id, event_json, device_time FROM gate_events WHERE id = ?",
      [stored.id],
    );
    if (existing.length > 0) {
      if (canonicalJson(JSON.parse(existing[0]!.event_json)) === canonicalJson(stored)) {
        return; // identical retry: no-op, already durable
      }
      throw new OutboxCollisionError(stored.id);
    }
    await this.db.runAsync(
      "INSERT INTO gate_events (id, event_json, device_time, device_time_ms, created_at) VALUES (?, ?, ?, ?, ?)",
      [
        stored.id,
        JSON.stringify(stored),
        stored.device_time,
        Date.parse(stored.device_time),
        createdAt,
      ],
    );
    await this.db.runAsync(
      "INSERT INTO gate_outbox (id, state, attempts, code) VALUES (?, 'PENDING', 0, NULL)",
      [stored.id],
    );
  }

  /** All events ever locally written, oldest first by `device_time_ms` (see its doc comment on
   * `SCHEMA` for why not the `device_time` text column) — the gate's local event log for the
   * exit/payment duplicate guards in `writeEvent.ts` (`WriteDeps.readEvents`, OQ-37's "events-read
   * API"). Every row re-validates (events were IC-01-valid at write time; parity is checked here
   * rather than assumed). Goes through `withWriteLock` so it never sees a row from an in-flight
   * write that later rolls back. */
  async listEvents(): Promise<Event[]> {
    const rows = await this.withWriteLock(() =>
      this.db.getAllAsync<EventRow>(
        "SELECT id, event_json, device_time FROM gate_events ORDER BY device_time_ms ASC, id ASC",
        [],
      ),
    );
    return rows.map((row) => {
      const parsed = parseEvent(JSON.parse(row.event_json));
      if (!parsed.ok) {
        throw new Error(
          `gate_events row ${row.id} no longer validates (${formatEventIssues(parsed.issues)})`,
        );
      }
      return parsed.value;
    });
  }

  /** `OutboxStore.pending` (Uploader's read side): up to `limit` PENDING rows ordered by
   * `device_time_ms` then id, joined against the durable event row. Goes through `withWriteLock`
   * so it never returns a row from a batch that is still mid-transaction and later rolls back
   * (review finding, PR #39) — a row this returns is always already committed. */
  async pending(limit: number): Promise<OutboxRow[]> {
    const rows = await this.withWriteLock(() =>
      this.db.getAllAsync<OutboxJoinRow>(
        `SELECT e.id as id, e.event_json as event_json, e.device_time as device_time, o.attempts as attempts
       FROM gate_outbox o JOIN gate_events e ON e.id = o.id
       WHERE o.state = 'PENDING'
       ORDER BY e.device_time_ms ASC, e.id ASC
       LIMIT ?`,
        [limit],
      ),
    );
    return rows.map((row) => ({
      id: row.id,
      event: JSON.parse(row.event_json) as unknown,
      attempts: row.attempts,
      deviceTime: row.device_time,
    }));
  }

  /** `OutboxStore.quarantined` (SYNC-06, OQ-66): up to `limit` QUARANTINED rows, newest first by
   * `device_time_ms` then id — a long-quarantined backlog doesn't bury what just failed. Mirrors
   * `pending()`'s shape (same join, same `withWriteLock` reasoning: a row this returns is always
   * already committed) with the opposite sort direction and state filter. `type` is read directly
   * from the stored event's own JSON via `quarantinedRowType` (never re-validated here;
   * `listEvents()` already does that for callers who need it) — this is a display list, not a
   * payload reader, so the raw `type` field is all it takes without parsing the rest. A row whose
   * `event_json` cannot be parsed is still listed (`UNPARSEABLE_EVENT`), never dropped and never
   * failing the whole call — the DB columns backing `id`/`attempts`/`code`/`createdAt` are
   * independent of the JSON blob's health. `code` defaults to `""` for the SQL schema's nullable
   * column, though `Uploader.run()` always sets one when it quarantines a row. */
  async quarantined(limit: number): Promise<QuarantinedRow[]> {
    const rows = await this.withWriteLock(() =>
      this.db.getAllAsync<QuarantinedJoinRow>(
        `SELECT e.id as id, e.event_json as event_json, e.device_time as device_time,
                o.attempts as attempts, o.code as code
       FROM gate_outbox o JOIN gate_events e ON e.id = o.id
       WHERE o.state = 'QUARANTINED'
       ORDER BY e.device_time_ms DESC, e.id DESC
       LIMIT ?`,
        [limit],
      ),
    );
    return rows.map((row) => ({
      id: row.id,
      type: quarantinedRowType(row.event_json),
      attempts: row.attempts,
      code: row.code ?? "",
      createdAt: row.device_time,
    }));
  }

  /** `OutboxStore.apply` (Uploader's write side): every update lands in ONE transaction. Never
   * touches `gate_events` — a SENT or QUARANTINED outcome only moves the outbox row's state, so a
   * failed or rejected upload can never erase a locally persisted event. */
  async apply(updates: RowUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    return this.withWriteLock(() =>
      this.db.withTransactionAsync(async () => {
        for (const update of updates) {
          await this.db.runAsync(
            "UPDATE gate_outbox SET state = ?, attempts = ?, code = ? WHERE id = ?",
            [update.state, update.attempts, update.code ?? null, update.id],
          );
        }
      }),
    );
  }

  /**
   * SYNC-06 health, the part `SqliteOutboxStore` actually owns: `queueDepth` (count of PENDING
   * rows), `oldestUnsyncedAgeMs` (age of the oldest PENDING row), and `quarantinedCount` (count of
   * QUARANTINED rows). ONE aggregate query — a status screen reading this on every render does one
   * round trip, not three.
   *
   * Timestamp semantics: age is measured from `device_time` (via its `device_time_ms` column),
   * not `created_at` — the SAME field `FakeSync.health()` already uses (`apps/gate/src/data/
   * fakeSync.ts`: `Math.min(...this.events.map(e => Date.parse(e.device_time))...)`), so a real
   * `SyncClient` built on this store answers
   * `T-IC02-GATE-1`'s shared contract suite the same way FakeSync does, not a newly invented one.
   * One consequence, inherited from FakeSync's own behaviour rather than introduced here: a
   * `PAPER_BACKFILL` event's `device_time` is the original paper time, which can be far older than
   * when it was actually keyed in and queued — its "age" by this measure reflects that backfill gap,
   * not queue latency. GATE-11's backfill flow is unaffected either way.
   *
   * `HealthSnapshot` (`apps/gate/src/data/ic02.ts`) also has `lastSyncAt`, `online` and
   * `syncBlocked` — deliberately NOT returned here. This store has no table recording when an
   * upload last succeeded, and `apply()` is never told whether the device is online or version-
   * gated; inventing those three would be guessing. They belong to whatever composes this store
   * with `Uploader` and the network/version-gate layer into a real `SyncClient` (Afzal's facade,
   * OQ-37) — `isSyncBlocked` in `apps/gate/src/syncGate.ts` already computes `syncBlocked` from the
   * cloud's `min_supported_version` (itself only known after an `Uploader` upload, via
   * `UploadOutcome.minSupportedVersion`), and `lastSyncAt`/`online` likewise only make sense once
   * that composition exists.
   *
   * Safety: an empty database, or a non-empty one with no PENDING row, both resolve to
   * `{queueDepth: 0, oldestUnsyncedAgeMs: 0, quarantinedCount: 0}` — SQL `SUM`/`MIN` over zero
   * matching rows is `NULL` in both cases, which this method treats as 0, never lets propagate as
   * `NaN`. A PENDING row whose `device_time` is in the future (clock skew) or fails to parse (should
   * never happen through this store's own IC-01-validated writes, but is not assumed) never
   * produces a negative or `NaN` age; both clamp to 0. Goes through `withWriteLock` for the same
   * reason `pending`/`listEvents` do (review finding, PR #39): a count taken mid-write could
   * include a row from a batch that then rolls back.
   */
  async queueHealth(): Promise<QueueHealth> {
    const rows = await this.withWriteLock(() =>
      this.db.getAllAsync<QueueHealthRow>(
        `SELECT
         SUM(CASE WHEN o.state = 'PENDING' THEN 1 ELSE 0 END) as pending_count,
         SUM(CASE WHEN o.state = 'QUARANTINED' THEN 1 ELSE 0 END) as quarantined_count,
         MIN(CASE WHEN o.state = 'PENDING' THEN e.device_time_ms ELSE NULL END) as oldest_pending_device_time_ms
       FROM gate_outbox o
       JOIN gate_events e ON e.id = o.id`,
        [],
      ),
    );
    const row = rows[0];
    return {
      queueDepth: row?.pending_count ?? 0,
      quarantinedCount: row?.quarantined_count ?? 0,
      oldestUnsyncedAgeMs: this.ageMs(row?.oldest_pending_device_time_ms ?? null),
    };
  }

  /** `0` for "nothing pending" (`oldestPendingMs === null`), a non-numeric value (SQLite's column
   * typing is weak: an INTEGER column can still hold TEXT), or a timestamp in the future relative
   * to `this.now()` — never `NaN`, never negative. `typeof` is checked, not just `Number.isNaN`,
   * because `Number.isNaN` does not coerce: a stray string value would otherwise slip past it and
   * turn into `NaN` the moment it reaches the subtraction below. */
  private ageMs(oldestPendingMs: number | null): number {
    if (typeof oldestPendingMs !== "number" || Number.isNaN(oldestPendingMs)) return 0;
    const now = Date.parse(this.now());
    return Math.max(0, now - oldestPendingMs);
  }
}
