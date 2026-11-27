import type { ConsoleSession } from "./data/types";

/**
 * The public landing page lives at "/" for signed-out visitors; a signed-in owner or manager gets the Dashboard at
 * the same address. "/welcome" shows the landing page to everyone, so a signed-in user can get back to it from the
 * Console. These rules are shared by `proxy.ts` (who may load which page) and `AppShell` (which pages render without
 * the Console sidebar), so the two can never disagree.
 */
export const LANDING_PATH = "/";
export const WELCOME_PATH = "/welcome";

/** proxy.ts: pages served without a sign-in redirect. "/" only while signed out; "/welcome" always. */
export function isLandingVisit(path: string, signedIn: boolean): boolean {
  return path === WELCOME_PATH || (!signedIn && path === LANDING_PATH);
}

/** app/page.tsx: show the landing page rather than the Dashboard. "offline" (no Supabase configured) keeps the
 * Dashboard's offline preview, because nobody can sign in there. */
export function showsLanding(kind: ConsoleSession["kind"]): boolean {
  return kind === "signed-out";
}

/** AppShell: pages that render full-bleed, without the Console sidebar and top bar. */
export function isBareLayout(path: string, kind: ConsoleSession["kind"]): boolean {
  return (
    path === "/login" || path === WELCOME_PATH || (path === LANDING_PATH && showsLanding(kind))
  );
}

/** Where a signed-out visitor signs in: the landing page, remembering the page they asked for. */
export function signInUrl(next: string): string {
  return next === "/" ? "/" : `/?next=${encodeURIComponent(next)}`;
}
