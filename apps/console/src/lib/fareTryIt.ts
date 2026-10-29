import { formatRupees } from "@pmp/contracts";
import type { Tariff } from "@pmp/contracts";
import { explainFare, isFareError } from "@pmp/domain";
import type { FareErrorCode } from "@pmp/domain";

/**
 * Setup-wizard "try a fare": runs the SHARED fare engine (`@pmp/domain`, the same function as the gate app) on a
 * tariff built from the wizard. Nothing here prices a stay itself; this file only turns form text into the
 * engine's inputs and its result into words.
 */
const STEP_LABEL = {
  duration: "Stay length",
  grace: "Grace period",
  blocks: "Price for the stay",
  night: "Night surcharge",
  minimum: "Minimum fare",
} as const;

const ERROR_TEXT: Record<FareErrorCode, string> = {
  NO_TARIFF: "This tariff does not cover the entry date. Check the start date of the tariff.",
  INVALID_RANGE: "The exit time must be after the entry time.",
  CLASS_MISMATCH: "The vehicle class does not match this tariff.",
  INVALID_TARIFF: "The tariff is not valid yet. Fix the errors above.",
  FARE_OVERFLOW: "The amount is too large to calculate.",
};

export interface FareStepView {
  label: string;
  detail?: string;
  runningTotal: string;
}
export type TryItResult =
  | {
      ok: true;
      fare: string;
      stay: string;
      steps: FareStepView[];
      tariffId: string;
    }
  | { ok: false; message: string };

/** `2026-11-02T10:30` typed as IST wall-clock time becomes an instant the engine accepts. */
export function istLocalToInstant(local: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00+05:30` : null;
}

const minutesText = (m: number): string => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h === 0 ? `${r} min` : r === 0 ? `${h} h` : `${h} h ${r} min`;
};

export function tryFare(
  tariff: Tariff,
  vehicleClass: string,
  entryLocal: string,
  exitLocal: string,
): TryItResult {
  const entryAt = istLocalToInstant(entryLocal);
  const exitAt = istLocalToInstant(exitLocal);
  if (!entryAt || !exitAt) return { ok: false, message: "Enter both the entry and the exit time." };
  try {
    const r = explainFare(tariff, entryAt, exitAt, vehicleClass);
    return {
      ok: true,
      fare: formatRupees(r.farePaise),
      stay: minutesText(r.durationMinutes),
      tariffId: r.tariffId,
      steps: r.steps.map((s) => ({
        label: STEP_LABEL[s.label],
        detail: s.detail,
        runningTotal: formatRupees(s.paiseAfter),
      })),
    };
  } catch (error) {
    if (isFareError(error)) return { ok: false, message: ERROR_TEXT[error.code] };
    throw error;
  }
}
