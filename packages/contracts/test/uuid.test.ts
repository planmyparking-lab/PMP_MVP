import { describe, expect, it } from "vitest";
import { createIdGenerator, isUuidV7, newId } from "../src/index";

describe("UUIDv7 (T-SYNC-01-U7)", () => {
  it("generates valid v7 ids", () => {
    for (let i = 0; i < 1000; i++) expect(isUuidV7(newId())).toBe(true);
  });

  it("generation order equals lexical order, including within one millisecond", () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(1000);
  });

  it("stays ordered with a frozen clock and survives counter overflow", () => {
    const gen = createIdGenerator({ now: () => 1_700_000_000_000 });
    const ids = Array.from({ length: 5000 }, () => gen());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(5000);
  });

  it("stays ordered if the clock steps backwards", () => {
    let t = 1_700_000_000_000;
    const gen = createIdGenerator({ now: () => t });
    const a = gen();
    t -= 5000;
    const b = gen();
    expect(b > a).toBe(true);
  });

  it("encodes the timestamp in the first 48 bits", () => {
    const ms = 1_700_000_123_456;
    const id = createIdGenerator({ now: () => ms })();
    const hex = id.replace(/-/g, "").slice(0, 12);
    expect(parseInt(hex, 16)).toBe(ms);
  });

  it("fails loudly without a secure random source", () => {
    const gen = createIdGenerator({
      random: () => {
        throw new Error("no random");
      },
    });
    expect(() => gen()).toThrow();
  });

  it("isUuidV7 rejects other versions and junk", () => {
    expect(isUuidV7("5f1d2c3e-0000-4000-8000-000000000001")).toBe(false);
    expect(isUuidV7("not-a-uuid")).toBe(false);
    expect(isUuidV7(42)).toBe(false);
  });
});
