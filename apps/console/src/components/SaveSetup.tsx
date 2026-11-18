"use client";

import { useActionState, useEffect, useState } from "react";
import { saveSetup } from "../../app/setup/actions";
import { ACTION_IDLE } from "../lib/credentialActions";
import type { ActionState } from "../lib/credentialActions";
import type { SetupDraft } from "../lib/setupDraft";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/primitives";
import { useToast } from "./ui/Toast";

/** CON-01: "Save to this facility" behind a confirmation that names the facility and what a save does. */
export function SaveSetup({
  draft,
  facilityName,
  isOwner,
  disabled,
}: {
  draft: SetupDraft;
  facilityName: string;
  isOwner: boolean;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon="check" variant="primary" disabled={disabled} onClick={() => setOpen(true)}>
        Save to this facility
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Save to ${facilityName}?`}>
        {open && <ConfirmSave draft={draft} isOwner={isOwner} onDone={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function ConfirmSave({
  draft,
  isOwner,
  onDone,
}: {
  draft: SetupDraft;
  isOwner: boolean;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSetup, ACTION_IDLE);
  const toast = useToast();
  useEffect(() => {
    if (state.ok && state.message) {
      toast(state.message);
      onDone();
    }
  }, [state, toast, onDone]);

  return (
    <form action={action} className="stack">
      <input suppressHydrationWarning type="hidden" name="draft" value={JSON.stringify(draft)} />
      <ul className="small">
        <li>
          New zone names are added. A zone with the same name gets the new capacity. No zone is
          deleted.
        </li>
        <li>
          Each tariff is saved as a new version starting{" "}
          {draft.effectiveFrom || "on the chosen date"}. Earlier versions stay as they are, so past
          fares never change.
        </li>
        <li>
          {isOwner
            ? "The facility name and slot count are updated."
            : "The facility name and slot count stay as they are: only an owner can change them."}
        </li>
      </ul>
      <div className="issue tone-info">
        <div>
          The overstay threshold is not saved yet (it needs a settings table), and phones receive
          the new settings only once download sync exists.
        </div>
      </div>
      {!state.ok && state.message && (
        <div className="issue tone-bad" role="alert">
          <div>{state.message}</div>
        </div>
      )}
      <Button variant="primary" type="submit" disabled={pending} icon="check">
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
