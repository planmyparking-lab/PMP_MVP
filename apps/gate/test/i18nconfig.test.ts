import { afterEach, describe, expect, it } from "vitest";

import {
  APP_LANGUAGES,
  getLanguage,
  setLanguage,
  subscribeLanguage,
  translate,
  translationParity,
} from "../src/i18n/config";

/**
 * i18n runtime (GATE-12): Hindi is the default language (the site's working language), a
 * switch is instant and listener-driven, missing keys degrade to the key itself (never a blank
 * screen), and the en/hi bundles pass the same parity gate CI runs.
 */

describe("i18n config runtime", () => {
  afterEach(() => {
    setLanguage("hi");
  });

  it("boots in Hindi with the two supported languages", () => {
    expect(getLanguage()).toBe("hi");
    expect(APP_LANGUAGES).toEqual(["en", "hi"]);
  });

  it("switches language instantly and notifies subscribers exactly once", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeLanguage((language) => seen.push(language));
    setLanguage("en");
    expect(getLanguage()).toBe("en");
    expect(seen).toEqual(["en"]);
    setLanguage("en"); // no-op: same language does not re-fire or disturb subscribers
    expect(seen).toEqual(["en"]);
    unsubscribe();
    setLanguage("hi");
    expect(seen).toEqual(["en"]);
  });

  it("resolves the CURRENT language and degrades a missing key to the key itself", () => {
    setLanguage("en");
    expect(translate("login.title")).toBe("Log in");
    expect(translate("definitely.not.a.key")).toBe("definitely.not.a.key");
    setLanguage("hi");
    expect(translate("login.title")).not.toBe("Log in");
  });

  it("interpolates parameters (banner/screen copy is parametric)", () => {
    setLanguage("en");
    expect(translate("zoneCount.capacity", { n: 8 })).toContain("8");
    setLanguage("hi");
  });

  it("passes the en/hi key parity gate at runtime (status screen row)", () => {
    expect(translationParity()).toEqual({ ok: true });
  });
});
