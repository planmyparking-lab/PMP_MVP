/**
 * Entry token (GATE-01, S module).
 * - `session_id`: UUIDv7 generated on device (IC-01 events; the sheet requires UUIDv7).
 * - short code: 5 characters from the Crockford base32 alphabet (test T-GATE-01-U1:
 *   ^[0-9A-HJKMNP-TV-Z]{5}$), regenerated when it collides with an open session code
 *   (T-GATE-01-U2; the regeneration count is returned so the app can record the
 *   `short_code_regenerations` metric the sheet names).
 * - QR payload: 'parkos:<facilityId>:<code>:<sessionId>' exactly (T-GATE-01-U3).
 *
 * The sheet's function list shows generateToken(openShortCodes); the device facility id is a
 * required second argument because the QR payload needs it, and the function stays pure by
 * taking it explicitly instead of reading device state.
 */

const SHORT_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** The sheet's (R) pattern for a valid short code. */
export const SHORT_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{5}$/;
const SHORT_CODE_LENGTH = 5;
/** ~33.5M code space; 50 tries make a full open-set failure practically impossible. */
const MAX_ATTEMPTS = 50;

export type Token = {
  sessionId: string;
  shortCode: string;
  qrPayload: string;
  /** How many times a colliding code was regenerated (0 on the first free draw). */
  regenerations: number;
};

export function qrPayloadFor(facilityId: string, shortCode: string, sessionId: string): string {
  return `parkos:${facilityId}:${shortCode}:${sessionId}`;
}

function randomBytes(length: number): Uint8Array {
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.getRandomValues !== "function") {
    throw new Error(
      "generateToken: crypto.getRandomValues is unavailable; the device must provide it (expo-crypto on device)",
    );
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** UUIDv7 (RFC 9562): 48-bit unix ms, version nibble 7, variant bits 10, rest random. */
export function defaultUuidV7(): string {
  const b = randomBytes(16);
  let ts = Date.now();
  for (let i = 5; i >= 0; i--) {
    b[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const asHex = (n: number): string => n.toString(16).padStart(2, "0");
  const hex = Array.from(b, asHex).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function generateToken(
  openShortCodes: ReadonlySet<string>,
  facilityId: string,
  newSessionId: () => string = defaultUuidV7,
): Token {
  if (typeof facilityId !== "string" || facilityId.length === 0) {
    throw new Error("generateToken: facilityId is required for the QR payload");
  }
  let regenerations = 0;
  while (true) {
    const bytes = randomBytes(SHORT_CODE_LENGTH);
    let code = "";
    for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
      code += SHORT_CODE_ALPHABET[bytes[i] % SHORT_CODE_ALPHABET.length];
    }
    if (!openShortCodes.has(code)) {
      const sessionId = newSessionId();
      return {
        sessionId,
        shortCode: code,
        qrPayload: qrPayloadFor(facilityId, code, sessionId),
        regenerations,
      };
    }
    regenerations += 1;
    if (regenerations >= MAX_ATTEMPTS) {
      throw new Error(`generateToken: no free short code after ${MAX_ATTEMPTS} attempts`);
    }
  }
}

/** Crockford-normalizes a typed or scanned short code (GATE-02 rule 8): I/L -> 1, O -> 0,
 * lowercase uppercased; U is rejected outright (ambiguous in the Crockford alphabet). Any
 * non-alphanumeric character is rejected; the result may still be length-checked by callers. */
export function normalizeShortCode(input: string): string | null {
  if (typeof input !== "string") return null;
  const upper = input.toUpperCase();
  if (upper.includes("U")) return null;
  let out = "";
  for (const ch of upper) {
    if (ch === "I" || ch === "L") out += "1";
    else if (ch === "O") out += "0";
    else if ((ch >= "0" && ch <= "9") || (ch >= "A" && ch <= "Z")) out += ch;
    else return null;
  }
  return out.length === 0 ? null : out;
}
