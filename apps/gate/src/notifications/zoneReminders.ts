import { parseInstant } from "@pmp/domain";

/**
 * Zone-count reminder times (GATE-08 sequence 4.4, test T-GATE-08-U1).
 *
 * The sheet: schedule two local notifications at shift open, at one-third and two-thirds of the
 * shift length; shift length unknown → facility default or 8 hours (edge cases 10). This pure
 * module computes the two instants; the expo-notifications scheduling itself is device-side
 * (src/notifications owns the wiring once the dev build exists) and must schedule exactly these
 * instants, then cancel them at shift close.
 *
 * T-GATE-08-U1: open at T, length 9 h → reminders at T+3 h and T+6 h. For lengths that do not
 * divide by three the instants are floored whole minutes — the sheet gives no fractional-hour
 * rule and notifications are minute-granular on Android.
 */

/** Documented default shift length (GATE-08 edge case 10): 8 hours. */
export const DEFAULT_SHIFT_LENGTH_MINUTES = 480;

export type ZoneReminderPlan = {
  lengthMinutes: number;
  usedDefault: boolean;
  /** Exactly two UTC ISO instants: [openAt + 1/3 length, openAt + 2/3 length]. */
  remindersIso: string[];
  reminderAlarms: { atIso: string; label: "ZONE_REMINDER_1" | "ZONE_REMINDER_2" }[];
};

export function zoneReminderTimes(
  shiftOpenedAtIso: string,
  shiftLengthMinutes: number | null | undefined,
  options: { defaultLengthMinutes?: number } = {},
): ZoneReminderPlan {
  const opened = parseInstant(shiftOpenedAtIso);
  if (opened === null) {
    throw new Error("zoneReminderTimes: shiftOpenedAtIso must be a UTC ISO 8601 instant");
  }
  const fallback = options.defaultLengthMinutes ?? DEFAULT_SHIFT_LENGTH_MINUTES;
  const requestedValid =
    typeof shiftLengthMinutes === "number" &&
    Number.isFinite(shiftLengthMinutes) &&
    shiftLengthMinutes > 0;
  const usedDefault = !requestedValid;
  const lengthMinutes = requestedValid ? (shiftLengthMinutes as number) : fallback;
  // Notifications are minute-granular; floor each offset to a whole minute.
  const firstOffsetMinutes = Math.floor(lengthMinutes / 3);
  const secondOffsetMinutes = Math.floor((lengthMinutes * 2) / 3);
  const instants = [opened + firstOffsetMinutes * 60_000, opened + secondOffsetMinutes * 60_000];
  const remindersIso = instants.map((t) => new Date(t).toISOString());
  return {
    lengthMinutes,
    usedDefault,
    remindersIso,
    reminderAlarms: [
      { atIso: remindersIso[0] as string, label: "ZONE_REMINDER_1" },
      { atIso: remindersIso[1] as string, label: "ZONE_REMINDER_2" },
    ],
  };
}
