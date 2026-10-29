import type { ReportData, ReportType } from "./model";
import type { DateRange } from "../reportPeriod";

/**
 * Made-up sample used ONLY by the labelled demo at /reports/demo, to show what the report layout and Excel file
 * look like. Every name and number is invented; none of it came from a facility or a database. Longer periods
 * simply scale the invented numbers.
 */
export function demoReport(
  generatedAt: string,
  type: ReportType = "daily",
  period: DateRange = { start: "2026-10-25", end: "2026-10-25" },
): ReportData {
  const k = type === "daily" ? 1 : type === "weekly" ? 7 : 30;
  return {
    type,
    facilityName: "DEMO SAMPLE (not a real facility)",
    period,
    generatedAt,
    sections: {
      utilisationByZone: {
        columns: ["Zone", "Capacity", "Peak vehicles", "Entries"],
        rows: [
          ["Demo Zone A", 100, 91, 240 * k],
          ["Demo Zone B", 80, 52, 130 * k],
        ],
      },
      revenueByMode: { cash: 1250000 * k, upiDeclared: 842500 * k, pass: 300000 * k },
      peakHourHeatmap: {
        columns: ["Hour", "Entries"],
        rows: [
          ["10:00", 38 * k],
          ["11:00", 52 * k],
          ["18:00", 61 * k],
        ],
      },
      overridesByReason: [{ reasonCode: "STAFF_VEHICLE", count: 3 * k }],
    },
  };
}
