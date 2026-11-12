import { AuthError, type IngestTransport } from "@pmp/sync-rules";
import type { Event } from "@pmp/contracts";

/**
 * Gate-owned transport for `public.ingest_events` (pasted brief Step 4; migration
 * `0004_ingest_events.sql`, documented in `docs/integrations/ingest-events.md`). Implements the
 * `IngestTransport` port `@pmp/sync-rules`'s `Uploader` already consumes — no change to that
 * package, same split as `sqliteOutboxStore.ts` (Nikhil implements the two interfaces the sheet's
 * README names: "the SQLite OutboxStore and the Supabase RPC").
 *
 * RPC name and payload verified against the actual merged migration, not guessed:
 * `public.ingest_events(events jsonb) returns jsonb`, called here as
 * `client.rpc("ingest_events", { events })`. The exact response shape is re-validated by
 * `Uploader` itself (`IngestResponse.safeParse`); this module only decides retryable vs.
 * permanent failure from the call outcome.
 *
 * BLOCKED on CLD-03 (device auth / `enroll_device`, not yet implemented — no `enroll_device`
 * function exists in `supabase/migrations/`, see docs/team/open-questions-and-assumptions.md and
 * member-04-akanksha.md CLD-03). `ingest_events` is SECURITY DEFINER and authorizes the caller via
 * `auth.uid()` against `public.devices.auth_user_id` — i.e. the Supabase client must already hold
 * a signed-in session for an enrolled, non-revoked device BEFORE this transport is ever called.
 * This module does not create, refresh, or store that session: it takes an already-authenticated
 * `SupabaseRpcClient` and makes exactly one call. How a device obtains that session (sign-in
 * method, token storage, GATE-09's enrollment flow) is CLD-03/GATE-09's decision, not invented
 * here — see `docs/team/evidence-nikhil.md` for the exact blocker record. Per the
 * brief's instruction ("do not bypass authentication"), there is no dev-mode sign-in shortcut in
 * this file.
 */

/** The narrow slice of `@supabase/supabase-js`'s `SupabaseClient` this transport calls — real
 * production code passes an actual `SupabaseClient`, which satisfies this structurally; tests pass
 * a fake with no network at all. `status` is the HTTP status PostgREST returned for the request —
 * `@supabase/postgrest-js`'s `PostgrestBuilder` resolves to `{ data, error, status, statusText,
 * count }`, a sibling of `error`, not a field on it (confirmed against that package's own source,
 * not guessed). `error.code` is the Postgres SQLSTATE PostgREST forwards for an exception raised
 * INSIDE the function (`28000` not authenticated, `42501` not an enrolled device), per
 * `0004_ingest_events.sql`'s `raise exception ... using errcode = '...'` — this never applies to a
 * rejection PostgREST's own auth layer makes BEFORE the function ever runs (an expired or
 * malformed JWT, or no JWT reaching `authenticated`), which carries a `PGRST3xx`-style code
 * instead and only `status` reliably distinguishes it. */
export interface SupabaseRpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
    status?: number;
  }>;
}

/** SQLSTATEs `ingest_events` raises for "you are not an authenticated, enrolled, non-revoked
 * device" (docs/integrations/ingest-events.md "Security model"), checked inside the function body.
 * Any other error is a retryable transport failure (`Uploader` backs off and retries unchanged). */
const AUTH_FAILURE_CODES = new Set(["28000", "42501"]);

/** HTTP statuses PostgREST's own auth layer returns before the function body ever runs — review
 * finding, PR #39: a request rejected here never reaches `ingest_events`, so it never carries one
 * of `AUTH_FAILURE_CODES` above, and would otherwise be retried with backoff forever instead of
 * surfacing `AUTH_REQUIRED`. */
const AUTH_FAILURE_HTTP_STATUS = new Set([401, 403]);

export class SupabaseIngestTransport implements IngestTransport {
  constructor(private readonly client: SupabaseRpcClient) {}

  async ingest(events: Event[]): Promise<unknown> {
    const { data, error, status } = await this.client.rpc("ingest_events", { events });
    if (error) {
      const isAuthFailure =
        (error.code !== undefined && AUTH_FAILURE_CODES.has(error.code)) ||
        (status !== undefined && AUTH_FAILURE_HTTP_STATUS.has(status));
      if (isAuthFailure) {
        throw new AuthError(error.message);
      }
      throw new Error(`ingest_events RPC failed: ${error.message}`);
    }
    return data;
  }
}
