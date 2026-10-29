/**
 * Zone-count validation and gap display (GATE-08 sequence 4.3, rules; logs feed MET-01).
 *
 * Rule (GATE-08 seq 4.3): "On submit: validate integer 0 to capacity + 50% (warn above capacity,
 * allow with confirmation)".
 *
 * DOCUMENTED CONFLICT (OQ-47, awaiting review): the D.8-U2 table expects capacity 50 with count
 * 76 to be "warn + confirm", but a proportional limit (50 × 1.5 = 75) would reject 76 — the two
 * readings cannot both hold. `safetyLimitMode` makes the reading explicit instead of hiding it:
 * - `PROPORTIONAL_50PCT` (default, the C-section's literal text): reject above capacity × 1.5;
 * - `ABSOLUTE_PLUS_50` (the reading that satisfies D.8-U2): reject above capacity + 50.
 * Both modes warn+confirm in (capacity, limit]. Pivot to the other mode with one call-site
 * change once OQ-47 is decided.
 *
 * Persistence: the merged IC-01 ZONE_COUNT payload (zone_id, counted, system_count_at_time) can
 * represent the submitted data; the screen writes it through writeEvent (see app/zone-count.tsx).

 */

export type SafetyLimitMode = "PROPORTIONAL_50PCT" | "ABSOLUTE_PLUS_50";

/** Current Gate UI mode, surfaced in status/diagnostics without resolving OQ-47. */
export const ACTIVE_SAFETY_LIMIT_MODE: SafetyLimitMode = "ABSOLUTE_PLUS_50";

export type ZoneCountValidation =
  | { ok: true; warning?: "ABOVE_CAPACITY" }
  | { ok: false; issue: "NOT_AN_INTEGER" | "NEGATIVE" | "ABOVE_SAFETY_LIMIT" | "INVALID_CAPACITY" };

export function zoneSafetyLimit(capacity: number, mode: SafetyLimitMode): number {
  return mode === "ABSOLUTE_PLUS_50" ? capacity + 50 : Math.round(capacity * 1.5);
}

export function validateZoneCount(
  actualCount: number,
  capacity: number,
  options: { safetyLimitMode?: SafetyLimitMode } = {},
): ZoneCountValidation {
  if (!Number.isInteger(capacity) || capacity < 0) return { ok: false, issue: "INVALID_CAPACITY" };
  if (!Number.isInteger(actualCount)) return { ok: false, issue: "NOT_AN_INTEGER" };
  if (actualCount < 0) return { ok: false, issue: "NEGATIVE" };
  const limit = zoneSafetyLimit(capacity, options.safetyLimitMode ?? "PROPORTIONAL_50PCT");
  if (actualCount > limit) return { ok: false, issue: "ABOVE_SAFETY_LIMIT" };
  return actualCount > capacity ? { ok: true, warning: "ABOVE_CAPACITY" } : { ok: true };
}

export type ZoneGap = {
  /** actual − system; negative means the system over-counts (drift to reconcile). */
  gap: number;
  direction: "OVER" | "UNDER" | "EXACT";
};

/**
 * Gap shown to the guard ("app shows the system value and gap", GATE-08 behaviour) and logged
 * per zone for MET-01 (gap magnitude). actual = what the guard counted; system = the displayed
 * occupancy from `observeOccupancy` (IC-02).
 */
export function zoneGap(actualCount: number, systemCount: number): ZoneGap {
  const gap = actualCount - systemCount;
  if (gap > 0) return { gap, direction: "OVER" };
  if (gap < 0) return { gap, direction: "UNDER" };
  return { gap: 0, direction: "EXACT" };
}
