/**
 * Exit QR payload parsing (GATE-02, tests T-GATE-02-U1/U2, N3) and validation rule 12:
 * anything not matching ^parkos:[0-9a-f-]{36}:[0-9A-Z]{5}:[0-9a-f-]{36}$ is INVALID; a payload
 * from another facility is WRONG_FACILITY ("Wrong facility token" on screen).
 */

const PAYLOAD_PATTERN = /^parkos:([0-9a-f-]{36}):([0-9A-Z]{5}):([0-9a-f-]{36})$/;

export type ParsedQrPayload =
  | { ok: true; facilityId: string; shortCode: string; sessionId: string }
  | { ok: false; reason: "INVALID" | "WRONG_FACILITY" };

export function parseQrPayload(payload: string, deviceFacilityId?: string): ParsedQrPayload {
  if (typeof payload !== "string") return { ok: false, reason: "INVALID" };
  const match = PAYLOAD_PATTERN.exec(payload);
  if (!match) return { ok: false, reason: "INVALID" };
  const facilityId = match[1] ?? "";
  const shortCode = match[2] ?? "";
  const sessionId = match[3] ?? "";
  if (deviceFacilityId !== undefined && facilityId !== deviceFacilityId) {
    return { ok: false, reason: "WRONG_FACILITY" };
  }
  return { ok: true, facilityId, shortCode, sessionId };
}
