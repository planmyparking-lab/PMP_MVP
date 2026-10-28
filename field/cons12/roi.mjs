// CON-12 baseline calculator. Formulas and thresholds: docs/team/member-03-anamika.md section D12.
// Money is integer paise.
//
// Input contract: every value is a real JavaScript number (means, counts and rates the observer has already
// worked out). Numeric strings are NOT accepted here; there is no CSV reader yet, and whoever adds one must
// convert cells to numbers at that boundary. This differs on purpose from ops/metrics/pilot-metrics.mjs,
// whose row functions read raw CSV cells and therefore accept decimal numeric strings.

export const PASS_MIN_HOURS_PER_DAY = 1.5;
export const KILL_MAX_HOURS_PER_DAY = 0.75;
export const PASS_VALUE_MULTIPLE = 3;

function assertNonNegative(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative number, got ${value}`);
  }
}

const STAFF_HOURS_FIELDS = [
  "meanVehicleSeconds",
  "dailyVehicles",
  "meanShiftCloseSeconds",
  "shiftsPerDay",
  "meanDisputeSeconds",
  "disputesPerDay",
];

/**
 * Staff-hours per day = (vehicle seconds x vehicles + shift-close seconds x shifts
 * + dispute seconds x disputes) / 3600.
 * `meanVehicleSeconds` is the per-vehicle handling time; how to derive it (one combined mean, or entry mean
 * plus exit mean) is not decided yet, so the caller supplies it.
 *
 * All six fields in STAFF_HOURS_FIELDS are required. Each must be a finite, non-negative number; a missing
 * field, undefined, null, boolean, string, NaN, infinity or negative value throws a RangeError naming the
 * field. Unrelated extra keys are ignored. The result is also checked to be finite, so a CON-12 pass or kill
 * decision can never be based on NaN or Infinity.
 */
export function staffHoursPerDay(input) {
  if (input === null || typeof input !== "object") {
    throw new RangeError(`staffHoursPerDay input must be an object, got ${input}`);
  }
  for (const field of STAFF_HOURS_FIELDS) assertNonNegative(field, input[field]);
  const hours =
    (input.meanVehicleSeconds * input.dailyVehicles +
      input.meanShiftCloseSeconds * input.shiftsPerDay +
      input.meanDisputeSeconds * input.disputesPerDay) /
    3600;
  if (!Number.isFinite(hours)) {
    throw new RangeError(
      "staff-hours per day is not a finite number; check the inputs for overflow",
    );
  }
  return hours;
}

/** Rupees per month, as integer paise. `wagePerHourPaise` must be an integer. */
export function paisePerMonth({ hoursPerDay, wagePerHourPaise, operatingDays }) {
  assertNonNegative("hoursPerDay", hoursPerDay);
  assertNonNegative("operatingDays", operatingDays);
  if (!Number.isSafeInteger(wagePerHourPaise) || wagePerHourPaise < 0) {
    throw new RangeError(
      `wagePerHourPaise must be a non-negative integer within the safe range, got ${wagePerHourPaise}`,
    );
  }
  const result = Math.round(hoursPerDay * wagePerHourPaise * operatingDays);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError("paise per month is outside the safe integer range; check the inputs");
  }
  return result;
}

/** Plain median of numbers (used for hours per day). An even count averages the two middle values. */
export function median(values) {
  if (!Array.isArray(values) || values.length === 0) throw new RangeError("median of empty list");
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * TWICE the exact median of money held as integer paise, as a BigInt (so a half paisa is still a whole
 * number and nothing is ever rounded or lost). Every value must be a non-negative integer.
 * Odd count: twice the middle value. Even count: the sum of the two middle values.
 */
function doubledMedianPaise(values) {
  if (!Array.isArray(values) || values.length === 0) throw new RangeError("median of empty list");
  values.forEach((v, i) => {
    if (!Number.isSafeInteger(v) || v < 0) {
      throw new RangeError(`values[${i}] must be a non-negative integer paise amount, got ${v}`);
    }
  });
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? 2n * BigInt(s[mid]) : BigInt(s[mid - 1]) + BigInt(s[mid]);
}

/** A doubled median back to whole paise, rounding a half paisa UP (the doubled value is never negative). */
const roundHalfUp = (doubled) => Number((doubled + 1n) / 2n);

/**
 * Median of money held as integer paise, for REPORTING; the result is always a whole number of paise.
 * For an even count the two middle values are averaged and a half paisa is rounded UP (10000 and 10001 give
 * 10001), as decided in OQ-36 (Afzal). The input array is not modified. Pass or kill decisions must NOT use
 * this rounded figure: evaluateBaseline compares the exact median instead.
 */
export function medianPaise(values) {
  return roundHalfUp(doubledMedianPaise(values));
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
  if (!Number.isSafeInteger(proposedMonthlyPricePaise) || proposedMonthlyPricePaise <= 0) {
    throw new RangeError("proposedMonthlyPricePaise must be a positive safe integer");
  }
  facilities.forEach((f, i) => {
    if (f === null || typeof f !== "object") {
      throw new RangeError(`facilities[${i}] must be an object, got ${f}`);
    }
    assertNonNegative(`facilities[${i}].hoursPerDay`, f.hoursPerDay);
    if (!Number.isSafeInteger(f.paisePerMonth) || f.paisePerMonth < 0) {
      throw new RangeError(
        `facilities[${i}].paisePerMonth must be a non-negative integer within the safe range, got ${f.paisePerMonth}`,
      );
    }
  });
  const medianHoursPerDay = median(facilities.map((f) => f.hoursPerDay));
  // The reported median is rounded to whole paise, but the decision uses the EXACT median (OQ-36): both
  // sides are doubled, so a half paisa needs no decimals and rounding can never flip pass to or from neither.
  const doubledMedian = doubledMedianPaise(facilities.map((f) => f.paisePerMonth));
  const medianPaisePerMonth = roundHalfUp(doubledMedian);
  const doubledThreshold = 2n * BigInt(PASS_VALUE_MULTIPLE) * BigInt(proposedMonthlyPricePaise);
  let result = "neither";
  if (medianHoursPerDay < KILL_MAX_HOURS_PER_DAY) result = "kill";
  else if (medianHoursPerDay >= PASS_MIN_HOURS_PER_DAY && doubledMedian >= doubledThreshold) {
    result = "pass";
  }
  return { result, medianHoursPerDay, medianPaisePerMonth };
}
