/**
 * Zone suggestion (GATE-01 step 4.2, tests T-GATE-01-U4/U5) and OQ-28.
 * First zone, in configured order, whose allowed classes include the class and whose occupancy
 * is below capacity; if none has space, the first allowed zone is returned with `full = true`,
 * so the guard can still admit with an override (GATE-07). When no zone allows the class at all,
 * the function returns null and the screen shows the OQ-28 warning-plus-override path.
 */

export type GateZone = {
  id: string;
  /** Allowed vehicle classes, from the facility config's zone row. */
  vehicle_class: readonly string[];
  capacity: number;
};

export type SuggestedZone = {
  zoneId: string;
  full: boolean;
};

export function suggestZone(
  classId: string,
  occupancy: Readonly<Record<string, number>>,
  zones: readonly GateZone[],
): SuggestedZone | null {
  for (const zone of zones) {
    if (!zone.vehicle_class.includes(classId)) continue;
    if (!Number.isSafeInteger(zone.capacity) || zone.capacity < 0) {
      throw new RangeError(`suggestZone: invalid capacity for zone ${zone.id}`);
    }
    const count = occupancy[zone.id] ?? 0;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError(`suggestZone: invalid occupancy for zone ${zone.id}`);
    }
    if (count < zone.capacity) {
      return { zoneId: zone.id, full: false };
    }
  }
  for (const zone of zones) {
    if (zone.vehicle_class.includes(classId)) {
      return { zoneId: zone.id, full: true };
    }
  }
  return null;
}
