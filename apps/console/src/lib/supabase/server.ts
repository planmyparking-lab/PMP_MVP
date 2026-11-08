import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseEnv } from "./env";

/**
 * Server-side Supabase client bound to the signed-in user's cookies (anon key + user JWT, so RLS applies).
 * Returns null when the Console is not configured with a Supabase project.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const env = readSupabaseEnv();
  if (!env) return null;
  const store = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // Server Components cannot write cookies; the proxy refreshes the session on every request instead.
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* called from a Server Component render */
        }
      },
    },
  });
}
