import { describe, expect, it } from "vitest";

import { SessionRegistry } from "../src/data/localSessions";

/**
 * Local open-session stand-in (SYNC-03 gap marked FALSE in dev shells): record/close/list rules
 * — dedupe by id (duplicate WRITE is a bug, not a retry), EXIT closes idempotently, list order
 * is oldest-entry-first (T-GATE-02-E4).
 */

function sample(input: {
  sessionId: string;
  shortCode?: string;
  enteredAt?: string;
  vehicleClass?: string;
}) {
  return {
    sessionId: input.sessionId,
    shortCode: input.shortCode ?? "P4RK1",
    vehicleClass: input.vehicleClass ?? "Car",
    vehicleNo: null,
    enteredAt: input.enteredAt ?? "2026-07-15T10:00:00.000Z",
  };
}

describe("SessionRegistry", () => {
  it("records rows and lists them oldest-entry first", () => {
    const registry = new SessionRegistry();
    registry.record(sample({ sessionId: "b", enteredAt: "2026-07-15T11:00:00.000Z" }));
    registry.record(sample({ sessionId: "a", enteredAt: "2026-07-15T10:00:00.000Z" }));
    expect(registry.list().map((row) => row.sessionId)).toEqual(["a", "b"]);
  });

  it("attempts a duplicate registration with a throw, never a silent replace", () => {
    const registry = new SessionRegistry();
    registry.record(sample({ sessionId: "a" }));
    expect(() => registry.record(sample({ sessionId: "a", shortCode: "H4K3P" }))).toThrow(
      /duplicate session id/,
    );
    expect(registry.list()).toHaveLength(1);
  });

  it("close is idempotent and mirrors a locally-acknowledged EXIT", () => {
    const registry = new SessionRegistry();
    registry.record(sample({ sessionId: "a" }));
    registry.close("a");
    expect(registry.list()).toEqual([]);
    expect(() => registry.close("a")).not.toThrow();
    expect(() => registry.close("never-existed")).not.toThrow();
  });

  it("clear empties everything (dev only)", () => {
    const registry = new SessionRegistry();
    registry.record(sample({ sessionId: "a" }));
    registry.record(sample({ sessionId: "b" }));
    registry.clear();
    expect(registry.list()).toEqual([]);
  });
});
