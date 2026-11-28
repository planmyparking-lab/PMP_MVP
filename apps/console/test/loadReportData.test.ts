import { describe, expect, it, vi } from "vitest";
import { loadReportData } from "../src/lib/reports/loadReportData";
import { parseReportParams } from "../src/lib/reports/params";
import type { ReportRpc } from "../src/lib/reports/loadReportData";

const FACILITY = "0190a000-0000-7000-8000-000000000001";
const SECRET = "s3cret-for-tests";
const NOW = () => new Date("2026-10-26T01:00:00Z");

function params(type = "daily", date = "2026-10-25", facility = FACILITY) {
  const parsed = parseReportParams({ type, facility, date, format: "pdf" });
  if (!parsed.ok) throw new Error("bad test params");
  return parsed.value;
}

const rows = {
  facility_name: "Demo Mall",
  revenue: { cash_paise: 1000000, upi_paise: 234500, pass_paise: 5 },
  hourly: [
    { local_date: "2026-10-25", hour: 9, entries: 10, exits: 4 },
    { local_date: "2026-10-26", hour: 9, entries: 5, exits: 1 },
    { local_date: "2026-10-25", hour: 18, entries: 20, exits: 15 },
  ],
};

const ok =
  (data: unknown): ReportRpc =>
  async () => ({ data, error: null });

describe("loadReportData (CON-08, migration 0013)", () => {
  it("calls report_data with the secret, facility and the period's own dates", async () => {
    const rpc = vi.fn<ReportRpc>(ok(rows));
    await loadReportData(params("weekly", "2026-10-28"), { rpc, secret: SECRET, now: NOW });
    expect(rpc).toHaveBeenCalledWith("report_data", {
      p_secret: SECRET,
      p_facility_id: FACILITY,
      p_from: "2026-10-26",
      p_to: "2026-11-01",
    });
  });

  it("maps revenue by mode and sums the hours of the day across the period", async () => {
    const data = await loadReportData(params(), { rpc: ok(rows), secret: SECRET, now: NOW });
    expect(data).not.toBeNull();
    expect(data!.facilityName).toBe("Demo Mall");
    expect(data!.generatedAt).toBe("2026-10-26T01:00:00.000Z");
    expect(data!.sections.revenueByMode).toEqual({ cash: 1000000, upiDeclared: 234500, pass: 5 });
    expect(data!.sections.peakHourHeatmap).toEqual({
      columns: ["Hour (IST)", "Entries", "Exits"],
      rows: [
        ["09:00", 15, 5],
        ["18:00", 20, 15],
      ],
    });
  });

  it("leaves unsourced sections out, so the report says there is no data", async () => {
    const data = await loadReportData(params(), { rpc: ok(rows), secret: SECRET, now: NOW });
    expect(Object.keys(data!.sections).sort()).toEqual(["peakHourHeatmap", "revenueByMode"]);
  });

  it("omits the hourly table when there was no traffic, but still reports zero revenue", async () => {
    const empty = {
      facility_name: "Demo Mall",
      revenue: { cash_paise: 0, upi_paise: 0, pass_paise: 0 },
      hourly: [],
    };
    const data = await loadReportData(params(), { rpc: ok(empty), secret: SECRET, now: NOW });
    expect(data!.sections.peakHourHeatmap).toBeUndefined();
    expect(data!.sections.revenueByMode).toEqual({ cash: 0, upiDeclared: 0, pass: 0 });
  });

  it("returns null for an unknown facility and for an id that is not a UUID, without a call", async () => {
    expect(await loadReportData(params(), { rpc: ok(null), secret: SECRET })).toBeNull();
    const rpc = vi.fn<ReportRpc>(ok(rows));
    expect(
      await loadReportData(params("daily", "2026-10-25", "not-a-uuid"), { rpc, secret: SECRET }),
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws on a database error and names only the code, never the message", async () => {
    const rpc: ReportRpc = async () => ({ data: null, error: { code: "28000" } });
    await expect(loadReportData(params(), { rpc, secret: SECRET })).rejects.toThrow(
      "report_data failed (28000)",
    );
  });

  it.each([
    ["fractional paise", { ...rows, revenue: { ...rows.revenue, cash_paise: 1.5 } }],
    ["negative paise", { ...rows, revenue: { ...rows.revenue, upi_paise: -1 } }],
    ["missing revenue", { facility_name: "Demo Mall", hourly: [] }],
    ["hour out of range", { ...rows, hourly: [{ hour: 24, entries: 1, exits: 0 }] }],
    ["hourly not a list", { ...rows, hourly: {} }],
    ["no facility name", { ...rows, facility_name: 7 }],
  ])("rejects a malformed result: %s", async (_name, bad) => {
    await expect(
      loadReportData(params(), { rpc: ok(bad), secret: SECRET, now: NOW }),
    ).rejects.toThrow();
  });
});
