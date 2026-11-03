import { z } from "zod";

export const CONFLICT_TYPES = [
  "DUPLICATE_EXIT",
  "ORPHAN_EXIT",
  "DUPLICATE_ENTRY",
  "CLOCK_SKEW",
] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];

export const CONFLICT_STATUSES = ["OPEN", "RESOLVED"] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

export const CONFLICT_ACTIONS = [
  "KEEP_FIRST",
  "KEEP_SECOND",
  "MARK_AS_TEST_ENTRY",
  "ADD_NOTE",
  "ACKNOWLEDGE",
] as const;
export type ConflictAction = (typeof CONFLICT_ACTIONS)[number];

export const CONFLICT_ACTION_LABELS: Readonly<Record<ConflictAction, string>> = {
  KEEP_FIRST: "Keep first",
  KEEP_SECOND: "Keep second",
  MARK_AS_TEST_ENTRY: "Mark as test entry",
  ADD_NOTE: "Add note",
  ACKNOWLEDGE: "Acknowledge",
};

const instant = z.iso.datetime({ offset: true });

/** The exact row returned by public.sync_conflicts in migration 0006. */
export const SyncConflictRowSchema = z
  .strictObject({
    id: z.uuid(),
    facility_id: z.uuid(),
    type: z.enum(CONFLICT_TYPES),
    event_ids: z.array(z.uuid()).min(1),
    session_id: z.uuid().nullable(),
    dedupe_key: z.uuid(),
    status: z.enum(CONFLICT_STATUSES),
    detail: z.json(),
    created_at: instant,
    resolved_by: z.uuid().nullable(),
    resolved_at: instant.nullable(),
  })
  .superRefine((row, ctx) => {
    const timestampMatchesStatus =
      (row.status === "RESOLVED" && row.resolved_at !== null) ||
      (row.status === "OPEN" && row.resolved_at === null);
    if (!timestampMatchesStatus) {
      ctx.addIssue({
        code: "custom",
        path: ["resolved_at"],
        message: "resolved_at must be set exactly when status is RESOLVED",
      });
    }
  });

export type SyncConflictRow = z.infer<typeof SyncConflictRowSchema>;

/** Parse one database row without dropping unknown columns or accepting a partial row. */
export function parseSyncConflictRow(input: unknown): SyncConflictRow {
  return SyncConflictRowSchema.parse(input);
}

/** Parse a complete query result atomically. One invalid row rejects the whole result. */
export function parseSyncConflictRows(input: unknown): SyncConflictRow[] {
  return z.array(SyncConflictRowSchema).parse(input);
}

function instantMs(value: string): number {
  const parsed = instant.safeParse(value);
  if (!parsed.success) {
    throw new RangeError("Expected an ISO 8601 instant with Z or an offset.");
  }
  return Date.parse(parsed.data);
}

/** Whole minutes since the conflict was created, rounded down and never negative. */
export function conflictAgeMinutes(createdAt: string, nowIso: string): number {
  return Math.max(0, Math.floor((instantMs(nowIso) - instantMs(createdAt)) / 60_000));
}

/** Sheet C7 rule: an OPEN conflict becomes an exception only after more than 24 elapsed hours. */
export function isUnresolvedOver24Hours(
  conflict: Pick<SyncConflictRow, "status" | "created_at">,
  nowIso: string,
): boolean {
  return (
    conflict.status === "OPEN" &&
    instantMs(nowIso) - instantMs(conflict.created_at) > 24 * 60 * 60_000
  );
}

const RESOLUTION_ACTIONS = [
  "KEEP_FIRST",
  "KEEP_SECOND",
  "MARK_AS_TEST_ENTRY",
  "ADD_NOTE",
] as const satisfies readonly ConflictAction[];
const CLOCK_SKEW_ACTIONS = ["ADD_NOTE", "ACKNOWLEDGE"] as const satisfies readonly ConflictAction[];

/** Actions permitted by CON-07 for a conflict type. CLOCK_SKEW never offers event selection. */
export function allowedConflictActions(type: ConflictType): readonly ConflictAction[] {
  return type === "CLOCK_SKEW" ? CLOCK_SKEW_ACTIONS : RESOLUTION_ACTIONS;
}
