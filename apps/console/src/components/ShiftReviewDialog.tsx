"use client";

import { useActionState, useEffect } from "react";
import { reviewShift } from "../../app/shifts/actions";
import type { ReviewState } from "../../app/shifts/actions";
import { MAX_NOTE_LENGTH } from "../lib/shiftReview";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/primitives";
import { useToast } from "./ui/Toast";

export interface ReviewTarget {
  shiftId: string;
  /** Who and when, for the dialog title. */
  label: string;
  hasVariance: boolean;
}

const INITIAL: ReviewState = { ok: false, message: null };

/**
 * CON-06 sign-off dialog. One instance per page, opened for the selected closed shift. Every rule is re-checked on
 * the server (app/shifts/actions.ts); the form only collects the decision and the note.
 */
export function ShiftReviewDialog({
  target,
  onClose,
}: {
  target: ReviewTarget | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={target ? `Review shift: ${target.label}` : "Review shift"}
    >
      {/* Keyed by shift so the form state (and any error) resets when another shift is opened. */}
      {target && <ReviewForm key={target.shiftId} target={target} onDone={onClose} />}
    </Modal>
  );
}

function ReviewForm({ target, onDone }: { target: ReviewTarget; onDone: () => void }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewShift, INITIAL);
  const toast = useToast();

  useEffect(() => {
    if (state.ok && state.message) {
      toast(state.message);
      onDone();
    }
  }, [state, toast, onDone]);

  return (
    <form action={action} className="stack">
      <input suppressHydrationWarning type="hidden" name="shift_id" value={target.shiftId} />
      <fieldset className="review-choice">
        <legend className="small muted">Decision</legend>
        <label>
          <input
            suppressHydrationWarning
            type="radio"
            name="status"
            value="approved"
            defaultChecked
          />{" "}
          Approve
        </label>
        <label>
          <input suppressHydrationWarning type="radio" name="status" value="flagged" /> Flag for
          follow-up
        </label>
      </fieldset>
      <div className="field">
        <label htmlFor="review-note">
          Note {target.hasVariance ? "(required: this shift has a variance)" : "(required to flag)"}
        </label>
        <textarea
          suppressHydrationWarning
          id="review-note"
          name="note"
          className="input"
          rows={3}
          maxLength={MAX_NOTE_LENGTH}
          placeholder="What did you check, or what needs follow-up?"
        />
      </div>
      {!state.ok && state.message && (
        <div className="issue tone-bad" role="alert">
          <div>{state.message}</div>
        </div>
      )}
      <p className="small muted">
        A review is a separate record with your account and the time. Shift events are never edited.
      </p>
      <Button variant="primary" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save review"}
      </Button>
    </form>
  );
}
