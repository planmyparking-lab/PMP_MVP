import { describe, expect, it, vi } from "vitest";

import { DEV_CONTROLS_ENABLED, developmentControlsEnabled } from "../src/lib/buildMode";

describe("development-only controls", () => {
  it("fails closed when the build flag is missing or not exactly true", () => {
    expect(developmentControlsEnabled(undefined, "true")).toBe(false);
    expect(developmentControlsEnabled(null, "true")).toBe(false);
    expect(developmentControlsEnabled(false, "true")).toBe(false);
    expect(developmentControlsEnabled(true, undefined)).toBe(false);
    expect(developmentControlsEnabled(true, false)).toBe(false);
    expect(developmentControlsEnabled(true, "TRUE")).toBe(false);
    expect(DEV_CONTROLS_ENABLED).toBe(false);
  });

  it("enables the development controls only for an explicit development build", () => {
    expect(developmentControlsEnabled(true, "true")).toBe(true);
    expect(developmentControlsEnabled(false, "true")).toBe(false);
  });

  it("keeps the production module disabled even when the public opt-in is set", async () => {
    vi.stubEnv("EXPO_PUBLIC_GATE_DEV_CONTROLS", "true");
    vi.stubGlobal("__DEV__", false);
    vi.resetModules();
    try {
      const { DEV_CONTROLS_ENABLED: productionControlsEnabled } =
        await import("../src/lib/buildMode");
      expect(productionControlsEnabled).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
