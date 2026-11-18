import {
  parseEvent,
  SCHEMA_VERSION,
  type Event,
  type EventOf,
  type ReasonCode,
} from "@pmp/contracts";

import { defaultUuidV7 } from "../domain/token";
import {
  exitEventForSession,
  paymentEventForSession,
  validatePaymentAmount,
  validateUpiAttestation,
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
 * Implemented against the merged SYNC-01 contract (packages/contracts/src/events.ts +
 * docs/integrations/event-envelope.md): the envelope carries facility_id/device_id/staff_id/
 * device_time/source/schema_version and every payload is fully representable — SESSION events
 * (ENTRY/EXIT/PAYMENT/OVERRIDE) carry a session_id; ZONE_COUNT/SHIFT_OPEN/SHIFT_CLOSE carry
 * `session_id: null`. The stamping below is the ONLY place the gate builds the envelope, so the
 * attribution rules are testable in one suite (failure to stamp = no write, never a partial one).
 *
 * Attribution: facility_id and staff_id come from WriteDeps (the port wires the dev config and
 * the logged-in session). An unresolved device id or staff id fails IC-01 validation CLOSED —
 * writes are refused rather than retried under a rotating identity. `source` is LIVE for gate
 * actions; PAPER_BACKFILL stays restricted to the GATE-11 flow (which remains blocked on the
 * still-missing `recorded_at`/paper-time field — see backfill.ts).
 */

/** Envelope schema version stamped on every event (IC-01 base uses a positive int; SQL parity). */
export { SCHEMA_VERSION };

export type WriteDeps = {
  /** The IC-02 client (FakeSync in tests; Afzal's package in the app shell). */
  client: SyncClient;
  /** Committed local events, for the exit/payment duplicate guards. Promise-based (OQ-37
   * feedback) so this binds unchanged to either `FakeSync.listEvents()` or the real on-device
   * `SqliteOutboxStore.listEvents()` (inherently async) once Afzal's facade composes one — see
   * `ic02.ts`'s `SyncClient` doc and `T-IC02-GATE-1`. Delegate to `listEvents()`; do not add a
   * synchronous events read here. */
  readEvents(): Promise<readonly Event[]>;
  /** Facility claim of the log-in (envelope facility_id; ingest rejects a different value). */
  facilityId: string;
  deviceId: string;
  /** Active staff on the device (envelope staff_id; blank fails validation closed). */
  staffId: string;
  /** Injected clock for `device_time` (D.15: tests inject a fake clock; never a raw Date.now). */
  now(): string;
  /** Event id minting, injectable for deterministic tests (default: UUIDv7 from domain/token). */
  generateId?: () => string;
};

/**
 * An action draft, at the gate's business level. The stamping layer maps it to the exact IC-01
 * envelope + payload shape: the contracts parser (parseEvent) then decides validity — there is no
 * second validation authority and no event reaches the client unstamped.
 */
export type EventDraft =
  | {
      type: "ENTRY";
      session_id: string;
      payload: EventOf<"ENTRY">["payload"];
    }
  | {
      type: "EXIT";
      session_id: string;
      payload: EventOf<"EXIT">["payload"];
    }
  | {
      type: "PAYMENT";
      session_id: string;
      payload: EventOf<"PAYMENT">["payload"];
    }
  | {
      type: "OVERRIDE";
      session_id: string;
      target_event_id: string;
      reason_code: ReasonCode;
      note?: string;
      change?: Record<string, unknown>;
    }
  | {
      type: "ZONE_COUNT";
      payload: EventOf<"ZONE_COUNT">["payload"];
    }
  | {
      type: "SHIFT_OPEN";
      payload: EventOf<"SHIFT_OPEN">["payload"];
    }
  | {
      type: "SHIFT_CLOSE";
      payload: EventOf<"SHIFT_CLOSE">["payload"];
    };

/** IC-01 validation failure detail for the caller (paper-sheet errors log the detail). */
export class WriteRuleError extends Error {
  constructor(
    readonly reason: "VALIDATION" | "ALREADY_EXITED" | "SECOND_PAYMENT" | "OVERRIDE_RULES",
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
  const id = (deps.generateId ?? defaultUuidV7)();
  const isSessionEvent =
    draft.type === "ENTRY" ||
    draft.type === "EXIT" ||
    draft.type === "PAYMENT" ||
    draft.type === "OVERRIDE";
  const candidate = {
    id,
    type: draft.type,
    facility_id: deps.facilityId,
    device_id: deps.deviceId,
    staff_id: deps.staffId,
    device_time: deps.now(),
    source: "LIVE",
    schema_version: SCHEMA_VERSION,
    session_id: isSessionEvent ? draft.session_id : null,
    payload:
      draft.type === "OVERRIDE"
        ? {
            target_event_id: draft.target_event_id,
            reason_code: draft.reason_code,
            note: draft.note,
            change: draft.change,
          }
        : draft.payload,
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
  /** Screen-button mode intent (all four modes are IC-01-payable since SYNC-01). */
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
  /** How the session was resolved (GATE-02 rule: recorded on the EXIT payload). */
  exitMethod: "SCAN" | "CODE" | "LOOKUP";
  /** Fare-audit fields (optional EXIT payload; only when the tariff id is an IC-01 uuid). */
  tariffId?: string;
  tariffVersion?: number;
  payment?: ExitPayment;
  override?: ExitOverride;
};

/**
 * `writeExit` (GATE-02 sequence 4.5, GATE-04 4.3/4.6): EXIT + PAYMENT (and for a waiver the
 * PAYMENT (mode WAIVED, 0) + the reason OVERRIDE) in ONE transaction — all stored or none
 * (T-GATE-02-I1, T-GATE-04-N3). Local guards BEFORE writing:
 *   T-GATE-02-N2  — no second exit for an already-exited session (checking local EXIT events);
 *   T-GATE-04-I1  — no second payment for an already-paid session (rejection is local);
 *   T-GATE-04-U1  — attestation true exactly on the UPI path, amount equals fare for CASH/UPI,
 *                   zero for PASS/WAIVED.
 */
export async function writeExit(deps: WriteDeps, bundle: ExitBundle): Promise<Event[]> {
  const existing = await deps.readEvents();
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
  const exitSt = stampAndValidate(deps, {
    type: "EXIT",
    session_id: bundle.sessionId,
    payload: {
      fare_paise: bundle.farePaise,
      exit_method: bundle.exitMethod,
      tariff_id: bundle.tariffId,
      tariff_version: bundle.tariffVersion,
    },
  });
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
    const paymentSt = stampAndValidate(deps, {
      type: "PAYMENT",
      session_id: bundle.sessionId,
      payload: {
        mode,
        amount_paise: amountPaise,
        upi_attested: mode === "UPI",
      },
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

  await deps.client.writeTransaction(stamped);
  return stamped;
}

/** Waiver exit bundle (GATE-04 sequence 4.6; T-GATE-04-I2): EXIT + PAYMENT(WAIVED, 0) + the
 * reason OVERRIDE in one transaction. `note` is required by validateOverrideInput when the
 * reason is OTHER; the fare is 0 because a waiver records no charge (sheet mapping). */
export function waiveExitBundle(input: {
  sessionId: string;
  entryEventId: string;
  reasonCode: ReasonCode;
  note?: string;
  exitMethod: ExitBundle["exitMethod"];
}): ExitBundle {
  return {
    sessionId: input.sessionId,
    farePaise: 0,
    exitMethod: input.exitMethod,
    payment: { mode: "WAIVED", amountPaise: 0 },
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
 * schema decision). Staff attribution rides the stamped envelope (`staff_id`). */
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
