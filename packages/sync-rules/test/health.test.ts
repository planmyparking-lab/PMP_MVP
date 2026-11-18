import { describe, expect, it } from "vitest";
import {
  composeHealth,
  listQuarantined,
  readHealth,
  type HealthContext,
  type OutboxStore,
} from "../src";
import { MemoryStore, makeEntry } from "./helpers";

describe("composeHealth", () => {
  it("merges the queue counts with the caller's network/version-gate state", () => {
    const context: HealthContext = {
      lastSyncAt: "2026-10-01T10:00:00.000Z",
      online: true,
      syncBlocked: false,
    };
    expect(
      composeHealth({ queueDepth: 3, oldestUnsyncedAgeMs: 90_000, quarantinedCount: 1 }, context),
    ).toEqual({
      queueDepth: 3,
      oldestUnsyncedAgeMs: 90_000,
      quarantinedCount: 1,
      lastSyncAt: "2026-10-01T10:00:00.000Z",
      online: true,
      syncBlocked: false,
    });
  });

  it("never guesses: a never-synced device reports lastSyncAt null, not a fabricated time", () => {
    const r = composeHealth(
      { queueDepth: 0, oldestUnsyncedAgeMs: 0, quarantinedCount: 0 },
      { lastSyncAt: null, online: false, syncBlocked: false },
    );
    expect(r.lastSyncAt).toBeNull();
  });
});

describe("readHealth", () => {
  it("reads the store and composes the snapshot", async () => {
    const store = new MemoryStore();
    store.clockMs = () => Date.parse("2026-10-01T10:05:00.000Z");
    store.add(makeEntry("2026-10-01T10:00:00.000Z"));
    const r = await readHealth(store, { lastSyncAt: null, online: true, syncBlocked: false });
    expect(r).toMatchObject({
      queueDepth: 1,
      oldestUnsyncedAgeMs: 300_000,
      quarantinedCount: 0,
      online: true,
    });
  });

  it("throws, rather than guessing zeros, when the store does not implement queueHealth()", async () => {
    const bareStore: OutboxStore = {
      pending: async () => [],
      apply: async () => {},
    };
    await expect(
      readHealth(bareStore, { lastSyncAt: null, online: true, syncBlocked: false }),
    ).rejects.toThrow(/queueHealth/);
  });
});

describe("listQuarantined", () => {
  it("lists quarantined rows without their payload or vehicle number", async () => {
    const store = new MemoryStore();
    const e = makeEntry("2026-10-01T10:00:00.000Z");
    store.add(e);
    await store.apply([{ id: e.id, state: "QUARANTINED", attempts: 5, code: "INVALID_PAYLOAD" }]);
    const rows = await listQuarantined(store);
    expect(rows).toEqual([
      {
        id: e.id,
        type: "ENTRY",
        attempts: 5,
        code: "INVALID_PAYLOAD",
        createdAt: "2026-10-01T10:00:00.000Z",
      },
    ]);
    // The row is list fields only: no payload or vehicle_class/short_code anywhere in it.
    expect(Object.keys(rows[0]!)).toEqual(["id", "type", "attempts", "code", "createdAt"]);
  });

  it("orders newest first and respects the limit", async () => {
    const store = new MemoryStore();
    const early = makeEntry("2026-10-01T10:00:00.000Z");
    const late = makeEntry("2026-10-01T11:00:00.000Z");
    store.add(early);
    store.add(late);
    await store.apply([
      { id: early.id, state: "QUARANTINED", attempts: 5, code: "REJECTED" },
      { id: late.id, state: "QUARANTINED", attempts: 5, code: "REJECTED" },
    ]);
    const rows = await listQuarantined(store, 1);
    expect(rows).toEqual([expect.objectContaining({ id: late.id })]);
  });

  it("throws, rather than returning an empty list, when the store does not implement quarantined()", async () => {
    const bareStore: OutboxStore = {
      pending: async () => [],
      apply: async () => {},
      queueHealth: async () => ({ queueDepth: 0, oldestUnsyncedAgeMs: 0, quarantinedCount: 0 }),
    };
    await expect(listQuarantined(bareStore)).rejects.toThrow(/quarantined/);
  });
});
