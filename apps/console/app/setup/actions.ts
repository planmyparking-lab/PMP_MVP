"use server";

import { revalidatePath } from "next/cache";
import { newId } from "@pmp/contracts";
import type { ActionState } from "../../src/lib/credentialActions";
import { getConsoleSession } from "../../src/lib/data/session";
import { analyse, todayInIst } from "../../src/lib/setupDraft";
import { DraftPayload, describeSaved, planSave } from "../../src/lib/setupSave";
import type { ValidDraft } from "../../src/lib/setupSave";
import { createSupabaseServerClient } from "../../src/lib/supabase/server";

const failed = (what: string, code: string | undefined): ActionState => ({
  ok: false,
  message:
    code === "42501"
      ? `Not saved: your account may not change ${what} for this facility.`
      : `Not saved: ${what} could not be written. Nothing after that step was saved; try again.`,
});

/**
 * CON-01: saves a valid wizard draft into the session's selected facility (rules in src/lib/setupSave.ts). The
 * facility, role and actor come from the session, never from the form. Every value is re-checked here with the same
 * `analyse` the wizard uses. Writes go through the user's JWT, so the 0010 policies are the final check.
 *
 * PostgREST has no multi-statement transaction, so the writes run in a fixed order (facility, zones, tariffs) and a
 * failure reports what was not saved. A repeated save is safe: known zones and identical tariffs are skipped.
 */
export async function saveSetup(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await getConsoleSession();
  if (session.kind !== "ok" || !session.facility)
    return { ok: false, message: "Sign in and choose a facility first." };
  // The role on the selected facility (is_member() in 0010), not "owns any facility": an owner of X who manages Y
  // must save to Y as a manager, or the facility update is refused and nothing after it is written.
  const role = session.facilityRole;
  if (role !== "owner" && role !== "manager")
    return { ok: false, message: "Only an owner or manager can save facility settings." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "The Console is not connected to a database." };

  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("draft") ?? ""));
  } catch {
    return { ok: false, message: "The setup could not be read. Reload the page and try again." };
  }
  const parsed = DraftPayload.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "The setup could not be read. Reload the page and try again." };

  const today = todayInIst();
  const a = analyse(parsed.data, today);
  // Steps 1-3 are what this save writes; the overstay threshold (step 4) is not stored yet (CON-09).
  if (a.stepErrors[1] + a.stepErrors[2] + a.stepErrors[3] > 0)
    return { ok: false, message: "Fix the problems shown in the wizard before saving." };

  const facility = session.facility;
  const draft: ValidDraft = {
    name: parsed.data.name.trim(),
    slotCount: Number(parsed.data.slotCount.trim()),
    zones: parsed.data.zones.map((z) => ({
      name: z.name.trim(),
      capacity: Number(z.capacity.trim()),
      vehicleClass: z.vehicleClass.trim(),
    })),
    tariffs: a.tariffs.flatMap((t) => (t.tariff ? [t.tariff] : [])),
    effectiveFrom: parsed.data.effectiveFrom,
  };

  const [zonesRes, tariffsRes] = await Promise.all([
    supabase
      .from("zones")
      .select("id, name, capacity, vehicle_class")
      .eq("facility_id", facility.id),
    supabase
      .from("tariffs")
      .select("vehicle_class, effective_from, rule_json")
      .eq("facility_id", facility.id),
  ]);
  if (zonesRes.error || tariffsRes.error)
    return {
      ok: false,
      message: "Not saved: the facility's current zones and tariffs could not be read.",
    };

  const result = planSave({
    draft,
    facility: { id: facility.id, name: facility.name, slotCount: facility.slotCount },
    role,
    zones: (zonesRes.data ?? []).map((z) => ({
      id: String(z.id),
      name: String(z.name),
      capacity: Number(z.capacity),
      vehicleClass: String(z.vehicle_class),
    })),
    tariffs: (tariffsRes.data ?? []).map((t) => ({
      vehicleClass: String(t.vehicle_class),
      effectiveFrom: String(t.effective_from),
      ruleJson: t.rule_json,
    })),
    newId,
  });
  if (!result.ok) return { ok: false, message: result.problems.join(" ") };
  const plan = result.plan;

  if (plan.facilityUpdate) {
    const { error } = await supabase
      .from("facilities")
      .update(plan.facilityUpdate)
      .eq("id", facility.id)
      .select("id");
    if (error) return failed("the facility details", error.code);
  }
  if (plan.zoneInserts.length) {
    const { error } = await supabase.from("zones").insert(plan.zoneInserts);
    if (error) return failed("the new zones", error.code);
  }
  for (const z of plan.zoneUpdates) {
    const { error } = await supabase
      .from("zones")
      .update({ capacity: z.capacity })
      .eq("id", z.id)
      .eq("facility_id", facility.id);
    if (error) return failed(`zone "${z.name}"`, error.code);
  }
  if (plan.tariffInserts.length) {
    const { error } = await supabase.from("tariffs").insert(plan.tariffInserts);
    if (error) return failed("the tariffs", error.code);
  }

  console.info(
    JSON.stringify({
      event: "wizard.step_saved",
      actor: session.userId,
      facility: facility.id,
      zonesAdded: plan.zoneInserts.length,
      zonesChanged: plan.zoneUpdates.length,
      tariffVersions: plan.tariffInserts.map((t) => t.id),
      at: new Date().toISOString(),
    }),
  );
  revalidatePath("/setup");
  revalidatePath("/facility");
  revalidatePath("/", "layout");
  return { ok: true, message: describeSaved(plan) };
}
