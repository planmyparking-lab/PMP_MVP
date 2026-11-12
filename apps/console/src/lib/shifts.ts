import { formatRupees, ShiftClosePayload, ShiftOpenPayload } from "@pmp/contracts";

/**
 * CON-06 (read-only part): build shift rows straight from SHIFT_OPEN and SHIFT_CLOSE events, because the shift
 * views and the `shift_reviews` table do not exist yet (OQ-51). Payloads are checked with the shared zod schemas;
 * an event whose payload does not match is counted as skipped, never guessed.
 *
 * The variance sign convention is not fixed in the specification (see `packages/contracts/src/events.ts`), so
 * variances are shown exactly as the phone sent them and only "zero" versus "not zero" is judged here.
 */
/** Most recent shift events the Console reads per request (the shift view will replace this, OQ-51). */
export const SHIFT_EVENT_LIMIT = 2000;

export interface ShiftEventRow {
  type: "SHIFT_OPEN" | "SHIFT_CLOSE";
  device_time: string;
  device_id: string;
  staff_id: string;
  payload: unknown;
}

export interface ShiftRow {
  shiftId: string;
  staffId: string;
  deviceId: string;
  openedAt: string | null;
  closedAt: string | null;
  openingFloatPaise: number | null;
  close: {
    countedCashPaise: number;
    expectedCashPaise: number;
    upiDeclaredPaise: number;
    upiAttestedPaise: number;
    varianceCashPaise: number;
    varianceUpiPaise: number;
    reason: string | null;
  } | null;
  /** Closed = a SHIFT_CLOSE arrived. Open = only SHIFT_OPEN so far (still running, or the close has not synced). */
  status: "closed" | "open";
}

export interface ShiftBuild {
  rows: ShiftRow[];
  /** Events whose payload failed the shared schema, or whose device_time is not a valid instant. */
  skipped: number;
}

const INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * An instant as whole microseconds since the epoch, or null when it is not a valid ISO 8601 instant.
 * Times are never compared as strings: the fraction is optional and of variable length, and the database
 * returns `+00:00` where the phone sent `Z`, so text order is not time order.
 */
export function instantMicros(value: string): number | null {
  const m = INSTANT.exec(value);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}${m[3]}`);
  if (!Number.isFinite(ms)) return null;
  const fraction = Number((m[2] ?? "").padEnd(6, "0").slice(0, 6));
  return ms * 1000 + fraction;
}

/** Newest first: by close time, else open time. */
export function buildShiftRows(events: readonly ShiftEventRow[]): ShiftBuild {
  const byId = new Map<string, ShiftRow>();
  // Comparable times kept beside each row; the row itself keeps the original text for display.
  const openedUs = new Map<string, number>();
  const closedUs = new Map<string, number>();
  let skipped = 0;

  const row = (shiftId: string, e: ShiftEventRow): ShiftRow => {
    let r = byId.get(shiftId);
    if (!r) {
      r = {
        shiftId,
        staffId: e.staff_id,
        deviceId: e.device_id,
        openedAt: null,
        closedAt: null,
        openingFloatPaise: null,
        close: null,
        status: "open",
      };
      byId.set(shiftId, r);
    }
    return r;
  };

  for (const e of events) {
    const at = instantMicros(e.device_time);
    if (at === null) {
      skipped += 1;
      continue;
    }
    if (e.type === "SHIFT_OPEN") {
      const p = ShiftOpenPayload.safeParse(e.payload);
      if (!p.success) {
        skipped += 1;
        continue;
      }
      const r = row(p.data.shift_id, e);
      // The first open wins if a phone re-sent it under a new event id.
      const prev = openedUs.get(r.shiftId);
      if (prev === undefined || at < prev) {
        openedUs.set(r.shiftId, at);
        r.openedAt = e.device_time;
        r.openingFloatPaise = p.data.opening_float_paise;
      }
    } else {
      const p = ShiftClosePayload.safeParse(e.payload);
      if (!p.success) {
        skipped += 1;
        continue;
      }
      const r = row(p.data.shift_id, e);
      // The latest close wins (an owner may reopen and close again).
      const prev = closedUs.get(r.shiftId);
      if (prev === undefined || at > prev) {
        closedUs.set(r.shiftId, at);
        r.closedAt = e.device_time;
        r.staffId = e.staff_id;
        r.deviceId = e.device_id;
        r.close = {
          countedCashPaise: p.data.counted_cash_paise,
          expectedCashPaise: p.data.expected_cash_paise,
          upiDeclaredPaise: p.data.upi_total_declared_paise,
          upiAttestedPaise: p.data.upi_attested_sum_paise,
          varianceCashPaise: p.data.variance_cash_paise,
          varianceUpiPaise: p.data.variance_upi_paise,
          reason: p.data.reason ?? null,
        };
        r.status = "closed";
      }
    }
  }

  const sortKey = (r: ShiftRow) => closedUs.get(r.shiftId) ?? openedUs.get(r.shiftId) ?? 0;
  const rows = [...byId.values()].sort((a, b) => sortKey(b) - sortKey(a));
  return { rows, skipped };
}

/** True when a closed shift reports any cash or UPI variance. */
export function hasVariance(r: ShiftRow): boolean {
  return r.close !== null && (r.close.varianceCashPaise !== 0 || r.close.varianceUpiPaise !== 0);
}

/** Signed paise as rupees: `+₹12.50`, `−₹3.00`, `₹0.00`. */
export function formatSignedRupees(paise: number): string {
  if (!Number.isSafeInteger(paise)) throw new RangeError(`Invalid paise: ${paise}`);
  if (paise === 0) return formatRupees(0);
  return `${paise > 0 ? "+" : "−"}${formatRupees(Math.abs(paise))}`;
}
