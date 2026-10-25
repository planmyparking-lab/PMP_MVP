import { describe, expect, it } from "vitest";
import { validateReportData } from "../src/lib/reports/model";
import type { ReportData } from "../src/lib/reports/model";

// Synthetic fixtures for tests only. Nothing here is report data and nothing in the app builds from it.
const good = (): ReportData => ({
  type: "weekly",
  facilityName: "Test Facility One",
  period: { start: "2026-10-26", end: "2026-11-01" },
  generatedAt: "2026-10-25T09:05:00Z",
  sections: {
    utilisationByZone: { columns: ["Zone", "Capacity"], rows: [["Zone A", 120]] },
    revenueByMode: { cash: 123456, upiDeclared: 50000, pass: 0 },
    overridesByReason: [{ reasonCode: "LOST_TOKEN", count: 3 }],
    shiftVariances: { columns: ["Shift", "Variance"], rows: [["Morning", { paise: 2500 }]] },
  },
});

/** A copy of the good data with one change applied, typed loosely so bad shapes can be built. */
const bad = (change: (d: Record<string, unknown>) => void): unknown => {
  const d = JSON.parse(JSON.stringify(good())) as Record<string, unknown>;
  change(d);
  return d;
};
const sections = (d: Record<string, unknown>) => d.sections as Record<string, unknown>;
const withSection = (key: string, value: unknown) =>
  bad((d) => {
    sections(d)[key] = value;
  });

function expectRange(data: unknown, message?: RegExp) {
  const attempt = () => validateReportData(data);
  expect(attempt, JSON.stringify(data)).toThrow(RangeError);
  if (message) expect(attempt, JSON.stringify(data)).toThrow(message);
}

describe("T-CON-08 report data shape is checked before it is read", () => {
  it("accepts valid data, including empty sections", () => {
    expect(() => validateReportData(good())).not.toThrow();
    expect(() => validateReportData({ ...good(), sections: {} })).not.toThrow();
  });
  it("treats an undefined section as missing", () => {
    const data = good();
    data.sections.conflicts = undefined;
    expect(() => validateReportData(data)).not.toThrow();
  });
  it("rejects data that is not an object (null, text, numbers, arrays)", () => {
    for (const data of [null, undefined, "report", 5, true, [], [good()]]) {
      expectRange(data, /report data must be an object/);
    }
  });
  it("rejects missing or malformed sections", () => {
    expectRange(
      bad((d) => delete d.sections),
      /sections must be an object/,
    );
    for (const value of [null, [], "none", 5, true]) {
      expectRange(
        bad((d) => (d.sections = value)),
        /sections must be an object/,
      );
    }
  });
  it("rejects a missing or malformed period", () => {
    expectRange(
      bad((d) => delete d.period),
      /period must be an object/,
    );
    for (const value of [null, "2026-10-25", 5, []]) {
      expectRange(
        bad((d) => (d.period = value)),
        /period must be an object/,
      );
    }
    expectRange(
      bad((d) => (d.period = { start: "2026-10-25" })),
      /period\.end/,
    );
    expectRange(
      bad((d) => (d.period = { end: "2026-10-25" })),
      /period\.start/,
    );
    expectRange(
      bad((d) => (d.period = { start: 20261025, end: "2026-10-25" })),
      /period\.start/,
    );
    expectRange(
      bad((d) => (d.period = { start: "2026-10-25", end: "25/10/2026" })),
      /period\.end/,
    );
  });
  it("rejects impossible calendar dates in the period, reusing the period helper's rules", () => {
    expectRange(
      bad((d) => (d.period = { start: "2026-02-30", end: "2026-03-01" })),
      /period\.start/,
    );
    expectRange(
      bad((d) => (d.period = { start: "2026-03-01", end: "2100-02-29" })),
      /period\.end/,
    );
    expect(() =>
      validateReportData({ ...good(), period: { start: "2024-02-29", end: "2024-02-29" } }),
    ).not.toThrow();
  });
  it("rejects a period that ends before it starts", () => {
    expectRange(
      bad((d) => (d.period = { start: "2026-11-02", end: "2026-11-01" })),
      /must not be after/,
    );
  });
  it("rejects a missing or invalid generatedAt", () => {
    expectRange(
      bad((d) => delete d.generatedAt),
      /generatedAt/,
    );
    for (const value of [
      null,
      5,
      true,
      {},
      "",
      "nope",
      "2026-10-25",
      "2026-10-25T09:05:00",
      "2026-13-40T99:99:00Z",
    ]) {
      expectRange(
        bad((d) => (d.generatedAt = value)),
        /generatedAt/,
      );
    }
  });
  it("rejects a bad type or facility name", () => {
    for (const value of [undefined, null, 5, "yearly", "Daily", {}]) {
      expectRange(
        bad((d) => (d.type = value)),
        /type must be one of daily, weekly, monthly/,
      );
    }
    for (const value of [undefined, null, 5, "", "  ", {}]) {
      expectRange(
        bad((d) => (d.facilityName = value)),
        /facilityName/,
      );
    }
  });
  it("rejects malformed tables in every table section", () => {
    const names = [
      "utilisationByZone",
      "peakHourHeatmap",
      "stayDistribution",
      "shiftVariances",
      "conflicts",
    ];
    const tables: unknown[] = [
      null,
      "table",
      5,
      [],
      {},
      { columns: "A", rows: [] },
      { columns: [], rows: [] },
      { columns: [5], rows: [] },
      { columns: [{}], rows: [] },
      { columns: ["A"] },
      { columns: ["A"], rows: null },
      { columns: ["A"], rows: "x" },
      { columns: ["A"], rows: {} },
      { columns: ["A"], rows: [null] },
      { columns: ["A"], rows: ["x"] },
      { columns: ["A"], rows: [["a", "b"]] },
      { columns: ["A", "B"], rows: [["a"]] },
    ];
    for (const name of names) {
      for (const table of tables) {
        expectRange(withSection(name, table), new RegExp(`sections\\.${name}`));
      }
    }
  });
  it("rejects malformed revenue sections", () => {
    const revenues: unknown[] = [
      null,
      "x",
      5,
      [],
      {},
      { cash: 1, upiDeclared: 2 },
      { cash: 1.5, upiDeclared: 0, pass: 0 },
      { cash: -1, upiDeclared: 0, pass: 0 },
      { cash: "1", upiDeclared: 0, pass: 0 },
    ];
    for (const value of revenues)
      expectRange(withSection("revenueByMode", value), /sections\.revenueByMode/);
  });
  it("rejects malformed override sections", () => {
    const overrides: unknown[] = [
      null,
      "x",
      5,
      {},
      [null],
      ["LOST_TOKEN"],
      [{ reasonCode: "NOPE", count: 1 }],
      [{ reasonCode: "LOST_TOKEN" }],
      [{ reasonCode: "LOST_TOKEN", count: -1 }],
      [{ reasonCode: "LOST_TOKEN", count: 1.5 }],
      [{ reasonCode: 5, count: 1 }],
    ];
    for (const value of overrides) {
      expectRange(withSection("overridesByReason", value), /sections\.overridesByReason/);
    }
  });
  it("never repeats the offending value in a message", () => {
    const secret = "SECRET-VALUE-123";
    const cases = [
      bad((d) => (d.type = secret)),
      bad((d) => (d.generatedAt = secret)),
      bad((d) => (d.period = { start: secret, end: secret })),
      withSection("conflicts", { columns: [secret], rows: [[{ x: secret }]] }),
      withSection("conflicts", { columns: ["A"], rows: [[secret.length + 0.5]] }),
    ];
    for (const data of cases) {
      expect(() => validateReportData(data)).toThrow(RangeError);
      expect(() => validateReportData(data)).not.toThrow(new RegExp(secret));
    }
  });
});

describe("T-CON-08 plain number cells must be whole numbers", () => {
  const withCell = (cell: unknown) =>
    withSection("conflicts", { columns: ["Count"], rows: [[cell]] });
  it("rejects decimals, NaN, infinities and unsafe integers instead of rounding them", () => {
    for (const cell of [
      0.5,
      0.123456,
      1234.5678,
      -2.5,
      Number.NaN,
      Infinity,
      -Infinity,
      1e21,
      2 ** 53,
    ]) {
      expectRange(
        withCell(cell),
        /must be a whole number; give decimals as text and money as \{ paise \}/,
      );
    }
  });
  it("names the cell that is wrong", () => {
    const data = withSection("conflicts", {
      columns: ["A", "B"],
      rows: [
        ["ok", 1],
        ["ok", 2.5],
      ],
    });
    expectRange(data, /sections\.conflicts\.rows\[1\]\[1\]/);
  });
  it("accepts whole numbers (zero, negative, large), text and { paise }", () => {
    for (const cell of [
      0,
      7,
      -3,
      1234567,
      Number.MAX_SAFE_INTEGER,
      "0.123456",
      "12.5%",
      "",
      { paise: 0 },
      { paise: 5 },
    ]) {
      expect(() => validateReportData(withCell(cell)), JSON.stringify(cell)).not.toThrow();
    }
  });
  it("still rejects bad paise and other cell types", () => {
    for (const cell of [
      { paise: 1.5 },
      { paise: -1 },
      { paise: "5" },
      {},
      null,
      undefined,
      true,
      [1],
    ]) {
      expectRange(withCell(cell), /sections\.conflicts\.rows\[0\]\[0\]/);
    }
  });
});
