/**
 * CON-02: role helper used for DISPLAY only. Row-level security in the database is the real control (CR-2);
 * this mirrors the permission matrix in the Anamika sheet (D-X) so menus match what the database allows.
 */
export type Role = "owner" | "manager" | "guard" | "device" | "anonymous";

export type ConsoleAction =
  | "view_dashboard"
  | "manage_setup"
  | "manage_staff_devices"
  | "review_shifts_conflicts"
  | "view_health";

export interface Scope {
  /** True when the facility belongs to the signed-in user's own site (owner: organisation). */
  ownFacility: boolean;
}

/** Every Console action in the matrix is allowed for owner and manager on their own facility, denied otherwise. */
export function can(role: Role, _action: ConsoleAction, scope: Scope): boolean {
  return (role === "owner" || role === "manager") && scope.ownFacility;
}

/** Nobody may update or delete events from the Console (CR-7). */
export function canMutateEvents(): false {
  return false;
}

/** Sites offered in the switcher: owner all of the organisation, manager one, others none. */
export function switcherFacilities<T>(role: Role, memberships: readonly T[]): T[] {
  if (role === "owner") return [...memberships];
  if (role === "manager") return memberships.slice(0, 1);
  return [];
}
