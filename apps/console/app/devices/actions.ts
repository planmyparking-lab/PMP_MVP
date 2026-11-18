"use server";

import { revalidatePath } from "next/cache";
import {
  credentialUpdateError,
  DeviceTarget,
  GuardTarget,
  nothingChanged,
} from "../../src/lib/credentialActions";
import type { ActionState } from "../../src/lib/credentialActions";
import { getConsoleSession } from "../../src/lib/data/session";
import { createSupabaseServerClient } from "../../src/lib/supabase/server";

/**
 * CON-02 credential actions. The facility is always the session's selected facility and the actor is the signed-in
 * user; only the target row id comes from the form. The #34 column grants allow exactly these two columns
 * (`staff.active`, `devices.revoked_at`) and its policies limit them to an owner or manager of the facility.
 * Sheet C2 asks for an audit line with the actor; it goes to the server log and never contains a PIN or a name.
 */
async function context() {
  const session = await getConsoleSession();
  if (session.kind !== "ok" || !session.facility) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  return { session, facilityId: session.facility.id, supabase };
}

function audit(event: string, actor: string, facility: string, target: string) {
  console.info(JSON.stringify({ event, actor, facility, target, at: new Date().toISOString() }));
}

export async function deactivateGuard(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await context();
  if (!ctx) return { ok: false, message: "Sign in and choose a facility first." };
  const parsed = GuardTarget.safeParse({ staff_id: form.get("staff_id") });
  if (!parsed.success)
    return { ok: false, message: "That guard could not be read. Reload the page." };

  const { data, error } = await ctx.supabase
    .from("staff")
    .update({ active: false })
    .eq("id", parsed.data.staff_id)
    .eq("facility_id", ctx.facilityId)
    .eq("active", true)
    .select("id");
  if (error) return { ok: false, message: credentialUpdateError(error.code) };
  if (!data || data.length === 0) return { ok: false, message: nothingChanged("guard") };

  audit("staff.deactivated", ctx.session.userId, ctx.facilityId, parsed.data.staff_id);
  revalidatePath("/devices");
  return {
    ok: true,
    message:
      "Guard deactivated. The cloud now refuses events signed by this guard. Phones may still accept their PIN until the gate app supports removing it.",
  };
}

export async function revokeDevice(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await context();
  if (!ctx) return { ok: false, message: "Sign in and choose a facility first." };
  const parsed = DeviceTarget.safeParse({ device_id: form.get("device_id") });
  if (!parsed.success)
    return { ok: false, message: "That phone could not be read. Reload the page." };

  const { data, error } = await ctx.supabase
    .from("devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.device_id)
    .eq("facility_id", ctx.facilityId)
    .is("revoked_at", null)
    .select("id");
  if (error) return { ok: false, message: credentialUpdateError(error.code) };
  if (!data || data.length === 0) return { ok: false, message: nothingChanged("phone") };

  audit("device.revoked", ctx.session.userId, ctx.facilityId, parsed.data.device_id);
  revalidatePath("/devices");
  return { ok: true, message: "Phone revoked. Its next sync is refused." };
}
