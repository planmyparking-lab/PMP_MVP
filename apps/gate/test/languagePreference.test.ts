import { describe, expect, it } from "vitest";

import { loadLanguagePreference, saveLanguagePreference } from "../src/i18n/preference";
import type { SecureKv } from "../src/auth/secureIdentity";

function memoryKv(): SecureKv & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
  };
}

describe("language preference persistence", () => {
  it("defaults only when there is no stored preference and restores a saved language", async () => {
    const kv = memoryKv();
    await expect(loadLanguagePreference(kv, "gate.language")).resolves.toEqual({
      ok: true,
      language: null,
    });
    await saveLanguagePreference(kv, "gate.language", "en");
    await expect(loadLanguagePreference(kv, "gate.language")).resolves.toEqual({
      ok: true,
      language: "en",
    });
  });

  it("restores the saved language from a new storage adapter after simulated restart", async () => {
    const persistedValues = new Map<string, string>();
    const firstProcess: SecureKv = {
      get: async (key) => persistedValues.get(key) ?? null,
      set: async (key, value) => {
        persistedValues.set(key, value);
      },
    };
    await saveLanguagePreference(firstProcess, "gate.language", "en");

    const restartedProcess: SecureKv = {
      get: async (key) => persistedValues.get(key) ?? null,
      set: async (key, value) => {
        persistedValues.set(key, value);
      },
    };
    await expect(loadLanguagePreference(restartedProcess, "gate.language")).resolves.toEqual({
      ok: true,
      language: "en",
    });
  });

  it("distinguishes unavailable or corrupt preference storage", async () => {
    const readFailure: SecureKv = {
      get: async () => {
        throw new Error("read failed");
      },
      set: async () => {},
    };
    await expect(loadLanguagePreference(readFailure, "gate.language")).resolves.toEqual({
      ok: false,
      reason: "STORE_UNAVAILABLE",
    });

    const kv = memoryKv();
    kv.values.set("gate.language", "fr");
    await expect(loadLanguagePreference(kv, "gate.language")).resolves.toEqual({
      ok: false,
      reason: "CORRUPTED",
    });
  });

  it("surfaces write failures and no-op writes", async () => {
    const writeFailure: SecureKv = {
      get: async () => null,
      set: async () => {
        throw new Error("write failed");
      },
    };
    await expect(saveLanguagePreference(writeFailure, "gate.language", "hi")).rejects.toThrow(
      "write failed",
    );

    const noOpWrite: SecureKv = { get: async () => null, set: async () => {} };
    await expect(saveLanguagePreference(noOpWrite, "gate.language", "en")).rejects.toThrow(
      "did not persist",
    );
  });
});
