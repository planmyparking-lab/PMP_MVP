import { describe, expect, it } from "vitest";

import {
  loadJsonRecord,
  loadOrCreateStableId,
  saveJsonRecord,
  type SecureKv,
  type StableIdResult,
} from "../src/auth/secureIdentity";

/** detail strings vary with the failure cause; assert the stable status fields. */
function statusOf(result: StableIdResult): { ok: unknown; reason?: string } | null {
  return result.ok ? null : { ok: false, reason: result.reason };
}

/**
 * Device-identity storage rules (GATE-09): create-once (and never silently rotate), strict
 * UUIDv7 conformance, fail-closed results on store/corruption problems, and JSON record
 * helpers that distinguish a missing record from corrupt data.
 */

const VALID_ID = "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa";

function memoryKv(): SecureKv & { dump: Map<string, string>; calls: { get: number; set: number } } {
  const dump = new Map<string, string>();
  const calls = { get: 0, set: 0 };
  return {
    dump,
    calls,
    get: (key) => {
      calls.get += 1;
      return Promise.resolve(dump.get(key) ?? null);
    },
    set: (key, value) => {
      calls.set += 1;
      dump.set(key, value);
      return Promise.resolve();
    },
  };
}

describe("loadOrCreateStableId", () => {
  it("creates once, re-reads on the next launch, and never calls the minter again", async () => {
    const kv = memoryKv();
    let minted = 0;
    const first = await loadOrCreateStableId(kv, "gate.deviceId", () => {
      minted += 1;
      return VALID_ID;
    });
    expect(first).toEqual({ ok: true, id: VALID_ID, created: true });

    const second = await loadOrCreateStableId(kv, "gate.deviceId", () => {
      minted += 1;
      return "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb";
    });
    expect(second).toEqual({ ok: true, id: VALID_ID, created: false });
    expect(minted).toBe(1);
  });

  it("refuses a stored value that is not a UUIDv7 (fail closed, no rewrite)", async () => {
    const kv = memoryKv();
    kv.dump.set("gate.deviceId", "toast");
    const result = await loadOrCreateStableId(kv, "gate.deviceId", () => VALID_ID);
    expect(statusOf(result)).toEqual({ ok: false, reason: "CORRUPTED" });
    expect(kv.calls.set).toBe(0);
  });

  it("refuses a minter that does not produce a UUIDv7", async () => {
    const result = await loadOrCreateStableId(memoryKv(), "k", () => "0123456789");
    expect(statusOf(result)).toEqual({ ok: false, reason: "CORRUPTED" });
  });

  it("reports STORE_UNAVAILABLE when reads or writes fail", async () => {
    const readBroken: SecureKv = {
      get: () => Promise.reject(new Error("boom")),
      set: () => Promise.resolve(),
    };
    const read = await loadOrCreateStableId(readBroken, "k", () => VALID_ID);
    expect(statusOf(read)).toEqual({ ok: false, reason: "STORE_UNAVAILABLE" });

    const writeBroken: SecureKv = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error("boom")),
    };
    const write = await loadOrCreateStableId(writeBroken, "k", () => VALID_ID);
    expect(statusOf(write)).toEqual({ ok: false, reason: "STORE_UNAVAILABLE" });
  });

  it("verifies the write actually persisted before trusting a fresh id", async () => {
    // A store that "succeeds" but forgets the value: fail closed rather than rotating ids.
    const kv: SecureKv = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
    };
    const result = await loadOrCreateStableId(kv, "k", () => VALID_ID);
    expect(statusOf(result)).toEqual({ ok: false, reason: "STORE_UNAVAILABLE" });
  });
});

describe("loadJsonRecord / saveJsonRecord", () => {
  it("round-trips a typed record", async () => {
    const kv = memoryKv();
    await saveJsonRecord(kv, "gate.lockout", { failCount: 2 });
    expect(await loadJsonRecord<{ failCount: number }>(kv, "gate.lockout")).toEqual({
      failCount: 2,
    });
  });

  it("treats a missing record as absent and surfaces corrupt JSON", async () => {
    const kv = memoryKv();
    expect(await loadJsonRecord(kv, "gate.lockout")).toBeNull();
    kv.dump.set("gate.lockout", "{not json");
    await expect(loadJsonRecord(kv, "gate.lockout")).rejects.toThrow();
  });
});
