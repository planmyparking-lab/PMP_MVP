import type { SecureKv } from "../auth/secureIdentity";
import { APP_LANGUAGES, type AppLanguage } from "./config";

export type LanguagePreferenceLoad =
  | { ok: true; language: AppLanguage | null }
  | { ok: false; reason: "STORE_UNAVAILABLE" | "CORRUPTED" };

function isAppLanguage(value: string): value is AppLanguage {
  return APP_LANGUAGES.some((language) => language === value);
}

export async function loadLanguagePreference(
  storage: Pick<SecureKv, "get">,
  key: string,
): Promise<LanguagePreferenceLoad> {
  let value: string | null;
  try {
    value = await storage.get(key);
  } catch {
    return { ok: false, reason: "STORE_UNAVAILABLE" };
  }
  if (value === null) return { ok: true, language: null };
  return isAppLanguage(value) ? { ok: true, language: value } : { ok: false, reason: "CORRUPTED" };
}

export async function saveLanguagePreference(
  storage: SecureKv,
  key: string,
  language: AppLanguage,
): Promise<void> {
  await storage.set(key, language);
  if ((await storage.get(key)) !== language) {
    throw new Error("Language preference did not persist");
  }
}
