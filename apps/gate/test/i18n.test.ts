import { describe, expect, it } from "vitest";

import enJson from "../src/i18n/en.json";
import hiJson from "../src/i18n/hi.json";
import { checkI18nParity, type I18nDict } from "../src/i18n/parity";

/** T-GATE-12 core: en.json and hi.json must have exactly the same key tree (GATE-12 seq 4.2). */
describe("i18n parity (GATE-12)", () => {
  it("the shipped dictionaries have identical key trees with non-empty values", () => {
    expect(checkI18nParity(enJson as I18nDict, hiJson as I18nDict)).toEqual({ ok: true });
  });

  it("flags keys missing from hi (the gate is the reverse check, not hi-specific)", () => {
    const en: I18nDict = { entry: { confirm: "Confirm" }, banner: { offline: "Offline" } };
    const hi: I18nDict = { entry: { confirm: "पक्का करें" } };
    expect(checkI18nParity(en, hi)).toEqual({
      ok: false,
      missingInHi: ["banner.offline"],
      missingInEn: [],
      invalidValues: [],
    });
  });

  it("flags keys missing from en", () => {
    const en: I18nDict = { entry: { confirm: "Confirm" } };
    const hi: I18nDict = { entry: { confirm: "पक्का करें", extra: "अतिरिक्त" } };
    expect(checkI18nParity(en, hi)).toEqual({
      ok: false,
      missingInHi: [],
      missingInEn: ["entry.extra"],
      invalidValues: [],
    });
  });

  it("catches non-string or empty values", () => {
    const both = { entry: { confirm: "" }, banner: { offline: 3 } };
    const same = { entry: { confirm: "x" }, banner: { offline: "y" } };
    const result = checkI18nParity(both, same);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidValues.sort()).toEqual(["banner.offline", "entry.confirm"]);
    }
  });
});
