import type { VehicleInside } from "./data/types";
import { findOverstays, validateOverstayMinutes } from "./overstay";

/** Example threshold used until facility storage exists (OQ-46: the default value is still to be set). */
export const EXAMPLE_THRESHOLD_MINUTES = 240;

export interface OverstayListRow {
  sessionId: string;
  shortCode: string;
  zoneName: string;
  vehicleClass: string;
  entryTime: string;
  ageMinutes: number;
}

/** Reads `?threshold=` safely. Anything invalid falls back to the example threshold and says so. */
export function parseThreshold(raw: unknown): {
  minutes: number;
  fromQuery: boolean;
  error?: string;
} {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { minutes: EXAMPLE_THRESHOLD_MINUTES, fromQuery: false };
  }
  const n = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  const check = validateOverstayMinutes(n);
  return check.ok
    ? { minutes: check.minutes, fromQuery: true }
    : { minutes: EXAMPLE_THRESHOLD_MINUTES, fromQuery: false, error: check.message };
}

/** CON-09 list: vehicles inside at or over the threshold, longest first, pass holders excluded. */
export function overstayList(
  inside: readonly VehicleInside[],
  nowIso: string,
  thresholdMinutes: number,
): OverstayListRow[] {
  const byId = new Map(inside.map((v) => [v.sessionId, v]));
  return findOverstays(
    inside.map((v) => ({ sessionId: v.sessionId, entryTime: v.entryTime, passId: v.passId })),
    nowIso,
    thresholdMinutes,
  ).flatMap((o) => {
    const v = byId.get(o.sessionId);
    return v
      ? [
          {
            sessionId: o.sessionId,
            shortCode: v.shortCode,
            zoneName: v.zoneName,
            vehicleClass: v.vehicleClass,
            entryTime: o.entryTime,
            ageMinutes: o.ageMinutes,
          },
        ]
      : [];
  });
}

const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;

/** RFC 4180 CSV of the list. Vehicle numbers are never included (OQ-26). */
export function overstayCsv(rows: readonly OverstayListRow[]): string {
  const header = ["token", "zone", "vehicle_class", "entry_time", "minutes_inside", "session_id"];
  const lines = [
    header.map(cell).join(","),
    ...rows.map((r) =>
      [r.shortCode, r.zoneName, r.vehicleClass, r.entryTime, r.ageMinutes, r.sessionId]
        .map(cell)
        .join(","),
    ),
  ];
  return `${lines.join("\r\n")}\r\n`;
}
