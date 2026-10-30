// Upload outbox (SYNC-02), storage-agnostic. The gate app supplies an OutboxStore (SQLite) and a transport (Supabase
// RPC); this module holds the rules: ordering, batching, result handling, retry counting, quarantine, one upload at a time.
import { parseEvent, type Event } from "@pmp/contracts";
import { nextDelay } from "./backoff";
import { IngestResponse, type IngestStatus } from "./ingestResponse";

export const DEFAULT_BATCH_SIZE = 50;
export const DEFAULT_MAX_ATTEMPTS = 5;

export type SyncState = "PENDING" | "SENT" | "QUARANTINED";

export interface OutboxRow {
  id: string;
  /** Stored event JSON, re-validated before every upload. */
  event: unknown;
  attempts: number;
  deviceTime: string;
}

/** What to write back for one row. SENT and QUARANTINED rows leave the pending set. */
export interface RowUpdate {
  id: string;
  state: SyncState;
  attempts: number;
  /** Server reason, or LOCAL_INVALID / ID_MISMATCH (decided locally, never sent), for quarantined rows. */
  code?: string;
}

export interface OutboxStore {
  /** Up to `limit` PENDING rows ordered by device_time, then id. */
  pending(limit: number): Promise<OutboxRow[]>;
  /** Apply all updates in ONE local transaction (all or nothing). */
  apply(updates: RowUpdate[]): Promise<void>;
}

/** Sends events to ingest_events. Throws AuthError for 401/403, anything else thrown is treated as a retryable failure. */
export interface IngestTransport {
  ingest(events: Event[]): Promise<unknown>;
}

export class AuthError extends Error {
  override name = "AuthError";
}

export type UploadOutcome =
  | { kind: "IDLE" }
  | {
      kind: "UPLOADED";
      sent: number;
      duplicates: number;
      retrying: number;
      quarantined: number;
      /** Cloud minimum schema_version, for the version gate (SYNC-03). */
      minSupportedVersion: number;
    }
  | { kind: "AUTH_REQUIRED" }
  | { kind: "FAILED"; retryInMs: number; error: unknown };

export interface UploaderOptions {
  batchSize?: number;
  maxAttempts?: number;
  random?: () => number;
}

export class Uploader {
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly random: () => number;
  private inFlight: Promise<UploadOutcome> | null = null;
  private failures = 0;

  constructor(
    private readonly store: OutboxStore,
    private readonly transport: IngestTransport,
    options: UploaderOptions = {},
  ) {
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.random = options.random ?? Math.random;
  }

  /** Consecutive failed uploads since the last success (drives the backoff). */
  get consecutiveFailures(): number {
    return this.failures;
  }

  /** Only one upload runs at a time: concurrent callers share the running upload. */
  uploadBatch(): Promise<UploadOutcome> {
    if (this.inFlight) return this.inFlight;
    const run = this.run().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  /** Upload until nothing is pending, a failure, or an auth problem. Returns the last outcome. */
  async drain(): Promise<UploadOutcome> {
    for (;;) {
      const outcome = await this.uploadBatch();
      if (outcome.kind !== "UPLOADED") return outcome;
      // A full pass in which nothing left the pending set would spin forever on permanent retries; stop.
      if (outcome.sent + outcome.quarantined === 0) return outcome;
    }
  }

  private async run(): Promise<UploadOutcome> {
    const rows = await this.store.pending(this.batchSize);
    if (rows.length === 0) return { kind: "IDLE" };

    // A stored event that no longer parses can never be accepted: quarantine it without a network call. The same goes
    // for a row whose id differs from the id inside its event: the server would accept event.id while the row (what the
    // app tracks) stays PENDING, and every retry would then fail the id check below. Which id is right is unknowable here.
    const updates: RowUpdate[] = [];
    const sendable: { row: OutboxRow; event: Event }[] = [];
    for (const row of rows) {
      const parsed = parseEvent(row.event);
      if (parsed.ok && parsed.value.id === row.id) sendable.push({ row, event: parsed.value });
      else
        updates.push({
          id: row.id,
          state: "QUARANTINED",
          attempts: row.attempts,
          code: parsed.ok ? "ID_MISMATCH" : "LOCAL_INVALID",
        });
    }

    let minSupportedVersion = 0;
    let duplicates = 0;
    let retrying = 0;
    if (sendable.length > 0) {
      let response: IngestResponse;
      try {
        const raw = await this.transport.ingest(sendable.map((s) => s.event));
        const checked = IngestResponse.safeParse(raw);
        if (!checked.success || checked.data.results.length !== sendable.length) {
          throw new Error("ingest_events returned an unexpected response");
        }
        // Results come back in request order; when the server could read an id it must match the request.
        for (const [i, entry] of sendable.entries()) {
          const id = checked.data.results[i]!.id;
          if (id !== undefined && id !== entry.row.id)
            throw new Error("ingest_events results are out of order");
        }
        response = checked.data;
      } catch (error) {
        if (updates.length > 0) await this.store.apply(updates); // keep the local quarantines
        if (error instanceof AuthError) return { kind: "AUTH_REQUIRED" };
        const retryInMs = nextDelay(this.failures, this.random);
        this.failures += 1;
        return { kind: "FAILED", retryInMs, error };
      }

      minSupportedVersion = response.min_supported_version;
      for (const [i, entry] of sendable.entries()) {
        const result = response.results[i]!;
        const status: IngestStatus = result.status;
        if (status === "ACCEPTED" || status === "DUPLICATE") {
          if (status === "DUPLICATE") duplicates += 1;
          updates.push({ id: entry.row.id, state: "SENT", attempts: entry.row.attempts });
        } else {
          const attempts = entry.row.attempts + 1;
          if (attempts >= this.maxAttempts) {
            updates.push({
              id: entry.row.id,
              state: "QUARANTINED",
              attempts,
              code: result.reason ?? "REJECTED",
            });
          } else {
            retrying += 1;
            updates.push({ id: entry.row.id, state: "PENDING", attempts, code: result.reason });
          }
        }
      }
    }

    // If this write fails (app killed, disk error) the server already has the events; the next upload gets DUPLICATE.
    await this.store.apply(updates);
    this.failures = 0;
    return {
      kind: "UPLOADED",
      sent: updates.filter((u) => u.state === "SENT").length,
      duplicates,
      retrying,
      quarantined: updates.filter((u) => u.state === "QUARANTINED").length,
      minSupportedVersion,
    };
  }
}
