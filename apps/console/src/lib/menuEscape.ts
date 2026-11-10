/**
 * ARIA menu-button convention: while a menu is open, Escape closes it and returns focus to the button that
 * opened it. Kept apart from the component so the exact behaviour has a regression test without a DOM library.
 * Returns the cleanup function for a React effect.
 */
export function bindMenuEscape(
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  close: () => void,
  focusTrigger: () => void,
): () => void {
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key !== "Escape") return;
    close();
    focusTrigger();
  };
  target.addEventListener("keydown", onKey);
  return () => target.removeEventListener("keydown", onKey);
}
