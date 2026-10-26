import { istDateString, parseInstant } from "@pmp/domain";
import { normalizeVehicleNo } from "./plates";

/**
 * Monthly pass lookup (GATE-05 step 4.2, tests T-GATE-05-U1/U2).
 * Rows are the synced `passes` table shape (pass id, facility_id, vehicle_no, valid_to, dues);
 * sync rules already scope them to this facility, so no facility filter happens here.
 *
 * Interim state precedence (see GATE-05 section 2: "expired or dues > 0: red state"):
 *   1. not found -> NOT_FOUND ("Charge normal fare");
 *   2. dues > 0  -> DUES (dues are shown and settled first, even when the pass is expired);
 *   3. valid_to strictly before today's IST date -> EXPIRED ("valid through end of the valid_to
 *      day" — a pass expiring today is still VALID);
 *   4. else VALID.
 * Duplicate rows for one plate resolve to the later valid_to (T-GATE-05-U2; equal valid_to keeps
 * the first row). A pass whose valid_to is not a YYYY-MM-DD date is fail-closed (EXPIRED) so an
 * unprovable pass never opens the gate silently. Pass QR payloads (R: parkos-pass:<facilityId>:
 * <passId>) are NOT accepted yet — the format is pending agreement with Anamika; QR-like input
 * falls through to NOT_FOUND and the screen must keep the pass-QR path disabled until agreed.
 */

export type PassRow = {
  id: string;
  facility_id: string;
  vehicle_no: string;
  /** Validity date, YYYY-MM-DD; the pass is valid through the end of that IST day. */
  valid_to: string;
  /** Outstanding dues in paise (integer >= 0 by the synced schema). */
  dues: number;
};

export type PassState = "VALID" | "EXPIRED" | "NOT_FOUND" | "DUES";

export type PassLookupResult = {
  state: PassState;
  pass: PassRow | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function lookupPass(
  vehicleNo: string,
  passes: readonly PassRow[],
  now: string,
): PassLookupResult {
  const nowMs = parseInstant(now);
  if (nowMs === null) {
    throw new Error("lookupPass: now must be a UTC ISO 8601 instant");
  }
  const today = istDateString(nowMs);

  const normalized = normalizeVehicleNo(vehicleNo);
  if (normalized === null) {
    // Not a plate (empty, too short, punctuation, or a pass-QR payload): "Not found" path.
    return { state: "NOT_FOUND", pass: null };
  }

  let best: PassRow | null = null;
  for (const row of passes) {
    if (normalizeVehicleNo(row.vehicle_no) !== normalized) continue;
    if (best === null || row.valid_to > best.valid_to) best = row;
  }
  if (best === null) return { state: "NOT_FOUND", pass: null };

  if (typeof best.dues === "number" && best.dues > 0) {
    return { state: "DUES", pass: best };
  }
  if (!DATE_PATTERN.test(best.valid_to) || best.valid_to < today) {
    return { state: "EXPIRED", pass: best };
  }
  return { state: "VALID", pass: best };
}
