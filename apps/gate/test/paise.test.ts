import { describe, expect, it } from "vitest";

import { formatPaise, humanizeAgeMs, parseRupeeInput } from "../src/domain/paise";

/**
 * Money/display primitives (repo invariant: paise are safe integers; typed rupee strings parse
 * to exact paise — "12.345" is more precision than paise and must not be rounded silently).
 */

describe("formatPaise", () => {
  it("renders whole rupees and exact paise", () => {
    expect(formatPaise(5230)).toBe("₹52.30");
    expect(formatPaise(5)).toBe("₹0.05");
    expect(formatPaise(0)).toBe("₹0.00");
    expect(formatPaise(-520)).toBe("-₹5.20");
  });

  it("refuses non-integer paise (straight throw; never rounds money)", () => {
    expect(() => formatPaise(10.5)).toThrow(/paise must be an integer/);
  });
});

describe("parseRupeeInput", () => {
  it("parses the accepted typed forms to exact paise", () => {
    expect(parseRupeeInput("52")).toBe(5200);
    expect(parseRupeeInput(" 52.3 ")).toBe(5230);
    expect(parseRupeeInput("52.35")).toBe(5235);
    expect(parseRupeeInput("0.05")).toBe(5);
    expect(parseRupeeInput("0")).toBe(0);
  });

  it("rejects anything that is not a whole-paise amount", () => {
    expect(parseRupeeInput("")).toBeNull();
    expect(parseRupeeInput("12.345")).toBeNull();
    expect(parseRupeeInput("-5")).toBeNull();
    expect(parseRupeeInput("1e2")).toBeNull();
    expect(parseRupeeInput("12,50")).toBeNull();
    expect(parseRupeeInput("99999999999999999999")).toBeNull();
  });
});

describe("humanizeAgeMs (status screen ages)", () => {
  it("uses seconds, minutes, hours+minutes, days+hours", () => {
    expect(humanizeAgeMs(0)).toBe("0s");
    expect(humanizeAgeMs(-50)).toBe("0s");
    expect(humanizeAgeMs(45_000)).toBe("45s");
    expect(humanizeAgeMs(60_000)).toBe("1m");
    expect(humanizeAgeMs(5 * 60_000)).toBe("5m");
    expect(humanizeAgeMs(90 * 60_000)).toBe("1h 30m");
    expect(humanizeAgeMs(26 * 60 * 60_000)).toBe("1d 2h");
  });
});
