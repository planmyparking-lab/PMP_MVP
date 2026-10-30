/**
 * Device-scoped secure identity storage (GATE-09 rules 11, sequence 2/5) — the injectable,
 * testable half. The device half is a 15-line SecureStore adapter in the login screen
 * (allowed native module; the sheet: "Store credentials with expo-secure-store; never in MMKV
 * or logs").
 *
 * What this module guarantees:
 * - the device id is created ONCE and then re-read (create-once, U4-style persistence for
 *   anything stored through the same adapter);
 * - every read/write goes through the injected `SecureKv` port, so the vitest suite can drive
 *   the exact same logic a device will;
 * - storage failures are surfaced as { ok: false, reason: "STORE_UNAVAILABLE" } — never
 *   swallowed, never worked around with MMKV or an in-memory fallback that would silently
 *   rotate the device id (a rotating "device id" would corrupt attribution of every event).
 */

export type SecureKv = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};

/** IC-01 envelope ids are UUIDv7 from domain/token; the device id candidate must match that. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StableIdResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; reason: "STORE_UNAVAILABLE" | "CORRUPTED"; detail: string };

/** Read-or-create a stable per-device id. Kept when present; created and re-read once when not. */
export async function loadOrCreateStableId(
  kv: SecureKv,
  key: string,
  newId: () => string,
): Promise<StableIdResult> {
  let existing: string | null;
  try {
    existing = await kv.get(key);
  } catch (error) {
    return {
      ok: false,
      reason: "STORE_UNAVAILABLE",
      detail: error instanceof Error ? error.message : "secure kv read failed",
    };
  }
  if (existing === null) {
    const candidate = newId();
    if (!UUID_PATTERN.test(candidate)) {
      return { ok: false, reason: "CORRUPTED", detail: "generated id is not a UUID" };
    }
    try {
      await kv.set(key, candidate);
      const reRead = await kv.get(key);
      if (reRead !== candidate) {
        return { ok: false, reason: "STORE_UNAVAILABLE", detail: "device id did not persist" };
      }
      return { ok: true, id: candidate, created: true };
    } catch (error) {
      return {
        ok: false,
        reason: "STORE_UNAVAILABLE",
        detail: error instanceof Error ? error.message : "secure kv write failed",
      };
    }
  }
  if (!UUID_PATTERN.test(existing)) {
    return { ok: false, reason: "CORRUPTED", detail: "stored device id is not a UUID" };
  }
  return { ok: true, id: existing, created: false };
}

/** Generic JSON record storage helpers; callers must distinguish missing from corrupt records. */
export async function loadJsonRecord<T>(kv: SecureKv, key: string): Promise<T | null> {
  const raw = await kv.get(key);
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}

export async function saveJsonRecord<T>(kv: SecureKv, key: string, value: T): Promise<void> {
  await kv.set(key, JSON.stringify(value));
}
