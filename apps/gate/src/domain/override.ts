import { REASON_CODES, ReasonCode } from "@pmp/contracts";

/**
 * Override validation (GATE-07 rules 7-9, test T-GATE-07-U1).
 * Reason code must be one of the fixed IC-01 codes; `OTHER` requires a note of 5 to 200
 * characters (trimmed); a note is optional text for any other code. Notes are stored as text and
 * must never be rendered as HTML (screen rule; N2 renders escaped).
 */

export type OverrideValidationIssue = "UNKNOWN_REASON_CODE" | "NOTE_LENGTH"; // covers missing note for OTHER as well (length 0)

export type OverrideInput = {
  reasonCode: string;
  note?: string | null;
};

export type OverrideValidation = { ok: true } | { ok: false; issue: OverrideValidationIssue };

const OTHER = "OTHER";
const NOTE_MIN = 5;
const NOTE_MAX = 200;

export function validateOverrideInput(input: OverrideInput): OverrideValidation {
  const isKnown =
    typeof input.reasonCode === "string" &&
    (REASON_CODES as readonly string[]).includes(input.reasonCode) &&
    ReasonCode.safeParse(input.reasonCode).success;
  if (!isKnown) return { ok: false, issue: "UNKNOWN_REASON_CODE" };
  if (input.reasonCode === OTHER) {
    const length = (input.note ?? "").trim().length;
    if (length < NOTE_MIN || length > NOTE_MAX) return { ok: false, issue: "NOTE_LENGTH" };
  }
  return { ok: true };
}

/** Two-minute correction window for WRONG_CLASS fixes by a guard (GATE-07 sequence 4; after
 * that only a supervisor role may correct — the role check is a screen concern). Inclusive at
 * exactly 2 minutes. Invalid instants fail closed. */
export function isWithinCorrectionWindow(entryAt: string, now: string): boolean {
  const parse = (iso: string): number | null => {
    if (typeof iso !== "string" || iso.length === 0) return null;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
  };
  const entry = parse(entryAt);
  const at = parse(now);
  if (entry === null || at === null || at < entry) return false;
  const TWO_MINUTES_MS = 2 * 60_000;
  return at - entry <= TWO_MINUTES_MS;
}

export const OVERRIDE_REASON_CODES = REASON_CODES;
