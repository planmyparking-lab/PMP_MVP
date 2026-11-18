// Heartbeat sender (SYNC-06). Calls CLD-04's heartbeat(device_id, queue_depth, oldest_unsynced_age, app_version,
// schema_version, battery) at most once every 5 minutes, sent immediately on the first reconnect after an outage.
// Storage-agnostic like outbox.ts: this module holds the rate-limiting rule and the call shape; the gate supplies
// the OutboxStore (for queueDepth/oldestUnsyncedAgeMs) and the transport.
import type { OutboxStore } from "./outbox";

export const HEARTBEAT_INTERVAL_MS = 5 * 60_000;

/** The six positional arguments heartbeat() takes, in that order — parameter names are the device contract
 * (confirmed with Nikhil, member-01-afzal.md CLD-04's (H) signature) and are what supabase-js rpc() sends. */
export interface HeartbeatParams {
  deviceId: string;
  queueDepth: number;
  /** Seconds, not ms: the stored column is oldest_unsynced_age_s and heartbeat() passes this straight through with
   * no conversion. Converted from HealthSnapshot's oldestUnsyncedAgeMs at the call site (floor, never negative). */
  oldestUnsyncedAgeSeconds: number;
  appVersion: string;
  schemaVersion: number;
  /** null when the battery API is unavailable (no battery module approved yet, OQ-29) — never guessed as 0. */
  batteryPercent: number | null;
}

/** Calls heartbeat(); returns the same boolean the SQL function does: true when the row was written, false when the
 * call fell inside the server's own 5-minute window (not an error — the client-side throttle below exists so this
 * is the uncommon case, not something callers need to branch on). */
export interface HeartbeatTransport {
  send(params: HeartbeatParams): Promise<boolean>;
}

/** True when a heartbeat should be sent now: the device just came back online after being offline (edge case: send
 * immediately on reconnect, do not wait out the interval), or enough time has passed since the last send. Pure, so
 * the throttle rule is testable without a clock or a transport. `wasOnline` is the online state as of the previous
 * call (undefined before the first call, which always sends if online, the same as a fresh reconnect). */
export function shouldSendHeartbeat(
  nowMs: number,
  lastSentAtMs: number | null,
  wasOnline: boolean | undefined,
  online: boolean,
): boolean {
  if (!online) return false;
  if (wasOnline === false) return true; // just reconnected: send immediately, do not wait out the interval
  if (lastSentAtMs === null) return true;
  return nowMs - lastSentAtMs >= HEARTBEAT_INTERVAL_MS;
}

export interface HeartbeatSenderOptions {
  clock?: () => number;
}

/** Tracks the rate limit and the online/offline transition across calls; one instance per device session. A failed
 * send is silent to the guard but retried: `maybeSend` never throws, and `lastSentAtMs` is only advanced on a
 * confirmed accepted send (true from the transport), so a failure or a false (server-throttled) result leaves the
 * next natural trigger free to try again. Call `maybeSend` on its own interval tick and again whenever `online`
 * flips, without awaiting it from an entry/exit flow (SYNC-06: "never blocking entry and exit"). */
export class HeartbeatSender {
  private readonly clock: () => number;
  private readonly queueHealth: NonNullable<OutboxStore["queueHealth"]>;
  private lastSentAtMs: number | null = null;
  private wasOnline: boolean | undefined;

  constructor(
    store: OutboxStore,
    private readonly transport: HeartbeatTransport,
    private readonly fixed: Pick<HeartbeatParams, "deviceId" | "appVersion" | "schemaVersion">,
    options: HeartbeatSenderOptions = {},
  ) {
    // A missing queueHealth() is a wiring bug (this store was never meant to back a heartbeat sender), not a
    // retryable heartbeat failure, so it fails loudly here rather than being silently swallowed on every tick.
    if (!store.queueHealth) throw new Error("this OutboxStore does not implement queueHealth()");
    this.queueHealth = store.queueHealth.bind(store);
    this.clock = options.clock ?? Date.now;
  }

  /** Sends when due (see shouldSendHeartbeat); otherwise does nothing. Returns whether a send was attempted, and if
   * so, whether the server accepted it — never throws, so a caller can fire this without a try/catch. */
  async maybeSend(
    online: boolean,
    batteryPercent: number | null,
  ): Promise<{ sent: boolean; accepted?: boolean }> {
    const now = this.clock();
    const due = shouldSendHeartbeat(now, this.lastSentAtMs, this.wasOnline, online);
    this.wasOnline = online;
    if (!due) return { sent: false };

    try {
      const queue = await this.queueHealth();
      const accepted = await this.transport.send({
        ...this.fixed,
        queueDepth: queue.queueDepth,
        oldestUnsyncedAgeSeconds: Math.max(0, Math.floor(queue.oldestUnsyncedAgeMs / 1000)),
        batteryPercent,
      });
      if (accepted) this.lastSentAtMs = now;
      return { sent: true, accepted };
    } catch {
      // Silent to the guard; the next tick or reconnect retries. Nothing to clean up: lastSentAtMs is untouched.
      return { sent: true, accepted: false };
    }
  }
}
