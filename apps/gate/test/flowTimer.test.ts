import { describe, expect, it } from "vitest";

import { elapsedFlowMs, resetFlowTimer, startFlowTimer } from "../src/domain/flowTimer";

describe("flow timing anchors", () => {
  it("starts at screen open and repeated starts do not reset the active flow", () => {
    const openedAt = startFlowTimer(null, 100);
    const afterNavigation = startFlowTimer(openedAt, 175);
    expect(openedAt).toBe(100);
    expect(afterNavigation).toBe(openedAt);
    expect(elapsedFlowMs(afterNavigation, 250)).toBe(150);
  });

  it("starts a fresh interval at reset and never reports negative duration", () => {
    const resetAt = resetFlowTimer(500);
    expect(elapsedFlowMs(resetAt, 620)).toBe(120);
    expect(elapsedFlowMs(resetAt, 499)).toBe(0);
    expect(elapsedFlowMs(null, 700)).toBe(0);
  });
});
