import { describe, expect, it } from "vitest";
import { formatIstDate, formatIstDateTime, formatIstPeriod } from "../src/lib/format";

describe("T-CON-08 IST date formatting", () => {
  it("formats a civil date", () => {
    expect(formatIstDate("2026-10-25")).toBe("25 Oct 2026");
    expect(formatIstDate("2024-02-29")).toBe("29 Feb 2024");
    expect(formatIstDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatIstDate("2026-12-31")).toBe("31 Dec 2026");
  });
  it("rejects a malformed date or month", () => {
    for (const bad of [
      "",
      "2026-1-5",
      "2026/10/25",
      "25-10-2026",
      "2026-13-01",
      "2026-00-10",
      " 2026-10-25",
    ]) {
      expect(() => formatIstDate(bad), JSON.stringify(bad)).toThrow(RangeError);
    }
  });
  it("formats a one-day and a many-day period", () => {
    expect(formatIstPeriod("2026-10-25", "2026-10-25")).toBe("25 Oct 2026");
    expect(formatIstPeriod("2026-10-26", "2026-11-01")).toBe("26 Oct 2026 to 1 Nov 2026");
    expect(formatIstPeriod("2026-12-28", "2027-01-03")).toBe("28 Dec 2026 to 3 Jan 2027");
  });
  it("rejects a period that ends before it starts", () => {
    expect(() => formatIstPeriod("2026-11-02", "2026-11-01")).toThrow(RangeError);
  });
});

describe("T-CON-08 IST time formatting", () => {
  it("converts a UTC instant to IST on a 24-hour clock", () => {
    expect(formatIstDateTime("2026-10-25T09:05:00Z")).toBe("25 Oct 2026, 14:35 IST");
    expect(formatIstDateTime("2026-10-25T09:05Z")).toBe("25 Oct 2026, 14:35 IST");
    expect(formatIstDateTime("2026-10-25T09:05:00.123Z")).toBe("25 Oct 2026, 14:35 IST");
  });
  it("rolls the date over when IST is already the next day", () => {
    expect(formatIstDateTime("2026-10-25T20:00:00Z")).toBe("26 Oct 2026, 01:30 IST");
    expect(formatIstDateTime("2026-12-31T18:30:00Z")).toBe("1 Jan 2027, 00:00 IST");
    expect(formatIstDateTime("2026-10-25T18:29:00Z")).toBe("25 Oct 2026, 23:59 IST");
  });
  it("understands an explicit offset", () => {
    expect(formatIstDateTime("2026-10-25T14:35:00+05:30")).toBe("25 Oct 2026, 14:35 IST");
    expect(formatIstDateTime("2026-10-25T10:00:00-04:00")).toBe("25 Oct 2026, 19:30 IST");
  });
  it("rejects text without an explicit zone, and garbage", () => {
    for (const bad of [
      "2026-10-25T09:05:00",
      "2026-10-25",
      "yesterday",
      "",
      "2026-13-40T99:99:00Z",
    ]) {
      expect(() => formatIstDateTime(bad), JSON.stringify(bad)).toThrow(RangeError);
    }
  });
});
