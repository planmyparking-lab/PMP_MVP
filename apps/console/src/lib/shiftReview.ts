import { z } from "zod";
import type { ShiftRow } from "./shifts";

/**
 * CON-06 sign-off rules, checked on the server before a `shift_reviews` row is written (the #34 insert policy also
 * checks the reviewer and that a SHIFT_CLOSE exists). Sheet C6: only closed shifts; "variance above threshold
 * requires a note". The threshold is undecided (OQ-22), so the strictest reading applies: any non-zero cash or UPI
 * variance needs a note. A flag always needs a note, so the reason is recorded.
 */
export const REVIEW_STATUSES = ["approved", "flagged"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const MAX_NOTE_LENGTH = 500;

export const ReviewInput = z.object({
  shift_id: z.uuid(),
  status: z.enum(REVIEW_STATUSES),
  note: z.string().trim().max(MAX_NOTE_LENGTH).default(""),
});
export type ReviewInput = z.infer<typeof ReviewInput>;

export type ReviewCheck = { ok: true; input: ReviewInput } | { ok: false; error: string };

export function checkReview(raw: unknown, close: ShiftRow["close"]): ReviewCheck {
  const parsed = ReviewInput.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      ok: false,
      error:
        field === "note"
          ? `Keep the note under ${MAX_NOTE_LENGTH} characters.`
          : "That review could not be read. Reload the page and try again.",
    };
  }
  const input = parsed.data;
  if (close === null) return { ok: false, error: "Only a closed shift can be reviewed." };
  const hasVariance = close.varianceCashPaise !== 0 || close.varianceUpiPaise !== 0;
  if (input.note === "" && input.status === "flagged") {
    return { ok: false, error: "Add a note saying why this shift is flagged." };
  }
  if (input.note === "" && hasVariance) {
    return {
      ok: false,
      error: "This shift has a cash or UPI variance. Add a note before signing off.",
    };
  }
  return { ok: true, input };
}

/** User-facing text for a failed insert. Never echoes the database message. */
export function reviewInsertError(code: string | null | undefined): string {
  switch (code) {
    case "23505":
      return "You already recorded this decision for this shift.";
    case "42501":
      return "Your account cannot record shift reviews yet (row-level security is not deployed).";
    case "PGRST205":
    case "42P01":
      return "Shift sign-off is not available yet: the shift_reviews table is not deployed.";
    default:
      return "The review could not be saved. Try again in a moment.";
  }
}
