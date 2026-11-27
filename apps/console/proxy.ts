import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { readSupabaseEnv } from "./src/lib/supabase/env";
import { sanitizeRedirect } from "./src/lib/safeRedirect";
import { isLandingVisit } from "./src/lib/landingRoute";

/** Paths reachable without a session. The report route has its own shared-secret check (CON-08). */
const PUBLIC_PATHS = ["/login"];
const SELF_AUTHENTICATED = ["/api/reports/"];
/** Answer without a session or a session refresh: the uptime check returns only a status, never data (CLD-10). */
const OPEN_ENDPOINTS = ["/api/health"];

/**
 * CON-03: refresh the Supabase session cookie on every request and send signed-out visitors to /login.
 * This is the optimistic check only; every data read goes through RLS with the user's own JWT.
 * Without a configured Supabase project the Console runs disconnected and no data exists to protect.
 */
export async function proxy(request: NextRequest) {
  const env = readSupabaseEnv();
  if (!env) return NextResponse.next();

  const path = request.nextUrl.pathname;
  if (SELF_AUTHENTICATED.some((p) => path.startsWith(p))) return NextResponse.next();
  if (OPEN_ENDPOINTS.includes(path)) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  let signedIn = false;
  try {
    const { data } = await supabase.auth.getUser();
    signedIn = data.user !== null;
  } catch {
    signedIn = false;
  }

  // The landing page at "/" is public for signed-out visitors; signed in, "/" is the Dashboard.
  if (isLandingVisit(path, signedIn)) return response;

  const isPublic = PUBLIC_PATHS.includes(path);
  if (!signedIn && !isPublic) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", sanitizeRedirect(path + request.nextUrl.search));
    return NextResponse.redirect(url);
  }
  if (signedIn && isPublic) {
    const target = sanitizeRedirect(request.nextUrl.searchParams.get("next"));
    return NextResponse.redirect(new URL(target, request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.png|favicon.ico|brand/).*)"],
};
