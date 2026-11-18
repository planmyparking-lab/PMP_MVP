import type { Role } from "./permissions";

/**
 * CON-03: what a signed-in user may see, worked out from their `memberships` rows (supabase 0002). Pure and
 * display-side only: the database (RLS, CLD-03) is the real control, and no policy exists yet.
 *
 * Only owner and manager memberships open the Console. A guard membership, or a user with none (a device user
 * has `devices.auth_user_id` and no membership), is denied. An owner membership with a null `facility_id` is
 * organisation-wide; a manager membership names one facility.
 */
export interface MembershipRow {
  orgId: string;
  facilityId: string | null;
  role: "owner" | "manager" | "guard";
}

export type SessionContext =
  | { access: "denied"; reason: "no_access" }
  | { access: "granted"; role: Extract<Role, "owner" | "manager">; memberships: MembershipRow[] };

export function resolveSessionContext(rows: readonly MembershipRow[]): SessionContext {
  const memberships = rows.filter((m) => m.role === "owner" || m.role === "manager");
  if (memberships.length === 0) return { access: "denied", reason: "no_access" };
  const role = memberships.some((m) => m.role === "owner") ? "owner" : "manager";
  return { access: "granted", role, memberships };
}

/**
 * The user's role on one facility, mirroring `is_member()` in 0010: a membership counts when it is in the facility's
 * organisation and is organisation-wide (null facility) or names that facility. Owner wins over manager. Use this,
 * not `SessionContext.role` (which is "owner" if the user owns anything), for any per-facility permission: an owner of
 * facility X who manages facility Y is only a manager on Y.
 */
export function roleOnFacility(
  memberships: readonly MembershipRow[],
  facility: { id: string; orgId: string },
): "owner" | "manager" | null {
  const on = memberships.filter(
    (m) => m.orgId === facility.orgId && (m.facilityId === null || m.facilityId === facility.id),
  );
  if (on.some((m) => m.role === "owner")) return "owner";
  if (on.some((m) => m.role === "manager")) return "manager";
  return null;
}

/**
 * Whether the user may open a facility page. A refusal must be shown as 404, never 403, so a foreign id does not
 * reveal that the facility exists. Managers need a membership on that facility; owners need one on its
 * organisation (organisation-wide) or on that facility.
 */
export function canOpenFacility(
  ctx: SessionContext,
  facility: { id: string; orgId: string },
): boolean {
  if (ctx.access !== "granted") return false;
  return ctx.memberships.some(
    (m) =>
      m.orgId === facility.orgId &&
      (m.facilityId === facility.id || (m.facilityId === null && m.role === "owner")),
  );
}
