import { z } from "zod";
import { maskNote } from "./activity";

/**
 * CON-07 "Add note". A note is one append-only `conflict_resolutions` row with action ADD_NOTE (0007; insert policy in
 * #34). It never changes the conflict's status: which actions close a conflict is OQ-49, and closing must happen in
 * the atomic `resolve_conflict` function, which does not exist yet. Keep first, Keep second, Mark as test entry and
 * Acknowledge therefore stay disabled.
 */
export const MAX_CONFLICT_NOTE_LENGTH = 500;

// Same "blank" rule as the 0007 check constraint: JavaScript trim() whitespace, including the Unicode spaces.
export const ConflictNoteInput = z.object({
  conflict_id: z.uuid(),
  note: z
    .string()
    .trim()
    .min(1, "Write a note first.")
    .max(MAX_CONFLICT_NOTE_LENGTH, `Keep the note under ${MAX_CONFLICT_NOTE_LENGTH} characters.`),
});
export type ConflictNoteInput = z.infer<typeof ConflictNoteInput>;

export type NoteCheck = { ok: true; input: ConflictNoteInput } | { ok: false; error: string };

export function checkConflictNote(raw: unknown): NoteCheck {
  const parsed = ConflictNoteInput.safeParse(raw);
  if (parsed.success) return { ok: true, input: parsed.data };
  const issue = parsed.error.issues[0];
  return {
    ok: false,
    error:
      issue?.path[0] === "note"
        ? issue.message
        : "That conflict could not be read. Reload the page and try again.",
  };
}

/** User-facing text for a failed insert. Never echoes the database message. */
export function noteInsertError(code: string | null | undefined): string {
  switch (code) {
    case "42501":
      return "Your account cannot add notes yet (row-level security is not deployed).";
    case "PGRST205":
    case "42P01":
      return "Notes are not available yet: the conflict_resolutions table is not deployed.";
    case "23514":
      return "Write a note first.";
    case "23503":
      return "This conflict no longer exists. Reload the page.";
    default:
      return "The note could not be saved. Try again in a moment.";
  }
}

export interface ConflictNote {
  id: string;
  conflictId: string;
  action: string;
  /** Masked like override notes in the activity log: words with digits are hidden (OQ-26). */
  note: string;
  resolvedBy: string;
  resolvedAt: string;
}

const NoteRow = z.object({
  id: z.string(),
  conflict_id: z.string(),
  action: z.string(),
  note: z.string().nullable(),
  resolved_by: z.string(),
  resolved_at: z.string(),
});

/** Parses `conflict_resolutions` rows (newest first) and groups them by conflict. */
export function groupConflictNotes(rows: unknown): Record<string, ConflictNote[]> {
  const out: Record<string, ConflictNote[]> = {};
  for (const r of z.array(NoteRow).parse(rows)) {
    (out[r.conflict_id] ??= []).push({
      id: r.id,
      conflictId: r.conflict_id,
      action: r.action,
      note: r.note === null ? "" : maskNote(r.note),
      resolvedBy: r.resolved_by,
      resolvedAt: r.resolved_at,
    });
  }
  return out;
}
