import {
  EntryPayload,
  ExitPayload,
  formatRupees,
  OverridePayload,
  PaymentPayload,
  ShiftClosePayload,
  ShiftOpenPayload,
  ZoneCountPayload,
} from "@pmp/contracts";
import type { EventType } from "@pmp/contracts";
import { formatSignedRupees } from "./shifts";

/**
 * Activity log (P0-7 override log, and the rest of the gate's event stream): one readable line per event. Every
 * payload is checked with the shared contract schema; a row that does not match is shown as such, never guessed.
 * Vehicle numbers from the payload are never part of the text, and digit-bearing words in free-text override notes
 * are masked (OQ-26).
 */
export interface EventRowIn {
  id: string;
  type: string;
  device_time: string;
  received_at: string;
  source: string;
  staff_id: string;
  device_id: string;
  session_id: string | null;
  payload: unknown;
}

export interface ActivityLine {
  id: string;
  type: EventType | "UNKNOWN";
  /** When the phone says it happened (shown). */
  deviceTime: string;
  /** When the cloud received it (window and order), so late syncs and paper backfills are not lost. */
  receivedAt: string;
  backfill: boolean;
  staffId: string;
  deviceId: string;
  sessionId: string | null;
  /** Human summary; never contains a vehicle number. */
  detail: string;
  /** Highlights overrides, waived payments, zone-count drift and unreadable rows. */
  attention: boolean;
  valid: boolean;
}

export const REASON_LABELS: Readonly<Record<string, string>> = {
  LOST_TOKEN: "Lost token",
  DAMAGED_TOKEN: "Damaged token",
  MISREAD_NUMBER: "Misread number",
  WRONG_CLASS: "Wrong vehicle class",
  OWNER_WAIVER: "Owner waiver",
  STAFF_VEHICLE: "Staff vehicle",
  OTHER: "Other",
};

const EXIT_LABEL: Readonly<Record<string, string>> = {
  SCAN: "token scanned",
  CODE: "code typed",
  LOOKUP: "looked up",
};

const MODE_LABEL: Readonly<Record<string, string>> = {
  CASH: "cash",
  UPI: "UPI",
  PASS: "pass",
  WAIVED: "waived",
};

/**
 * Free-text notes are typed by staff and may contain a plate or a phone number. Every word that contains a digit is
 * replaced with bullets, so "Plate MH12AB1234, call 98765 43210" reads "Plate ••••, call •••• ••••". This removes the
 * usual plate and phone shapes; it is not a guarantee for a number written out in words.
 */
export function maskNote(note: string): string {
  return note.trim().replace(/[\p{L}\p{N}_-]*\p{N}[\p{L}\p{N}_-]*/gu, "••••");
}

/** Minutes between the claimed time and receipt above which the log says the event arrived late. */
export const LATE_SYNC_MINUTES = 10;

export const ACTIVITY_WINDOW_DAYS = 7;
export const ACTIVITY_LIMIT = 500;

export const ACTIVITY_TYPES = [
  "ENTRY",
  "EXIT",
  "PAYMENT",
  "OVERRIDE",
  "ZONE_COUNT",
  "SHIFT_OPEN",
  "SHIFT_CLOSE",
] as const satisfies readonly EventType[];

const KNOWN = new Set<string>(ACTIVITY_TYPES);

export function summarizeEvent(row: EventRowIn, zoneName: (id: string) => string): ActivityLine {
  const base = {
    id: row.id,
    type: (KNOWN.has(row.type) ? row.type : "UNKNOWN") as ActivityLine["type"],
    deviceTime: row.device_time,
    receivedAt: row.received_at,
    backfill: row.source === "PAPER_BACKFILL",
    staffId: row.staff_id,
    deviceId: row.device_id,
    sessionId: row.session_id,
  };
  const bad = (): ActivityLine => ({
    ...base,
    detail: "Payload does not match the event contract",
    attention: true,
    valid: false,
  });
  const ok = (detail: string, attention = false): ActivityLine => ({
    ...base,
    detail,
    attention,
    valid: true,
  });

  switch (row.type) {
    case "ENTRY": {
      const p = EntryPayload.safeParse(row.payload);
      if (!p.success) return bad();
      return ok(
        `Token ${p.data.short_code} · ${p.data.vehicle_class} · ${zoneName(p.data.zone_id)}${p.data.pass_id ? " · monthly pass" : ""}`,
      );
    }
    case "EXIT": {
      const p = ExitPayload.safeParse(row.payload);
      if (!p.success) return bad();
      return ok(
        `Fare ${formatRupees(p.data.fare_paise)} · ${EXIT_LABEL[p.data.exit_method] ?? p.data.exit_method}`,
      );
    }
    case "PAYMENT": {
      const p = PaymentPayload.safeParse(row.payload);
      if (!p.success) return bad();
      const mode = MODE_LABEL[p.data.mode] ?? p.data.mode;
      const attested =
        p.data.mode === "UPI" ? (p.data.upi_attested ? ", attested" : ", not attested") : "";
      return ok(
        `${formatRupees(p.data.amount_paise)} ${mode}${attested}`,
        p.data.mode === "WAIVED",
      );
    }
    case "OVERRIDE": {
      const p = OverridePayload.safeParse(row.payload);
      if (!p.success) return bad();
      const note = p.data.note === undefined ? "" : maskNote(p.data.note);
      return ok(
        `${REASON_LABELS[p.data.reason_code] ?? p.data.reason_code}${note ? `: ${note}` : ""}`,
        true,
      );
    }
    case "ZONE_COUNT": {
      const p = ZoneCountPayload.safeParse(row.payload);
      if (!p.success) return bad();
      const drift = p.data.counted - p.data.system_count_at_time;
      return ok(
        `${zoneName(p.data.zone_id)}: counted ${p.data.counted}, system showed ${p.data.system_count_at_time}${drift === 0 ? "" : ` (${drift > 0 ? "+" : ""}${drift})`}`,
        drift !== 0,
      );
    }
    case "SHIFT_OPEN": {
      const p = ShiftOpenPayload.safeParse(row.payload);
      if (!p.success) return bad();
      return ok(`Shift opened with ${formatRupees(p.data.opening_float_paise)} float`);
    }
    case "SHIFT_CLOSE": {
      const p = ShiftClosePayload.safeParse(row.payload);
      if (!p.success) return bad();
      const v = p.data.variance_cash_paise;
      return ok(
        `Counted ${formatRupees(p.data.counted_cash_paise)} of ${formatRupees(p.data.expected_cash_paise)} expected${v === 0 ? "" : ` (${formatSignedRupees(v)})`}`,
        v !== 0 || p.data.variance_upi_paise !== 0,
      );
    }
    default:
      return bad();
  }
}

/** Filters accepted from the URL. Anything else is ignored, never passed to the database. */
export interface ActivityFilter {
  type: (typeof ACTIVITY_TYPES)[number] | null;
  sessionId: string | null;
  eventIds: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseActivityFilter(
  params: Record<string, string | string[] | undefined>,
): ActivityFilter {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const type = one("type").toUpperCase();
  const session = one("session");
  const ids = one("events")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID.test(s))
    .slice(0, 20);
  return {
    type: (ACTIVITY_TYPES as readonly string[]).includes(type)
      ? (type as ActivityFilter["type"])
      : null,
    sessionId: UUID.test(session) ? session : null,
    eventIds: ids,
  };
}
