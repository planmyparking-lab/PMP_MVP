import { isDatabaseUnreachable } from "./data/probe";
import type { DbError } from "./data/probe";

/**
 * CLD-10 health check for the uptime monitor (ops/runbook.md: "a Console /api/health route ... returns 200 or 503
 * with no data"). It sends one zero-row request with the public anon key, never the service-role key. The anon role
 * may not read any table, so a permission error (42501) still proves PostgREST reached the database; only a
 * connection failure (PGRST000-PGRST002), a thrown request or a 5xx counts as down.
 */
export type HealthResult =
  | { status: 200; body: { status: "ok" } }
  | { status: 503; body: { status: "unconfigured" | "unavailable" } };

export async function checkHealth(
  probe: (() => Promise<{ error: DbError | null; status: number }>) | null,
): Promise<HealthResult> {
  if (!probe) return { status: 503, body: { status: "unconfigured" } };
  try {
    const { error, status } = await probe();
    if (isDatabaseUnreachable(error) || status >= 500) {
      return { status: 503, body: { status: "unavailable" } };
    }
    return { status: 200, body: { status: "ok" } };
  } catch {
    return { status: 503, body: { status: "unavailable" } };
  }
}
