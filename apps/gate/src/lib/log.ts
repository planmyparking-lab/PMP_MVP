/**
 * Diagnostics log ring (GATE-12 sequence 5, test T-GATE-12-U3; D.9-N5: PIN scrubbing).
 *
 * The status screen's diagnostics blob = fixed fields + the last 100 log lines. Lines are
 * scrubbed AT PUSH (never merely at render) so the diagnostics export cannot pick the raw line
 * up later — the sheet's rule "no PINs in crash reports" has to hold for the log buffer too.
 *
 * Scrub rules:
 * - recognized PIN/password assignments and PIN digit values are masked without dropping
 *   otherwise useful diagnostic text;
 * - `parkos:` QR payloads are replaced with the stable label `[qr-token-payload]`;
 * - digit runs of 7+ become `[number]`, except explicitly named diagnostic metrics;
 * - vehicle-plate-shaped tokens (6-12 uppercase letters/digits, normalizeVehicleNo's shape,
 *   PR #7 review item 3) become `[plate]`. No current call site logs `vehicleNo`/`plate` (traced
 *   every `addLogLine` site in apps/gate; error-message formatting only ever surfaces field paths
 *   and generic Zod messages, never raw input values) — this is defense-in-depth for if one ever
 *   does. Uppercase-only so it never touches lowercase-hex uuids (session/device/zone ids) that
 *   ARE legitimately logged; 6+ chars so it never touches the 5-char short code.
 */

export const LOG_CAP = 500;

export const PHONE_MASK = "[removed-number]";
export const TOKEN_MASK = "[qr-token-payload]";
export const SECRET_MASK = "[redacted]";
export const PLATE_MASK = "[plate]";

const CREDENTIAL_ASSIGNMENT =
  /\b(pin|password|passwd)\b\s*(?::|=|\bis\b|\bwas\b)\s*(?:"[^"]*"|'[^']*'|[^\s,;'"`]+)/gi;
const PIN_DIGITS = /\bpin\s+(\d{4,8})\b/gi;
const PARKOS_PAYLOAD = /parkos:[A-Za-z0-9:-]{8,}/g;
const VEHICLE_PLATE_SHAPED =
  /\b(?=[A-Z0-9]{6,12}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{6,12}\b/g;
const DIGIT_RUN_7PLUS = /\d[\d\s-]{5,}\d/g;
const SAFE_LONG_NUMBER_FIELD =
  /(?:^|\b)(?:entry_ms|entry_taps|entry_save_ms|short_code_regenerations|exit_ms|exit_save_ms)=\s*$/i;

/** Pure: returns null for non-text or empty lines, else the scrubbed line. */
export function scrubLogLine(line: string): string | null {
  if (typeof line !== "string") return null;
  const masked = line
    .replace(CREDENTIAL_ASSIGNMENT, (_match, key: string) => `${key}=${SECRET_MASK}`)
    .replace(PIN_DIGITS, `pin ${SECRET_MASK}`)
    .replace(PARKOS_PAYLOAD, TOKEN_MASK)
    .replace(VEHICLE_PLATE_SHAPED, PLATE_MASK)
    .replace(DIGIT_RUN_7PLUS, (number, offset: number, source: string) => {
      const prefix = source.slice(Math.max(0, offset - 48), offset);
      return SAFE_LONG_NUMBER_FIELD.test(prefix) ? number : PHONE_MASK;
    });
  const trimmed = masked.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export type GateLog = {
  at: string; // ISO instant of the push
  line: string;
};

const buffer: GateLog[] = [];

/** Ring buffer of scrubbed lines (module-scoped: one app process, one log). */
export function addLogLine(line: string, atIso: string): GateLog | null {
  const scrubbed = scrubLogLine(line);
  if (scrubbed === null) return null;
  const at = Number.isNaN(Date.parse(atIso))
    ? new Date(0).toISOString()
    : new Date(Date.parse(atIso)).toISOString();
  const entry: GateLog = { at, line: scrubbed };
  buffer.push(entry);
  if (buffer.length > LOG_CAP) buffer.splice(0, buffer.length - LOG_CAP);
  return entry;
}

/** Last `count` lines (status blob uses 100); oldest first. */
export function recentLogLines(count: number): GateLog[] {
  const n = Math.min(Math.max(0, count), buffer.length);
  return buffer.slice(buffer.length - n);
}

/** Test/dev support: clear the log. */
export function resetLogForTests(): void {
  buffer.length = 0;
}
