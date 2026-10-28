import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, isSupported } from "../src/index";

describe("version (T-SYNC-01-R1)", () => {
  it("isSupported(client, min)", () => {
    expect(isSupported(1, 2)).toBe(false);
    expect(isSupported(2, 2)).toBe(true);
    expect(isSupported(3, 2)).toBe(true);
  });
  it("rejects non-integer versions", () => {
    expect(isSupported(1.5, 1)).toBe(false);
  });
  it("starts at 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});
