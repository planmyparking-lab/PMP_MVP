/**
 * CON-08 / CR-4: dates and times are shown in IST. Money is shown through `formatRupees` from
 * `@pmp/contracts` (integer paise in, text out); this file adds only the date and time side.
 *
 * `formatIstDate` and `formatIstPeriod` expect civil dates (`yyyy-mm-dd`) that were already validated by the
 * report period helpers (`dayRange`, `weekRange`, `monthRange`); they check the shape and month only, so the
 * calendar rules are not duplicated here.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IST_OFFSET_MS = 330 * 60 * 1000;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `2026-10-25` becomes `25 Oct 2026`. */
export function formatIstDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = m ? Number(m[2]) : 0;
  if (!m || month < 1 || month > 12) {
    throw new RangeError(`Invalid date (expected yyyy-mm-dd): ${date}`);
  }
  return `${Number(m[3])} ${MONTHS[month - 1]} ${m[1]}`;
}

/** One day as `25 Oct 2026`, several days as `26 Oct 2026 to 1 Nov 2026`. */
export function formatIstPeriod(start: string, end: string): string {
  const first = formatIstDate(start);
  const last = formatIstDate(end);
  if (start > end) throw new RangeError("Period start is after period end");
  return start === end ? first : `${first} to ${last}`;
}

/**
 * Converts an instant to IST, 24-hour clock: `2026-10-25T09:05:00Z` becomes `25 Oct 2026, 14:35 IST`.
 * The text must carry an explicit `Z` or offset, so a local-time reading can never sneak in.
 */
export function formatIstDateTime(instant: string): string {
  const ms = INSTANT.test(instant) ? Date.parse(instant) : NaN;
  if (!Number.isFinite(ms)) {
    throw new RangeError(`Invalid instant (expected ISO 8601 with Z or an offset): ${instant}`);
  }
  const ist = new Date(ms + IST_OFFSET_MS);
  const day = `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
  return `${day}, ${pad2(ist.getUTCHours())}:${pad2(ist.getUTCMinutes())} IST`;
}
