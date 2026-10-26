import { recentLogLines } from "./log";
import { ACTIVE_SAFETY_LIMIT_MODE } from "../domain/zoneCount";

/**
 * Diagnostics blob (GATE-12 sequence 5; T-GATE-12-U3/U2 evidence). The JSON the support person
 * reads on WhatsApp: fixed status fields + last 100 scrubbed log lines.
 *
 * The field list is EXACTLY the status screen's (health, app/schema version, device id, current
 * shift, config seed state). Personal data has no path in: fields are typed, not free-form, and
 * the log lines were scrubbed at push time by src/lib/log.ts.
 */

export type DiagnosticsFields = {
  appVersion: string | null;
  schemaVersion: number;
  deviceId: string | null;
  facilityId: string;
  /** "DEV SEED" when the local demo config is in use. */
  configSource: string;
  currentShiftOpenedAt: string | null;
  lastSyncAt: string | null;
  queueDepth: number;
  oldestUnsyncedAgeMs: number;
  online: boolean;
  quarantinedCount: number;
  syncBlocked: boolean;
  /** ISO instant the blob was built. */
  generatedAt: string;
};

export function entryTimingLine(
  entryMs: number,
  saveMs: number,
  regenerations: number,
  taps: number,
): string {
  return `entry_ms=${Math.round(entryMs)} entry_taps=${taps} entry_save_ms=${Math.round(saveMs)} short_code_regenerations=${regenerations}`;
}

export function exitTimingLine(
  exitMs: number,
  saveMs: number,
  payment: "CASH" | "UPI" | "waived",
): string {
  return `exit_ms=${Math.round(exitMs)} exit_save_ms=${Math.round(saveMs)} outcome=${payment}`;
}

export function buildDiagnosticsBlob(fields: DiagnosticsFields): string {
  const payload = {
    ...fields,
    safetyLimitMode: ACTIVE_SAFETY_LIMIT_MODE,
    logs: recentLogLines(100).map((entry) => ({ at: entry.at, line: entry.line })),
  };
  return JSON.stringify(payload);
}
