"use client";

import { useActionState, useEffect } from "react";
import { addConflictNote } from "../../app/conflicts/actions";
import { CONFLICT_ACTION_LABELS, allowedConflictActions } from "../lib/conflicts";
import type { ConflictType } from "../lib/conflicts";
import { MAX_CONFLICT_NOTE_LENGTH } from "../lib/conflictNotes";
import type { ConflictNote } from "../lib/conflictNotes";
import { ACTION_IDLE } from "../lib/credentialActions";
import type { ActionState } from "../lib/credentialActions";
import { formatIstDateTime } from "../lib/format";
import { Modal } from "./ui/Modal";
import { Button, UnavailableButton } from "./ui/primitives";
import { useToast } from "./ui/Toast";

export interface ConflictReviewTarget {
  id: string;
  type: ConflictType;
  typeLabel: string;
  typeText: string;
  eventCount: number;
}

/** Why the deciding actions stay disabled (OQ-49). */
export const DECIDE_UNAVAILABLE =
  "Closing a conflict needs the resolve_conflict function, which changes the status and records the decision together. It is not built yet (OQ-49).";

/**
 * CON-07 review dialog: what the conflict means, the notes recorded so far, and "Add note". Notes never close the
 * conflict. The deciding actions are listed but disabled until resolve_conflict exists.
 */
export function ConflictReviewDialog({
  target,
  notes,
  notesUnavailable,
  userId,
  onClose,
}: {
  target: ConflictReviewTarget | null;
  notes: readonly ConflictNote[];
  /** Set when notes cannot be read or written yet; the form is then hidden and this reason shown. */
  notesUnavailable: string | null;
  userId: string | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={target ? `${target.typeLabel}: review` : "Review conflict"}
    >
      {target && (
        <div className="stack">
          <p>{target.typeText}</p>
          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>
              Decisions
            </div>
            <div className="row">
              {allowedConflictActions(target.type)
                .filter((a) => a !== "ADD_NOTE")
                .map((a) => (
                  <UnavailableButton key={a} reason={DECIDE_UNAVAILABLE}>
                    {CONFLICT_ACTION_LABELS[a]}
                  </UnavailableButton>
                ))}
            </div>
          </div>

          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>
              Notes ({notes.length})
            </div>
            {notes.length === 0 ? (
              <p className="small muted">No notes yet.</p>
            ) : (
              <ul className="note-list">
                {notes.map((n) => (
                  <li key={n.id}>
                    <div className="small muted">
                      {n.resolvedBy === userId ? "You" : "Another owner or manager"} ·{" "}
                      {formatIstDateTime(n.resolvedAt)}
                      {n.action !== "ADD_NOTE" ? ` · ${n.action}` : ""}
                    </div>
                    <div>{n.note || "(no text)"}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {notesUnavailable ? (
            <div className="issue tone-info">
              <div>{notesUnavailable}</div>
            </div>
          ) : (
            <NoteForm key={target.id} conflictId={target.id} onDone={onClose} />
          )}
        </div>
      )}
    </Modal>
  );
}

function NoteForm({ conflictId, onDone }: { conflictId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    addConflictNote,
    ACTION_IDLE,
  );
  const toast = useToast();
  useEffect(() => {
    if (state.ok && state.message) {
      toast(state.message);
      onDone();
    }
  }, [state, toast, onDone]);

  return (
    <form action={action} className="stack-sm">
      <input suppressHydrationWarning type="hidden" name="conflict_id" value={conflictId} />
      <div className="field">
        <label htmlFor="conflict-note">Add a note</label>
        <textarea
          suppressHydrationWarning
          id="conflict-note"
          name="note"
          className="input"
          rows={3}
          maxLength={MAX_CONFLICT_NOTE_LENGTH}
          placeholder="What did you check, or who will follow up?"
          required
        />
        <span className="small muted">
          The note is saved with your account and the time; the conflict stays open. Words with
          numbers (vehicle or phone numbers) are hidden when notes are shown.
        </span>
      </div>
      {!state.ok && state.message && (
        <div className="issue tone-bad" role="alert">
          <div>{state.message}</div>
        </div>
      )}
      <Button variant="primary" type="submit" disabled={pending} icon="check">
        {pending ? "Saving…" : "Save note"}
      </Button>
    </form>
  );
}
