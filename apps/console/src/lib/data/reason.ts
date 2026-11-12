import type { ConsoleSession } from "./types";

/** Plain-language reason a page is showing its offline preview instead of live data. */
export function offlineReason(session: ConsoleSession): string {
  switch (session.kind) {
    case "offline":
      return "No Supabase project is configured for this build, so live figures show as unavailable instead of invented numbers.";
    case "signed-out":
      return "Sign in to load live figures.";
    case "denied":
      return session.detail;
    case "ok":
      return session.facility
        ? "Live data could not be loaded."
        : "You are signed in, but no facility row is readable for your account yet. Until the row-level security policies (CLD-03) are deployed, the database returns no facilities.";
  }
}
