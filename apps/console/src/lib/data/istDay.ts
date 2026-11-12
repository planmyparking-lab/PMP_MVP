const IST_OFFSET_MS = 330 * 60 * 1000;

/** Start of the IST calendar day containing `nowIso`, as a UTC instant. */
export function istDayStart(nowIso: string): string {
  const ms = Date.parse(nowIso);
  if (!Number.isFinite(ms)) throw new RangeError(`Invalid instant: ${nowIso}`);
  const ist = new Date(ms + IST_OFFSET_MS);
  const midnightIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(midnightIst - IST_OFFSET_MS).toISOString();
}

/** IST hour (0..23) of an instant. */
export function istHour(instant: string): number {
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms)) throw new RangeError(`Invalid instant: ${instant}`);
  return new Date(ms + IST_OFFSET_MS).getUTCHours();
}

/** Count instants per IST hour; always 24 buckets. */
export function countByIstHour(instants: readonly string[]): number[] {
  const buckets = Array.from({ length: 24 }, () => 0);
  for (const t of instants) {
    const h = istHour(t);
    buckets[h] = (buckets[h] ?? 0) + 1;
  }
  return buckets;
}
