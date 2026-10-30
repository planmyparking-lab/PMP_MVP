/**
 * Money formatting/parsing for the guard-facing screens (GATE-02/GATE-04/GATE-06 input and
 * display amounts — the sheet says amounts "in paise" internally; guards think in rupees).
 *
 * Pure and exact: paise stay safe integers; formatted strings are the only interface to the
 * user, and typed rupee amounts parse back without float arithmetic (split on the dot).
 */

/** 5230 → "₹52.30". Never rounds; negative amounts are not a UI concept (assert-safe). */
export function formatPaise(paise: number): string {
  if (!Number.isSafeInteger(paise)) throw new Error("formatPaise: paise must be an integer");
  const sign = paise < 0 ? "-" : "";
  const absolute = Math.abs(paise);
  const rupees = Math.floor(absolute / 100);
  const paiseRest = absolute - rupees * 100;
  return `${sign}₹${rupees}.${String(paiseRest).padStart(2, "0")}`;
}

/** Typed rupee input ("52", "52.3", "52.35", "0.05") → integer paise; null when invalid.
 * "12.345" is more precision than paise → null (do not silently round money). */
export function parseRupeeInput(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const parts = trimmed.split(".");
  const rupees = parts[0] ?? "";
  const rest = parts[1] ?? "";
  const paise =
    Number(rupees) * 100 +
    (rest.length === 0 ? 0 : rest.length === 1 ? Number(rest) * 10 : Number(rest));
  if (!Number.isSafeInteger(paise)) return null;
  return paise;
}

/** "3 mins ago"-style age display for the status screen; minutes when an hour or more fits. */
export function humanizeAgeMs(ms: number): string {
  if (ms <= 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes - hours * 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours - days * 24}h`;
}
