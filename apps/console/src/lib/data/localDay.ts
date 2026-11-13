/**
 * The calendar date (yyyy-mm-dd) of an instant in an IANA time zone. The KPI views (#33) report `local_date` in each
 * facility's own `timezone`, so "today" must be computed the same way. Returns null for an unknown zone name, so the
 * caller can show "unavailable" instead of picking a different day.
 */
export function localDate(nowIso: string, timeZone: string): string | null {
  const ms = Date.parse(nowIso);
  if (!Number.isFinite(ms)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const y = get("year");
    const m = get("month");
    const d = get("day");
    return y && m && d ? `${y}-${m}-${d}` : null;
  } catch {
    return null; // RangeError: invalid time zone
  }
}
