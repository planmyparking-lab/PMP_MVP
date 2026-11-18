"use server";

import { revalidatePath } from "next/cache";
import { checkConflictNote, noteInsertError } from "../../src/lib/conflictNotes";
import type { ActionState } from "../../src/lib/credentialActions";
import { getConsoleSession } from "../../src/lib/data/session";
import { createSupabaseServerClient } from "../../src/lib/supabase/server";

/**
 * CON-07 "Add note": one append-only `conflict_resolutions` row with action ADD_NOTE. The conflict must belong to the
 * session's selected facility (checked here, and again by the #34 insert policy), the author is the signed-in user, and
 * the conflict's status is never changed here (OQ-49: closing belongs to resolve_conflict, not built yet).
 */
export async function addConflictNote(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await getConsoleSession();
  if (session.kind !== "ok" || !session.facility) {
    return { ok: false, message: "Sign in and choose a facility first." };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "The Console is not connected to a database." };

  const check = checkConflictNote({
    conflict_id: form.get("conflict_id"),
    note: form.get("note") ?? "",
  });
  if (!check.ok) return { ok: false, message: check.error };

  const conflict = await supabase
    .from("sync_conflicts")
    .select("id")
    .eq("id", check.input.conflict_id)
    .eq("facility_id", session.facility.id)
    .maybeSingle();
  if (conflict.error) return { ok: false, message: "The conflict could not be read. Try again." };
  if (!conflict.data)
    return { ok: false, message: "This conflict is not in the selected facility." };

  const { error } = await supabase.from("conflict_resolutions").insert({
    conflict_id: check.input.conflict_id,
    action: "ADD_NOTE",
    note: check.input.note,
    resolved_by: session.userId,
  });
  if (error) return { ok: false, message: noteInsertError(error.code) };

  console.info(
    JSON.stringify({
      event: "conflict.note_added",
      actor: session.userId,
      facility: session.facility.id,
      target: check.input.conflict_id,
      at: new Date().toISOString(),
    }),
  );
  revalidatePath("/conflicts");
  return { ok: true, message: "Note added. The conflict stays open." };
}
