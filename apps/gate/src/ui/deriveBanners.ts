import type { HealthSnapshot } from "../data/ic02";

/**
 * Banner derivation for the app shell (GATE-12 behaviour + member-01 SYNC-06 fallback table).
 * Pure: the React hook (`useBanners`, device-side wiring) subscribes to health() observers and
 * re-runs this derivation; this module owns the THRESHOLDS so they are testable in CI.
 *
 * Documented thresholds (member-01 SYNC-06 expected behaviour 2 and member-02 GATE-12):
 * - offline: shown only after the device has been offline for 10 seconds (grace), not instantly;
 * - unsynced queue older than 30 minutes WHILE ONLINE: supervisor banner ("server-side Sentry
 *   alert at 2 h" is the cloud job's concern, CLD-07);
 * - old build: `syncBlocked` from the version gate (SYNC-03) → update banner; compounding with
 *   offline: syncBlocked wins as the actionable banner;
 * - low battery: under 15%; low storage: under 300 MB (OQ-29 decides the modules that feed
 *   these and whether the values are available at all);
 * - clock skew: more than 5 minutes off the last trusted server time.
 */

export type BannerKind =
  "OFFLINE" | "QUEUE_OLD" | "OLD_BUILD" | "LOW_BATTERY" | "LOW_STORAGE" | "CLOCK_SKEW";

export type Banner = { kind: BannerKind; title: string };
export const MAX_VISIBLE_BANNERS = 2;

export function visibleBanners(
  banners: readonly Banner[],
  dismissedKinds: readonly BannerKind[] = [],
): Banner[] {
  const dismissed = new Set(dismissedKinds);
  return banners.filter((banner) => !dismissed.has(banner.kind)).slice(0, MAX_VISIBLE_BANNERS);
}

export type DeviceUptimeInputs = {
  /** How long the device has been continuously offline (ms), per the screen's timer. */
  offlineForMs: number;
  /** Battery percent 0..100, when available (null: OQ-29 module not approved/available). */
  batteryPercent: number | null;
  /** Free storage in MB, when available (null: OQ-29). */
  freeStorageMb: number | null;
  /** Signed skew vs last trusted server time (ms). */
  clockSkewMs: number;
};

export const BANNER_THRESHOLDS = {
  offlineGraceMs: 10_000,
  queueAgeSupervisorMs: 30 * 60_000,
  batteryLowPercent: 15,
  storageLowMb: 300,
  clockSkewMs: 5 * 60_000,
} as const;

export function deriveBanners(health: HealthSnapshot, device: DeviceUptimeInputs): Banner[] {
  const banners: Banner[] = [];
  if (health.syncBlocked) {
    banners.push({ kind: "OLD_BUILD", title: "OLD_BUILD" });
  } else if (!health.online && device.offlineForMs >= BANNER_THRESHOLDS.offlineGraceMs) {
    banners.push({ kind: "OFFLINE", title: "OFFLINE" });
  }
  if (health.online && health.oldestUnsyncedAgeMs >= BANNER_THRESHOLDS.queueAgeSupervisorMs) {
    banners.push({ kind: "QUEUE_OLD", title: "QUEUE_OLD" });
  }
  if (
    device.batteryPercent !== null &&
    device.batteryPercent < BANNER_THRESHOLDS.batteryLowPercent
  ) {
    banners.push({ kind: "LOW_BATTERY", title: "LOW_BATTERY" });
  }
  if (device.freeStorageMb !== null && device.freeStorageMb < BANNER_THRESHOLDS.storageLowMb) {
    banners.push({ kind: "LOW_STORAGE", title: "LOW_STORAGE" });
  }
  if (Math.abs(device.clockSkewMs) > BANNER_THRESHOLDS.clockSkewMs) {
    banners.push({ kind: "CLOCK_SKEW", title: "CLOCK_SKEW" });
  }
  return banners;
}
