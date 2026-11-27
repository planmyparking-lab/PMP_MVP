import "server-only";
import { groupConflictNotes } from "../conflictNotes";
import type { ConflictNote } from "../conflictNotes";
import { createSupabaseServerClient } from "../supabase/server";
import { probeResult } from "./probe";
import type { Probe } from "./probe";

export const CONFLICT_NOTE_LIMIT = 500;

/**
 * Notes and other resolutions recorded for the conflicts of one facility (0007), newest first, read with the user's
 * JWT. `conflict_resolutions` has no facility column, so the facility is matched through the conflict (inner join).
 */
export async function loadConflictNotes(
  facilityId: string,
): Promise<Probe<Record<string, ConflictNote[]>>> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { state: "error", error: "not connected" };
  const res = await supabase
    .from("conflict_resolutions")
    .select(
      "id, conflict_id, action, note, resolved_by, resolved_at, sync_conflicts!inner(facility_id)",
    )
    .eq("sync_conflicts.facility_id", facilityId)
    .order("resolved_at", { ascending: false })
    .limit(CONFLICT_NOTE_LIMIT);
  return probeResult("conflict_resolutions", res, (rows) =>
    groupConflictNotes(
      (rows ?? []).map((r) => ({
        id: r.id,
        conflict_id: r.conflict_id,
        action: r.action,
        note: r.note,
        resolved_by: r.resolved_by,
        resolved_at: r.resolved_at,
      })),
    ),
  );
}
