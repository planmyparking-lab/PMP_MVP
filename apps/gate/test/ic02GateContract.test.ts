import { describe, expect, it } from "vitest";

import type { Event } from "@pmp/contracts";

import { FakeSync } from "../src/data/fakeSync";
import type { SyncClient } from "../src/data/ic02";
import { SqliteOutboxStore } from "../src/data/sqliteOutboxStore";
import { SCHEMA_VERSION, writeExit, type WriteDeps } from "../src/data/writeEvent";
import { createNodeSqliteDb, withOneRunFailure } from "./helpers/nodeSqliteDb";

/**
 * T-IC02-GATE-1 — the shared contract suite `ic02.ts` and `sqliteOutboxStore.ts` have long
 * promised ("fake and real implementations pass the SAME suite", member-01 IC-02 row) and that
 * OQ-37's feedback asked to make runnable: `writeExit`'s local duplicate guards now read through
 * `WriteDeps.readEvents(): Promise<readonly Event[]>`, so the exact same test body can drive a
 * `FakeSync`-backed and a `SqliteOutboxStore`-backed `WriteDeps` without the business logic under
 * test caring which one it got. `describe.each` below runs every case once per backend; a real
 * divergence between the fake and the on-device store fails exactly one of the two runs, not
 * both and not neither.
 *
 * `SqliteOutboxStore` implements `@pmp/sync-rules`'s `OutboxStore`, not the full `SyncClient` —
 * it has no `observeOccupancy`/`health` (those belong to whatever composes this store with
 * `Uploader` into a real client, Afzal's facade, OQ-37). `writeExit` never calls either, so
 * `clientFor()` below implements only the one member it actually uses (`writeTransaction`) and
 * throws loudly if anything else is ever invoked, rather than silently stubbing a surface this
 * suite does not exercise.
 */

const NOW = "2026-10-25T04:00:00.000Z";
const FACILITY = "fa7a7a7a-7a7a-7a7a-8a7a-7a7a7a7a7a7a";
const STAFF = "018aaaaa-0000-7000-8000-00000000000a";
const DEVICE = "018bbbbb-0000-7000-8000-00000000000b";
const SESSION = "01833333-3333-7333-8333-333333333331";

function unimplemented(member: string): never {
  throw new Error(
    `T-IC02-GATE-1 clientFor() adapter: ${member} is not used by writeExit and was not expected ` +
      "to be called in this suite",
  );
}

/** Minimal `SyncClient` adapter over whichever backend's batch-write primitive is passed in —
 * see the file header for why only `writeTransaction` needs a real implementation here. */
function clientFor(writeTransaction: SyncClient["writeTransaction"]): SyncClient {
  return {
    writeTransaction,
    writeEvent: () => unimplemented("writeEvent"),
    observeOccupancy: () => unimplemented("observeOccupancy"),
    health: () => unimplemented("health"),
  };
}

function seededPayment(mode: "CASH" | "UPI", amountPaise: number): Event {
  return {
    id: "01844444-4444-7444-8444-444444444441",
    type: "PAYMENT",
    facility_id: FACILITY,
    device_id: DEVICE,
    staff_id: STAFF,
    device_time: NOW,
    source: "LIVE",
    schema_version: SCHEMA_VERSION,
    session_id: SESSION,
    payload: { mode, amount_paise: amountPaise, upi_attested: mode === "UPI" },
  };
}

function makeDeps(client: SyncClient, readEvents: () => Promise<readonly Event[]>): WriteDeps {
  let minted = 0;
  return {
    client,
    readEvents,
    facilityId: FACILITY,
    staffId: STAFF,
    deviceId: DEVICE,
    now: () => NOW,
    generateId: () => {
      minted += 1;
      return `01822222-2222-7222-8222-${String(minted).padStart(12, "0")}`;
    },
  };
}

type Harness = {
  deps: WriteDeps;
  listEvents: () => Promise<readonly Event[]>;
  seedPayment(mode: "CASH" | "UPI", amountPaise: number): Promise<void>;
  teardown(): Promise<void>;
};

function fakeHarness(opts: { failSecondEvent?: boolean } = {}): Harness {
  const fake = new FakeSync({ zones: {}, clock: () => new Date(NOW) });
  if (opts.failSecondEvent) {
    fake.failOnEventPosition(1, new Error("write died between events"));
  }
  return {
    deps: makeDeps(
      clientFor((events) => fake.writeTransaction(events)),
      () => fake.listEvents(),
    ),
    listEvents: () => fake.listEvents(),
    seedPayment: async (mode, amountPaise) => {
      await fake.writeTransaction([seededPayment(mode, amountPaise)]);
    },
    teardown: async () => {},
  };
}

function sqliteHarness(opts: { failSecondEvent?: boolean } = {}): Harness {
  const rawDb = createNodeSqliteDb();
  let gateEventInserts = 0;
  const db = opts.failSecondEvent
    ? withOneRunFailure(
        rawDb,
        (sql) => {
          if (!sql.startsWith("INSERT INTO gate_events")) return false;
          gateEventInserts += 1;
          return gateEventInserts === 2; // fail on the SECOND event's insert, inside the one batch transaction
        },
        new Error("write died between events"),
      )
    : rawDb;
  const store = new SqliteOutboxStore(db, () => NOW);
  const ready = store.init();
  return {
    deps: makeDeps(
      clientFor(async (events) => {
        await ready;
        await store.writeEventsAndEnqueue(events);
      }),
      async () => {
        await ready;
        return store.listEvents();
      },
    ),
    listEvents: async () => {
      await ready;
      return store.listEvents();
    },
    seedPayment: async (mode, amountPaise) => {
      await ready;
      await store.writeEventsAndEnqueue([seededPayment(mode, amountPaise)]);
    },
    teardown: async () => rawDb.close(),
  };
}

const BACKENDS: { name: string; harness: (opts?: { failSecondEvent?: boolean }) => Harness }[] = [
  { name: "FakeSync", harness: fakeHarness },
  { name: "SqliteOutboxStore", harness: sqliteHarness },
];

describe.each(BACKENDS)("T-IC02-GATE-1 writeExit guards ($name)", ({ harness }) => {
  it("rolled-back batch: an injected failure between EXIT and PAYMENT stores neither", async () => {
    const h = harness({ failSecondEvent: true });
    try {
      await expect(
        writeExit(h.deps, {
          sessionId: SESSION,
          farePaise: 6000,
          exitMethod: "CODE",
          payment: { mode: "UPI", amountPaise: 6000 },
        }),
      ).rejects.toThrow("write died between events");
      expect(await h.listEvents()).toHaveLength(0);
    } finally {
      await h.teardown();
    }
  });

  it("already-exited guard: a second exit for the same session is refused locally", async () => {
    const h = harness();
    try {
      await writeExit(h.deps, {
        sessionId: SESSION,
        farePaise: 6000,
        exitMethod: "CODE",
        payment: { mode: "CASH", amountPaise: 6000 },
      });
      await expect(
        writeExit(h.deps, {
          sessionId: SESSION,
          farePaise: 6000,
          exitMethod: "CODE",
          payment: { mode: "CASH", amountPaise: 6000 },
        }),
      ).rejects.toMatchObject({ reason: "ALREADY_EXITED" });
      expect(await h.listEvents()).toHaveLength(2); // the first exit's EXIT + PAYMENT only
    } finally {
      await h.teardown();
    }
  });

  it("second-payment guard: a session with an existing PAYMENT refuses another", async () => {
    const h = harness();
    try {
      await h.seedPayment("CASH", 6000);
      await expect(
        writeExit(h.deps, {
          sessionId: SESSION,
          farePaise: 6000,
          exitMethod: "CODE",
          payment: { mode: "CASH", amountPaise: 6000 },
        }),
      ).rejects.toMatchObject({ reason: "SECOND_PAYMENT" });
      expect(await h.listEvents()).toHaveLength(1); // only the seeded PAYMENT
    } finally {
      await h.teardown();
    }
  });
});
