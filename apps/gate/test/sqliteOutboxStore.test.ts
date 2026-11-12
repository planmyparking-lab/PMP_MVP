import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { newId, type Event } from "@pmp/contracts";
import { Uploader, type IngestTransport } from "@pmp/sync-rules";

import type { GateSqliteDb } from "../src/data/gateSqliteDb";
import {
  OutboxCollisionError,
  OutboxValidationError,
  SqliteOutboxStore,
} from "../src/data/sqliteOutboxStore";
import { createNodeSqliteDb, withOneRunFailure } from "./helpers/nodeSqliteDb";

/** Wraps a `GateSqliteDb` to record the highest number of `withTransactionAsync` calls that were
 * ever simultaneously in flight — the direct way to prove (or disprove) that two writes never
 * overlap on the same connection, independent of any particular engine's own locking behavior. */
function withTransactionConcurrencyTracker(db: GateSqliteDb): {
  db: GateSqliteDb;
  maxConcurrent(): number;
} {
  let active = 0;
  let max = 0;
  return {
    db: {
      execAsync: (sql) => db.execAsync(sql),
      runAsync: (sql, params) => db.runAsync(sql, params),
      getAllAsync: (sql, params) => db.getAllAsync(sql, params),
      withTransactionAsync: async (task) => {
        active += 1;
        max = Math.max(max, active);
        try {
          await db.withTransactionAsync(task);
        } finally {
          active -= 1;
        }
      },
    },
    maxConcurrent: () => max,
  };
}

/** Wraps a `GateSqliteDb` so a `runAsync` call matching `shouldPause` suspends mid-transaction,
 * right after its row is written but before the transaction commits or rolls back — the exact
 * window a read must never observe anything from. `reached` resolves once that point is hit;
 * nothing after it runs until the test calls `release()`. Node's `node:sqlite` binding is
 * synchronous under the hood, so a plain concurrent `await` never naturally interleaves two
 * "transactions" — this is what creates a real, deterministic window instead. */
function withPauseAfter(
  db: GateSqliteDb,
  shouldPause: (sql: string, params: readonly unknown[]) => boolean,
): { db: GateSqliteDb; reached: Promise<void>; release: () => void } {
  let armed = true;
  let release: (() => void) | undefined;
  let signalReached: (() => void) | undefined;
  const reached = new Promise<void>((resolve) => {
    signalReached = resolve;
  });
  return {
    db: {
      execAsync: (sql) => db.execAsync(sql),
      getAllAsync: (sql, params) => db.getAllAsync(sql, params),
      withTransactionAsync: (task) => db.withTransactionAsync(task),
      async runAsync(sql, params) {
        const result = await db.runAsync(sql, params);
        if (armed && shouldPause(sql, params)) {
          armed = false;
          signalReached!();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return result;
      },
    },
    reached,
    release: () => release?.(),
  };
}

/**
 * SqliteOutboxStore tests (pasted brief Step 3 D-list: "Successful atomic write", "Event insert
 * failure", "Outbox insert failure and rollback", "Duplicate event ID", "Upload failure after
 * local persistence", "App restart recovery", "Multiple pending events", "Invalid event
 * rejection"). Runs the real SQL against Node's built-in `node:sqlite` (see helpers/nodeSqliteDb.ts
 * for why vitest cannot load `expo-sqlite` directly).
 */

const FACILITY = "00000000-0000-4000-8000-0000000000f1";
const DEVICE = "00000000-0000-4000-8000-0000000000d1";
const STAFF = "00000000-0000-4000-8000-0000000000b1";
const ZONE = "00000000-0000-4000-8000-0000000000c1";

function makeEntry(deviceTime: string, id: string = newId()): Event {
  return {
    id,
    type: "ENTRY",
    facility_id: FACILITY,
    device_id: DEVICE,
    staff_id: STAFF,
    session_id: newId(),
    device_time: deviceTime,
    source: "LIVE",
    schema_version: 1,
    payload: { vehicle_class: "Car", zone_id: ZONE, short_code: "7K2QX" },
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pmp-gate-outbox-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("SqliteOutboxStore.writeEventAndEnqueue", () => {
  it("stores the event and its outbox row atomically, PENDING, attempts 0", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const entry = makeEntry("2026-10-29T10:00:00.000Z");

    await store.writeEventAndEnqueue(entry);

    expect(await store.listEvents()).toEqual([entry]);
    const pending = await store.pending(10);
    expect(pending).toEqual([
      { id: entry.id, event: entry, attempts: 0, deviceTime: entry.device_time },
    ]);
  });

  it("rejects an IC-01-invalid event before any write (invalid event rejection)", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();

    await expect(
      store.writeEventAndEnqueue({
        id: newId(),
        type: "PAYMENT",
        facility_id: FACILITY,
        device_id: DEVICE,
        staff_id: STAFF,
        session_id: newId(),
        device_time: "2026-10-29T10:00:00.000Z",
        source: "LIVE",
        schema_version: 1,
        payload: { mode: "CASH", amount_paise: -5, upi_attested: false },
      } as unknown as Event),
    ).rejects.toBeInstanceOf(OutboxValidationError);

    expect(await store.listEvents()).toHaveLength(0);
    expect(await store.pending(10)).toHaveLength(0);
  });

  it("rolls back the whole transaction when the event insert fails (no orphan outbox row)", async () => {
    const real = createNodeSqliteDb();
    const faulty = withOneRunFailure(
      real,
      (sql) => sql.includes("INSERT INTO gate_events"),
      new Error("disk full"),
    );
    const store = new SqliteOutboxStore(faulty);
    await store.init();

    await expect(store.writeEventAndEnqueue(makeEntry("2026-10-29T10:00:00.000Z"))).rejects.toThrow(
      "disk full",
    );

    expect(await store.listEvents()).toHaveLength(0);
    expect(await store.pending(10)).toHaveLength(0);
  });

  it("rolls back the whole transaction when the outbox insert fails (event row also gone)", async () => {
    const real = createNodeSqliteDb();
    const faulty = withOneRunFailure(
      real,
      (sql) => sql.includes("INSERT INTO gate_outbox"),
      new Error("constraint violation"),
    );
    const store = new SqliteOutboxStore(faulty);
    await store.init();

    await expect(store.writeEventAndEnqueue(makeEntry("2026-10-29T10:00:00.000Z"))).rejects.toThrow(
      "constraint violation",
    );

    // Both-or-neither: the event row must not survive without its outbox row.
    expect(await store.listEvents()).toHaveLength(0);
  });

  it("an identical re-write of the same event id is a silent no-op (idempotent retry)", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const entry = makeEntry("2026-10-29T10:00:00.000Z");

    await store.writeEventAndEnqueue(entry);
    await store.writeEventAndEnqueue(entry); // same id, same content: no-op

    expect(await store.listEvents()).toHaveLength(1);
    expect(await store.pending(10)).toHaveLength(1);
  });

  it("the same event id with DIFFERENT content is a collision, rejected without touching the stored row", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const id = newId();
    const original = makeEntry("2026-10-29T10:00:00.000Z", id);
    const colliding = makeEntry("2026-10-29T11:00:00.000Z", id); // same id, different device_time

    await store.writeEventAndEnqueue(original);
    await expect(store.writeEventAndEnqueue(colliding)).rejects.toBeInstanceOf(
      OutboxCollisionError,
    );

    expect(await store.listEvents()).toEqual([original]); // untouched
  });

  it("keeps multiple pending events ordered by device_time then id", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const late = makeEntry("2026-10-29T10:05:00.000Z", "018f0000-0000-7000-8000-000000000003");
    const earlyB = makeEntry("2026-10-29T10:01:00.000Z", "018f0000-0000-7000-8000-000000000002");
    const earlyA = makeEntry("2026-10-29T10:01:00.000Z", "018f0000-0000-7000-8000-000000000001");
    for (const e of [late, earlyB, earlyA]) await store.writeEventAndEnqueue(e);

    const pending = await store.pending(10);
    expect(pending.map((r) => r.id)).toEqual([earlyA.id, earlyB.id, late.id]);
  });
});

describe("SqliteOutboxStore.writeEventsAndEnqueue (batch form, backs IC-02 writeTransaction)", () => {
  it("persists multiple events, each with its own outbox row, in input order", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const exit = makeEntry("2026-10-29T10:00:00.000Z", "018f0000-0000-7000-8000-00000000a001");
    const payment = makeEntry("2026-10-29T10:00:00.000Z", "018f0000-0000-7000-8000-00000000a002");
    const override = makeEntry("2026-10-29T10:00:00.000Z", "018f0000-0000-7000-8000-00000000a003");

    await store.writeEventsAndEnqueue([exit, payment, override]);

    expect(await store.listEvents()).toEqual([exit, payment, override]);
    const pending = await store.pending(10);
    expect(pending.map((r) => r.id)).toEqual([exit.id, payment.id, override.id]);
    expect(pending.every((r) => r.attempts === 0)).toBe(true);
  });

  it("an empty array is a safe no-op: no transaction, no rows, no error", async () => {
    const real = createNodeSqliteDb();
    let transactionCalls = 0;
    const counting: typeof real = {
      ...real,
      withTransactionAsync: (task) => {
        transactionCalls += 1;
        return real.withTransactionAsync(task);
      },
    };
    const store = new SqliteOutboxStore(counting);
    await store.init();

    await expect(store.writeEventsAndEnqueue([])).resolves.toBeUndefined();

    expect(transactionCalls).toBe(0);
    expect(await store.listEvents()).toHaveLength(0);
  });

  it("an invalid event anywhere in the batch rejects the whole call before any write", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const good = makeEntry("2026-10-29T10:00:00.000Z");
    const bad = {
      id: newId(),
      type: "PAYMENT",
      facility_id: FACILITY,
      device_id: DEVICE,
      staff_id: STAFF,
      session_id: newId(),
      device_time: "2026-10-29T10:00:00.000Z",
      source: "LIVE",
      schema_version: 1,
      payload: { mode: "CASH", amount_paise: -5, upi_attested: false },
    } as unknown as Event;

    await expect(store.writeEventsAndEnqueue([good, bad])).rejects.toBeInstanceOf(
      OutboxValidationError,
    );

    expect(await store.listEvents()).toHaveLength(0); // the good event never landed either
  });

  it("a failure on the second event's insert rolls back the whole batch (none persisted)", async () => {
    const real = createNodeSqliteDb();
    const first = makeEntry("2026-10-29T10:00:00.000Z");
    const second = makeEntry("2026-10-29T10:00:01.000Z");
    let eventInserts = 0;
    const faulty: typeof real = {
      ...real,
      runAsync: (sql, params) => {
        if (sql.includes("INSERT INTO gate_events")) {
          eventInserts += 1;
          if (eventInserts === 2) throw new Error("disk full on second event");
        }
        return real.runAsync(sql, params);
      },
    };
    const store = new SqliteOutboxStore(faulty);
    await store.init();

    await expect(store.writeEventsAndEnqueue([first, second])).rejects.toThrow(
      "disk full on second event",
    );

    // Both-or-neither across the WHOLE batch: the first event must not survive alone.
    expect(await store.listEvents()).toHaveLength(0);
    expect(await store.pending(10)).toHaveLength(0);
  });

  it("a failure on an outbox insert rolls back the whole batch", async () => {
    const real = createNodeSqliteDb();
    const first = makeEntry("2026-10-29T10:00:00.000Z");
    const second = makeEntry("2026-10-29T10:00:01.000Z");
    let outboxInserts = 0;
    const faulty: typeof real = {
      ...real,
      runAsync: (sql, params) => {
        if (sql.includes("INSERT INTO gate_outbox")) {
          outboxInserts += 1;
          if (outboxInserts === 2) throw new Error("constraint violation on second outbox row");
        }
        return real.runAsync(sql, params);
      },
    };
    const store = new SqliteOutboxStore(faulty);
    await store.init();

    await expect(store.writeEventsAndEnqueue([first, second])).rejects.toThrow(
      "constraint violation on second outbox row",
    );

    expect(await store.listEvents()).toHaveLength(0);
  });

  it("a prior successful write survives a LATER failed batch untouched", async () => {
    const real = createNodeSqliteDb();
    const store = new SqliteOutboxStore(real);
    await store.init();
    const already = makeEntry("2026-10-29T09:00:00.000Z");
    await store.writeEventAndEnqueue(already);

    const a = makeEntry("2026-10-29T10:00:00.000Z");
    const b = makeEntry("2026-10-29T10:00:01.000Z");
    let eventInserts = 0;
    const faulty: typeof real = {
      ...real,
      runAsync: (sql, params) => {
        if (sql.includes("INSERT INTO gate_events")) {
          eventInserts += 1;
          if (eventInserts === 1) throw new Error("killed mid-batch");
        }
        return real.runAsync(sql, params);
      },
    };
    const faultyStore = new SqliteOutboxStore(faulty);
    await expect(faultyStore.writeEventsAndEnqueue([a, b])).rejects.toThrow("killed mid-batch");

    expect(await store.listEvents()).toEqual([already]); // previously persisted event is intact
  });

  it("duplicate ids within ONE batch follow the single-write rule: identical content no-ops, differing content collides and rolls back", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const id = newId();
    const first = makeEntry("2026-10-29T10:00:00.000Z", id);
    const sameAgain = { ...first }; // identical content (same object fields), same id
    // NOT `makeEntry(..., id)` again: that mints a fresh `session_id` each call, so two
    // "same id" entries built that way are id-identical but content-different by construction.

    await store.writeEventsAndEnqueue([first, sameAgain]);
    expect(await store.listEvents()).toEqual([first]); // one row, no error

    const other = makeEntry("2026-10-29T10:00:00.000Z");
    const colliding = { ...first, device_time: "2026-10-29T11:00:00.000Z" }; // same id as `first`, different content
    await expect(store.writeEventsAndEnqueue([other, colliding])).rejects.toBeInstanceOf(
      OutboxCollisionError,
    );
    // The whole batch rolled back: `other` must not have landed either.
    expect(await store.listEvents()).toEqual([first]);
  });

  it("duplicate ids against an EARLIER call behave the same as the single-event path", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const id = newId();
    const original = makeEntry("2026-10-29T10:00:00.000Z", id);
    await store.writeEventAndEnqueue(original);

    const next = makeEntry("2026-10-29T10:05:00.000Z");
    const colliding = { ...original, device_time: "2026-10-29T12:00:00.000Z" };
    await expect(store.writeEventsAndEnqueue([next, colliding])).rejects.toBeInstanceOf(
      OutboxCollisionError,
    );
    expect(await store.listEvents()).toEqual([original]); // untouched; `next` did not land
  });
});

describe("SqliteOutboxStore.apply", () => {
  it("never removes the underlying event row, even when quarantining", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const entry = makeEntry("2026-10-29T10:00:00.000Z");
    await store.writeEventAndEnqueue(entry);

    await store.apply([
      { id: entry.id, state: "QUARANTINED", attempts: 5, code: "CLAIM_MISMATCH" },
    ]);

    expect(await store.pending(10)).toHaveLength(0); // left the pending set
    expect(await store.listEvents()).toEqual([entry]); // but the event itself is still there
  });

  it("applies every update in one transaction (all or nothing)", async () => {
    const real = createNodeSqliteDb();
    const store = new SqliteOutboxStore(real);
    await store.init();
    const a = makeEntry("2026-10-29T10:00:00.000Z");
    const b = makeEntry("2026-10-29T10:01:00.000Z");
    await store.writeEventAndEnqueue(a);
    await store.writeEventAndEnqueue(b);

    const faulty = withOneRunFailure(
      real,
      (sql) => sql.includes("UPDATE gate_outbox"),
      new Error("killed"),
    );
    const faultyStore = new SqliteOutboxStore(faulty);
    // First UPDATE throws inside the transaction: neither row's state should change.
    await expect(
      faultyStore.apply([
        { id: a.id, state: "SENT", attempts: 0 },
        { id: b.id, state: "SENT", attempts: 0 },
      ]),
    ).rejects.toThrow("killed");

    expect((await store.pending(10)).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe("SqliteOutboxStore + Uploader (upload failure after local persistence)", () => {
  it("a network failure during upload leaves the event PENDING and still in gate_events", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const entry = makeEntry("2026-10-29T10:00:00.000Z");
    await store.writeEventAndEnqueue(entry);

    const failingTransport: IngestTransport = {
      ingest: async () => {
        throw new Error("network unreachable");
      },
    };
    const uploader = new Uploader(store, failingTransport, { random: () => 0.5 });

    const outcome = await uploader.uploadBatch();
    expect(outcome).toMatchObject({ kind: "FAILED" });

    // The locally persisted event survives an upload failure untouched.
    expect(await store.listEvents()).toEqual([entry]);
    expect(await store.pending(10)).toEqual([
      { id: entry.id, event: entry, attempts: 0, deviceTime: entry.device_time },
    ]);
  });

  it("a successful upload marks the row SENT without ever deleting the event row", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const entry = makeEntry("2026-10-29T10:00:00.000Z");
    await store.writeEventAndEnqueue(entry);

    const okTransport: IngestTransport = {
      ingest: async (events) => ({
        results: events.map((e) => ({ id: e.id, status: "ACCEPTED" })),
        accepted: events.length,
        duplicates: 0,
        rejected: 0,
        min_supported_version: 1,
        server_time: "2026-10-29T10:00:01.000Z",
      }),
    };
    const uploader = new Uploader(store, okTransport);
    expect(await uploader.uploadBatch()).toMatchObject({ kind: "UPLOADED", sent: 1 });
    expect(await store.pending(10)).toHaveLength(0);
    expect(await store.listEvents()).toEqual([entry]); // the event row is never deleted
  });
});

describe("SqliteOutboxStore restart recovery", () => {
  it("a fresh store opened against the same file reads back everything a prior process committed", async () => {
    const path = join(dir, "gate.db");
    const first = createNodeSqliteDb(path);
    const firstStore = new SqliteOutboxStore(first);
    await firstStore.init();
    const a = makeEntry("2026-10-29T10:00:00.000Z");
    const b = makeEntry("2026-10-29T10:01:00.000Z");
    await firstStore.writeEventAndEnqueue(a);
    await firstStore.writeEventAndEnqueue(b);
    await firstStore.apply([{ id: a.id, state: "SENT", attempts: 0 }]);
    first.close(); // simulate app termination

    const second = createNodeSqliteDb(path);
    const secondStore = new SqliteOutboxStore(second);
    await secondStore.init(); // CREATE TABLE IF NOT EXISTS must not disturb existing rows

    expect(await secondStore.listEvents()).toEqual([a, b]);
    expect((await secondStore.pending(10)).map((r) => r.id)).toEqual([b.id]); // a already SENT
    second.close();
  });
});

describe("SqliteOutboxStore production-risk mitigations (audit follow-up)", () => {
  it("enables foreign-key enforcement on init: an orphan outbox row (no matching event) is rejected", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init(); // issues PRAGMA foreign_keys = ON before creating the tables

    // Bypass the store's own API (which never produces an orphan) to prove the constraint itself
    // is actually enforced by this connection, not just declared in the schema text.
    await expect(
      db.runAsync(
        "INSERT INTO gate_outbox (id, state, attempts, code) VALUES (?, 'PENDING', 0, NULL)",
        [newId()],
      ),
    ).rejects.toThrow();
  });

  it("serializes writeEventsAndEnqueue calls: no two write transactions are ever in flight at once", async () => {
    const real = createNodeSqliteDb();
    const tracked = withTransactionConcurrencyTracker(real);
    const store = new SqliteOutboxStore(tracked.db);
    await store.init();
    const a = makeEntry("2026-10-29T10:00:00.000Z");
    const b = makeEntry("2026-10-29T10:00:01.000Z");

    await Promise.all([store.writeEventsAndEnqueue([a]), store.writeEventsAndEnqueue([b])]);

    expect(tracked.maxConcurrent()).toBe(1);
    expect((await store.listEvents()).map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("serializes a writeEventsAndEnqueue racing an apply on the same store", async () => {
    const real = createNodeSqliteDb();
    const store = new SqliteOutboxStore(real);
    await store.init();
    const already = makeEntry("2026-10-29T09:00:00.000Z");
    await store.writeEventAndEnqueue(already);

    const tracked = withTransactionConcurrencyTracker(real);
    const trackedStore = new SqliteOutboxStore(tracked.db);
    const incoming = makeEntry("2026-10-29T10:00:00.000Z");

    await Promise.all([
      trackedStore.writeEventsAndEnqueue([incoming]),
      trackedStore.apply([{ id: already.id, state: "SENT", attempts: 0 }]),
    ]);

    expect(tracked.maxConcurrent()).toBe(1);
    expect(await store.pending(10)).toEqual([
      { id: incoming.id, event: incoming, attempts: 0, deviceTime: incoming.device_time },
    ]);
  });

  it("a write that fails INSIDE the locked transaction does not jam the queue for the next write", async () => {
    const real = createNodeSqliteDb();
    const faulty = withOneRunFailure(
      real,
      (sql) => sql.includes("INSERT INTO gate_events"),
      new Error("disk full"),
    );
    const store = new SqliteOutboxStore(faulty);
    await store.init();
    const failing = makeEntry("2026-10-29T10:00:00.000Z");
    const good = makeEntry("2026-10-29T10:00:01.000Z");

    // This rejection happens INSIDE withWriteLock (past validation, mid-transaction) — the queue
    // entry it leaves behind must be released, not left stuck mid-hold for the next caller.
    await expect(store.writeEventsAndEnqueue([failing])).rejects.toThrow("disk full");
    await store.writeEventsAndEnqueue([good]); // must not hang or stay blocked by the prior failure

    expect(await store.listEvents()).toEqual([good]);
  });
});

describe("SqliteOutboxStore.queueHealth (IC-02 HealthSnapshot: queueDepth/oldestUnsyncedAgeMs/quarantinedCount)", () => {
  it("an empty database reports all zeros, not null or NaN", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();

    expect(await store.queueHealth()).toEqual({
      queueDepth: 0,
      oldestUnsyncedAgeMs: 0,
      quarantinedCount: 0,
    });
  });

  it("one pending row: queueDepth 1, age measured from its device_time", async () => {
    const clock = "2026-10-29T10:05:00.000Z";
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db, () => clock);
    await store.init();
    await store.writeEventAndEnqueue(makeEntry("2026-10-29T10:00:00.000Z"));

    expect(await store.queueHealth()).toEqual({
      queueDepth: 1,
      oldestUnsyncedAgeMs: 5 * 60_000,
      quarantinedCount: 0,
    });
  });

  it("multiple pending rows: queueDepth counts all of them, age comes from the OLDEST one", async () => {
    const clock = "2026-10-29T10:10:00.000Z";
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db, () => clock);
    await store.init();
    await store.writeEventAndEnqueue(makeEntry("2026-10-29T10:00:00.000Z")); // oldest
    await store.writeEventAndEnqueue(makeEntry("2026-10-29T10:02:00.000Z"));
    await store.writeEventAndEnqueue(makeEntry("2026-10-29T10:05:00.000Z"));

    expect(await store.queueHealth()).toEqual({
      queueDepth: 3,
      oldestUnsyncedAgeMs: 10 * 60_000, // from the 10:00 row, not 10:02 or 10:05
      quarantinedCount: 0,
    });
  });

  it("no pending rows (all SENT): queueDepth and age are both 0, even though events exist", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const entry = makeEntry("2026-10-29T10:00:00.000Z");
    await store.writeEventAndEnqueue(entry);
    await store.apply([{ id: entry.id, state: "SENT", attempts: 0 }]);

    expect(await store.queueHealth()).toEqual({
      queueDepth: 0,
      oldestUnsyncedAgeMs: 0,
      quarantinedCount: 0,
    });
  });

  it("quarantined rows are counted separately from the pending queue", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const entry = makeEntry("2026-10-29T10:00:00.000Z");
    await store.writeEventAndEnqueue(entry);
    await store.apply([
      { id: entry.id, state: "QUARANTINED", attempts: 5, code: "CLAIM_MISMATCH" },
    ]);

    expect(await store.queueHealth()).toEqual({
      queueDepth: 0,
      oldestUnsyncedAgeMs: 0,
      quarantinedCount: 1,
    });
  });

  it("SENT rows never inflate queueDepth even when PENDING rows also exist", async () => {
    const clock = "2026-10-29T10:10:00.000Z";
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db, () => clock);
    await store.init();
    const sent = makeEntry("2026-10-29T09:00:00.000Z"); // earlier device_time, but SENT
    const pending = makeEntry("2026-10-29T10:00:00.000Z");
    await store.writeEventAndEnqueue(sent);
    await store.writeEventAndEnqueue(pending);
    await store.apply([{ id: sent.id, state: "SENT", attempts: 0 }]);

    expect(await store.queueHealth()).toEqual({
      queueDepth: 1,
      oldestUnsyncedAgeMs: 10 * 60_000, // from `pending` (10:00), NOT from the earlier SENT row
      quarantinedCount: 0,
    });
  });

  it("mixed PENDING, SENT and QUARANTINED states: each field reflects only its own subset", async () => {
    const clock = "2026-10-29T11:00:00.000Z";
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db, () => clock);
    await store.init();
    const sent = makeEntry("2026-10-29T09:00:00.000Z");
    const quarantined = makeEntry("2026-10-29T09:30:00.000Z");
    const pendingOld = makeEntry("2026-10-29T10:00:00.000Z");
    const pendingNew = makeEntry("2026-10-29T10:30:00.000Z");
    for (const e of [sent, quarantined, pendingOld, pendingNew])
      await store.writeEventAndEnqueue(e);
    await store.apply([
      { id: sent.id, state: "SENT", attempts: 0 },
      { id: quarantined.id, state: "QUARANTINED", attempts: 5, code: "CLAIM_MISMATCH" },
    ]);

    expect(await store.queueHealth()).toEqual({
      queueDepth: 2, // pendingOld, pendingNew only
      oldestUnsyncedAgeMs: 60 * 60_000, // from pendingOld (10:00), not the earlier sent/quarantined rows
      quarantinedCount: 1,
    });
    // Previously persisted events remain intact: the health query is read-only.
    expect((await store.listEvents()).map((e) => e.id).sort()).toEqual(
      [sent.id, quarantined.id, pendingOld.id, pendingNew.id].sort(),
    );
  });

  it("a future device_time (clock skew) never produces a negative age", async () => {
    const clock = "2026-10-29T10:00:00.000Z";
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db, () => clock);
    await store.init();
    await store.writeEventAndEnqueue(makeEntry("2026-10-29T10:10:00.000Z")); // 10 min AFTER "now"

    expect((await store.queueHealth()).oldestUnsyncedAgeMs).toBe(0);
  });

  it("a NULL device_time_ms (row planted before the column existed, never backfilled) never produces NaN", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    // Bypass the store's own IC-01-validated write path to plant a corrupted row directly, the
    // same technique used for the foreign-key-enforcement test above. device_time_ms is omitted,
    // leaving it NULL, as a pre-migration row would be if the backfill UPDATE in
    // migrateDeviceTimeMs() were ever skipped.
    const id = newId();
    await db.runAsync(
      "INSERT INTO gate_events (id, event_json, device_time, created_at) VALUES (?, '{}', 'not-a-timestamp', '2026-10-29T10:00:00.000Z')",
      [id],
    );
    await db.runAsync(
      "INSERT INTO gate_outbox (id, state, attempts, code) VALUES (?, 'PENDING', 0, NULL)",
      [id],
    );

    const health = await store.queueHealth();
    expect(health.queueDepth).toBe(1);
    expect(health.oldestUnsyncedAgeMs).toBe(0);
    expect(Number.isNaN(health.oldestUnsyncedAgeMs)).toBe(false);
  });

  it("a non-numeric device_time_ms (SQLite's weak typing allows it) never produces NaN", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const id = newId();
    await db.runAsync(
      "INSERT INTO gate_events (id, event_json, device_time, device_time_ms, created_at) VALUES (?, '{}', '2026-10-29T10:00:00.000Z', 'garbage', '2026-10-29T10:00:00.000Z')",
      [id],
    );
    await db.runAsync(
      "INSERT INTO gate_outbox (id, state, attempts, code) VALUES (?, 'PENDING', 0, NULL)",
      [id],
    );

    const health = await store.queueHealth();
    expect(health.queueDepth).toBe(1);
    expect(health.oldestUnsyncedAgeMs).toBe(0);
    expect(Number.isNaN(health.oldestUnsyncedAgeMs)).toBe(false);
  });
});

describe("SqliteOutboxStore reads never observe an uncommitted write (review finding, PR #39)", () => {
  /** The exact probe from review: an existing event, then a batch `[fresh, colliding]` where
   * `colliding` reuses `existing`'s id with different content. The pause lands right after
   * `fresh`'s outbox row commits-in-transaction, while the batch is still open -- `colliding` has
   * not been processed yet, so the transaction has not failed or rolled back. */
  function setupOpenBatch(real: GateSqliteDb, existing: Event) {
    const fresh = makeEntry("2026-10-29T10:00:00.000Z");
    const colliding = makeEntry("2026-10-29T11:00:00.000Z", existing.id);
    const paused = withPauseAfter(
      real,
      (sql, params) => sql.includes("INSERT INTO gate_outbox") && params[0] === fresh.id,
    );
    return { fresh, colliding, paused };
  }

  it("pending() never returns a row from a batch that is still open and later rolls back", async () => {
    const real = createNodeSqliteDb();
    const bootstrap = new SqliteOutboxStore(real);
    await bootstrap.init();
    const existing = makeEntry("2026-10-29T09:00:00.000Z");
    await bootstrap.writeEventAndEnqueue(existing);

    const { fresh, colliding, paused } = setupOpenBatch(real, existing);
    const store = new SqliteOutboxStore(paused.db);

    const batch = store.writeEventsAndEnqueue([fresh, colliding]).catch((e: unknown) => e);
    await paused.reached; // fresh's outbox row is committed-in-transaction; colliding not processed yet
    // Call now (while the batch is still open) but do not await yet: a fixed pending() must
    // queue behind the open write rather than run immediately, so awaiting it here — before
    // release() — would deadlock forever on a correct implementation. release() first, then
    // await both: a buggy pending() has already run (and wrongly seen `fresh`) by this point; a
    // fixed one only runs once the batch below has fully settled.
    const pendingPromise = store.pending(10);
    paused.release();
    const [pendingDuringBatch, batchError] = await Promise.all([pendingPromise, batch]);

    expect(batchError).toBeInstanceOf(OutboxCollisionError);
    // The whole batch rolled back: `fresh` must never have been visible, not even transiently.
    expect(pendingDuringBatch.map((r) => r.id)).toEqual([existing.id]);
    expect((await store.listEvents()).map((e) => e.id)).toEqual([existing.id]);
  });

  it("listEvents() never returns a row from a batch that is still open and later rolls back", async () => {
    const real = createNodeSqliteDb();
    const bootstrap = new SqliteOutboxStore(real);
    await bootstrap.init();
    const existing = makeEntry("2026-10-29T09:00:00.000Z");
    await bootstrap.writeEventAndEnqueue(existing);

    const { fresh, colliding, paused } = setupOpenBatch(real, existing);
    const store = new SqliteOutboxStore(paused.db);

    const batch = store.writeEventsAndEnqueue([fresh, colliding]).catch((e: unknown) => e);
    await paused.reached;
    const eventsPromise = store.listEvents(); // see the pending() test above for why not awaited yet
    paused.release();
    const [eventsDuringBatch] = await Promise.all([eventsPromise, batch]);

    expect(eventsDuringBatch.map((e) => e.id)).toEqual([existing.id]);
  });

  it("queueHealth() never counts a row from a batch that is still open and later rolls back", async () => {
    const real = createNodeSqliteDb();
    const bootstrap = new SqliteOutboxStore(real);
    await bootstrap.init();
    const existing = makeEntry("2026-10-29T09:00:00.000Z");
    await bootstrap.writeEventAndEnqueue(existing);

    const { fresh, colliding, paused } = setupOpenBatch(real, existing);
    const store = new SqliteOutboxStore(paused.db);

    const batch = store.writeEventsAndEnqueue([fresh, colliding]).catch((e: unknown) => e);
    await paused.reached;
    const healthPromise = store.queueHealth(); // see the pending() test above for why not awaited yet
    paused.release();
    const [healthDuringBatch] = await Promise.all([healthPromise, batch]);

    // Only `existing` is PENDING; `fresh` must not be counted even though its row was written
    // inside the (still uncommitted, soon to roll back) transaction.
    expect(healthDuringBatch.queueDepth).toBe(1);
  });
});

describe("SqliteOutboxStore device_time_ms ordering (review finding, PR #39)", () => {
  it("orders pending() by instant, not by device_time's string form", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    // ".500Z" sorts BEFORE a bare "Z" as a string (the character "." is less than "Z"), even
    // though the fractional-second timestamp is the LATER instant. A string ORDER BY would put
    // these two rows in the wrong order; device_time_ms must not.
    const later = makeEntry("2026-10-29T10:00:00.500Z", "018f0000-0000-7000-8000-000000000002");
    const earlier = makeEntry("2026-10-29T10:00:00Z", "018f0000-0000-7000-8000-000000000001");
    await store.writeEventAndEnqueue(later);
    await store.writeEventAndEnqueue(earlier);

    const pending = await store.pending(10);
    expect(pending.map((r) => r.id)).toEqual([earlier.id, later.id]);
  });

  it("orders listEvents() by instant, not by device_time's string form", async () => {
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db);
    await store.init();
    const later = makeEntry("2026-10-29T10:00:00.500Z", "018f0000-0000-7000-8000-000000000002");
    const earlier = makeEntry("2026-10-29T10:00:00Z", "018f0000-0000-7000-8000-000000000001");
    await store.writeEventAndEnqueue(later);
    await store.writeEventAndEnqueue(earlier);

    expect((await store.listEvents()).map((e) => e.id)).toEqual([earlier.id, later.id]);
  });

  it("queueHealth()'s oldest-pending age comes from the instant, not the device_time string order", async () => {
    const clock = "2026-10-29T10:00:01.000Z";
    const db = createNodeSqliteDb();
    const store = new SqliteOutboxStore(db, () => clock);
    await store.init();
    // By string order "...00Z" < "...00.500Z" is false (the bare "Z" form sorts AFTER), so a
    // string-based MIN() would have picked the wrong row as "oldest" here.
    const trueOldest = makeEntry("2026-10-29T10:00:00Z");
    const notOldest = makeEntry("2026-10-29T10:00:00.500Z");
    await store.writeEventAndEnqueue(notOldest);
    await store.writeEventAndEnqueue(trueOldest);

    expect((await store.queueHealth()).oldestUnsyncedAgeMs).toBe(1000);
  });

  it("restart recovery: a gate_events table created before device_time_ms existed is migrated and backfilled on init()", async () => {
    const path = join(dir, "pre-migration.db");
    const pre = createNodeSqliteDb(path);
    // Recreate the exact schema this store shipped with before device_time_ms, and plant two rows
    // directly (no device_time_ms column at all), simulating a device that already has local data.
    await pre.execAsync(
      `CREATE TABLE gate_events (
        id TEXT PRIMARY KEY,
        event_json TEXT NOT NULL,
        device_time TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    );
    await pre.execAsync(
      `CREATE TABLE gate_outbox (
        id TEXT PRIMARY KEY REFERENCES gate_events(id),
        state TEXT NOT NULL CHECK (state IN ('PENDING','SENT','QUARANTINED')),
        attempts INTEGER NOT NULL DEFAULT 0,
        code TEXT
      )`,
    );
    const later = makeEntry("2026-10-29T10:00:00.500Z", "018f0000-0000-7000-8000-000000000002");
    const earlier = makeEntry("2026-10-29T10:00:00Z", "018f0000-0000-7000-8000-000000000001");
    for (const e of [later, earlier]) {
      await pre.runAsync(
        "INSERT INTO gate_events (id, event_json, device_time, created_at) VALUES (?, ?, ?, ?)",
        [e.id, JSON.stringify(e), e.device_time, "2026-10-29T10:00:00.000Z"],
      );
      await pre.runAsync(
        "INSERT INTO gate_outbox (id, state, attempts, code) VALUES (?, 'PENDING', 0, NULL)",
        [e.id],
      );
    }
    pre.close();

    const reopened = createNodeSqliteDb(path);
    const store = new SqliteOutboxStore(reopened);
    await store.init(); // must add + backfill device_time_ms without disturbing the existing rows

    expect((await store.listEvents()).map((e) => e.id)).toEqual([earlier.id, later.id]);
    expect((await store.pending(10)).map((r) => r.id)).toEqual([earlier.id, later.id]);
    reopened.close();
  });
});
