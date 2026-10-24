/** Money is ALWAYS integer paise. Never floating point. */
export type Paise = number;

export function isPaise(n: unknown): n is Paise {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

/** Convert a rupee amount (e.g. 12.5) to paise. Rejects more than 2 decimals and negatives. */
export function toPaise(rupees: number): Paise {
  const paise = Math.round(rupees * 100);
  if (!Number.isFinite(rupees) || rupees < 0 || Math.abs(rupees * 100 - paise) > 1e-6) {
    throw new RangeError(`Invalid rupee amount: ${rupees}`);
  }
  return paise;
}

export function formatRupees(paise: Paise): string {
  if (!isPaise(paise)) throw new RangeError(`Invalid paise: ${paise}`);
  const rupees = Math.floor(paise / 100);
  const rem = paise % 100;
  return `₹${rupees.toLocaleString("en-IN")}.${String(rem).padStart(2, "0")}`;
}
