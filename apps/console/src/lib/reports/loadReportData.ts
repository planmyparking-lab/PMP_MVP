import { isPaise } from "@pmp/contracts";
import { validateReportData } from "./model";
import type { Paise } from "@pmp/contracts";
import type { ReportData, ReportTable } from "./model";
import type { ReportParams } from "./params";

/**
 * CON-08: builds a ReportData from `public.report_data()` (migration 0013, OQ-72).
 *
 * The function checks the shared secret itself and returns only one facility's figures from the KPI views, so
 * this code needs no user session and no service-role key. It maps those figures and decides nothing about
 * them: no money arithmetic beyond adding the three revenue modes' own values is done here, and nothing is
 * recomputed.
 *
 * Only revenue by mode and an hourly table come from the views. The other sections (utilisation, stay
 * distribution, overrides by reason, shift variances, conflicts) have no source yet, so they are left out and
 * the report shows "No data for this period." for each (OQ-19: what an owner report must contain is open).
 */
export type ReportRpc = (
  fn: "report_data",
  args: { p_secret: string; p_facility_id: string; p_from: string; p_to: string },
) => Promise<{ data: unknown; error: { code?: string } | null }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function paise(value: unknown, name: string): Paise {
  if (!isPaise(value)) throw new RangeError(`report_data.${name} is not integer paise`);
  return value;
}

function whole(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`report_data.${name} is not a non-negative whole number`);
  }
  return value;
}

/** One row per hour of the day that had traffic in the period, summed over its days. */
function hourlyTable(hourly: unknown): ReportTable | undefined {
  if (!Array.isArray(hourly)) throw new RangeError("report_data.hourly must be a list");
  const byHour = new Map<number, { entries: number; exits: number }>();
  hourly.forEach((row: unknown, i) => {
    if (!isRecord(row)) throw new RangeError(`report_data.hourly[${i}] must be an object`);
    const hour = whole(row.hour, `hourly[${i}].hour`);
    if (hour > 23) throw new RangeError(`report_data.hourly[${i}].hour is not 0 to 23`);
    const slot = byHour.get(hour) ?? { entries: 0, exits: 0 };
    slot.entries += whole(row.entries, `hourly[${i}].entries`);
    slot.exits += whole(row.exits, `hourly[${i}].exits`);
    byHour.set(hour, slot);
  });
  if (byHour.size === 0) return undefined;
  const rows = [...byHour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, v]) => [`${String(hour).padStart(2, "0")}:00`, v.entries, v.exits] as const);
  return { columns: ["Hour (IST)", "Entries", "Exits"], rows };
}

/**
 * Returns `null` for an unknown facility or a facility id that is not a UUID (the route answers 404). Throws on
 * any other database error, or on a result of an unexpected shape, so the route answers 500 with a job id and
 * never prints a half-built report.
 */
export async function loadReportData(
  params: ReportParams,
  deps: { rpc: ReportRpc; secret: string; now?: () => Date },
): Promise<ReportData | null> {
  if (!UUID.test(params.facility)) return null;

  const { data, error } = await deps.rpc("report_data", {
    p_secret: deps.secret,
    p_facility_id: params.facility,
    p_from: params.period.start,
    p_to: params.period.end,
  });
  // The code only: a database message can quote what was sent.
  if (error) throw new Error(`report_data failed (${error.code ?? "unknown"})`);
  if (data === null) return null;
  if (!isRecord(data) || typeof data.facility_name !== "string") {
    throw new RangeError("report_data returned an unexpected shape");
  }

  const revenue = data.revenue;
  if (!isRecord(revenue)) throw new RangeError("report_data.revenue must be an object");

  const peak = hourlyTable(data.hourly);
  const report: ReportData = {
    type: params.type,
    facilityName: data.facility_name,
    period: { start: params.period.start, end: params.period.end },
    generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    sections: {
      revenueByMode: {
        cash: paise(revenue.cash_paise, "revenue.cash_paise"),
        upiDeclared: paise(revenue.upi_paise, "revenue.upi_paise"),
        pass: paise(revenue.pass_paise, "revenue.pass_paise"),
      },
      ...(peak ? { peakHourHeatmap: peak } : {}),
    },
  };
  validateReportData(report);
  return report;
}
