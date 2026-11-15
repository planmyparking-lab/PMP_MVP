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

/**
 * PostgREST returns at most `max_rows` rows per request (`supabase/config.toml`: 1000; the hosted default is the same),
 * whatever `.limit()` asks for. A read that may need more goes through `readPaged`.
 */
export const MAX_ROWS_PER_REQUEST = 1000;

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string; code?: string | null } | null;
}

/**
 * Reads up to `want` rows in pages of at most `pageSize` (`.range(from, to)` on a query with a stable order). Stops
 * at the first short page, so a facility with few rows costs one request. An error returns the rows read so far with
 * the error, and the caller reports it.
 */
export async function readPaged<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  want: number,
  pageSize: number = MAX_ROWS_PER_REQUEST,
): Promise<{ data: T[]; error: PageResult<T>["error"] }> {
  const out: T[] = [];
  for (let from = 0; from < want; from += pageSize) {
    const to = Math.min(from + pageSize, want) - 1;
    const { data, error } = await page(from, to);
    if (error) return { data: out, error };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < to - from + 1) break;
  }
  return { data: out, error: null };
}
