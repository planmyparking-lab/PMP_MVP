import { z } from "zod";
import { csvCell } from "./csv";

const instant = z.iso.datetime({ offset: true });

/** The exact row returned by public.open_sessions in migration 0005. */
export const OpenSessionRowSchema = z.strictObject({
  session_id: z.uuid(),
  facility_id: z.uuid(),
  entry_event_id: z.uuid(),
  zone_id: z.uuid(),
  vehicle_class: z.string(),
  short_code: z.string(),
  vehicle_no: z.string().nullable(),
  pass_id: z.uuid().nullable(),
  entry_time: instant,
  created_at: instant,
});

export type OpenSessionRow = z.infer<typeof OpenSessionRowSchema>;

/**
 * Structural CON-09 input used by the overstay rule on PR #23. It lives here so this branch does not copy or
 * modify that PR's overstay.ts file; TypeScript treats this result as compatible with its OpenSessionLike.
 */
export interface OpenSessionLike {
  sessionId: string;
  entryTime: string;
  passId: string | null;
}

export function parseOpenSessionRow(input: unknown): OpenSessionRow {
  return OpenSessionRowSchema.parse(input);
}

/** Convert the database's snake_case projection into the pure overstay-rule input. */
export function toOpenSessionLike(row: OpenSessionRow): OpenSessionLike {
  return {
    sessionId: row.session_id,
    entryTime: row.entry_time,
    passId: row.pass_id,
  };
}

export interface OpenSessionCsvOptions {
  /** OQ-26: vehicle numbers are absent unless a caller makes this explicit opt-in. */
  includeVehicleNumbers?: boolean;
}

const SAFE_COLUMNS = [
  "session_id",
  "facility_id",
  "entry_event_id",
  "zone_id",
  "vehicle_class",
  "short_code",
  "pass_id",
  "entry_time",
  "created_at",
] as const satisfies readonly (keyof OpenSessionRow)[];

/** RFC 4180-style CSV, formula-safe (see csv.ts). Vehicle numbers are excluded by default and require an explicit option. */
export function openSessionsToCsv(
  rows: readonly OpenSessionRow[],
  options: OpenSessionCsvOptions = {},
): string {
  const columns: readonly (keyof OpenSessionRow)[] = options.includeVehicleNumbers
    ? [...SAFE_COLUMNS.slice(0, 6), "vehicle_no", ...SAFE_COLUMNS.slice(6)]
    : SAFE_COLUMNS;
  const lines = [
    columns.map((column) => csvCell(column)).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}
