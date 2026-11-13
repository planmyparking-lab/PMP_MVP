"use server";

import { revalidatePath } from "next/cache";
import { getConsoleSession } from "../../src/lib/data/session";
import { buildShiftRows } from "../../src/lib/shifts";
import type { ShiftEventRow } from "../../src/lib/shifts";
import { checkReview, reviewInsertError } from "../../src/lib/shiftReview";
import { createSupabaseServerClient } from "../../src/lib/supabase/server";

export interface ReviewState {
  ok: boolean;
  message: string | null;
}

/**
 * CON-06 sign-off. Writes one append-only `shift_reviews` row (#31). Everything that decides the row comes from the
 * server: the facility is the session's selected facility, the reviewer is the signed-in user, and the shift's close
 * is read from the event log here, never taken from the form. The #34 insert policy repeats the reviewer and
 * closed-shift checks in the database. Events are never written.
 */
export async function reviewShift(_prev: ReviewState, form: FormData): Promise<ReviewState> {
  const session = await getConsoleSession();
  if (session.kind !== "ok" || !session.facility) {
    return { ok: false, message: "Sign in and choose a facility first." };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "The Console is not connected to a database." };

  const shiftId = String(form.get("shift_id") ?? "");
  const closes = await supabase
    .from("events")
    .select("type, device_time, device_id, staff_id, payload")
    .eq("facility_id", session.facility.id)
    .eq("type", "SHIFT_CLOSE")
    .eq("payload->>shift_id", shiftId)
    .limit(50);
  if (closes.error) return { ok: false, message: "The shift could not be read. Try again." };

  const built = buildShiftRows(
    (closes.data ?? []).map((e): ShiftEventRow => ({
      type: "SHIFT_CLOSE",
      device_time: String(e.device_time),
      device_id: String(e.device_id),
      staff_id: String(e.staff_id),
      payload: e.payload,
    })),
  );
  const close = built.rows.find((r) => r.shiftId === shiftId)?.close ?? null;

  const check = checkReview(
    { shift_id: shiftId, status: form.get("status"), note: form.get("note") ?? "" },
    close,
  );
  if (!check.ok) return { ok: false, message: check.error };

  const { error } = await supabase.from("shift_reviews").insert({
    facility_id: session.facility.id,
    shift_id: check.input.shift_id,
    reviewed_by: session.userId,
    status: check.input.status,
    note: check.input.note === "" ? null : check.input.note,
  });
  if (error) return { ok: false, message: reviewInsertError(error.code) };

  revalidatePath("/shifts");
  return {
    ok: true,
    message: check.input.status === "approved" ? "Shift signed off." : "Shift flagged.",
  };
}
