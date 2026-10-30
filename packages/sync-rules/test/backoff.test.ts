import { describe, expect, it } from "vitest";
import { MAX_DELAY_MS, nextDelay } from "../src";

describe("nextDelay", () => {
  it("doubles from 2 s with no jitter at the midpoint", () => {
    expect([0, 1, 2, 3].map((n) => nextDelay(n, () => 0.5))).toEqual([2000, 4000, 8000, 16000]);
  });
  it("caps at 5 minutes", () => {
    expect(nextDelay(8, () => 0.5)).toBe(MAX_DELAY_MS);
    expect(nextDelay(10_000, () => 0.5)).toBe(MAX_DELAY_MS);
  });
  it("applies +/-20% jitter", () => {
    expect(nextDelay(0, () => 0)).toBe(1600);
    expect(nextDelay(0, () => 0.999999)).toBe(2400);
    expect(nextDelay(10, () => 0)).toBe(240_000);
  });
  it("rejects invalid attempts", () => {
    expect(() => nextDelay(-1)).toThrow(RangeError);
    expect(() => nextDelay(1.5)).toThrow(RangeError);
  });
});
