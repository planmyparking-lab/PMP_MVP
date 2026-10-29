/** CON-09: smallest overstay threshold a facility may configure, in minutes. */
export const MIN_OVERSTAY_MINUTES = 30;

export type OverstayCheck = { ok: true; minutes: number } | { ok: false; message: string };

/** Validates a configured overstay threshold (whole minutes, at least 30). */
export function validateOverstayMinutes(minutes: unknown): OverstayCheck {
  if (typeof minutes !== "number" || !Number.isInteger(minutes)) {
    return { ok: false, message: "Enter a whole number of minutes." };
  }
  if (minutes < MIN_OVERSTAY_MINUTES) {
    return {
      ok: false,
      message: `The threshold must be at least ${MIN_OVERSTAY_MINUTES} minutes.`,
    };
  }
  return { ok: true, minutes };
}
