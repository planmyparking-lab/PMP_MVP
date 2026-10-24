import { SCHEMA_VERSION, isSupported } from "@pmp/contracts";

/**
 * Version gate (see docs/team/member-01-afzal.md, SYNC-03): when this build's SCHEMA_VERSION is below the
 * server's minimum supported version, syncing must stop. Offline operation continues.
 */
export function isSyncBlocked(
  minSupportedVersion: number,
  appVersion: number = SCHEMA_VERSION,
): boolean {
  return !isSupported(appVersion, minSupportedVersion);
}
