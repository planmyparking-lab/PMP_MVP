"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "./primitives";

/**
 * Dialog built on the native <dialog> element, which supplies the focus trap, Escape to close and the backdrop.
 * `onClose` runs for every way of closing it, so the parent state always matches what is on screen.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  confirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** When given, the dialog is a confirmation: a primary action next to Cancel. */
  confirm?: { label: string; onConfirm: () => void; danger?: boolean };
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
      </div>
      <div className="modal-body">{children}</div>
      <div className="modal-foot">
        <Button variant="secondary" onClick={onClose} autoFocus={!confirm}>
          {confirm ? "Cancel" : "Close"}
        </Button>
        {confirm && (
          <Button
            variant={confirm.danger ? "danger" : "primary"}
            onClick={() => {
              confirm.onConfirm();
              onClose();
            }}
          >
            {confirm.label}
          </Button>
        )}
      </div>
    </dialog>
  );
}
