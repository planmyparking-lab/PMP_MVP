import { isPaise, REASON_CODES } from "@pmp/contracts";
import { formatIstDateTime } from "../format";
import { dayRange } from "../reportPeriod";
import type { Paise, ReasonCode } from "@pmp/contracts";

/**
 * PROVISIONAL report presentation model (CON-08, first slice).
 *
 * It describes what a report page shows, NOT where the numbers come from. It deliberately names no database
 * column, view or KPI formula: the real queries (`v_report_*`, IC-07) are Akanksha's and do not exist yet, and
 * OQ-19 (what an owner report must contain) is open. When they exist, one adapter should map query rows into
 * this model; until then nothing in the repository builds a ReportData from real data.
 *
 * Sections whose columns are not fixed by the spec are plain tables of already-prepared cells. The three
 * revenue modes and the override reason codes are fixed by the sheet (C8) and the contracts package.
 * Vehicle numbers have no place here (OQ-26: excluded by default).
 */
export const REPORT_TYPES = ["daily", "weekly", "monthly"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/**
 * Text is shown as given. A plain number must be a whole number (decimals would be rounded when printed, so
 * give them as already-formatted text). `{ paise }` is shown as rupees from integer paise.
 */
export type ReportCell = string | number | { paise: Paise };

export interface ReportTable {
  columns: readonly string[];
  rows: readonly (readonly ReportCell[])[];
}

/** Cash, UPI declared (attested by the guard), and pass revenue, each in integer paise. */
export interface RevenueByMode {
  cash: Paise;
  upiDeclared: Paise;
  pass: Paise;
}

export interface OverrideCount {
  reasonCode: ReasonCode;
  count: number;
}

/** Every section is optional. A missing or empty section is shown as "No data for this period." */
export interface ReportSections {
  utilisationByZone?: ReportTable;
  revenueByMode?: RevenueByMode;
  peakHourHeatmap?: ReportTable;
  stayDistribution?: ReportTable;
  overridesByReason?: readonly OverrideCount[];
  shiftVariances?: ReportTable;
  conflicts?: ReportTable;
}

export interface ReportData {
  type: ReportType;
  facilityName: string;
  /** Inclusive civil dates (`yyyy-mm-dd`) in IST, from the report period helpers. */
  period: { start: string; end: string };
  /** UTC instant (ISO 8601 with `Z`) the report was generated. */
  generatedAt: string;
  sections: ReportSections;
}

export const NO_DATA_MESSAGE = "No data for this period.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const TABLE_SECTIONS = [
  "utilisationByZone",
  "peakHourHeatmap",
  "stayDistribution",
  "shiftVariances",
  "conflicts",
] as const;

/** A real `yyyy-mm-dd` date. The period helpers decide what "real" means; nothing is duplicated here. */
function checkCivilDate(name: string, value: unknown): string {
  const message = `${name} must be a real calendar date written as yyyy-mm-dd`;
  if (typeof value !== "string") throw new RangeError(message);
  try {
    dayRange(value);
  } catch {
    throw new RangeError(message);
  }
  return value;
}

/**
 * Plain numbers must be whole numbers: the page prints them as they are, so a decimal would be rounded
 * without anyone noticing. Decimals belong in text (already formatted) and money in `{ paise }`.
 */
function checkCell(where: string, cell: unknown): void {
  if (typeof cell === "string") return;
  if (typeof cell === "number") {
    if (!Number.isSafeInteger(cell)) {
      throw new RangeError(
        `${where} must be a whole number; give decimals as text and money as { paise }`,
      );
    }
    return;
  }
  if (isRecord(cell) && isPaise(cell.paise)) return;
  throw new RangeError(`${where} is not a valid cell`);
}

function checkTable(name: string, table: unknown): void {
  if (!isRecord(table)) {
    throw new RangeError(`${name} must be an object with columns and rows (leave it out if empty)`);
  }
  const { columns, rows } = table;
  if (
    !Array.isArray(columns) ||
    columns.length === 0 ||
    !columns.every((c) => typeof c === "string")
  ) {
    throw new RangeError(`${name}.columns must be a non-empty list of text`);
  }
  if (!Array.isArray(rows)) throw new RangeError(`${name}.rows must be a list`);
  rows.forEach((row: unknown, i) => {
    if (!Array.isArray(row) || row.length !== columns.length) {
      throw new RangeError(`${name}.rows[${i}] must be a list of ${columns.length} cells`);
    }
    row.forEach((cell: unknown, j) => checkCell(`${name}.rows[${i}][${j}]`, cell));
  });
}

/**
 * Checks the whole shape of a ReportData before anything reads into it. Throws a RangeError that names the
 * problem and never repeats the offending value. Accepts `unknown`, so it is safe on data of any origin.
 * A section that is `undefined` is simply missing and shows "No data for this period."; `null` is rejected.
 */
export function validateReportData(data: unknown): asserts data is ReportData {
  if (!isRecord(data)) throw new RangeError("report data must be an object");
  if (typeof data.type !== "string" || !(REPORT_TYPES as readonly string[]).includes(data.type)) {
    throw new RangeError(`type must be one of ${REPORT_TYPES.join(", ")}`);
  }
  if (typeof data.facilityName !== "string" || data.facilityName.trim() === "") {
    throw new RangeError("facilityName must be a non-blank string");
  }

  if (!isRecord(data.period)) throw new RangeError("period must be an object with start and end");
  const start = checkCivilDate("period.start", data.period.start);
  const end = checkCivilDate("period.end", data.period.end);
  if (start > end) throw new RangeError("period.start must not be after period.end");

  const generatedAt = data.generatedAt;
  try {
    formatIstDateTime(typeof generatedAt === "string" ? generatedAt : "");
  } catch {
    throw new RangeError("generatedAt must be an ISO 8601 instant ending in Z or with an offset");
  }

  const sections = data.sections;
  if (!isRecord(sections)) {
    throw new RangeError("sections must be an object (use {} when there is nothing to show)");
  }
  for (const name of TABLE_SECTIONS) {
    if (sections[name] !== undefined) checkTable(`sections.${name}`, sections[name]);
  }

  const revenue = sections.revenueByMode;
  if (revenue !== undefined) {
    if (!isRecord(revenue)) throw new RangeError("sections.revenueByMode must be an object");
    for (const mode of ["cash", "upiDeclared", "pass"] as const) {
      if (!isPaise(revenue[mode])) {
        throw new RangeError(`sections.revenueByMode.${mode} must be integer paise`);
      }
    }
  }

  const overrides = sections.overridesByReason;
  if (overrides !== undefined) {
    if (!Array.isArray(overrides))
      throw new RangeError("sections.overridesByReason must be a list");
    overrides.forEach((o: unknown, i) => {
      const where = `sections.overridesByReason[${i}]`;
      if (!isRecord(o)) throw new RangeError(`${where} must be an object`);
      if (
        typeof o.reasonCode !== "string" ||
        !(REASON_CODES as readonly string[]).includes(o.reasonCode)
      ) {
        throw new RangeError(`${where}.reasonCode is not a known reason code`);
      }
      if (!Number.isInteger(o.count) || (o.count as number) < 0) {
        throw new RangeError(`${where}.count must be a non-negative integer`);
      }
    });
  }
}
