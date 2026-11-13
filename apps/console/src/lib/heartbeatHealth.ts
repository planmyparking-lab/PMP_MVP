import type { HeartbeatLive } from "./data/types";
import { deviceHealthStatus } from "./deviceHealth";
import type { HealthStatus } from "./deviceHealth";

export interface DeviceHealthView {
  status: HealthStatus;
  /** Whole minutes since the last accepted heartbeat; null when the device never sent one. */
  heartbeatAgeMinutes: number | null;
  queueDepth: number | null;
  oldestUnsyncedMinutes: number | null;
}

/**
 * CON-10 status for one device from its latest `device_heartbeats` row (or none). Opening hours are not stored
 * anywhere yet (OQ-47); the CLD-04 sheet recommends that missing configuration means "always open", so a silent
 * device always counts as stale here. Thresholds stay in deviceHealth.ts (OQ-39).
 */
export function deviceHealthFromHeartbeat(
  hb: HeartbeatLive | undefined,
  nowIso: string,
): DeviceHealthView {
  const now = Date.parse(nowIso);
  if (!hb) {
    return {
      status: deviceHealthStatus({
        queueDepth: 0,
        oldestUnsyncedMinutes: 0,
        heartbeatAgeMinutes: null,
        duringOpeningHours: true,
      }),
      heartbeatAgeMinutes: null,
      queueDepth: null,
      oldestUnsyncedMinutes: null,
    };
  }
  const received = Date.parse(hb.receivedAt);
  const ageMinutes =
    Number.isFinite(received) && Number.isFinite(now)
      ? Math.max(0, Math.floor((now - received) / 60_000))
      : null;
  const oldestUnsyncedMinutes = Math.floor(hb.oldestUnsyncedAgeS / 60);
  return {
    status: deviceHealthStatus({
      queueDepth: hb.queueDepth,
      oldestUnsyncedMinutes,
      heartbeatAgeMinutes: ageMinutes,
      duringOpeningHours: true,
    }),
    heartbeatAgeMinutes: ageMinutes,
    queueDepth: hb.queueDepth,
    oldestUnsyncedMinutes,
  };
}
