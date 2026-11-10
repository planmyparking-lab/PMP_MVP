/**
 * CON-03: where the Console finds its Supabase project. Only the public URL and anon key are read; the Console
 * never uses the service-role key (sheet section on security). When either value is missing or still the
 * `.env.example` placeholder, the Console runs disconnected and every screen says so instead of inventing data.
 */
export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

const PLACEHOLDERS = ["replace-me", "your-dev-project"];

function usable(value: string | undefined): value is string {
  if (!value || value.trim() === "") return false;
  return !PLACEHOLDERS.some((p) => value.includes(p));
}

export function readSupabaseEnv(
  env: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
): SupabaseEnv | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!usable(url) || !usable(anonKey)) return null;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" &&
      parsed.hostname !== "127.0.0.1" &&
      parsed.hostname !== "localhost"
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return { url: url.replace(/\/+$/, ""), anonKey };
}
