import i18next, { type i18n as I18n } from "i18next";

import en from "./en.json";
import hi from "./hi.json";
import { checkI18nParity } from "./parity";

/**
 * i18n instance for the gate screens (GATE-12 rule 7: every string through i18n; Hindi default,
 * switchable). Plain i18next is S-listed; the react binding is not needed for a screens-thin
 * app — the exported `useI18n` (src/ui/useSyncState.ts) subscribes to the tiny listener below.
 *
 * `resources` come from the one-file-per-language bundles the parity check validates; nested
 * keys only, no dynamic key assembly. Default language Hindi (GATE-12: "Hindi default for new
 * guards"); Gate persists an explicit language choice through its existing SecureStore adapter.
 */

export const APP_LANGUAGES = ["en", "hi"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

let initialized = false;

function init(): I18n {
  if (initialized) return i18next;
  initialized = true;
  void i18next.init({
    lng: "hi",
    fallbackLng: "en",
    // the bundles are stored under the single "translation" namespace in BOTH languages
    defaultNS: "translation",
    resources: {
      en: { translation: en },
      hi: { translation: hi },
    },
    interpolation: { escapeValue: false },
    returnObjects: false,
  });
  return i18next;
}

init();

export type Translator = (key: string, options?: Record<string, unknown>) => string;

/** String lookup in the CURRENT language (key lists live ONLY in en.json/hi.json). */
export function translate(key: string, options?: Record<string, unknown>): string {
  const value = i18next.t(key, { lng: currentLanguage, ...options });
  return typeof value === "string" ? value : key;
}

export type LanguageListener = (language: AppLanguage) => void;

let currentLanguage: AppLanguage = "hi";
const listeners = new Set<LanguageListener>();

export function getLanguage(): AppLanguage {
  return currentLanguage;
}

export function setLanguage(language: AppLanguage): void {
  if (!APP_LANGUAGES.includes(language) || language === currentLanguage) return;
  currentLanguage = language;
  for (const listener of [...listeners]) listener(language);
}

export function subscribeLanguage(listener: LanguageListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Server-free invariant check used by CI (T-GATE-12-U1) and the status screen: en and hi carry
 * exactly the same key sets; report (typed summary) rather than crash the app shell. */
export function translationParity(): ReturnType<typeof checkI18nParity> {
  return checkI18nParity(en, hi);
}
