/**
 * CON-05: overrides per 100 vehicles, using entries as the denominator.
 * Zero entries gives 0 (never NaN or Infinity). The result is not rounded; format it at display time.
 */
export function overridesPer100(overrides: number, entries: number): number {
  if (!Number.isInteger(overrides) || overrides < 0) {
    throw new RangeError(`Invalid overrides count: ${overrides}`);
  }
  if (!Number.isInteger(entries) || entries < 0) {
    throw new RangeError(`Invalid entries count: ${entries}`);
  }
  return entries === 0 ? 0 : (overrides / entries) * 100;
}
