import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_INTERVAL_MS,
  HeartbeatSender,
  shouldSendHeartbeat,
  type HeartbeatParams,
  type HeartbeatTransport,
} from "../src";
import { MemoryStore, makeEntry } from "./helpers";

describe("shouldSendHeartbeat", () => {
  const T0 = Date.parse("2026-10-01T10:00:00.000Z");

  it("never sends while offline", () => {
    expect(shouldSendHeartbeat(T0, null, undefined, false)).toBe(false);
    expect(shouldSendHeartbeat(T0, T0 - 1, true, false)).toBe(false);
  });

  it("sends on the very first call, online, with no prior send", () => {
    expect(shouldSendHeartbeat(T0, null, undefined, true)).toBe(true);
  });

  it("sends immediately on reconnect, without waiting out the interval", () => {
    // wasOnline === false means the device was offline a moment ago and has just come back.
    expect(shouldSendHeartbeat(T0, T0 - 1_000, false, true)).toBe(true);
  });

  it("does not send again before the interval elapses", () => {
    expect(shouldSendHeartbeat(T0 + HEARTBEAT_INTERVAL_MS - 1, T0, true, true)).toBe(false);
  });

  it("sends again exactly at the interval boundary and after it", () => {
    expect(shouldSendHeartbeat(T0 + HEARTBEAT_INTERVAL_MS, T0, true, true)).toBe(true);
    expect(shouldSendHeartbeat(T0 + HEARTBEAT_INTERVAL_MS + 1, T0, true, true)).toBe(true);
  });
});

class FakeTransport implements HeartbeatTransport {
  calls: HeartbeatParams[] = [];
  accept = true;
  error: unknown = null;
  async send(params: HeartbeatParams): Promise<boolean> {
    this.calls.push(params);
    if (this.error) throw this.error;
    return this.accept;
  }
}

function setup(initialMs: number) {
  const clock = { nowMs: initialMs };
  const store = new MemoryStore();
  store.clockMs = () => clock.nowMs;
  const transport = new FakeTransport();
  const sender = new HeartbeatSender(
    store,
    transport,
    { deviceId: "d1", appVersion: "1.0.0", schemaVersion: 1 },
    { clock: () => clock.nowMs },
  );
  return { store, transport, sender, clock };
}

describe("HeartbeatSender", () => {
  it("refuses a store that does not implement queueHealth() at construction, not on first send", () => {
    const bareStore = { pending: async () => [], apply: async () => {} };
    const transport = new FakeTransport();
    expect(
      () =>
        new HeartbeatSender(bareStore, transport, {
          deviceId: "d1",
          appVersion: "1.0.0",
          schemaVersion: 1,
        }),
    ).toThrow(/queueHealth/);
  });

  it("sends the six parameters in the device contract's shape, converting age from ms to seconds", async () => {
    const T0 = Date.parse("2026-10-01T10:00:00.000Z");
    const { store, transport, sender } = setup(T0);
    store.add(makeEntry("2026-10-01T09:58:30.500Z")); // 89.5s old at T0: floors to 89
    const result = await sender.maybeSend(true, 42);
    expect(result).toEqual({ sent: true, accepted: true });
    expect(transport.calls).toEqual([
      {
        deviceId: "d1",
        queueDepth: 1,
        oldestUnsyncedAgeSeconds: 89,
        appVersion: "1.0.0",
        schemaVersion: 1,
        batteryPercent: 42,
      },
    ]);
  });

  it("passes battery as null, never 0, when it is unavailable", async () => {
    const { transport, sender } = setup(Date.parse("2026-10-01T10:00:00.000Z"));
    await sender.maybeSend(true, null);
    expect(transport.calls[0]!.batteryPercent).toBeNull();
  });

  it("does not send again before the interval, then sends once it elapses", async () => {
    const T0 = Date.parse("2026-10-01T10:00:00.000Z");
    const { transport, sender, clock } = setup(T0);
    await sender.maybeSend(true, null);
    expect(transport.calls).toHaveLength(1);

    clock.nowMs = T0 + HEARTBEAT_INTERVAL_MS - 1;
    expect(await sender.maybeSend(true, null)).toEqual({ sent: false });
    expect(transport.calls).toHaveLength(1);

    clock.nowMs = T0 + HEARTBEAT_INTERVAL_MS;
    expect(await sender.maybeSend(true, null)).toEqual({ sent: true, accepted: true });
    expect(transport.calls).toHaveLength(2);
  });

  it("sends immediately on reconnect even though the interval has not elapsed", async () => {
    const T0 = Date.parse("2026-10-01T10:00:00.000Z");
    const { transport, sender, clock } = setup(T0);
    await sender.maybeSend(true, null);
    expect(transport.calls).toHaveLength(1);

    clock.nowMs = T0 + 1_000;
    await sender.maybeSend(false, null); // goes offline
    expect(transport.calls).toHaveLength(1); // offline: no call at all

    clock.nowMs = T0 + 2_000; // well inside the interval
    await sender.maybeSend(true, null); // reconnects
    expect(transport.calls).toHaveLength(2);
  });

  it("is silent to the caller on a transport failure, and the next trigger retries (lastSentAt never advanced)", async () => {
    const T0 = Date.parse("2026-10-01T10:00:00.000Z");
    const { transport, sender, clock } = setup(T0);
    transport.error = new Error("network down");
    const result = await sender.maybeSend(true, null);
    expect(result).toEqual({ sent: true, accepted: false }); // never throws
    expect(transport.calls).toHaveLength(1);

    // Shortly after, well inside the interval: still due, because the failed attempt never counted as a send.
    transport.error = null;
    clock.nowMs = T0 + 1_000;
    expect(await sender.maybeSend(true, null)).toEqual({ sent: true, accepted: true });
    expect(transport.calls).toHaveLength(2);
  });

  it("does not advance lastSentAt when the server declines (its own 5-minute window), so the client retries sooner", async () => {
    const T0 = Date.parse("2026-10-01T10:00:00.000Z");
    const { transport, sender, clock } = setup(T0);
    transport.accept = false;
    await sender.maybeSend(true, null);

    transport.accept = true;
    clock.nowMs = T0 + 1_000; // well inside the client's own interval
    expect(await sender.maybeSend(true, null)).toEqual({ sent: true, accepted: true });
    expect(transport.calls).toHaveLength(2);
  });
});
