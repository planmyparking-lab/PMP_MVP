import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { createRateLimiter, secretMatches } from "../src/lib/reports/access";
import { buildReportWorkbook } from "../src/lib/reports/excel";
import { handleReportRequest } from "../src/lib/reports/handler";
import { renderPdf } from "../src/lib/reports/pdf";
import type { ReportData } from "../src/lib/reports/model";
import type { ReportDeps } from "../src/lib/reports/handler";

const SECRET = "test-secret-value";
const FACILITY = "0190a000-0000-7000-8000-000000000001";

const data: ReportData = {
  type: "daily",
  facilityName: "Demo Mall",
  period: { start: "2026-10-25", end: "2026-10-25" },
  generatedAt: "2026-10-26T01:00:00Z",
  sections: {
    utilisationByZone: {
      columns: ["Zone", "Entries", "Revenue"],
      rows: [["Zone A", 120, { paise: 1234500 }]],
    },
    revenueByMode: { cash: 1000000, upiDeclared: 234500, pass: 5 },
    overridesByReason: [{ reasonCode: "STAFF_VEHICLE", count: 3 }],
  },
};

const request = (qs: string, secret: string | null = SECRET, ip = "1.1.1.1") =>
  new Request(`https://console.test/api/reports/daily?${qs}`, {
    headers: { ...(secret ? { "x-report-secret": secret } : {}), "x-forwarded-for": ip },
  });
const goodQs = `facility=${FACILITY}&date=2026-10-25&format=xlsx`;

function deps(overrides: Partial<ReportDeps> = {}): ReportDeps {
  return {
    secret: SECRET,
    loadReportData: async () => data,
    renderPdf: async () => new Uint8Array([37, 80, 68, 70]),
    authFailures: createRateLimiter(3, 60_000),
    perFacility: createRateLimiter(100, 60_000),
    log: () => undefined,
    ...overrides,
  };
}

describe("T-CON-08-N1/N2 secret and rate limit", () => {
  it("compares secrets exactly and fails closed when none is configured", () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches("wrong", SECRET)).toBe(false);
    expect(secretMatches(null, SECRET)).toBe(false);
    expect(secretMatches("", "")).toBe(false);
    expect(secretMatches("anything", undefined)).toBe(false);
  });
  it("returns 401 without or with a wrong secret", async () => {
    expect((await handleReportRequest(request(goodQs, null), "daily", deps())).status).toBe(401);
    expect((await handleReportRequest(request(goodQs, "nope"), "daily", deps())).status).toBe(401);
  });
  it("limits repeated wrong secrets from one client but not other clients", async () => {
    const d = deps();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await handleReportRequest(request(goodQs, "bad"), "daily", d)).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
    expect((await handleReportRequest(request(goodQs, "bad", "2.2.2.2"), "daily", d)).status).toBe(
      401,
    );
  });
  it("rate limits accepted requests per facility", async () => {
    const d = deps({ perFacility: createRateLimiter(1, 60_000) });
    expect((await handleReportRequest(request(goodQs), "daily", d)).status).toBe(200);
    expect((await handleReportRequest(request(goodQs), "daily", d)).status).toBe(429);
  });
});

describe("request validation and data source", () => {
  it("rejects a bad type, date or format with 400 and names the field", async () => {
    const res = await handleReportRequest(
      request(`facility=${FACILITY}&date=2026-02-30&format=doc`),
      "yearly",
      deps(),
    );
    expect(res.status).toBe(400);
    const fields = (await res.json()).issues.map((i: { field: string }) => i.field);
    expect(fields).toEqual(expect.arrayContaining(["type", "date", "format"]));
  });
  it("answers 501 while no data source is wired", async () => {
    const res = await handleReportRequest(
      request(goodQs),
      "daily",
      deps({ loadReportData: undefined }),
    );
    expect(res.status).toBe(501);
  });
  it("answers 404 for an unknown facility", async () => {
    const res = await handleReportRequest(
      request(goodQs),
      "daily",
      deps({ loadReportData: async () => null }),
    );
    expect(res.status).toBe(404);
  });
});

describe("T-CON-08-I2 Excel equals the report data", () => {
  it("writes one sheet per section with the same numbers", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildReportWorkbook(data)).buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Summary",
      "Revenue by mode",
      "Utilisation by zone",
      "Peak-hour heatmap",
      "Stay distribution",
      "Overrides",
      "Shift variances",
      "Conflicts",
    ]);
    const rev = wb.getWorksheet("Revenue by mode")!;
    expect(rev.getRow(2).getCell(2).value).toBe(10000);
    expect(rev.getRow(3).getCell(2).value).toBe(2345);
    expect(rev.getRow(4).getCell(2).value).toBe(0.05);
    expect(rev.getRow(3).getCell(1).value).toMatch(/UPI declared/);
    expect(wb.getWorksheet("Utilisation by zone")!.getRow(2).getCell(3).value).toBe(12345);
    expect(wb.getWorksheet("Overrides")!.getRow(2).values).toEqual([undefined, "STAFF_VEHICLE", 3]);
  });
  it("says there is no data instead of leaving a section out (T-CON-08-N3)", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      (await buildReportWorkbook({ ...data, sections: {} })).buffer as ArrayBuffer,
    );
    expect(wb.getWorksheet("Conflicts")!.getRow(1).getCell(1).value).toBe(
      "No data for this period.",
    );
    expect(wb.getWorksheet("Revenue by mode")!.getRow(1).getCell(1).value).toBe(
      "No data for this period.",
    );
  });
  it("refuses data that looks like a vehicle number (T-CON-08-I3)", async () => {
    const bad: ReportData = {
      ...data,
      sections: { conflicts: { columns: ["Note"], rows: [["MH12AB1234 duplicate exit"]] } },
    };
    await expect(buildReportWorkbook(bad)).rejects.toThrow(RangeError);
  });
});

describe("successful responses", () => {
  it("returns an attachment for xlsx and pdf and logs without payload", async () => {
    const log = vi.fn();
    const d = deps({ log });
    const x = await handleReportRequest(request(goodQs), "daily", d);
    expect(x.status).toBe(200);
    expect(x.headers.get("content-type")).toContain("spreadsheetml");
    expect(x.headers.get("content-disposition")).toBe(
      'attachment; filename="report-daily-2026-10-25.xlsx"',
    );
    const p = await handleReportRequest(request(goodQs.replace("xlsx", "pdf")), "daily", d);
    expect(p.status).toBe(200);
    expect(p.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await p.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "report.render", bytes: 4 }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("Demo Mall");
  });
});

describe("T-CON-08-N4 failure path", () => {
  it("returns 500 with a job id and does not leak the error message", async () => {
    const log = vi.fn();
    const res = await handleReportRequest(
      request(goodQs.replace("xlsx", "pdf")),
      "daily",
      deps({
        log,
        renderPdf: async () => {
          throw new Error("chromium exploded at /secret/path");
        },
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("render_failed");
    expect(body.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toContain("secret/path");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret/path");
  });
});

describe("PDF renderer", () => {
  const page = {
    setContent: vi.fn(async () => undefined),
    pdf: vi.fn(async () => new Uint8Array([1])),
  };
  it("renders A4 and always closes the browser", async () => {
    const close = vi.fn(async () => undefined);
    const out = await renderPdf("<html></html>", {
      launch: async () => ({ newPage: async () => page, close }),
    });
    expect(out).toEqual(new Uint8Array([1]));
    expect(page.pdf).toHaveBeenCalledWith(expect.objectContaining({ format: "A4" }));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("closes the browser when rendering fails", async () => {
    const close = vi.fn(async () => undefined);
    await expect(
      renderPdf("<html></html>", {
        launch: async () => ({
          newPage: async () => ({ ...page, pdf: async () => Promise.reject(new Error("x")) }),
          close,
        }),
      }),
    ).rejects.toThrow("x");
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("times out a render that never finishes", async () => {
    await expect(
      renderPdf("<html></html>", {
        timeoutMs: 20,
        launch: async () => ({
          newPage: async () => ({ ...page, pdf: () => new Promise<Uint8Array>(() => undefined) }),
          close: async () => undefined,
        }),
      }),
    ).rejects.toThrow(/timed out/);
  });
});
