/**
 * CON-10 status chip (T-CON-10-U1). Red thresholds come from the sheet (queue over 200, oldest unsynced over
 * 30 minutes, heartbeat older than 30 minutes during opening hours). Amber bounds are NOT specified; the
 * values below are provisional (OQ-39) and live here so there is one place to change them.
 */
export const HEALTH_THRESHOLDS = {
  red: { queueDepth: 200, oldestUnsyncedMinutes: 30, heartbeatAgeMinutes: 30 },
  amber: { queueDepth: 100, oldestUnsyncedMinutes: 15, heartbeatAgeMinutes: 15 },
} as const;

export type HealthStatus = "green" | "amber" | "red";

export interface HealthInput {
  queueDepth: number;
  oldestUnsyncedMinutes: number;
  /** Null when the device never sent a heartbeat. */
  heartbeatAgeMinutes: number | null;
  /** Heartbeat staleness counts only during opening hours (from facility shift config). */
  duringOpeningHours: boolean;
}

export function deviceHealthStatus(h: HealthInput): HealthStatus {
  const { red, amber } = HEALTH_THRESHOLDS;
  const stale = (limit: number) =>
    h.duringOpeningHours && (h.heartbeatAgeMinutes === null || h.heartbeatAgeMinutes > limit);
  if (
    h.queueDepth > red.queueDepth ||
    h.oldestUnsyncedMinutes > red.oldestUnsyncedMinutes ||
    stale(red.heartbeatAgeMinutes)
  ) {
    return "red";
  }
  if (
    h.queueDepth > amber.queueDepth ||
    h.oldestUnsyncedMinutes > amber.oldestUnsyncedMinutes ||
    stale(amber.heartbeatAgeMinutes)
  ) {
    return "amber";
  }
  return "green";
}
