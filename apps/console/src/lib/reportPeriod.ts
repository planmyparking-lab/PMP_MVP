/**
 * CON-08 / CLD-06: report period boundaries as inclusive civil dates (`yyyy-mm-dd`) in facility local time.
 * India has no daylight saving, so plain calendar arithmetic is exact. Weeks start on Monday
 * (T-CLD-06-U1). Which period each scheduled cadence requests is NOT decided here (see OQ-37).
 */
export interface DateRange {
  /** First day, inclusive. */
  start: string;
  /** Last day, inclusive. */
  end: string;
}

const IST_OFFSET_MINUTES = 330;
const DAY_MS = 24 * 60 * 60 * 1000;

// Same rules as isCalendarDate() in ops/metrics/pilot-metrics.mjs (strict yyyy-mm-dd, real calendar date),
// but this one throws and returns the UTC milliseconds. Deliberately not shared yet; see the review notes.
function parseCivil(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Invalid date (expected yyyy-mm-dd): ${date}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new RangeError(`Invalid calendar date: ${date}`);
  }
  return ms;
}

function formatCivil(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function dayRange(date: string): DateRange {
  parseCivil(date);
  return { start: date, end: date };
}

/** Monday to Sunday week containing `date`. */
export function weekRange(date: string): DateRange {
  const ms = parseCivil(date);
  const daysSinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  const start = ms - daysSinceMonday * DAY_MS;
  return { start: formatCivil(start), end: formatCivil(start + 6 * DAY_MS) };
}

/** First to last day of the calendar month containing `date`. */
export function monthRange(date: string): DateRange {
  const ms = parseCivil(date);
  const d = new Date(ms);
  const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const last = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
  return { start: formatCivil(first), end: formatCivil(last) };
}

/** UTC instant (ISO 8601, trailing Z) of 00:00 IST on a civil date, for querying `device_time`. */
export function istDayStartUtc(date: string): string {
  return new Date(parseCivil(date) - IST_OFFSET_MINUTES * 60 * 1000).toISOString();
}

/** Half-open UTC bounds `[from, to)` covering every IST day in the range. */
export function istRangeBoundsUtc(range: DateRange): { from: string; to: string } {
  const end = parseCivil(range.end);
  if (parseCivil(range.start) > end) throw new RangeError("Range start is after range end");
  return { from: istDayStartUtc(range.start), to: istDayStartUtc(formatCivil(end + DAY_MS)) };
}
