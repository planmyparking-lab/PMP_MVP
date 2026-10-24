import { describe, expect, it } from "vitest";
import { isSyncBlocked } from "../src/syncGate";

describe("version gate", () => {
  it("does not block when the app meets the minimum", () => {
    expect(isSyncBlocked(1, 1)).toBe(false);
    expect(isSyncBlocked(1, 2)).toBe(false);
  });
  it("blocks sync when the app is below the minimum", () => {
    expect(isSyncBlocked(2, 1)).toBe(true);
  });
});
