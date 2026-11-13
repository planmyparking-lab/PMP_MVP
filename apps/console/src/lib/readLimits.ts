/**
 * Helpers shared by the server loaders: honest truncation and honest reference lookups.
 *
 * Truncation. A loader asks the database for `limit + 1` rows. Only when that extra row arrives is the list really cut,
 * so a page with exactly `limit` rows never claims that rows are missing.
 *
 * Reference lookups. Names of staff, devices and zones are looked up next to the main read. When one of those lookups
 * fails, the page must say so instead of quietly showing "Unknown guard" for everybody.
 */

/** Ask the database for this many rows to know whether `limit` rows were cut. */
export const probeLimit = (limit: number): number => limit + 1;

/** Keeps at most `limit` rows and says whether more existed. */
export function takeLimited<T>(
  rows: readonly T[] | null | undefined,
  limit: number,
): { rows: T[]; truncated: boolean } {
  const all = rows ?? [];
  return { rows: all.slice(0, limit), truncated: all.length > limit };
}

/** One human line per failed lookup, e.g. "staff names: permission denied". Empty when every lookup worked. */
export function referenceProblems(
  lookups: ReadonlyArray<readonly [label: string, error: { message: string } | null | undefined]>,
): string[] {
  return lookups
    .filter(([, error]) => error)
    .map(([label, error]) => `${label}: ${error?.message}`);
}
