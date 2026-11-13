// Response of the cloud function public.ingest_events (supabase/migrations/0004_ingest_events.sql and the follow-up
// validation migration, docs/integrations/ingest-events.md). Validated here because the network is not trusted to
// match the contract.
import { z } from "zod";

export const INGEST_STATUSES = ["ACCEPTED", "DUPLICATE", "REJECTED"] as const;
export type IngestStatus = (typeof INGEST_STATUSES)[number];

// Reasons the server currently emits. Unknown reasons are kept as plain strings so a newer server never breaks an
// older app; the app only branches on status.
export const KNOWN_REJECT_REASONS = [
  "INVALID_ENVELOPE",
  "INVALID_PAYLOAD",
  "CLAIM_MISMATCH",
  "STAFF_NOT_ACTIVE",
  "SCHEMA_VERSION_TOO_OLD",
  "SCHEMA_VERSION_TOO_NEW",
  "ID_COLLISION",
] as const;

export const IngestResult = z.object({
  // The id exactly as the device sent it. Absent when the server could not read a valid uuid from a malformed event.
  id: z.string().optional(),
  status: z.enum(INGEST_STATUSES),
  reason: z.string().optional(),
  // Only on REJECTED results: the field path that failed (for example "facility_id" or "payload.fare_paise"), never a
  // message or a client-supplied value. Diagnostic only; the app branches on status and never depends on its value.
  detail: z.string().optional(),
});
export type IngestResult = z.infer<typeof IngestResult>;

export const IngestResponse = z.object({
  results: z.array(IngestResult),
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  min_supported_version: z.number().int().positive(),
  server_time: z.string(),
});
export type IngestResponse = z.infer<typeof IngestResponse>;
