import { formatRupees, ShiftClosePayload, ShiftOpenPayload } from "@pmp/contracts";

/**
 * CON-06 (read-only part): build shift rows straight from SHIFT_OPEN and SHIFT_CLOSE events, because the shift
 * views and the `shift_reviews` table do not exist yet (OQ-51). Payloads are checked with the shared zod schemas;
 * an event whose payload does not match is counted as skipped, never guessed.
 *
 * The variance sign convention is not fixed in the specification (see `packages/contracts/src/events.ts`), so
 * variances are shown exactly as the phone sent them and only "zero" versus "not zero" is judged here.
 */
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
  /** Events whose payload failed the shared schema. */
  skipped: number;
}

/** Newest first: by close time, else open time. */
export function buildShiftRows(events: readonly ShiftEventRow[]): ShiftBuild {
  const byId = new Map<string, ShiftRow>();
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
    if (e.type === "SHIFT_OPEN") {
      const p = ShiftOpenPayload.safeParse(e.payload);
      if (!p.success) {
        skipped += 1;
        continue;
      }
      const r = row(p.data.shift_id, e);
      // The first open wins if a phone re-sent it under a new event id.
      if (r.openedAt === null || e.device_time < r.openedAt) {
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
      if (r.closedAt === null || e.device_time > r.closedAt) {
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

  const sortKey = (r: ShiftRow) => r.closedAt ?? r.openedAt ?? "";
  const rows = [...byId.values()].sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
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
