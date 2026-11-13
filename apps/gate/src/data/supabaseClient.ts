import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Production Supabase client factory for `SupabaseIngestTransport` (see that file's header for the
 * full CLD-03 blocker note). A real `SupabaseClient` satisfies `SupabaseRpcClient` structurally
 * (it has `.rpc(fn, args)`), so no adapter is needed — `new SupabaseIngestTransport(client)` takes
 * this return value directly once a device session exists.
 *
 * What this factory deliberately does NOT do: sign the device in. `auth.setSession` /
 * `auth.signInWithPassword` (or whatever CLD-03's `enroll_device` decides) must run before any
 * `ingest_events` call succeeds — `authStorage` below is where GATE-09's enrollment flow
 * (`secureIdentity.ts`, `expo-secure-store`) will plug in a persistent session store once CLD-03
 * exists; until then this client holds no session and every RPC call fails closed with `28000`
 * (not authenticated), which `SupabaseIngestTransport` correctly reports as `AuthError` rather than
 * retrying forever.
 */
export interface GateAuthStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export function createGateSupabaseClient(
  url: string,
  anonKey: string,
  authStorage?: GateAuthStorage,
): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      persistSession: authStorage !== undefined,
      storage: authStorage,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}
