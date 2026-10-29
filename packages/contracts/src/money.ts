/** Money is ALWAYS integer paise. Never floating point. */
export type Paise = number;

export function isPaise(n: unknown): n is Paise {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

/**
 * Parse a rupee amount given as a decimal STRING ("10", "10.5", "10.50") into paise.
 * Strings only: numbers are rejected so no floating-point value can enter the system.
 * Rejects negatives, more than two decimals, signs, exponents and anything non-numeric.
 */
export function toPaise(rupees: string): Paise {
  if (typeof rupees !== "string") {
    throw new TypeError("toPaise expects a decimal string, not a number");
  }
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(rupees);
  if (!m) throw new RangeError(`Invalid rupee amount: ${JSON.stringify(rupees)}`);
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? "").padEnd(2, "0") || "0");
  const paise = whole * 100 + frac;
  if (!Number.isSafeInteger(paise)) throw new RangeError("Amount too large");
  return paise;
}

export function formatRupees(paise: Paise): string {
  if (!isPaise(paise)) throw new RangeError(`Invalid paise: ${paise}`);
  const rupees = Math.floor(paise / 100);
  const rem = paise % 100;
  return `₹${rupees.toLocaleString("en-IN")}.${String(rem).padStart(2, "0")}`;
}

/** a + b for two non-negative paise amounts. */
export function add(a: Paise, b: Paise): Paise {
  if (!isPaise(a) || !isPaise(b)) throw new RangeError("add expects non-negative integer paise");
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new RangeError("Amount too large");
  return sum;
}

/** a - b where the result must stay non-negative. Use signedDiff for variances. */
export function sub(a: Paise, b: Paise): Paise {
  if (!isPaise(a) || !isPaise(b)) throw new RangeError("sub expects non-negative integer paise");
  if (b > a) throw new RangeError("sub result would be negative; use signedDiff");
  return a - b;
}

/** a - b as a signed integer (for variances such as counted minus expected). */
export function signedDiff(a: Paise, b: Paise): number {
  if (!isPaise(a) || !isPaise(b))
    throw new RangeError("signedDiff expects non-negative integer paise");
  return a - b;
}
