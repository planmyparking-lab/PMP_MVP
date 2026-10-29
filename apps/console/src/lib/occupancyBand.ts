export type OccupancyBand = "low" | "medium" | "high";

export interface OccupancyView {
  band: OccupancyBand;
  /** Unrounded percentage of capacity, using the raw occupied count. */
  percent: number;
  /** Count to display: never below 0 and never above capacity. */
  displayed: number;
  /** True when the reported count exceeds capacity; the UI must show an "over capacity" flag. */
  overCapacity: boolean;
}

/**
 * CON-04: below 70% is low, 70 to 90% inclusive is medium, above 90% is high.
 * Thresholds are marked (R) in docs/team/member-03-anamika.md section C4.
 * The count itself always comes from `v_zone_now`; this only classifies it for display.
 */
export function occupancyView(occupied: number, capacity: number): OccupancyView {
  if (!Number.isInteger(occupied)) throw new RangeError(`Invalid occupied count: ${occupied}`);
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`Invalid zone capacity: ${capacity}`);
  }
  const percent = (occupied / capacity) * 100;
  const band: OccupancyBand = percent > 90 ? "high" : percent >= 70 ? "medium" : "low";
  return {
    band,
    percent,
    displayed: Math.min(Math.max(occupied, 0), capacity),
    overCapacity: occupied > capacity,
  };
}
