/** Bump on any breaking change to event shapes. Document in docs/release.md. */
export const SCHEMA_VERSION = 1;

/** True when this client's version meets the server's minimum supported version. */
export function isSupported(clientVersion: number, minSupported: number): boolean {
  return Number.isInteger(clientVersion) && clientVersion >= minSupported;
}
