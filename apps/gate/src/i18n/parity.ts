/**
 * i18n key-parity check (GATE-12 sequence 4.2: "i18n/en.json and hi.json with a CI check that
 * both files have the same keys"; T-GATE-12 has a parity row in the U tests).
 *
 * Pure deep comparison between the two dictionaries: key trees must match exactly, values must
 * be non-empty strings. The actual screen wiring (i18next, language switch, Hindi default) is
 * app-shell work that needs the Expo dev build; this module is the checkable core.
 */

export type I18nDict = Record<string, unknown>;

export type I18nParityResult =
  | { ok: true }
  | { ok: false; missingInHi: string[]; missingInEn: string[]; invalidValues: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function leafKeys(dict: I18nDict, prefix: string, out: string[]): string[] {
  for (const key of Object.keys(dict)) {
    const value = dict[key];
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (isPlainObject(value)) {
      leafKeys(value as I18nDict, path, out);
    } else {
      out.push(path);
    }
  }
  return out.sort();
}

function collectLeafErrors(dict: I18nDict, prefix: string, out: string[]): void {
  for (const key of Object.keys(dict)) {
    const value = dict[key];
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (isPlainObject(value)) {
      collectLeafErrors(value as I18nDict, path, out);
    } else if (typeof value !== "string" || (value as string).trim().length === 0) {
      out.push(path);
    }
  }
  out.sort();
}

export function checkI18nParity(en: I18nDict, hi: I18nDict): I18nParityResult {
  const missingInHi: string[] = [];
  const missingInEn: string[] = [];
  const enKeys = leafKeys(en, "", []);
  const hiKeys = leafKeys(hi, "", []);
  const hiSet = new Set(hiKeys);
  const enSet = new Set(enKeys);
  for (const key of enKeys) if (!hiSet.has(key)) missingInHi.push(key);
  for (const key of hiKeys) if (!enSet.has(key)) missingInEn.push(key);
  if (missingInHi.length > 0 || missingInEn.length > 0) {
    return { ok: false, missingInHi, missingInEn, invalidValues: [] };
  }
  const invalidValues: string[] = [];
  collectLeafErrors(en, "", invalidValues);
  collectLeafErrors(hi, "", invalidValues);
  if (invalidValues.length > 0) return { ok: false, missingInHi, missingInEn, invalidValues };
  return { ok: true };
}
