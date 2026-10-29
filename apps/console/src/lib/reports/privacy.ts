import type { ReportCell, ReportData, ReportTable } from "./model";

/**
 * OQ-26 (recommended default): reports must not contain vehicle numbers. ReportData has no field for them;
 * this is a second line of defence against an adapter that copies one into a name or table cell.
 *
 * It is a HEURISTIC for the common Indian formats (for example `MH12AB1234`, `DL 1C AB 1234`, and the BH
 * series `22 BH 1234 AA`). It will not catch every possible string and is not a substitute for keeping
 * vehicle numbers out of the data in the first place. To avoid flagging ordinary text it only accepts a real
 * state or union-territory code at the start, allows a series of at most three letters (or one letter plus
 * one or two letters, the Delhi style), and ignores month-and-year text such as `or 1 Nov 2026`.
 *
 * Known limits, in both directions:
 * - It can still flag a name made of a state-code-like word, a number, a word of at most three letters and a
 *   four-digit number, for example `UP 2 Row 2026`. Longer words such as `PB 1 Plaza 2024` are not flagged.
 * - It misses plates written with unusual spacing or characters (for example `M H 12 A B 1234`) and plates
 *   without a recognised state code.
 */
const STATE_CODES =
  "AN|AP|AR|AS|BR|CG|CH|DD|DL|DN|GA|GJ|HP|HR|JH|JK|KA|KL|LA|LD|MH|ML|MN|MP|MZ|NL|OD|OR|PB|PY|RJ|SK|TN|TR|TS|UK|UP|WB";
const STATE_PLATE = `(?:${STATE_CODES})[ -]?\\d{1,2}[ -]?([A-Z]{1,3}|[A-Z][ -][A-Z]{1,2})[ -]?\\d{4}`;
const BH_PLATE = "\\d{2}[ -]?BH[ -]?\\d{4}[ -]?[A-Z]{1,2}";
const VEHICLE_NUMBER = new RegExp(
  `(?<![A-Za-z0-9])(?:${STATE_PLATE}|${BH_PLATE})(?![A-Za-z0-9])`,
  "gi",
);
const MONTHS = new Set([
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
]);

/** Returns the first match if `text` looks like a vehicle number, otherwise null. */
export function findVehicleNumberLike(text: string): string | null {
  for (const m of text.matchAll(VEHICLE_NUMBER)) {
    const series = m[1]?.replace(/[ -]/g, "").toUpperCase();
    if (series && MONTHS.has(series)) continue; // a date such as "or 1 Nov 2026", not a plate
    return m[0];
  }
  return null;
}

function cellText(cell: ReportCell): string {
  return typeof cell === "string" ? cell : "";
}

function tableStrings(table: ReportTable | undefined): string[] {
  if (!table) return [];
  return [...table.columns, ...table.rows.flatMap((row) => row.map(cellText))];
}

/** Throws if any text that will be printed looks like a vehicle number. The error never repeats the match. */
export function assertNoVehicleNumbers(data: ReportData): void {
  const s = data.sections;
  const texts = [
    data.facilityName,
    ...tableStrings(s.utilisationByZone),
    ...tableStrings(s.peakHourHeatmap),
    ...tableStrings(s.stayDistribution),
    ...tableStrings(s.shiftVariances),
    ...tableStrings(s.conflicts),
  ];
  if (texts.some((t) => findVehicleNumberLike(t) !== null)) {
    throw new RangeError("report data contains text that looks like a vehicle number");
  }
}
