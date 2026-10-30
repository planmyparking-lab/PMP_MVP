import { describe, expect, it } from "vitest";

import { stateAfterAppError, stateAfterAppErrorRetry } from "../src/lib/errorBoundaryState";

describe("top-level error fallback", () => {
  it("switches to the safe fallback state after an uncaught render error", () => {
    expect(stateAfterAppError()).toEqual({ hasError: true });
  });

  it("clears the error state when the fallback retry is activated", () => {
    expect(stateAfterAppErrorRetry()).toEqual({ hasError: false });
  });
});
