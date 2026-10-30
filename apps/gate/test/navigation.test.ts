import { describe, expect, it } from "vitest";

import { afterPassLookupNavigation, afterShiftOpenNavigation } from "../src/domain/navigation";

describe("post-shift-open navigation", () => {
  it("returns to the initiating screen, falling back to entry when there is no history", () => {
    expect(afterShiftOpenNavigation(true)).toEqual({ kind: "back" });
    expect(afterShiftOpenNavigation(false)).toEqual({ kind: "replace", route: "/entry" });
  });
});

describe("pass lookup return navigation", () => {
  it("returns to the current exit flow instead of stacking a new exit screen", () => {
    expect(afterPassLookupNavigation(true)).toEqual({ kind: "back" });
    expect(afterPassLookupNavigation(false)).toEqual({ kind: "replace", route: "/exit" });
  });
});
