import { describe, expect, it } from "vitest";
import { add, formatRupees, isPaise, signedDiff, sub, toPaise } from "../src/index";

describe("money helpers (T-SYNC-01-U5, U6)", () => {
  it.each([
    ["10.50", 1050],
    ["10.5", 1050],
    ["10", 1000],
    ["0", 0],
    ["0.05", 5],
  ])("toPaise(%j) = %i", (input, expected) => {
    expect(toPaise(input)).toBe(expected);
  });

  it.each(["abc", "-1", "1.234", "", " 5", "1e3", "+5", "1,000", ".5", "5."])(
    "toPaise rejects %j",
    (input) => {
      expect(() => toPaise(input)).toThrow();
    },
  );

  it("rejects numbers, even whole ones (no floating point enters)", () => {
    expect(() => toPaise(12.5 as unknown as string)).toThrow(TypeError);
    expect(() => toPaise(12 as unknown as string)).toThrow(TypeError);
  });

  it("rejects amounts beyond safe integers", () => {
    expect(() => toPaise("99999999999999999999")).toThrow();
  });

  it("0.1 + 0.2 rupees is exactly 30 paise", () => {
    expect(add(toPaise("0.1"), toPaise("0.2"))).toBe(30);
  });

  it("add, sub and signedDiff", () => {
    expect(add(100, 250)).toBe(350);
    expect(sub(250, 100)).toBe(150);
    expect(() => sub(100, 250)).toThrow();
    expect(signedDiff(100, 250)).toBe(-150);
    expect(signedDiff(250, 100)).toBe(150);
  });

  it("helpers reject non-integer or negative paise", () => {
    expect(() => add(1.5, 1)).toThrow();
    expect(() => add(-1, 1)).toThrow();
    expect(() => signedDiff(1, Number.NaN)).toThrow();
    expect(isPaise(0)).toBe(true);
    expect(isPaise(1.5)).toBe(false);
    expect(isPaise(-1)).toBe(false);
  });

  it("formats paise with Indian grouping", () => {
    expect(formatRupees(123456)).toBe("₹1,234.56");
    expect(formatRupees(5)).toBe("₹0.05");
    expect(() => formatRupees(1.5)).toThrow();
  });
});
