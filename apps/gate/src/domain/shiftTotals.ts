import type { Event } from "@pmp/contracts";

/**
 * Shift totals and closing rules (GATE-06, tests T-GATE-06-U1/U2/U3, N1/N2; rules 2, 7).
 *
 * Matching model: totals come from local events whose `device_time` falls in
 * [open, close) and whose shift id matches. IC-01 SHIFT_OPEN/SHIFT_CLOSE carry `shift_id` and
 * the totals/variance payloads (SYNC-01), so a persisted close pairs with its open by `shift_id`;
 * the open shift itself is scoped by `device_id` per OQ-23's default (the shift is per guard per
 * device), `includeOtherDevices` mirroring the facility setting "shifts span devices".
 *
 * The opening float comes from the SHIFT_OPEN payload (the source of truth since SYNC-01); the
 * close screen prefers this event value over stale UI state.
 *
 * Variance semantics exactly per the sheet:
 *   expected_cash = float + sum(CASH payments in shift)
 *   cash_variance = counted_cash − expected_cash            (T-GATE-06-U2: 119500 − 120000 = −500)
 *   upi_variance  = declared_upi − sum(UPI BEHAVIOR attested payments)   (81000 − 80000 = +1000)
 * Threshold from facility config; default when missing: 0 → reason required for ANY non-zero
 * variance (sequence 4.3, flagged by the sheet as recommendation). "Beyond" is STRICTLY greater
 * in magnitude: |variance| > threshold requires a reason (T-GATE-06-U3: 500 with threshold 500
 * is allowed without a reason; 501 requires one).
 */

export type ShiftOpenWindow = {
  deviceId: string;
  /** device_time of the SHIFT_OPEN event (UTC ISO). */
  openAt: string;
  /** device_time of the matching SHIFT_CLOSE, when the shift is closed. */
  closeAt?: string;
  /** Facility setting "shifts span devices" (OQ-23; default false = per guard per device). */
  includeOtherDevices?: boolean;
  /** The SHIFT_OPEN payload's shift_id of the open shift (undefined for pre-SYNC-01 envelope).
   * SHIFT_CLOSE must carry the same id so open and close pair up. */
  shiftId?: string | null;
  /** The SHIFT_OPEN payload's opening float (undefined when the event predates the payload). */
  openingFloatPaise?: number | null;
};

function shiftOpenFields(event: Event): { shiftId: string; openingFloatPaise: number } | null {
  if (event.type !== "SHIFT_OPEN") return null;
  return { shiftId: event.payload.shift_id, openingFloatPaise: event.payload.opening_float_paise };
}

function parsedMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function inWindow(events: readonly Event[], window: ShiftOpenWindow): Event[] {
  const openMs = parsedMs(window.openAt);
  if (openMs === null) return []; // malformed window: compute nothing rather than everything
  const closeMs = window.closeAt === undefined ? null : parsedMs(window.closeAt);
  return events.filter((e) => {
    if (!window.includeOtherDevices && e.device_id !== window.deviceId) return false;
    const at = parsedMs(e.device_time);
    if (at === null || at < openMs) return false;
    if (closeMs !== null && at >= closeMs) return false;
    return true;
  });
}

/** Events inside the shift window, for the summary screen (rule: derived, never stored). */
export function shiftWindowEvents(events: readonly Event[], window: ShiftOpenWindow): Event[] {
  return inWindow(events, window);
}

export type ModeTotals = Record<string, { count: number; amountPaise: number }>;

export type ShiftTotals = {
  window: { openAt: string; closeAt?: string };
  /** ENTRY events in the window (vehicle count; one row per entry envelope event). */
  vehicles: number;
  /** Totals by payment mode from the events present (all four IC-01 modes since SYNC-01;
   * buckets are parametric over what the shift actually recorded). */
  paymentsByMode: ModeTotals;
  upiAttested: { count: number; amountPaise: number };
  overrides: number;
};

/**
 * Totals over a shift window (T-GATE-06-U1). Payments sum per mode (UPI attested subset tracked
 * separately); ENTRY and OVERRIDE envelope events supply the vehicle and override counts.
 */
export function shiftTotals(events: readonly Event[], window: ShiftOpenWindow): ShiftTotals {
  const scoped = inWindow(events, window);
  const paymentsByMode: ModeTotals = {};
  const upiAttested = { count: 0, amountPaise: 0 };
  let vehicles = 0;
  let overrides = 0;
  for (const e of scoped) {
    if (e.type === "ENTRY") {
      vehicles += 1;
    } else if (e.type === "PAYMENT") {
      const bucket = paymentsByMode[e.payload.mode] ?? { count: 0, amountPaise: 0 };
      bucket.count += 1;
      bucket.amountPaise += e.payload.amount_paise;
      paymentsByMode[e.payload.mode] = bucket;
      if (e.payload.mode === "UPI" && e.payload.upi_attested) {
        upiAttested.count += 1;
        upiAttested.amountPaise += e.payload.amount_paise;
      }
    } else if (e.type === "OVERRIDE") {
      overrides += 1;
    }
  }
  return {
    window: { openAt: window.openAt, closeAt: window.closeAt },
    vehicles,
    paymentsByMode,
    upiAttested,
    overrides,
  };
}

/**
 * The currently open shift on a device: the latest SHIFT_OPEN event on that device (with its
 * `shift_id`/`opening_float_paise` payload since SYNC-01) that has no later SHIFT_CLOSE on the
 * same device. One open shift per guard per device (rule 7); the shift id from the payload is
 * the identity the close event must repeat.
 */
export function findOpenShift(events: readonly Event[], deviceId: string): ShiftOpenWindow | null {
  const opens = events
    .filter((e) => e.type === "SHIFT_OPEN" && e.device_id === deviceId)
    .map((e) => ({
      at: parsedMs(e.device_time),
      iso: e.device_time,
      fields: shiftOpenFields(e),
    }))
    .filter(
      (
        o,
      ): o is { at: number; iso: string; fields: { shiftId: string; openingFloatPaise: number } } =>
        o.at !== null,
    )
    .sort((a, b) => a.at - b.at);
  const closes = events
    .filter((e) => e.type === "SHIFT_CLOSE" && e.device_id === deviceId)
    .map((e) => parsedMs(e.device_time))
    .filter((at): at is number => at !== null);
  for (let i = opens.length - 1; i >= 0; i -= 1) {
    const open = opens[i] as {
      at: number;
      iso: string;
      fields: { shiftId: string; openingFloatPaise: number };
    };
    const laterClose = closes.find((at) => at >= open.at);
    if (laterClose === undefined) {
      return {
        deviceId,
        openAt: open.iso,
        shiftId: open.fields?.shiftId ?? null,
        openingFloatPaise: open.fields?.openingFloatPaise ?? null,
      };
    }
  }
  return null;
}

export type ShiftVarianceInput = {
  /** Opening float (paise); the close screen prefers the SHIFT_OPEN payload's value via
   * findOpenShift().openingFloatPaise (the caller's argument stays the fallback/login input). */
  openingFloatPaise: number;
  /** Counted cash at close (paise); 0 is valid. */
  countedCashPaise: number;
  /** UPI total read from the operator's business app at close (paise). */
  upiDeclaredPaise: number;
  totals: ShiftTotals;
  /** Facility threshold (paise); null when config missing → sheet default 0 (recommendation). */
  thresholdPaise: number | null;
};

// Field names mirror the confirmed SHIFT_CLOSE payload (packages/contracts/src/events.ts,
// ShiftClosePayload) now that SYNC-01 is merged — camelCase of expected_cash_paise,
// variance_cash_paise, upi_attested_sum_paise, variance_upi_paise (PR #7 review item 2).
export type ShiftVariance = {
  expectedCashPaise: number;
  varianceCashPaise: number;
  upiAttestedSumPaise: number;
  varianceUpiPaise: number;
  thresholdPaise: number;
  cashReasonRequired: boolean;
  upiReasonRequired: boolean;
};

function moneyOrThrow(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`computeShiftVariance: ${label} must be an integer paise amount`);
  }
  return value;
}

export function computeShiftVariance(input: ShiftVarianceInput): ShiftVariance {
  const float = moneyOrThrow(input.openingFloatPaise, "openingFloatPaise");
  const counted = moneyOrThrow(input.countedCashPaise, "countedCashPaise");
  const declared = moneyOrThrow(input.upiDeclaredPaise, "upiDeclaredPaise");
  const cash = input.totals.paymentsByMode["CASH"]?.amountPaise ?? 0;
  const threshold =
    input.thresholdPaise === null || input.thresholdPaise === undefined
      ? 0 // documented default (seq 4.3): require a reason for any non-zero variance
      : input.thresholdPaise;
  const expectedCashPaise = float + cash;
  const varianceCashPaise = counted - expectedCashPaise;
  const upiAttestedSumPaise = input.totals.upiAttested.amountPaise;
  const varianceUpiPaise = declared - upiAttestedSumPaise;
  return {
    expectedCashPaise,
    varianceCashPaise,
    upiAttestedSumPaise,
    varianceUpiPaise,
    thresholdPaise: threshold,
    cashReasonRequired: Math.abs(varianceCashPaise) > threshold,
    upiReasonRequired: Math.abs(varianceUpiPaise) > threshold,
  };
}

export type CloseValidation =
  { ok: true } | { ok: false; issue: "COUNTED_CASH_REQUIRED" | "VARIANCE_REASON_REQUIRED" };

/**
 * Closing blockers (T-GATE-06-N1/N2, rule 7): a counted cash value is required ("0 is valid,
 * empty is not") and a reason is required for any variance strictly beyond the threshold.
 * Presence of a reason when none is required is harmless.
 */
export function validateShiftClose(
  countedCashPaise: number | null | undefined,
  variance: Pick<ShiftVariance, "cashReasonRequired" | "upiReasonRequired">,
  varianceReason: string | null | undefined,
): CloseValidation {
  if (typeof countedCashPaise !== "number" || !Number.isSafeInteger(countedCashPaise)) {
    return { ok: false, issue: "COUNTED_CASH_REQUIRED" };
  }
  if (
    (variance.cashReasonRequired || variance.upiReasonRequired) &&
    (varianceReason ?? "").trim().length === 0
  ) {
    return { ok: false, issue: "VARIANCE_REASON_REQUIRED" };
  }
  return { ok: true };
}
