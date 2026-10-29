import { describe, expect, it } from "vitest";
import { dayRange, istRangeBoundsUtc, monthRange, weekRange } from "../src/lib/reportPeriod";
import { parseReportParams, REPORT_FORMATS } from "../src/lib/reports/params";
import type { ParseReportParamsResult } from "../src/lib/reports/params";

// Synthetic request values for tests only.
const valid = { type: "weekly", facility: "fac-test-1", date: "2026-10-31", format: "pdf" };

function ok(input: unknown) {
  const r = parseReportParams(input);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.issues)}`);
  return r.value;
}

function issues(input: unknown) {
  const r = parseReportParams(input);
  if (r.ok) throw new Error("expected issues, got ok");
  return r.issues;
}

const fields = (input: unknown) => issues(input).map((i) => i.field);

describe("T-CON-08-U1 report period from a valid request", () => {
  it("derives a daily period and its IST bounds in UTC", () => {
    const v = ok({ ...valid, type: "daily", date: "2026-10-25" });
    expect(v.period).toEqual({ start: "2026-10-25", end: "2026-10-25" });
    expect(v.bounds).toEqual({ from: "2026-10-24T18:30:00.000Z", to: "2026-10-25T18:30:00.000Z" });
  });
  it("derives the Monday to Sunday week containing the date", () => {
    const v = ok({ ...valid, type: "weekly", date: "2026-10-31" }); // a Saturday, week crosses a month
    expect(v.period).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(v.bounds).toEqual({ from: "2026-10-25T18:30:00.000Z", to: "2026-11-01T18:30:00.000Z" });
  });
  it("derives the whole month containing the date, including a leap February", () => {
    const v = ok({ ...valid, type: "monthly", date: "2024-02-10" });
    expect(v.period).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(v.bounds).toEqual({ from: "2024-01-31T18:30:00.000Z", to: "2024-02-29T18:30:00.000Z" });
    expect(ok({ ...valid, type: "monthly", date: "2023-02-28" }).period.end).toBe("2023-02-28");
  });
  it("handles a week that crosses a year", () => {
    expect(ok({ ...valid, type: "weekly", date: "2026-12-31" }).period).toEqual({
      start: "2026-12-28",
      end: "2027-01-03",
    });
  });
  it("gives exactly what the existing period helpers give (no separate date logic)", () => {
    const helpers = { daily: dayRange, weekly: weekRange, monthly: monthRange } as const;
    for (const type of ["daily", "weekly", "monthly"] as const) {
      for (const date of ["2024-02-29", "2026-01-01", "2026-12-31", "2100-03-01", "2000-02-29"]) {
        const v = ok({ ...valid, type, date });
        expect(v.period).toEqual(helpers[type](date));
        expect(v.bounds).toEqual(istRangeBoundsUtc(helpers[type](date)));
      }
    }
  });
  it("returns the request values unchanged and nothing extra", () => {
    const v = ok({ ...valid, format: "xlsx", extra: "ignored", another: 1 });
    expect(Object.keys(v).sort()).toEqual(
      ["bounds", "date", "facility", "format", "period", "type"].sort(),
    );
    expect(v.type).toBe("weekly");
    expect(v.format).toBe("xlsx");
    expect(v.facility).toBe("fac-test-1");
    expect(v.date).toBe("2026-10-31");
  });
  it("accepts every supported format", () => {
    for (const format of REPORT_FORMATS) expect(ok({ ...valid, format }).format).toBe(format);
    expect([...REPORT_FORMATS]).toEqual(["pdf", "xlsx"]);
  });
  it("accepts an object without a prototype", () => {
    expect(ok(Object.assign(Object.create(null), valid)).type).toBe("weekly");
  });
});

describe("report type and format are matched exactly", () => {
  it("rejects an unknown, differently-cased, blank or non-text type", () => {
    for (const type of [
      "yearly",
      "Daily",
      "DAILY",
      " daily",
      "daily ",
      "",
      "day",
      undefined,
      null,
      1,
      true,
      ["daily"],
      {},
    ]) {
      expect(fields({ ...valid, type }), String(type)).toEqual(["type"]);
    }
  });
  it("rejects an unknown, differently-cased, blank or non-text format", () => {
    for (const format of [
      "PDF",
      "Xlsx",
      "csv",
      "xls",
      ".pdf",
      "",
      " pdf",
      undefined,
      null,
      0,
      false,
      ["pdf"],
      {},
    ]) {
      expect(fields({ ...valid, format }), String(format)).toEqual(["format"]);
    }
  });
  it("does not treat inherited object keys as valid", () => {
    expect(fields({ ...valid, type: "constructor" })).toEqual(["type"]);
    expect(fields({ ...valid, format: "__proto__" })).toEqual(["format"]);
    expect(fields({ ...valid, type: "toString" })).toEqual(["type"]);
  });
});

describe("facility identifier", () => {
  it("accepts any non-blank text and returns it as given", () => {
    for (const facility of [
      "a",
      "fac-1",
      "0192f0a0-0000-7000-8000-000000000001",
      "Mall / Level 2",
      "x".repeat(300),
    ]) {
      expect(ok({ ...valid, facility }).facility).toBe(facility);
    }
  });
  it("rejects blank, whitespace-only, missing and non-text values", () => {
    for (const facility of [
      "",
      " ",
      "   ",
      "\t",
      "\n",
      " \t\n ",
      undefined,
      null,
      0,
      123,
      true,
      [],
      ["a"],
      {},
    ]) {
      expect(fields({ ...valid, facility }), JSON.stringify(facility)).toEqual(["facility"]);
    }
  });
});

describe("dates: malformed and impossible", () => {
  const fieldsFor = (date: unknown, type: string = "weekly") => fields({ ...valid, type, date });
  it("rejects malformed text", () => {
    for (const date of [
      "",
      " ",
      "2026-1-5",
      "2026-10-5",
      "26-10-25",
      "25-10-2026",
      "25/10/2026",
      "2026/10/25",
      "20261025",
      "2026-10-25 ",
      " 2026-10-25",
      "2026-10-25T00:00:00Z",
      "2026-10-25T00:00:00+05:30",
      "2026-10",
      "2026",
      "yesterday",
      "2026-10-25\n",
      "２０２６-10-25",
      "+2026-10-25",
      "-2026-10-25",
    ]) {
      expect(fieldsFor(date), JSON.stringify(date)).toEqual(["date"]);
    }
  });
  it("rejects impossible calendar dates", () => {
    for (const date of [
      "2026-00-10",
      "2026-13-01",
      "2026-10-00",
      "2026-10-32",
      "2026-04-31",
      "2026-02-29", // 2026 is not a leap year
      "2026-02-30",
      "2100-02-29", // century year that is not a leap year
      "0000-01-01",
    ]) {
      for (const type of ["daily", "weekly", "monthly"]) {
        expect(fieldsFor(date, type), `${type} ${date}`).toEqual(["date"]);
      }
    }
  });
  it("accepts real leap days, including the century rule", () => {
    for (const date of ["2024-02-29", "2000-02-29", "2028-02-29"]) {
      expect(ok({ ...valid, date }).date).toBe(date);
    }
  });
  it("rejects a missing or non-text date", () => {
    for (const date of [
      undefined,
      null,
      20261025,
      true,
      new Date("2026-10-25"),
      ["2026-10-25"],
      {},
      Symbol("d"),
    ]) {
      expect(fieldsFor(date), String(date)).toEqual(["date"]);
    }
    expect(fields({ type: "daily", facility: "f", format: "pdf" })).toEqual(["date"]);
  });
  it("reports a date at the edge of the supported range as invalid instead of throwing", () => {
    // The period helpers cannot form the day after 9999-12-31, so the request is refused, not crashed.
    expect(() => parseReportParams({ ...valid, type: "daily", date: "9999-12-31" })).not.toThrow();
    expect(fields({ ...valid, type: "daily", date: "9999-12-31" })).toEqual(["date"]);
    expect(ok({ ...valid, type: "daily", date: "9999-12-30" }).period.end).toBe("9999-12-30");
  });
});

describe("several problems and unusable input", () => {
  it("reports every bad field at once, in a fixed order", () => {
    expect(fields({ type: "yearly", facility: " ", date: "2026-02-30", format: "csv" })).toEqual([
      "type",
      "facility",
      "date",
      "format",
    ]);
  });
  it("still checks the date when the type is unusable", () => {
    expect(fields({ ...valid, type: "yearly", date: "2026-02-30" })).toEqual(["type", "date"]);
    expect(fields({ ...valid, type: "yearly", date: "2026-10-25" })).toEqual(["type"]);
  });
  it("rejects input that is not an object, without throwing", () => {
    for (const input of [undefined, null, "weekly", 5, true, [], [valid], () => valid]) {
      const r = parseReportParams(input);
      expect(r.ok, String(input)).toBe(false);
      expect(r.ok === false && r.issues).toEqual([
        { field: "input", message: "The request must be an object." },
      ]);
    }
  });
  it("rejects an empty object with all four fields", () => {
    expect(fields({})).toEqual(["type", "facility", "date", "format"]);
  });
  it("never repeats the submitted text in an error message", () => {
    const probe = "<script>alert(1)</script>";
    const all = issues({ type: probe, facility: "", date: probe, format: probe });
    expect(all.length).toBe(4);
    for (const issue of all) expect(issue.message).not.toContain("script");
  });
  it("never throws, whatever it is given", () => {
    const hostile = {
      get type(): string {
        return "daily";
      },
      facility: {
        toString: () => {
          throw new Error("boom");
        },
      },
      date: {
        toString: () => {
          throw new Error("boom");
        },
      },
      format: {
        valueOf: () => {
          throw new Error("boom");
        },
      },
    };
    let result: ParseReportParamsResult | undefined;
    expect(() => {
      result = parseReportParams(hostile);
    }).not.toThrow();
    expect(result?.ok).toBe(false);
  });
  it("is deterministic and does not modify its input", () => {
    const input = { ...valid };
    const copy = JSON.stringify(input);
    expect(parseReportParams(input)).toEqual(parseReportParams(input));
    expect(JSON.stringify(input)).toBe(copy);
  });
});
