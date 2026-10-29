import { describe, expect, it } from "vitest";
import { formatRupees } from "@pmp/contracts";
import {
  dayRange,
  istDayStartUtc,
  istRangeBoundsUtc,
  monthRange,
  weekRange,
} from "../src/lib/reportPeriod";

describe("T-CON-08-U1 / T-CLD-06-U1 report periods", () => {
  it("handles month length in leap and non-leap years", () => {
    expect(monthRange("2024-02-10")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(monthRange("2023-02-28")).toEqual({ start: "2023-02-01", end: "2023-02-28" });
    expect(monthRange("2026-12-31")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
  it("starts weeks on Monday, including across a month and a year", () => {
    expect(weekRange("2026-10-26")).toEqual({ start: "2026-10-26", end: "2026-11-01" }); // Monday
    expect(weekRange("2026-10-31")).toEqual({ start: "2026-10-26", end: "2026-11-01" }); // crosses month
    expect(weekRange("2026-11-01")).toEqual({ start: "2026-10-26", end: "2026-11-01" }); // Sunday
    expect(weekRange("2026-12-31")).toEqual({ start: "2026-12-28", end: "2027-01-03" }); // crosses year
  });
  it("returns a single day for a daily report", () => {
    expect(dayRange("2026-10-25")).toEqual({ start: "2026-10-25", end: "2026-10-25" });
  });
  it("rejects malformed and impossible dates", () => {
    expect(() => weekRange("2026-13-01")).toThrow(RangeError);
    expect(() => monthRange("2023-02-29")).toThrow(RangeError);
    expect(() => dayRange("25/10/2026")).toThrow(RangeError);
  });
  it("applies the century leap-year rule (same cases as the audit-hour date check)", () => {
    expect(monthRange("2000-02-10")).toEqual({ start: "2000-02-01", end: "2000-02-29" });
    expect(() => dayRange("2100-02-29")).toThrow(RangeError);
    expect(dayRange("2024-02-29")).toEqual({ start: "2024-02-29", end: "2024-02-29" });
    expect(() => dayRange("2026-02-29")).toThrow(RangeError);
  });
  it("rejects the same malformed strings as the audit-hour date check", () => {
    for (const bad of [
      "",
      "2026-1-5",
      "26-11-02",
      "2026/11/02",
      " 2026-11-02",
      "2026-11-02 ",
      "2026-11-02T00:00:00Z",
      "2026-13-01",
      "2026-00-10",
      "2026-11-31",
      "2026-02-30",
    ]) {
      expect(() => dayRange(bad), JSON.stringify(bad)).toThrow(RangeError);
    }
  });
  it("converts IST day boundaries to UTC instants", () => {
    expect(istDayStartUtc("2026-10-26")).toBe("2026-10-25T18:30:00.000Z");
    expect(istRangeBoundsUtc({ start: "2026-02-28", end: "2026-02-28" })).toEqual({
      from: "2026-02-27T18:30:00.000Z",
      to: "2026-02-28T18:30:00.000Z",
    });
    expect(() => istRangeBoundsUtc({ start: "2026-02-02", end: "2026-02-01" })).toThrow(RangeError);
  });
});

describe("T-CON-05-U2 paise to rupees (shared formatter from @pmp/contracts)", () => {
  it("formats 0, 1, 99, 100 and 123456 paise", () => {
    expect(formatRupees(0)).toBe("₹0.00");
    expect(formatRupees(1)).toBe("₹0.01");
    expect(formatRupees(99)).toBe("₹0.99");
    expect(formatRupees(100)).toBe("₹1.00");
    expect(formatRupees(123456)).toBe("₹1,234.56");
  });
});
