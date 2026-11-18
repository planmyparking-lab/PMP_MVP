"use client";

import { useActionState, useEffect, useState } from "react";
import { deactivateGuard, revokeDevice } from "../../app/devices/actions";
import { ACTION_IDLE } from "../lib/credentialActions";
import type { ActionState } from "../lib/credentialActions";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/primitives";
import { useToast } from "./ui/Toast";

const COPY = {
  guard: {
    button: "Deactivate",
    title: (name: string) => `Deactivate ${name}?`,
    body: "From now on the cloud refuses every event signed by this guard, including events recorded earlier that are still waiting on a phone to sync. Events already in the cloud stay as they are. The phones may still accept this guard's PIN until the gate app supports removing it, but anything recorded with it will not reach the cloud.",
    warning:
      "Reactivating later needs a new PIN, which the Console cannot set yet (set_staff_pin is not built).",
    submit: "Deactivate guard",
    field: "staff_id",
  },
  phone: {
    button: "Revoke",
    title: (name: string) => `Revoke ${name}?`,
    body: "The phone's next sync is refused, including events still waiting on it, and it can no longer read this facility. Events already in the cloud stay as they are.",
    warning:
      "This cannot be undone from the Console. Using the phone again needs a new enrolment (enroll_device is not built yet).",
    submit: "Revoke phone",
    field: "device_id",
  },
} as const;

/**
 * CON-02: one destructive credential action behind a confirmation dialog. The server action re-checks everything; the
 * facility and the actor never come from this form.
 */
export function CredentialAction({
  kind,
  id,
  name,
  queueNote,
}: {
  kind: "guard" | "phone";
  id: string;
  name: string;
  /** What happens to events still waiting to sync, built from the heartbeats (see credentialActions.ts). */
  queueNote: string;
}) {
  const [open, setOpen] = useState(false);
  const copy = COPY[kind];
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={kind === "guard" ? "x" : "lock"}
        onClick={() => setOpen(true)}
      >
        {copy.button}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={copy.title(name)}>
        {open && (
          <ConfirmForm kind={kind} id={id} queueNote={queueNote} onDone={() => setOpen(false)} />
        )}
      </Modal>
    </>
  );
}

function ConfirmForm({
  kind,
  id,
  queueNote,
  onDone,
}: {
  kind: "guard" | "phone";
  id: string;
  queueNote: string;
  onDone: () => void;
}) {
  const copy = COPY[kind];
  const [state, action, pending] = useActionState<ActionState, FormData>(
    kind === "guard" ? deactivateGuard : revokeDevice,
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
    <form action={action} className="stack">
      <input suppressHydrationWarning type="hidden" name={copy.field} value={id} />
      <p>{copy.body}</p>
      <div className="issue tone-info">
        <div>
          <b>Waiting to sync:</b> {queueNote}
        </div>
      </div>
      <div className="issue tone-warn">
        <div>{copy.warning}</div>
      </div>
      {!state.ok && state.message && (
        <div className="issue tone-bad" role="alert">
          <div>{state.message}</div>
        </div>
      )}
      <Button variant="danger" type="submit" disabled={pending}>
        {pending ? "Saving…" : copy.submit}
      </Button>
    </form>
  );
}
