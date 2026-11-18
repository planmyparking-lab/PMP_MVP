import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { canOpenFacility, resolveSessionContext, roleOnFacility } from "../session";
import type { MembershipRow } from "../session";
import { createSupabaseServerClient } from "../supabase/server";
import type { ConsoleSession, FacilitySummary } from "./types";

export const FACILITY_COOKIE = "pmp_facility";

const NO_ACCESS_DETAIL =
  "No owner or manager membership is readable for this account. Either the account has no membership, or the row-level security policies (CLD-03) are not deployed yet, so the database returns no rows.";

/**
 * CON-03: who is signed in, their role and the facilities they may open. Cached per request so the layout and
 * the page share one round of queries. All reads use the user's JWT; RLS decides what comes back.
 */
export const getConsoleSession = cache(async (): Promise<ConsoleSession> => {
  // Session and live data are per request; never prerender them into a static page.
  await connection();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { kind: "offline" };

  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return { kind: "signed-out" };
  const email = user.email ?? "Signed-in user";

  const { data: memberRows, error: memberError } = await supabase
    .from("memberships")
    .select("org_id, facility_id, role")
    .eq("user_id", user.id);
  if (memberError) {
    return { kind: "denied", email, detail: `Could not read memberships: ${memberError.message}` };
  }
  const memberships: MembershipRow[] = (memberRows ?? []).map((m) => ({
    orgId: String(m.org_id),
    facilityId: m.facility_id === null ? null : String(m.facility_id),
    role: m.role as MembershipRow["role"],
  }));
  const ctx = resolveSessionContext(memberships);
  if (ctx.access !== "granted") return { kind: "denied", email, detail: NO_ACCESS_DETAIL };

  const orgIds = [...new Set(ctx.memberships.map((m) => m.orgId))];
  const { data: facilityRows } = await supabase
    .from("facilities")
    .select("id, org_id, name, timezone, slot_count")
    .in("org_id", orgIds)
    .order("name");
  const facilities: FacilitySummary[] = (facilityRows ?? [])
    .map((f) => ({
      id: String(f.id),
      orgId: String(f.org_id),
      name: String(f.name),
      timezone: String(f.timezone),
      slotCount: Number(f.slot_count),
    }))
    // Display-side guard only; RLS is the real control.
    .filter((f) => canOpenFacility(ctx, f));

  const chosen = (await cookies()).get(FACILITY_COOKIE)?.value;
  const facility = facilities.find((f) => f.id === chosen) ?? facilities[0] ?? null;
  const facilityRole = facility ? roleOnFacility(ctx.memberships, facility) : null;
  return { kind: "ok", userId: user.id, email, role: ctx.role, facilities, facility, facilityRole };
});
