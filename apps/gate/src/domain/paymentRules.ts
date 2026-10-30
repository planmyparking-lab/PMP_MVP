import type { Event } from "@pmp/contracts";

/** The payment member of the IC-01 union, extracted by shape (contracts exports the zod schemas
 * as values; the union type `Event` is the exported type surface). */
export type PaymentShape = Extract<Event, { type: "PAYMENT" }>;

/**
 * Payment recording rules (GATE-04, tests T-GATE-04-U1/U2/U3, I1, rules 8-10).
 *
 * Screen buttons: Cash, UPI received, Pass, Waive. Mapping (sheet, "Implementation sequence"
 * and C.0 payload table):
 * - Cash   -> PAYMENT {mode:'CASH',   amount_paise = fare, upi_attested = false}
 * - UPI    -> PAYMENT {mode:'UPI',    amount_paise = fare, upi_attested = true}  ("UPI received"
 *            means the guard saw/heard the confirmation; honoured flag, attributable, OQ-05)
 * - Pass   -> PAYMENT {mode:'PASS',   amount_paise = 0}    (pass lookup first, GATE-05)
 * - Waive  -> PAYMENT {mode:'WAIVED', amount_paise = 0} + OVERRIDE with the reason code
 *            (created in the same transaction, GATE-04 sequence 4.6 / T-GATE-04-I2)
 *
 * All four modes are writeable in the merged IC-01 contract (SYNC-01: PAYMENT_MODES = CASH, UPI,
 * PASS, WAIVED; the zod refine enforces `upi_attested` true only with UPI). `paymentIntentFor`
 * produces this mapping and the write path validates amount, attestation and mode via
 * validatePaymentAmount/validateUpiAttestation before anything is stamped.
 */

export type ContractPaymentMode = PaymentShape["payload"]["mode"]; // "CASH" | "UPI" | "PASS" | "WAIVED"
export type PaymentButton = ContractPaymentMode;

export type PaymentIntent = {
  button: PaymentButton;
  mode: PaymentButton;
  amountPaise: number;
  upiAttested: boolean;
};

export function paymentIntentFor(button: PaymentButton, farePaise: number): PaymentIntent {
  switch (button) {
    case "CASH":
      return { button, mode: "CASH", amountPaise: farePaise, upiAttested: false };
    case "UPI":
      return { button, mode: "UPI", amountPaise: farePaise, upiAttested: true };
    case "PASS":
    case "WAIVED":
      // amount fixed to 0 by the sheet (sequence 4.5/4.6); no manual amount edit in v1.
      return { button, mode: button, amountPaise: 0, upiAttested: false };
  }
}

/** Modes the IC-01 schema can represent (contracts events.ts; all four since SYNC-01). */
export const CONTRACT_PAYABLE_MODES: readonly ContractPaymentMode[] = [
  "CASH",
  "UPI",
  "PASS",
  "WAIVED",
];

export function isContractPayableMode(mode: string): mode is ContractPaymentMode {
  return (CONTRACT_PAYABLE_MODES as readonly string[]).includes(mode);
}

export type PaymentAmountValidation =
  { ok: true } | { ok: false; reason: "UNSUPPORTED_MODE" | "AMOUNT_MISMATCH" | "ZERO_REQUIRED" };

/**
 * T-GATE-04-U2: for Cash and UPI the stored amount equals the computed fare ("no manual amount
 * edit in v1; discount needs Waive or Override with reason" — rule 8). Pass/Waived must store 0
 * (sequence 4.5/4.6). Unknown modes fail closed.
 */
export function validatePaymentAmount(
  mode: string,
  amountPaise: number,
  farePaise: number,
): PaymentAmountValidation {
  switch (mode) {
    case "CASH":
    case "UPI":
      return amountPaise === farePaise ? { ok: true } : { ok: false, reason: "AMOUNT_MISMATCH" };
    case "PASS":
    case "WAIVED":
      return amountPaise === 0 ? { ok: true } : { ok: false, reason: "ZERO_REQUIRED" };
    default:
      return { ok: false, reason: "UNSUPPORTED_MODE" };
  }
}

export type AttestationValidation =
  { ok: true } | { ok: false; reason: "UPI_MUST_BE_ATTESTED" | "ATTESTATION_ONLY_FOR_UPI" };

/**
 * T-GATE-04-U1: `upi_attested` is true exactly on the UPI path. The IC-01 refine already rejects
 * `attested && mode !== 'UPI'`; the sheet additionally requires the UPI path itself to store
 * `true` (the button is literally "UPI received"), so missing attestation on UPI is a rule break,
 * not a valid event.
 */
export function validateUpiAttestation(mode: string, upiAttested: boolean): AttestationValidation {
  if (mode === "UPI" && !upiAttested) return { ok: false, reason: "UPI_MUST_BE_ATTESTED" };
  if (mode !== "UPI" && upiAttested) return { ok: false, reason: "ATTESTATION_ONLY_FOR_UPI" };
  return { ok: true };
}

export type DuplicatePayment = {
  sessionId: string;
  count: number;
  eventIds: string[];
};

/**
 * T-GATE-04-I1 (local half of rule 8): at most one PAYMENT per session. A second payment for a
 * session is rejected locally by the write path (the server detector remains the backstop).
 * Returns the offending sessions; an empty array means the set is clean.
 */
export function duplicatePaymentSessions(
  payments: readonly { id: string; session_id: string }[],
): DuplicatePayment[] {
  const idsBySession = new Map<string, string[]>();
  for (const p of payments) {
    const list = idsBySession.get(p.session_id) ?? [];
    list.push(p.id);
    idsBySession.set(p.session_id, list);
  }
  const duplicates: DuplicatePayment[] = [];
  for (const [sessionId, ids] of idsBySession) {
    if (ids.length > 1) duplicates.push({ sessionId, count: ids.length, eventIds: ids });
  }
  return duplicates;
}

/** The EXIT event recorded for a session, if any (T-GATE-02-N2 "Already exited at HH:MM"). */
export function exitEventForSession(events: readonly Event[], sessionId: string): Event | null {
  for (const e of events) {
    if (e.type === "EXIT" && e.session_id === sessionId) return e;
  }
  return null;
}

/** The PAYMENT event recorded for a session, if any (T-GATE-04-I1 second-payment rejection). */
export function paymentEventForSession(events: readonly Event[], sessionId: string): Event | null {
  for (const e of events) {
    if (e.type === "PAYMENT" && e.session_id === sessionId) return e;
  }
  return null;
}

/**
 * Optional cash change calculator (GATE-04 sequence 4.4, T-GATE-04-E2): change returned for the
 * amount the customer tendered. Pure display-only — the tendered amount is NOT stored (the
 * sequence pins "the tendered amount is not stored in v1"; the PAYMENT write keeps
 * `amount_paise = fare`). Integer paise in and out (IC-01 money rule); `null` means either
 * "nothing to compute" (empty input) or "no change due" (tendered below the fare) — the screen
 * renders the change row only when this returns a number.
 */
export function cashChangePaise(tenderedPaise: number | null, farePaise: number): number | null {
  if (tenderedPaise === null) return null;
  if (!Number.isSafeInteger(tenderedPaise) || tenderedPaise < 0) return null;
  if (!Number.isSafeInteger(farePaise) || farePaise < 0) return null;
  if (tenderedPaise < farePaise) return null;
  return tenderedPaise - farePaise;
}
