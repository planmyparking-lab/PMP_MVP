import { z } from "zod";

export const REASON_CODES = [
  "LOST_TOKEN",
  "DAMAGED_TOKEN",
  "MISREAD_NUMBER",
  "WRONG_CLASS",
  "OWNER_WAIVER",
  "STAFF_VEHICLE",
  "OTHER",
] as const;

export const ReasonCode = z.enum(REASON_CODES);
export type ReasonCode = z.infer<typeof ReasonCode>;
