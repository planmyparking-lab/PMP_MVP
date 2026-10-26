import { parseEvent, type Event, type ReasonCode } from "@pmp/contracts";

import { defaultUuidV7 } from "../domain/token";
import {
  exitEventForSession,
  paymentEventForSession,
  validatePaymentAmount,
  validateUpiAttestation,
  isContractPayableMode,
  type PaymentButton,
} from "../domain/paymentRules";
import { validateOverrideInput } from "../domain/override";
import type { SyncClient } from "./ic02";
import { formatEventIssues } from "./eventIssues";

/**
 * Gate-side `writeEvent` data layer (GATE-01 sequence 4.5; the gate owns this file per C.0 rule 1;
 * tests T-GATE-01-I1/I2, T-GATE-02-I1, T-GATE-04-I1/I2/N3, T-GATE-07-I1, T-GATE-06-I1).
 *
 * C.0 rule 1: "One action = one writeEvent call = one SQLite transaction. The function validates
 * the event with the IC-01 zod schema, stamps id (UUIDv7), device_id, staff_id, device_time, and
 * delegates to Afzal's sync package (IC-02). It returns after the local commit; it never waits
 * for the network."
 *
 * Implemented exactly as far as the approved IC-01 schema permits (the authoritative shape is
 * packages/contracts/src/events.ts, not the sheet's C.0 example payloads):
 * - stamp `id` (UUIDv7 via domain/token), `device_id`, `device_time`, `schema_version` = 1;
 * - reject event types whose required business payload is not representable by IC-01, then
 *   validate supported events with the contracts parser before they reach the client;
 * - delegate to the `SyncClient` port and return after the local commit.
 *
 * Attribution gaps (documented, never silently dropped): the IC-01 envelope has no `staff_id`,
 * `facility_id` or `source` field today (the sheet's C.0 table lists them; the contracts TODO owns
 * them). The login session
 * (GATE-09) stays the screen-side source of staff identity until the field lands; payloads for
 * ENTRY (class/plate/short_code/zone) and SHIFT_OPEN totals are envelope-only too, so the
 * entry bundle writes what IC-01 can represent and the rest follows the contracts TODOs.
 */

/** Envelope schema version stamped on every event (IC-01 base uses a positive int). */
export const SCHEMA_VERSION = 1;

export type WriteDeps = {
  /** The IC-02 client (FakeSync in tests; Afzal's package in the app shell). */
  client: SyncClient;
  /** Committed local events, for the exit/payment duplicate guards. IC-02 exposes no read API
   * today (SYNC-03 gives open_sessions only); an events read is needed from Afzal (OQ-37 list). */
  readEvents(): readonly Event[];
  deviceId: string;
  /** Injected clock for `device_time` (D.15: tests inject a fake clock; never a raw Date.now). */
  now(): string;
  /** Event id minting, injectable for deterministic tests (default: UUIDv7 from domain/token). */
  generateId?: () => string;
};

/**
 * A draft stamped by this layer, restricted to what IC-01 can represent today. ENTRY/EXIT are
 * envelope-only (no class/plate/code fields until the contracts TODO lands), PAYMENT is
 * CASH|UPI, OVERRIDE carries reason/note/change. SHIFT_OPEN is envelope-only; ZONE_COUNT and
 * SHIFT_CLOSE are rejected because their required payload fields are not yet in IC-01.
 */
export type EventDraft =
  | { type: "ENTRY"; session_id: string }
  | { type: "EXIT"; session_id: string }
  | {
      type: "PAYMENT";
      session_id: string;
      amount_paise: number;
      mode: "CASH" | "UPI";
      upi_attested: boolean;
    }
  | {
      type: "OVERRIDE";
      session_id: string;
      target_event_id: string;
      reason_code: ReasonCode;
      note?: string;
      change?: Record<string, unknown>;
    }
  | { type: "ZONE_COUNT" }
  | { type: "SHIFT_OPEN" }
  | { type: "SHIFT_CLOSE" };

/** IC-01 validation failure detail for the caller (paper-sheet errors log the detail). */
export class WriteRuleError extends Error {
  constructor(
    readonly reason:
      | "VALIDATION"
      | "ALREADY_EXITED"
      | "SECOND_PAYMENT"
      | "UNSUPPORTED_PAYMENT_MODE"
      | "OVERRIDE_RULES",
    message: string,
    /** Extra context: schema issue list or the conflicting event's time. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

export type StampResult = { ok: true; event: Event } | { ok: false; detail: string };

/** Stamp the envelope and validate against IC-01 with the contracts parser (the single authority
 * the sync package also enforces on ingest — no ad-hoc re-implementation here). */
export function stampAndValidate(deps: WriteDeps, draft: EventDraft): StampResult {
  if (draft.type === "ZONE_COUNT" || draft.type === "SHIFT_CLOSE") {
    const eventName = draft.type;
    const fields =
      eventName === "ZONE_COUNT" ? "zone and count fields" : "shift totals and variance fields";
    return {
      ok: false,
      detail: `${eventName} cannot be written until IC-01 supports its ${fields}`,
    };
  }
  const id = (deps.generateId ?? defaultUuidV7)();
  const candidate = {
    ...draft,
    id,
    device_id: deps.deviceId,
    device_time: deps.now(),
    schema_version: SCHEMA_VERSION,
  } as unknown as Event; // one cast boundary; `parseEvent` below is the authority
  const parsed = parseEvent(candidate);
  if (!parsed.ok) {
    return {
      ok: false,
      detail: formatEventIssues(parsed.issues),
    };
  }
  return { ok: true, event: parsed.value };
}

/** Validate, stamp, delegate — one action, one transaction (C.0 rule 1). */
export async function writeEvent(deps: WriteDeps, draft: EventDraft): Promise<Event> {
  const stamped = stampAndValidate(deps, draft);
  if (!stamped.ok) {
    throw new WriteRuleError(
      "VALIDATION",
      `IC-01 validation failed (${stamped.detail})`,
      stamped.detail,
    );
  }
  await deps.client.writeTransaction([stamped.event]);
  return stamped.event;
}

export type ExitPayment = {
  /** Screen-button mode intent (from paymentIntentFor; PASS/WAIVED pending the IC-01 enum). */
  mode: PaymentButton;
  amountPaise: number;
};

export type ExitOverride = {
  target_event_id: string;
  reason_code: ReasonCode;
  note?: string;
};

export type ExitBundle = {
  sessionId: string;
  /** The computed fare the payment must equal for CASH/UPI (GATE-04 rule 8, T-GATE-04-U2). */
  farePaise: number;
  payment?: ExitPayment;
  override?: ExitOverride;
};

/**
 * `writeExit` (GATE-02 sequence 4.5, GATE-04 4.3/4.6): EXIT + PAYMENT (and for a waiver the
 * OVERRIDE with reason) in ONE transaction — all stored or none (T-GATE-02-I1, T-GATE-04-N3).
 * Local guards BEFORE writing:
 *   T-GATE-02-N2  — no second exit for an already-exited session (checking local EXIT events);
 *   T-GATE-04-I1  — no second payment for an already-paid session (rejection is local);
 *   T-GATE-04-U1  — attestation true exactly on the UPI path, amount equals fare for CASH/UPI,
 *                   zero for PASS/WAIVED;
 *   contracts gap — PASS/WAIVED payment modes are not yet IC-01-encodable:
 *                   a PASS exit is refused outright (a paid customer's exit must not be recorded
 *                   without its payment event); a WAIVED exit records EXIT + reason OVERRIDE in
 *                   the same transaction and its PAYMENT(mode WAIVED, 0) plugs in when the enum
 *                   lands. Neither gap is papered over with a invented event shape.
 */
export async function writeExit(deps: WriteDeps, bundle: ExitBundle): Promise<Event[]> {
  const existing = deps.readEvents();
  const priorExit = exitEventForSession(existing, bundle.sessionId);
  if (priorExit) {
    throw new WriteRuleError(
      "ALREADY_EXITED",
      "session already exited locally",
      priorExit.device_time,
    );
  }
  if (bundle.payment && paymentEventForSession(existing, bundle.sessionId)) {
    throw new WriteRuleError("SECOND_PAYMENT", "session already has a PAYMENT event");
  }

  const stamped: Event[] = [];
  const exitSt = stampAndValidate(deps, { type: "EXIT", session_id: bundle.sessionId });
  if (!exitSt.ok)
    throw new WriteRuleError("VALIDATION", `EXIT rejected (${exitSt.detail})`, exitSt.detail);
  stamped.push(exitSt.event);

  if (bundle.override) {
    const input = {
      reasonCode: bundle.override.reason_code,
      note: bundle.override.note ?? null,
    };
    const ruleCheck = validateOverrideInput(input);
    if (!ruleCheck.ok) {
      throw new WriteRuleError("OVERRIDE_RULES", `override rejected (${ruleCheck.issue})`);
    }
    const overrideSt = stampAndValidate(deps, {
      type: "OVERRIDE",
      session_id: bundle.sessionId,
      target_event_id: bundle.override.target_event_id,
      reason_code: bundle.override.reason_code,
      note: bundle.override.note,
    });
    if (!overrideSt.ok) {
      throw new WriteRuleError(
        "VALIDATION",
        `OVERRIDE rejected (${overrideSt.detail})`,
        overrideSt.detail,
      );
    }
    stamped.push(overrideSt.event);
  }

  if (bundle.payment) {
    const { mode, amountPaise } = bundle.payment;
    const amountCheck = validatePaymentAmount(mode, amountPaise, bundle.farePaise);
    if (!amountCheck.ok) {
      throw new WriteRuleError("VALIDATION", `PAYMENT ${mode} rejected: ${amountCheck.reason}`);
    }
    const attestationCheck = validateUpiAttestation(mode, mode === "UPI");
    if (!attestationCheck.ok) {
      throw new WriteRuleError("VALIDATION", `PAYMENT ${mode}: ${attestationCheck.reason}`);
    }
    if (!isContractPayableMode(mode)) {
      if (mode === "WAIVED" && bundle.override) {
        // documented interim: waiver survives via the OVERRIDE in this transaction; the
        // PAYMENT(mode 'WAIVED', 0) event is added when IC-01 grows the mode enum
      } else {
        throw new WriteRuleError(
          "UNSUPPORTED_PAYMENT_MODE",
          `payment mode ${mode} is not supported by the IC-01 contract yet`,
        );
      }
    } else {
      const paymentSt = stampAndValidate(deps, {
        type: "PAYMENT",
        session_id: bundle.sessionId,
        amount_paise: amountPaise,
        mode,
        upi_attested: mode === "UPI",
      });
      if (!paymentSt.ok) {
        throw new WriteRuleError(
          "VALIDATION",
          `PAYMENT rejected (${paymentSt.detail})`,
          paymentSt.detail,
        );
      }
      stamped.push(paymentSt.event);
    }
  }

  await deps.client.writeTransaction(stamped);
  return stamped;
}

/** Waiver exit bundle (GATE-04 sequence 4.6; T-GATE-04-I2): EXIT + OVERRIDE(reason) in one
 * transaction. `note` is required by validateOverrideInput when the reason is OTHER. */
export function waiveExitBundle(input: {
  sessionId: string;
  entryEventId: string;
  reasonCode: ReasonCode;
  note?: string;
}): ExitBundle {
  return {
    sessionId: input.sessionId,
    farePaise: 0,
    override: {
      target_event_id: input.entryEventId,
      reason_code: input.reasonCode,
      note: input.note,
    },
  };
}

/** Plain single override write (GATE-07 sequence 3; T-GATE-07-I1). Reason rules from
 * validateOverrideInput plus the IC-01 refine; the target event id is mandatory because the
 * contract schema requires it (the sheet's "target_event_id or session_id" wording predates the
 * schema decision). */
export async function writeOverride(
  deps: WriteDeps,
  input: {
    sessionId: string;
    targetEventId: string;
    reasonCode: ReasonCode;
    note?: string;
    change?: Record<string, unknown>;
  },
): Promise<Event> {
  const ruleCheck = validateOverrideInput({
    reasonCode: input.reasonCode,
    note: input.note ?? null,
  });
  if (!ruleCheck.ok) {
    throw new WriteRuleError("OVERRIDE_RULES", `override rejected (${ruleCheck.issue})`);
  }
  return writeEvent(deps, {
    type: "OVERRIDE",
    session_id: input.sessionId,
    target_event_id: input.targetEventId,
    reason_code: input.reasonCode,
    note: input.note,
    change: input.change,
  });
}
