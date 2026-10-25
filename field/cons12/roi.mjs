// CON-12 baseline calculator. Formulas and thresholds: docs/team/member-03-anamika.md section D12.
// Money is integer paise.

export const PASS_MIN_HOURS_PER_DAY = 1.5;
export const KILL_MAX_HOURS_PER_DAY = 0.75;
export const PASS_VALUE_MULTIPLE = 3;

function assertNonNegative(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative number, got ${value}`);
  }
}

/**
 * Staff-hours per day = (vehicle seconds x vehicles + shift-close seconds x shifts
 * + dispute seconds x disputes) / 3600.
 * `meanVehicleSeconds` is the per-vehicle handling time; see OQ-36 for how to derive it.
 */
export function staffHoursPerDay(input) {
  const {
    meanVehicleSeconds,
    dailyVehicles,
    meanShiftCloseSeconds,
    shiftsPerDay,
    meanDisputeSeconds,
    disputesPerDay,
  } = input;
  for (const [k, v] of Object.entries(input)) assertNonNegative(k, v);
  return (
    (meanVehicleSeconds * dailyVehicles +
      meanShiftCloseSeconds * shiftsPerDay +
      meanDisputeSeconds * disputesPerDay) /
    3600
  );
}

/** Rupees per month, as integer paise. `wagePerHourPaise` must be an integer. */
export function paisePerMonth({ hoursPerDay, wagePerHourPaise, operatingDays }) {
  assertNonNegative("hoursPerDay", hoursPerDay);
  assertNonNegative("operatingDays", operatingDays);
  if (!Number.isInteger(wagePerHourPaise) || wagePerHourPaise < 0) {
    throw new RangeError(
      `wagePerHourPaise must be a non-negative integer, got ${wagePerHourPaise}`,
    );
  }
  return Math.round(hoursPerDay * wagePerHourPaise * operatingDays);
}

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) throw new RangeError("median of empty list");
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Applies the D12 pass bar and kill criterion across facilities.
 * facilities: [{ hoursPerDay, paisePerMonth }]; proposedMonthlyPricePaise: integer.
 * Returns { result: "pass" | "kill" | "neither", medianHoursPerDay, medianPaisePerMonth }.
 */
export function evaluateBaseline({ facilities, proposedMonthlyPricePaise }) {
  if (!Array.isArray(facilities) || facilities.length === 0) {
    throw new RangeError("at least one facility is required");
  }
  if (!Number.isInteger(proposedMonthlyPricePaise) || proposedMonthlyPricePaise <= 0) {
    throw new RangeError("proposedMonthlyPricePaise must be a positive integer");
  }
  facilities.forEach((f, i) => {
    if (f === null || typeof f !== "object") {
      throw new RangeError(`facilities[${i}] must be an object, got ${f}`);
    }
    assertNonNegative(`facilities[${i}].hoursPerDay`, f.hoursPerDay);
    if (!Number.isInteger(f.paisePerMonth) || f.paisePerMonth < 0) {
      throw new RangeError(
        `facilities[${i}].paisePerMonth must be a non-negative integer, got ${f.paisePerMonth}`,
      );
    }
  });
  const medianHoursPerDay = median(facilities.map((f) => f.hoursPerDay));
  const medianPaisePerMonth = median(facilities.map((f) => f.paisePerMonth));
  let result = "neither";
  if (medianHoursPerDay < KILL_MAX_HOURS_PER_DAY) result = "kill";
  else if (
    medianHoursPerDay >= PASS_MIN_HOURS_PER_DAY &&
    medianPaisePerMonth >= PASS_VALUE_MULTIPLE * proposedMonthlyPricePaise
  ) {
    result = "pass";
  }
  return { result, medianHoursPerDay, medianPaisePerMonth };
}
