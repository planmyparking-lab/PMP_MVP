import { z } from "zod";

/**
 * CON-02 credential actions the Console can perform with the #34 column grants: deactivate a guard (`staff.active`) and
 * revoke a phone (`devices.revoked_at`). Adding a guard, setting a PIN, reactivating a guard and enrolling a phone need
 * database functions that do not exist yet (`set_staff_pin`, `create_enrollment_code`, IC-05, IC-06), so they are not
 * offered here. Row-level security is the real control; these helpers only shape input and messages.
 */
export const GuardTarget = z.object({ staff_id: z.uuid() });
export const DeviceTarget = z.object({ device_id: z.uuid() });

export interface ActionState {
  ok: boolean;
  message: string | null;
}

export const ACTION_IDLE: ActionState = { ok: false, message: null };

/** Why reactivating is not offered (sheet C2 step 3: "reactivation requires a new PIN"). */
export const REACTIVATE_UNAVAILABLE =
  "Reactivating a guard needs a new PIN, and PINs can only be set through set_staff_pin, which is not built yet.";

export const ADD_GUARD_UNAVAILABLE =
  "Adding a guard needs set_staff_pin (IC-06), which hashes the PIN in the database. It is not built yet.";

export const ADD_DEVICE_UNAVAILABLE =
  "Adding a phone needs create_enrollment_code and enroll_device (IC-05). They are not built yet.";

/** User-facing text for a failed update. Never echoes the database message. */
export function credentialUpdateError(code: string | null | undefined): string {
  switch (code) {
    case "42501":
      return "Your account cannot change this yet (row-level security is not deployed).";
    case "PGRST205":
    case "42P01":
      return "This table is not available in the database yet.";
    default:
      return "Nothing was saved. Try again in a moment.";
  }
}

/**
 * An update that matched no row is not an error in PostgREST. It means the row was already in the target state, is in
 * another facility, or row-level security hid it. All three are told the same way, because the Console cannot tell
 * them apart and must not claim more than it knows.
 */
export function nothingChanged(what: "guard" | "phone"): string {
  return what === "guard"
    ? "Nothing changed: this guard is already inactive, or your account cannot change staff in this facility yet."
    : "Nothing changed: this phone is already revoked, or your account cannot change devices in this facility yet.";
}
