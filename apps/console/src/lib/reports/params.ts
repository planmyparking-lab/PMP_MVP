import { dayRange, istRangeBoundsUtc, monthRange, weekRange } from "../reportPeriod";
import type { DateRange } from "../reportPeriod";
import { REPORT_TYPES } from "./model";
import type { ReportType } from "./model";

/**
 * CON-08: validation of a report request (type, facility, date, format), with the report period and the UTC
 * query bounds worked out by the existing helpers in `reportPeriod.ts`. This file does no date arithmetic.
 *
 * The request shape (`type`, `facility`, `date`, `format`) is the RECOMMENDED query shape in
 * docs/team/member-03-anamika.md C8 and may still change (OQ-32). Nothing here reads a URL, a header or a
 * database: whatever receives a request passes in plain values.
 *
 * Invalid input never throws. The result is `{ ok: false, issues }`, each issue naming the field in plain
 * words, and the messages never repeat what was sent.
 */
export const REPORT_FORMATS = ["pdf", "xlsx"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export interface ReportParams {
  type: ReportType;
  format: ReportFormat;
  /** Exactly as supplied. Its format is not decided here (ids belong to the database contract). */
  facility: string;
  /** The date that was asked for, `yyyy-mm-dd`. */
  date: string;
  /** Inclusive IST civil dates of the day, the Monday to Sunday week, or the month containing `date`. */
  period: DateRange;
  /** Half-open UTC instants `[from, to)` covering every IST day of `period`. */
  bounds: { from: string; to: string };
}

export type ReportParamField = "input" | "type" | "facility" | "date" | "format";

export interface ReportParamIssue {
  field: ReportParamField;
  message: string;
}

export type ParseReportParamsResult =
  { ok: true; value: ReportParams } | { ok: false; issues: ReportParamIssue[] };

const periodFor: Record<ReportType, (date: string) => DateRange> = {
  daily: dayRange,
  weekly: weekRange,
  monthly: monthRange,
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" ? allowed.find((a) => a === value) : undefined;
}

const DATE_MESSAGE = "date must be a real calendar date written as yyyy-mm-dd.";

/**
 * Validates a report request. `type` is the report cadence, `date` is any day inside the wanted period.
 * Both values are matched exactly (lower case); nothing is trimmed, defaulted or guessed.
 */
export function parseReportParams(input: unknown): ParseReportParamsResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, issues: [{ field: "input", message: "The request must be an object." }] };
  }
  const raw = input as Record<string, unknown>;
  const issues: ReportParamIssue[] = [];

  const type = oneOf(raw.type, REPORT_TYPES);
  if (!type) {
    issues.push({ field: "type", message: `type must be one of ${REPORT_TYPES.join(", ")}.` });
  }

  const facility = raw.facility;
  if (typeof facility !== "string" || facility.trim() === "") {
    issues.push({ field: "facility", message: "facility must be a non-empty text value." });
  }

  // The period helpers are the single source of truth for what a valid date is: they throw RangeError.
  let period: DateRange | undefined;
  let bounds: { from: string; to: string } | undefined;
  if (typeof raw.date !== "string") {
    issues.push({ field: "date", message: DATE_MESSAGE });
  } else {
    try {
      // With an unusable type the date is still checked, so one response can name both problems.
      period = periodFor[type ?? "daily"](raw.date);
      bounds = istRangeBoundsUtc(period);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      issues.push({ field: "date", message: DATE_MESSAGE });
    }
  }

  const format = oneOf(raw.format, REPORT_FORMATS);
  if (!format) {
    issues.push({
      field: "format",
      message: `format must be one of ${REPORT_FORMATS.join(", ")}.`,
    });
  }

  if (issues.length > 0 || !type || !format || !period || !bounds) return { ok: false, issues };
  return {
    ok: true,
    value: { type, format, facility: facility as string, date: raw.date as string, period, bounds },
  };
}
