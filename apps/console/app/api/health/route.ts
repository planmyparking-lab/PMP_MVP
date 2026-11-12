import { createClient } from "@supabase/supabase-js";
import { checkHealth } from "../../../src/lib/health";
import { readSupabaseEnv } from "../../../src/lib/supabase/env";

/** Uptime check (CLD-10). Public and data-free: answers only `{"status": ...}`. See src/lib/health.ts. */
export async function GET(): Promise<Response> {
  const env = readSupabaseEnv();
  const result = await checkHealth(
    env
      ? async () => {
          const client = createClient(env.url, env.anonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { error, status } = await client
            .from("facilities")
            .select("id", { head: true })
            .limit(0);
          return { error, status };
        }
      : null,
  );
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
