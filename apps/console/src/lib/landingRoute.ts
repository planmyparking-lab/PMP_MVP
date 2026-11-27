import type { ConsoleSession } from "./data/types";

/**
 * The public landing page lives at "/" for signed-out visitors; a signed-in owner or manager gets the Dashboard at
 * the same address. These two rules are shared by `proxy.ts` (who may load "/") and `AppShell` (which pages render
 * without the Console sidebar), so the two can never disagree.
 */
export const LANDING_PATH = "/";

/** proxy.ts: a signed-out visitor may load the landing page instead of being sent to /login. */
export function isLandingVisit(path: string, signedIn: boolean): boolean {
  return !signedIn && path === LANDING_PATH;
}

/** app/page.tsx: show the landing page rather than the Dashboard. "offline" (no Supabase configured) keeps the
 * Dashboard's offline preview, because nobody can sign in there and /login links back to "/" for that preview. */
export function showsLanding(kind: ConsoleSession["kind"]): boolean {
  return kind === "signed-out";
}

/** AppShell: pages that render full-bleed, without the Console sidebar and top bar. */
export function isBareLayout(path: string, kind: ConsoleSession["kind"]): boolean {
  return path === "/login" || (path === LANDING_PATH && showsLanding(kind));
}
