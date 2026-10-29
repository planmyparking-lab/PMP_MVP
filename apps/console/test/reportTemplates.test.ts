import { REASON_CODES } from "@pmp/contracts";
import { describe, expect, it } from "vitest";
import { NO_DATA_MESSAGE } from "../src/lib/reports/model";
import type { ReportData } from "../src/lib/reports/model";
import { parseReportParams } from "../src/lib/reports/params";
import { assertNoVehicleNumbers, findVehicleNumberLike } from "../src/lib/reports/privacy";
import { renderReportHtml } from "../src/reports/render";

// Synthetic fixtures for tests only. Nothing here is report data and nothing in the app builds from it.
const base = (over: Partial<ReportData> = {}): ReportData => ({
  type: "weekly",
  facilityName: "Test Facility One",
  period: { start: "2026-10-26", end: "2026-11-01" },
  generatedAt: "2026-10-25T09:05:00Z",
  sections: {},
  ...over,
});

const full = (): ReportData =>
  base({
    sections: {
      utilisationByZone: { columns: ["Zone", "Capacity"], rows: [["Zone A", 120]] },
      revenueByMode: { cash: 123456, upiDeclared: 50000, pass: 0 },
      peakHourHeatmap: { columns: ["Hour", "Entries"], rows: [["10:00", 42]] },
      stayDistribution: { columns: ["Stay", "Vehicles"], rows: [["Under 1 hour", 1234567]] },
      overridesByReason: [
        { reasonCode: "LOST_TOKEN", count: 3 },
        { reasonCode: "OWNER_WAIVER", count: 1 },
      ],
      shiftVariances: { columns: ["Shift", "Variance"], rows: [["Morning", { paise: 2500 }]] },
      conflicts: { columns: ["Type", "Open"], rows: [["DUPLICATE_EXIT", 2]] },
    },
  });

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("T-CON-08 rendered HTML: identity and time", () => {
  const html = renderReportHtml(base());
  it("is a complete HTML page", () => {
    expect(html.startsWith('<!doctype html><html lang="en">')).toBe(true);
    expect(html).toMatch(/<meta charset="utf-8"\s*\/?>/i);
    expect(html.endsWith("</html>")).toBe(true);
  });
  it("shows the facility name in the header, body and footer", () => {
    expect(count(html, "Test Facility One")).toBeGreaterThanOrEqual(4); // title, header, body, footer
    expect(html).toContain('<header class="running-header">');
    expect(html).toContain('<footer class="running-footer">');
  });
  it("shows the generation time in IST in the body and the footer", () => {
    expect(count(html, "25 Oct 2026, 14:35 IST")).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("09:05");
  });
  it("shows the period as IST dates", () => {
    expect(html).toContain("26 Oct 2026 to 1 Nov 2026 (IST)");
    expect(html).not.toContain("2026-10-26");
  });
  it("shows a single day without a range", () => {
    const daily = renderReportHtml(
      base({ type: "daily", period: { start: "2026-10-25", end: "2026-10-25" } }),
    );
    expect(daily).toContain("Period: 25 Oct 2026 (IST)");
    expect(daily).not.toContain(" to 25 Oct 2026");
  });
  it("rolls generation time over to the next IST day", () => {
    expect(renderReportHtml(base({ generatedAt: "2026-10-25T20:00:00Z" }))).toContain(
      "26 Oct 2026, 01:30 IST",
    );
  });
});

describe("T-CON-08 templates", () => {
  it("uses the daily, weekly and monthly titles", () => {
    expect(
      renderReportHtml(base({ type: "daily", period: { start: "2026-10-25", end: "2026-10-25" } })),
    ).toContain("<h1>Daily report</h1>");
    expect(renderReportHtml(base({ type: "weekly" }))).toContain("<h1>Weekly report</h1>");
    expect(
      renderReportHtml(
        base({ type: "monthly", period: { start: "2026-10-01", end: "2026-10-31" } }),
      ),
    ).toContain("<h1>Monthly report</h1>");
  });
  it("renders every section in a fixed order", () => {
    const html = renderReportHtml(full());
    const titles = [
      "Utilisation by zone",
      "Revenue declared by mode",
      "Peak-hour heatmap",
      "Average stay distribution",
      "Overrides by reason",
      "Shift variances",
      "Conflicts",
    ];
    const positions = titles.map((t) => html.indexOf(`<h2>${t}</h2>`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
  it("is deterministic", () => {
    expect(renderReportHtml(full())).toBe(renderReportHtml(full()));
  });
});

describe("T-CON-08-N3 missing sections say so explicitly", () => {
  it("shows the no-data message in all seven sections when nothing is supplied", () => {
    const html = renderReportHtml(base());
    expect(NO_DATA_MESSAGE).toBe("No data for this period.");
    expect(count(html, NO_DATA_MESSAGE)).toBe(7);
  });
  it("shows it only for the missing sections", () => {
    const html = renderReportHtml(full());
    expect(count(html, NO_DATA_MESSAGE)).toBe(0);
    const partial = base({ sections: { revenueByMode: { cash: 100, upiDeclared: 0, pass: 0 } } });
    expect(count(renderReportHtml(partial), NO_DATA_MESSAGE)).toBe(6);
  });
  it("treats empty tables and an empty override list as no data", () => {
    const html = renderReportHtml(
      base({
        sections: {
          utilisationByZone: { columns: ["Zone"], rows: [] },
          overridesByReason: [],
        },
      }),
    );
    expect(count(html, NO_DATA_MESSAGE)).toBe(7);
  });
});

describe("T-CON-08 money and wording", () => {
  const html = renderReportHtml(full());
  it("labels UPI as declared and explains why", () => {
    expect(html).toContain("UPI declared (attested by the guard)");
    expect(html).toContain("UPI amounts are declared by the guard");
    expect(html).not.toMatch(/UPI (collected|verified|confirmed)/i);
  });
  it("shows integer paise as rupees", () => {
    expect(html).toContain("₹1,234.56");
    expect(html).toContain("₹500.00");
    expect(html).toContain("₹0.00");
    expect(html).toContain("₹25.00");
  });
  it("shows plain numbers in Indian grouping and reasons in words", () => {
    expect(html).toContain("12,34,567");
    expect(html).toContain("Lost token");
    expect(html).toContain("Owner waiver");
  });
});

describe("T-CON-08 A4 print styles", () => {
  const html = renderReportHtml(base());
  it("sets an A4 page", () => {
    expect(html).toMatch(/@page\s*\{\s*size:\s*A4;/);
  });
  it("keeps rows and sections from splitting and repeats table headers", () => {
    expect(html).toContain("break-inside: avoid");
    expect(html).toContain("display: table-header-group");
  });
  it("pins the header and footer when printing", () => {
    expect(html).toMatch(/@media print\s*\{[^}]*\.running-header\s*\{[^}]*position:\s*fixed/);
    expect(html).toMatch(/\.running-footer\s*\{[^}]*position:\s*fixed/);
  });
  it("contains no script and no external resource", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(src|href)=/i);
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe("T-CON-08-I3 no vehicle numbers", () => {
  it("has no vehicle-number-like text in a full render", () => {
    const html = renderReportHtml(full());
    expect(findVehicleNumberLike(html.replace(/<style>[\s\S]*?<\/style>/, ""))).toBeNull();
  });
  it("recognises common formats", () => {
    for (const plate of [
      "MH12AB1234",
      "mh12ab1234",
      "DL 1C AB 1234",
      "KA-03-MN-4567",
      "22 BH 1234 AA",
      "TN09A1234",
    ]) {
      expect(findVehicleNumberLike(`seen ${plate} today`), plate).not.toBeNull();
    }
  });
  it("does not flag ordinary zone, level and gate names", () => {
    for (const text of [
      "Zone B2",
      "Level 3 - Row 12",
      "Basement 1",
      "Gate 2",
      "Two-wheeler bay",
      "Test Facility One",
      "10:00",
      "2026-10-26",
    ]) {
      expect(findVehicleNumberLike(text), text).toBeNull();
    }
  });
  it("does not mistake dates or ordinary words for a plate", () => {
    for (const text of [
      "26 Oct 2026 to 1 Nov 2026",
      "or 1 Nov 2026",
      "UP 12 Dec 2026",
      "as 5 May 2026",
      "Generated: 25 Oct 2026, 14:35 IST",
      "Period: 28 Dec 2026 to 3 Jan 2027",
    ]) {
      expect(findVehicleNumberLike(text), text).toBeNull();
    }
  });
  it("refuses to render data that contains one, without repeating it", () => {
    const leaks: ReportData[] = [
      base({ facilityName: "Mall MH12AB1234" }),
      base({ sections: { conflicts: { columns: ["Vehicle"], rows: [["MH12AB1234"]] } } }),
      base({ sections: { utilisationByZone: { columns: ["DL 1C AB 1234"], rows: [] } } }),
    ];
    for (const data of leaks) {
      expect(() => renderReportHtml(data)).toThrow(/looks like a vehicle number/);
      expect(() => renderReportHtml(data)).not.toThrow(/MH12AB1234/);
    }
    expect(() => assertNoVehicleNumbers(full())).not.toThrow();
  });
});

describe("T-CON-08 input is validated and escaped", () => {
  it("escapes HTML in text", () => {
    const html = renderReportHtml(base({ facilityName: "<script>alert(1)</script> Mall & Co" }));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Mall &amp; Co");
    expect(html).not.toContain("<script>alert");
  });
  it("rejects malformed data instead of rendering a partial page", () => {
    const bad: ReportData[] = [
      base({ facilityName: "   " }),
      base({ type: "yearly" as never }),
      base({ generatedAt: "2026-10-25T09:05:00" }),
      base({ period: { start: "2026-11-02", end: "2026-11-01" } }),
      base({ sections: { revenueByMode: { cash: 1.5, upiDeclared: 0, pass: 0 } } }),
      base({ sections: { revenueByMode: { cash: -1, upiDeclared: 0, pass: 0 } } }),
      base({ sections: { shiftVariances: { columns: ["A", "B"], rows: [["only one"]] } } }),
      base({ sections: { conflicts: { columns: [], rows: [] } } }),
      base({ sections: { conflicts: { columns: ["A"], rows: [[Number.NaN]] } } }),
      base({ sections: { conflicts: { columns: ["A"], rows: [[{ paise: 1.5 }]] } } }),
      base({
        sections: { overridesByReason: [{ reasonCode: "NOT_A_REASON" as never, count: 1 }] },
      }),
      base({ sections: { overridesByReason: [{ reasonCode: "LOST_TOKEN", count: -1 }] } }),
      base({ sections: { overridesByReason: [{ reasonCode: "LOST_TOKEN", count: 1.5 }] } }),
    ];
    for (const data of bad) expect(() => renderReportHtml(data)).toThrow(RangeError);
  });
  it("rejects data that is not even an object, with the same error type", () => {
    for (const data of [null, undefined, "report", [], { ...base(), sections: undefined }]) {
      expect(() => renderReportHtml(data as never)).toThrow(RangeError);
    }
  });
});

describe("T-CON-08-I3 ordinary names are not mistaken for vehicle numbers", () => {
  const names = ["PB 1 Plaza 2024", "UP 2 Mall 2026", "MH 12 Zone 2026", "AP 1 Tower 2025"];
  it("does not flag these names", () => {
    for (const name of names) expect(findVehicleNumberLike(name), name).toBeNull();
  });
  it("renders a report whose facility name, column and zone are one of these names", () => {
    for (const name of names) {
      const html = renderReportHtml(
        base({
          facilityName: name,
          sections: { utilisationByZone: { columns: [name], rows: [[name]] } },
        }),
      );
      expect(html, name).toContain(name);
    }
  });
  it("still flags real plates in the same positions", () => {
    for (const plate of [
      "MH12AB1234",
      "DL 1C AB 1234",
      "KA-03-MN-4567",
      "22 BH 1234 AA",
      "TN09A1234",
    ]) {
      expect(() => renderReportHtml(base({ facilityName: `Mall ${plate}` })), plate).toThrow(
        /looks like a vehicle number/,
      );
    }
  });
  it("documents a known limit: a short word after a state-code-like prefix can still be flagged", () => {
    // The guard is a heuristic, not perfect detection. See the comment at the top of privacy.ts.
    expect(findVehicleNumberLike("UP 2 Row 2026")).not.toBeNull();
  });
});

describe("T-CON-08 whole-number cells render as they are", () => {
  it("shows zero, negatives and large numbers in Indian grouping, never rounded", () => {
    const html = renderReportHtml(
      base({ sections: { conflicts: { columns: ["Count"], rows: [[0], [7], [-3], [1234567]] } } }),
    );
    for (const text of [">0<", ">7<", ">-3<", ">12,34,567<"]) expect(html).toContain(text);
  });
  it("shows { paise } as exact rupees and decimals given as text unchanged", () => {
    const html = renderReportHtml(
      base({
        sections: {
          shiftVariances: {
            columns: ["Amount", "Share"],
            rows: [
              [{ paise: 123456 }, "12.5%"],
              [{ paise: 5 }, "0.123456"],
            ],
          },
        },
      }),
    );
    for (const text of ["₹1,234.56", "₹0.05", "12.5%", "0.123456"]) expect(html).toContain(text);
  });
  it("refuses a decimal instead of rounding it", () => {
    const data = base({ sections: { conflicts: { columns: ["Count"], rows: [[0.123456]] } } });
    expect(() => renderReportHtml(data)).toThrow(/whole number/);
  });
});

describe("T-CON-08 override reason labels", () => {
  const labels: Record<string, string> = {
    LOST_TOKEN: "Lost token",
    DAMAGED_TOKEN: "Damaged token",
    MISREAD_NUMBER: "Misread number",
    WRONG_CLASS: "Wrong class",
    OWNER_WAIVER: "Owner waiver",
    STAFF_VEHICLE: "Staff vehicle",
    OTHER: "Other",
  };
  it("has a label for every reason code in the contracts package", () => {
    expect(REASON_CODES.length).toBe(7);
    expect([...REASON_CODES].sort()).toEqual(Object.keys(labels).sort());
  });
  it("shows each of the seven labels with its count", () => {
    const html = renderReportHtml(
      base({
        sections: {
          overridesByReason: REASON_CODES.map((reasonCode, i) => ({ reasonCode, count: i + 1 })),
        },
      }),
    );
    REASON_CODES.forEach((code, i) => {
      expect(html, code).toContain(`<td>${labels[code]}</td><td class="num">${i + 1}</td>`);
    });
    expect(html).not.toContain("LOST_TOKEN"); // raw codes never reach the page
  });
});

describe("T-CON-08 request to rendered page", () => {
  const request = { type: "weekly", facility: "fac-test-1", date: "2026-10-31", format: "pdf" };
  const renderFor = (over: Record<string, string>) => {
    const parsed = parseReportParams({ ...request, ...over });
    if (!parsed.ok) throw new Error(`request should be valid: ${JSON.stringify(parsed.issues)}`);
    return renderReportHtml({
      type: parsed.value.type,
      facilityName: "Test Facility One",
      period: parsed.value.period,
      generatedAt: "2026-10-25T09:05:00Z",
      sections: {},
    });
  };
  it("shows the weekly period worked out from a parsed request", () => {
    const html = renderFor({});
    expect(html).toContain("26 Oct 2026 to 1 Nov 2026 (IST)");
    expect(html).toContain("<h1>Weekly report</h1>");
  });
  it("works the same way for the daily and monthly requests and across a year end", () => {
    expect(renderFor({ type: "daily", date: "2026-10-25" })).toContain("Period: 25 Oct 2026 (IST)");
    expect(renderFor({ type: "monthly", date: "2024-02-10" })).toContain(
      "1 Feb 2024 to 29 Feb 2024 (IST)",
    );
    expect(renderFor({ date: "2026-12-31" })).toContain("28 Dec 2026 to 3 Jan 2027 (IST)");
  });
});
