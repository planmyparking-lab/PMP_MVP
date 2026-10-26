import { normalizeVehicleNo } from "./plates";
import { SHORT_CODE_PATTERN } from "./token";
import type { OpenSessionRecord } from "./findOpenSession";

/**
 * Paper-sheet backfill rules (GATE-11, tests T-GATE-11-U1/U2/N1/N2) as pure functions so
 * `app/backfill.tsx` stays a thin wrapper.
 *
 * Time rule (GATE-11 sequence 2 / D.11-U1): the picker is constrained to the CURRENT SHIFT or the
 * PREVIOUS 24 HOURS — a future paper time is rejected; a time older than 24 hours needs the
 * supervisor role (R: "entries older than 24 hours (supervisor only)"; D.11-N2 "Guard bulk
 * backfill ... events older than the shift" — the sheet's guard boundary is the shift for
 * in-shift work and 24 h otherwise; both readings accept exactly what the union accepts).
 *
 * Amount rule (D.11-N1): a typed amount requires a reason code (sheet rule 13: "typed amount
 * requires a reason"). Typed zero means "no typed amount" only when deliberately entered as 0 —
 * any typed positive paise amount forces the reason.
 *
 * Duplicate rule (D.11-U2): a matching short code or plate on an ENTRY saved within 10 minutes of
 * the paper time triggers a warning (never a hard block — duplicates of events saved by OTHER
 * devices cannot be detected locally until the contracts carry source metadata; this check covers
 * what this device demonstrably knows).
 *
 * NOTE (contracts gap): IC-01 events cannot yet carry `source = PAPER_BACKFILL` (or `recorded_at`),
 * so the app may NOT persist backfill events the
 * drafts it validates here would produce indistinguishable live events. The write call in the
 * screen is therefore blocked with an explicit explanation until Afzal's envelope TODO lands.
 */

const DUPLICATE_WINDOW_MINUTES = 10;
const DAY_MS = 24 * 60 * 60_000;

/** Clock-time entry (HH:MM) → the most recent instant with that wall time at/before `nowMs`
 * (today, or yesterday when today's would be in the future). Strict pattern; no seconds allowed. */
export function resolvePaperTime(
  hhmm: string,
  nowMs: number,
): { ok: true; iso: string } | { ok: false } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (match === null) return { ok: false };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return { ok: false };
  }
  const now = new Date(nowMs);
  let candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (candidate.getTime() > nowMs) {
    candidate = new Date(candidate.getTime() - DAY_MS);
  }
  return { ok: true, iso: candidate.toISOString() };
}

export type BackfillTimeValidation =
  | { ok: true; inShift: boolean }
  | { ok: false; issue: "INVALID_TIME" | "FUTURE" | "OLDER_THAN_24H" };

export function validateBackfillTime(
  paperTimeIso: string,
  nowIso: string,
  /** device_time of the currently open shift, when one is open (findOpenShift). */
  shiftOpenedAtIso: string | null | undefined,
): BackfillTimeValidation {
  const paper = Date.parse(paperTimeIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(paper) || Number.isNaN(now)) return { ok: false, issue: "INVALID_TIME" };
  if (paper > now) return { ok: false, issue: "FUTURE" };
  if (paper <= now - DAY_MS) return { ok: false, issue: "OLDER_THAN_24H" };
  const opened =
    shiftOpenedAtIso === null || shiftOpenedAtIso === undefined
      ? Number.NaN
      : Date.parse(shiftOpenedAtIso);
  const inShift = !Number.isNaN(opened) && paper >= opened;
  return { ok: true, inShift };
}

/** True only for a time older than 24 h (D.11-N2: guard role is blocked; supervisor allowed). */
export function isOlderThan24h(paperTimeIso: string, nowIso: string): boolean {
  const paper = Date.parse(paperTimeIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(paper) || Number.isNaN(now)) return true; // unparseable: fail closed
  return paper <= now - DAY_MS;
}

export type BackfillExitMode = "CASH" | "UPI";

export type BackfillExitValidation =
  | { ok: true }
  | {
      ok: false;
      issue: "MODE_REQUIRED" | "AMOUNT_REQUIRED" | "AMOUNT_INVALID" | "REASON_REQUIRED";
    };

/**
 * Paper-exit draft validation. mode defaults to null ("not chosen yet"). An amount typed as an
 * integer paise value is fine for CASH/UPI; any positive typed amount REQUIRES `reasonCode`
 * (any fixed reason string passes here; the exact-code semantics are re-validated against
 * validateOverrideInput when the events become writable, so a locally-passing reason can never
 * be silently accepted twice).
 */
export function validateBackfillExit(input: {
  mode: BackfillExitMode | null;
  amountPaise: number | null;
  reasonCode: string | null;
}): BackfillExitValidation {
  if (input.mode === null) return { ok: false, issue: "MODE_REQUIRED" };
  if (input.amountPaise === null || input.amountPaise === undefined)
    return { ok: false, issue: "AMOUNT_REQUIRED" };
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 0)
    return { ok: false, issue: "AMOUNT_INVALID" };
  if (
    input.amountPaise > 0 &&
    (input.reasonCode === null || (input.reasonCode ?? "").trim().length === 0)
  )
    return { ok: false, issue: "REASON_REQUIRED" };
  return { ok: true };
}

export type BackfillDuplicateWarning = {
  duplicateOf: OpenSessionRecord[];
};

/**
 * D.11-U2: existing local ENTRY rows matching the normalized plate OR the (normalized) short
 * code whose entry time falls within ±10 minutes of the paper time. Null plate/code simply
 * never matches. `rows` is the local open-session list plus any locally-known sessions the
 * caller can supply — closed sessions are invisible until payload fields land (documented gap).
 */
export function backfillDuplicateWarning(
  rows: readonly OpenSessionRecord[],
  identity: { shortCode: string | null; vehicleNo: string | null },
  paperTimeIso: string,
): BackfillDuplicateWarning {
  const paper = Date.parse(paperTimeIso);
  if (Number.isNaN(paper)) return { duplicateOf: [] };
  const plate = identity.vehicleNo === null ? null : normalizeVehicleNo(identity.vehicleNo);
  const code = identity.shortCode === null ? null : identity.shortCode.toUpperCase();
  const shortCodeValid = code !== null && SHORT_CODE_PATTERN.test(code);
  const matches = rows.filter((row) => {
    const at = Date.parse(row.enteredAt);
    if (Number.isNaN(at) || Math.abs(at - paper) > DUPLICATE_WINDOW_MINUTES * 60_000) return false;
    if (shortCodeValid && row.shortCode === code) return true;
    if (plate !== null && row.vehicleNo != null && row.vehicleNo === plate) return true;
    return false;
  });
  return { duplicateOf: matches };
}
