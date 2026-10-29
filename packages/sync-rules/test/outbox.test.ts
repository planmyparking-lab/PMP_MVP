import { newId } from "@pmp/contracts";
import { describe, expect, it } from "vitest";
import { AuthError, Uploader } from "../src";
import { FakeCloud, MemoryStore, makeEntry } from "./helpers";

function setup() {
  const store = new MemoryStore();
  const cloud = new FakeCloud();
  const uploader = new Uploader(store, cloud, { random: () => 0.5 });
  return { store, cloud, uploader };
}
const at = (minute: number) => `2026-10-01T10:${String(minute).padStart(2, "0")}:00.000Z`;

describe("Uploader.uploadBatch", () => {
  it("is idle when nothing is pending", async () => {
    const { uploader, cloud } = setup();
    expect(await uploader.uploadBatch()).toEqual({ kind: "IDLE" });
    expect(cloud.calls).toHaveLength(0);
  });

  it("sends events ordered by device_time then id and marks accepted ones SENT", async () => {
    const { store, cloud, uploader } = setup();
    const late = makeEntry(at(5), "018f0000-0000-7000-8000-000000000003");
    const earlyB = makeEntry(at(1), "018f0000-0000-7000-8000-000000000002");
    const earlyA = makeEntry(at(1), "018f0000-0000-7000-8000-000000000001");
    [late, earlyB, earlyA].forEach((e) => store.add(e));
    const outcome = await uploader.uploadBatch();
    expect(cloud.calls[0]).toEqual([earlyA.id, earlyB.id, late.id]);
    expect(outcome).toMatchObject({
      kind: "UPLOADED",
      sent: 3,
      duplicates: 0,
      retrying: 0,
      quarantined: 0,
    });
    expect(store.count("SENT")).toBe(3);
  });

  it("limits a batch to 50 events and drain() uploads a 300-event backlog in order", async () => {
    const { store, cloud, uploader } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 300; i++) {
      const e = makeEntry(
        `2026-10-01T10:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`,
      );
      ids.push(e.id);
      store.add(e);
    }
    const outcome = await uploader.drain();
    expect(cloud.calls.map((c) => c.length)).toEqual([50, 50, 50, 50, 50, 50]);
    expect(cloud.calls.flat()).toEqual(ids);
    expect(store.count("SENT")).toBe(300);
    expect(cloud.stored.size).toBe(300);
    expect(outcome).toEqual({ kind: "IDLE" });
  });

  it("treats DUPLICATE as success", async () => {
    const { store, cloud, uploader } = setup();
    const e = makeEntry(at(1));
    cloud.stored.add(e.id);
    store.add(e);
    expect(await uploader.uploadBatch()).toMatchObject({
      kind: "UPLOADED",
      sent: 1,
      duplicates: 1,
    });
    expect(store.count("SENT")).toBe(1);
  });

  it("survives the app being killed between the RPC and the local write (re-sent, server says duplicate)", async () => {
    const { store, cloud, uploader } = setup();
    const e = makeEntry(at(1));
    store.add(e);
    store.failNextApply = true;
    await expect(uploader.uploadBatch()).rejects.toThrow("killed");
    expect(cloud.stored.has(e.id)).toBe(true);
    expect(store.count("PENDING")).toBe(1);
    expect(await uploader.uploadBatch()).toMatchObject({
      kind: "UPLOADED",
      sent: 1,
      duplicates: 1,
    });
    expect(store.count("SENT")).toBe(1);
    expect(cloud.stored.size).toBe(1);
  });

  it("a rejected event never blocks the others in its batch", async () => {
    const { store, cloud, uploader } = setup();
    const bad = makeEntry(at(1));
    const good = makeEntry(at(2));
    store.add(bad);
    store.add(good);
    cloud.rejectIds.set(bad.id, "STAFF_NOT_ACTIVE");
    expect(await uploader.uploadBatch()).toMatchObject({ sent: 1, retrying: 1, quarantined: 0 });
    expect(store.rows.get(good.id)!.state).toBe("SENT");
    expect(store.rows.get(bad.id)).toMatchObject({
      state: "PENDING",
      attempts: 1,
      code: "STAFF_NOT_ACTIVE",
    });
  });

  it("quarantines a rejected event after 5 attempts and keeps the server code", async () => {
    const { store, cloud, uploader } = setup();
    const bad = makeEntry(at(1));
    store.add(bad);
    cloud.rejectIds.set(bad.id, "CLAIM_MISMATCH");
    for (let i = 1; i <= 4; i++) {
      expect(await uploader.uploadBatch()).toMatchObject({ retrying: 1, quarantined: 0 });
      expect(store.rows.get(bad.id)!.attempts).toBe(i);
    }
    expect(await uploader.uploadBatch()).toMatchObject({ retrying: 0, quarantined: 1 });
    expect(store.rows.get(bad.id)).toMatchObject({
      state: "QUARANTINED",
      attempts: 5,
      code: "CLAIM_MISMATCH",
    });
    expect(await uploader.uploadBatch()).toEqual({ kind: "IDLE" });
  });

  it("drain stops instead of spinning on events that keep being rejected", async () => {
    const { store, cloud, uploader } = setup();
    const bad = makeEntry(at(1));
    store.add(bad);
    cloud.rejectIds.set(bad.id, "INVALID_PAYLOAD");
    const outcome = await uploader.drain();
    expect(outcome).toMatchObject({ kind: "UPLOADED", retrying: 1 });
    expect(cloud.calls).toHaveLength(1);
  });

  it("quarantines a stored event that no longer parses, without sending it", async () => {
    const { store, cloud, uploader } = setup();
    store.addRaw("broken", { id: "broken", type: "ENTRY" });
    const good = makeEntry(at(2));
    store.add(good);
    expect(await uploader.uploadBatch()).toMatchObject({ sent: 1, quarantined: 1 });
    expect(cloud.calls[0]).toEqual([good.id]);
    expect(store.rows.get("broken")).toMatchObject({ state: "QUARANTINED", code: "LOCAL_INVALID" });
  });

  it("on a network failure keeps events PENDING, counts failures and returns a growing delay", async () => {
    const { store, cloud, uploader } = setup();
    store.add(makeEntry(at(1)));
    cloud.failWith = new Error("offline");
    expect(await uploader.uploadBatch()).toMatchObject({ kind: "FAILED", retryInMs: 2000 });
    expect(await uploader.uploadBatch()).toMatchObject({ kind: "FAILED", retryInMs: 4000 });
    expect(uploader.consecutiveFailures).toBe(2);
    expect(store.count("PENDING")).toBe(1);
    expect([...store.rows.values()][0]!.attempts).toBe(0);
    cloud.failWith = null;
    expect(await uploader.uploadBatch()).toMatchObject({ kind: "UPLOADED", sent: 1 });
    expect(uploader.consecutiveFailures).toBe(0);
  });

  it("on an auth failure stops, keeps every event and reports AUTH_REQUIRED", async () => {
    const { store, cloud, uploader } = setup();
    store.add(makeEntry(at(1)));
    cloud.failWith = new AuthError("401");
    expect(await uploader.uploadBatch()).toEqual({ kind: "AUTH_REQUIRED" });
    expect(store.count("PENDING")).toBe(1);
    expect(uploader.consecutiveFailures).toBe(0);
  });

  it("treats a malformed or short response as a retryable failure and changes nothing", async () => {
    const store = new MemoryStore();
    store.add(makeEntry(at(1)));
    const uploader = new Uploader(
      store,
      { ingest: async () => ({ results: [] }) },
      { random: () => 0.5 },
    );
    expect(await uploader.uploadBatch()).toMatchObject({ kind: "FAILED" });
    expect(store.count("PENDING")).toBe(1);
  });

  it("treats results for a different event id as a failure", async () => {
    const store = new MemoryStore();
    store.add(makeEntry(at(1)));
    const uploader = new Uploader(
      store,
      {
        ingest: async () => ({
          results: [{ id: newId(), status: "ACCEPTED" }],
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          min_supported_version: 1,
          server_time: "x",
        }),
      },
      { random: () => 0.5 },
    );
    expect(await uploader.uploadBatch()).toMatchObject({ kind: "FAILED" });
    expect(store.count("SENT")).toBe(0);
  });

  it("runs one upload at a time: concurrent calls share the running upload", async () => {
    const { store, cloud, uploader } = setup();
    store.add(makeEntry(at(1)));
    const [a, b, c] = await Promise.all([
      uploader.uploadBatch(),
      uploader.uploadBatch(),
      uploader.uploadBatch(),
    ]);
    expect(cloud.calls).toHaveLength(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("reports the cloud's minimum schema version for the version gate", async () => {
    const { store, uploader } = setup();
    store.add(makeEntry(at(1)));
    expect(await uploader.uploadBatch()).toMatchObject({ minSupportedVersion: 1 });
  });
});
