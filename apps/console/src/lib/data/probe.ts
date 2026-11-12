/**
 * Progressive wiring: some backend objects the Console uses are still in open pull requests (KPI views in #33,
 * `shift_reviews` and `device_heartbeats` in #31, policies in #34). A read of such an object answers in one of three
 * ways, and the Console must tell them apart instead of showing an error or inventing data:
 *
 *   absent  - the table or view does not exist yet (PostgREST PGRST205, Postgres 42P01). Fall back silently.
 *   denied  - it exists but the caller may not read it (42501): RLS policies are not deployed yet.
 *   error   - anything else: shown as "unavailable" with the message.
 *
 * Codes checked against a local Supabase stack (PostgREST 12): a missing table gives PGRST205 "Could not find the
 * table ... in the schema cache"; a revoked or policy-less view gives 42501.
 */
export type Probe<T> =
  | { state: "ok"; data: T }
  | { state: "absent" }
  | { state: "denied"; error: string }
  | { state: "error"; error: string };

export interface DbError {
  code?: string | null;
  message: string;
}

const ABSENT_CODES = new Set(["PGRST205", "42P01"]);
const DENIED_CODES = new Set(["42501"]);

export function classify(error: DbError): "absent" | "denied" | "error" {
  const code = error.code ?? "";
  if (ABSENT_CODES.has(code)) return "absent";
  if (DENIED_CODES.has(code)) return "denied";
  return "error";
}

/** Turns a Supabase `{ data, error }` result into a Probe, mapping rows with `map` when the read succeeded. */
export function probeResult<R, T>(
  what: string,
  res: { data: R | null; error: DbError | null },
  map: (data: R) => T,
): Probe<T> {
  if (res.error) {
    const kind = classify(res.error);
    if (kind === "absent") return { state: "absent" };
    return { state: kind, error: `${what}: ${res.error.message}` };
  }
  try {
    return { state: "ok", data: map(res.data as R) };
  } catch (e) {
    return {
      state: "error",
      error: `${what}: ${e instanceof Error ? e.message : "unexpected shape"}`,
    };
  }
}

/** PostgREST codes that mean the database itself could not be reached (used by the health route). */
export function isDatabaseUnreachable(error: DbError | null): boolean {
  return error !== null && /^PGRST00\d$/.test(error.code ?? "");
}
