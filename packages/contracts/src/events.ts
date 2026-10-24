import { z } from "zod";
import { ReasonCode } from "./reasonCodes.js";

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

const uuid = z.string().uuid();
const utcTime = z.string().datetime({ offset: false }); // UTC ISO 8601 (trailing Z)
const paise = z.number().int().nonnegative();

const base = {
  id: uuid, // UUIDv7 generated on device
  device_id: z.string().min(1),
  device_time: utcTime,
  schema_version: z.number().int().positive(),
};

export const EntryEvent = z.object({ ...base, type: z.literal("ENTRY"), session_id: uuid });
export const ExitEvent = z.object({ ...base, type: z.literal("EXIT"), session_id: uuid });

export const PaymentEvent = z
  .object({
    ...base,
    type: z.literal("PAYMENT"),
    session_id: uuid,
    amount_paise: paise,
    mode: z.enum(["CASH", "UPI"]),
    upi_attested: z.boolean().default(false),
  })
  .refine((e) => !e.upi_attested || e.mode === "UPI", {
    message: "upi_attested is only valid with mode UPI",
    path: ["upi_attested"],
  });

export const OverrideEvent = z
  .object({
    ...base,
    type: z.literal("OVERRIDE"),
    session_id: uuid,
    target_event_id: uuid,
    reason_code: ReasonCode,
    note: z.string().optional(),
    change: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((e) => e.reason_code !== "OTHER" || (e.note ?? "").trim().length > 0, {
    message: "note is required when reason_code is OTHER",
    path: ["note"],
  });

// TODO(owner: Afzal/Akanksha): payloads for these three are not yet specified; envelope only.
export const ZoneCountEvent = z.object({ ...base, type: z.literal("ZONE_COUNT") });
export const ShiftOpenEvent = z.object({ ...base, type: z.literal("SHIFT_OPEN") });
export const ShiftCloseEvent = z.object({ ...base, type: z.literal("SHIFT_CLOSE") });

// Cannot use discriminatedUnion directly because some members are refined (ZodEffects).
export const EventSchema = z.union([
  EntryEvent,
  ExitEvent,
  PaymentEvent,
  OverrideEvent,
  ZoneCountEvent,
  ShiftOpenEvent,
  ShiftCloseEvent,
]);
export type Event = z.infer<typeof EventSchema>;

export type ParseResult = { ok: true; value: Event } | { ok: false; issues: z.core.$ZodIssue[] };

export function parseEvent(input: unknown): ParseResult {
  const r = EventSchema.safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, issues: r.error.issues };
}
