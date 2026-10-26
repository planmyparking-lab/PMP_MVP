import type { OpenSessionRecord } from "../domain/findOpenSession";

/**
 * In-memory open-session registry — the app-shell stand-in for the SYNC-03 `open_sessions`
 * snapshot (Afzal) plus this device's local ENTRY events.
 *
 * IC-01 `ENTRY` payloads are envelope-only today (no class/plate/short_code/zone), so a session's
 * searchable attributes live only where the
 * entry was made. Until the payload fields land (or the synced snapshot arrives), screens keep
 * this runtime registry — explicitly a DEV-MODE behaviour, not the port: everything here dies
 * with the process and the status screen labels the whole shell "DEV MODE — local only".
 *
 * When the real client lands, `PortProvider` swaps the registry read for the snapshot + derived
 * local rows and deletes this file; no screen changes (they consume the record shape, which is
 * OpenSessionRecord from domain/findOpenSession.ts already).
 */

export class SessionRegistry {
  private readonly rows = new Map<string, OpenSessionRecord>();

  /** Record one locally-created session (ENTRY write succeeded). Throws on duplicate id. */
  record(input: {
    sessionId: string;
    shortCode: string;
    vehicleClass: string;
    vehicleNo?: string | null;
    enteredAt: string;
    zoneId?: string;
  }): void {
    if (this.rows.has(input.sessionId)) {
      throw new Error(`SessionRegistry: duplicate session id ${input.sessionId}`);
    }
    this.rows.set(input.sessionId, {
      sessionId: input.sessionId,
      shortCode: input.shortCode,
      vehicleClass: input.vehicleClass,
      vehicleNo: input.vehicleNo ?? null,
      enteredAt: input.enteredAt,
      zoneId: input.zoneId,
    });
  }

  /** EXIT acknowledged locally → the session leaves the open view. Idempotent. */
  close(sessionId: string): void {
    this.rows.delete(sessionId);
  }

  /** All known open sessions, oldest entry first (T-GATE-02-E4 list order). */
  list(): OpenSessionRecord[] {
    return [...this.rows.values()].sort(
      (a, b) => Date.parse(a.enteredAt) - Date.parse(b.enteredAt),
    );
  }

  /** Dev/test support: clear (never used by screens; provider resets on env re-init). */
  clear(): void {
    this.rows.clear();
  }
}
