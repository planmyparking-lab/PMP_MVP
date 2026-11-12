import { describe, expect, it, vi } from "vitest";
import { bindMenuEscape } from "../src/lib/menuEscape";

const key = (k: string) => Object.assign(new Event("keydown"), { key: k });

describe("bindMenuEscape (account menu, ARIA menu-button convention)", () => {
  it("closes the menu and returns focus to the trigger on Escape", () => {
    const target = new EventTarget();
    const order: string[] = [];
    bindMenuEscape(
      target,
      () => order.push("close"),
      () => order.push("focus"),
    );
    target.dispatchEvent(key("Escape"));
    expect(order).toEqual(["close", "focus"]);
  });

  it("ignores every other key", () => {
    const target = new EventTarget();
    const close = vi.fn();
    const focus = vi.fn();
    bindMenuEscape(target, close, focus);
    for (const k of ["Enter", "Tab", "ArrowDown", "Esc", "escape", " "])
      target.dispatchEvent(key(k));
    expect(close).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it("stops listening after cleanup, so a closed menu does not react", () => {
    const target = new EventTarget();
    const close = vi.fn();
    const focus = vi.fn();
    const cleanup = bindMenuEscape(target, close, focus);
    cleanup();
    target.dispatchEvent(key("Escape"));
    expect(close).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });
});
