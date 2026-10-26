import { z } from "zod";
import { ReasonCode } from "./reasonCodes";
import { isUuidV7 } from "./uuid";
import { MAX_SCHEMA_VERSION } from "./version";

/**
 * Cloud event envelope + per-type payloads (IC-01). Specification and decisions:
 * docs/integrations/event-envelope.md. Zod is the source of truth for payload shape; SQL enforces
 * only the envelope (type, source, schema_version, key columns).
 *
 * Strictness: unknown keys are REJECTED (envelope and payload). Compatibility across versions is
 * handled by schema_version / min_supported_version, not by silently ignoring fields.
 */

export const EVENT_TYPES = [
  "ENTRY",
  "EXIT",
  "PAYMENT",
  "OVERRIDE",
  "ZONE_COUNT",
  "SHIFT_OPEN",
  "SHIFT_CLOSE",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_SOURCES = ["LIVE", "PAPER_BACKFILL"] as const;
export const EventSource = z.enum(EVENT_SOURCES);

/** Event types that belong to a parking session and therefore must carry a session_id. */
export const SESSION_EVENT_TYPES = ["ENTRY", "EXIT", "PAYMENT", "OVERRIDE"] as const;

const uuid = z.uuid();
const eventId = z.uuid().refine(isUuidV7, { message: "must be a UUIDv7" });
const utcTime = z.iso.datetime(); // UTC ISO 8601, trailing Z, no offsets
const paise = z.number().int().nonnegative();
const signedPaise = z.number().int();
const count = z.number().int().nonnegative();

const envelope = {
  id: eventId, // device-generated UUIDv7, primary key
  facility_id: uuid, // ingest rejects a value different from the JWT claim
  device_id: uuid, // matches devices.id and the device claim
  staff_id: uuid, // active staff of the facility (checked by ingest)
  device_time: utcTime,
  source: EventSource,
  schema_version: z.number().int().positive().max(MAX_SCHEMA_VERSION),
};

// ---- payloads -------------------------------------------------------------------------------

export const EntryPayload = z.strictObject({
  vehicle_class: z.string().trim().min(1),
  zone_id: uuid,
  short_code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{5}$/, "5-char Crockford base32 code"),
  vehicle_no: z.string().trim().min(1).optional(),
  pass_id: uuid.optional(),
});

export const EXIT_METHODS = ["SCAN", "CODE", "LOOKUP"] as const;
export const ExitPayload = z.strictObject({
  fare_paise: paise,
  exit_method: z.enum(EXIT_METHODS),
  // Recorded so a fare can be audited later; see OQ-20 (which tariff applies) before relying on them.
  tariff_id: uuid.optional(),
  tariff_version: z.number().int().positive().optional(),
});

export const PAYMENT_MODES = ["CASH", "UPI", "PASS", "WAIVED"] as const;
export const PaymentPayload = z
  .strictObject({
    mode: z.enum(PAYMENT_MODES),
    amount_paise: paise,
    upi_attested: z.boolean(),
  })
  .refine((p) => !p.upi_attested || p.mode === "UPI", {
    message: "upi_attested is only valid with mode UPI",
    path: ["upi_attested"],
  });

export const OverridePayload = z
  .strictObject({
    target_event_id: eventId,
    reason_code: ReasonCode,
    note: z.string().optional(),
    change: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((p) => p.reason_code !== "OTHER" || (p.note ?? "").trim().length > 0, {
    message: "note is required when reason_code is OTHER",
    path: ["note"],
  });

export const ZoneCountPayload = z.strictObject({
  zone_id: uuid,
  counted: count,
  system_count_at_time: count,
});

export const ShiftOpenPayload = z.strictObject({
  shift_id: uuid,
  opening_float_paise: paise,
});

// Variances are signed. The sign convention (for example counted minus expected) is NOT yet fixed in the
// specification, so it is not cross-checked here; see docs/integrations/event-envelope.md, open items.
export const ShiftClosePayload = z.strictObject({
  shift_id: uuid,
  counted_cash_paise: paise,
  expected_cash_paise: paise,
  upi_total_declared_paise: paise,
  upi_attested_sum_paise: paise,
  variance_cash_paise: signedPaise,
  variance_upi_paise: signedPaise,
  reason: z.string().optional(),
});

// ---- events ---------------------------------------------------------------------------------

const sessionRequired = { session_id: uuid };
const sessionNull = { session_id: z.null() };

export const EntryEvent = z.strictObject({
  ...envelope,
  ...sessionRequired,
  type: z.literal("ENTRY"),
  payload: EntryPayload,
});
export const ExitEvent = z.strictObject({
  ...envelope,
  ...sessionRequired,
  type: z.literal("EXIT"),
  payload: ExitPayload,
});
export const PaymentEvent = z.strictObject({
  ...envelope,
  ...sessionRequired,
  type: z.literal("PAYMENT"),
  payload: PaymentPayload,
});
export const OverrideEvent = z.strictObject({
  ...envelope,
  ...sessionRequired,
  type: z.literal("OVERRIDE"),
  payload: OverridePayload,
});
export const ZoneCountEvent = z.strictObject({
  ...envelope,
  ...sessionNull,
  type: z.literal("ZONE_COUNT"),
  payload: ZoneCountPayload,
});
export const ShiftOpenEvent = z.strictObject({
  ...envelope,
  ...sessionNull,
  type: z.literal("SHIFT_OPEN"),
  payload: ShiftOpenPayload,
});
export const ShiftCloseEvent = z.strictObject({
  ...envelope,
  ...sessionNull,
  type: z.literal("SHIFT_CLOSE"),
  payload: ShiftClosePayload,
});

export const EventSchema = z.discriminatedUnion("type", [
  EntryEvent,
  ExitEvent,
  PaymentEvent,
  OverrideEvent,
  ZoneCountEvent,
  ShiftOpenEvent,
  ShiftCloseEvent,
]);
export type Event = z.infer<typeof EventSchema>;
export type EventOf<T extends EventType> = Extract<Event, { type: T }>;

export interface EventIssue {
  /** Dotted path of the failing field, e.g. "payload.amount_paise"; "" for the whole input. */
  path: string;
  message: string;
}

export type ParseResult = { ok: true; value: Event } | { ok: false; issues: EventIssue[] };

/** Validate unknown JSON. Never returns a partially valid event. */
export function parseEvent(input: unknown): ParseResult {
  const r = EventSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return {
    ok: false,
    issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}
