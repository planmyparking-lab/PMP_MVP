/**
 * Vehicle number normalization (GATE-01 rule 9, test T-GATE-01-U6).
 * Normalize to uppercase alphanumerics: strip spaces and hyphens, uppercase A-Z; reject anything
 * that is not 4 to 12 uppercase alphanumerics afterwards (including other punctuation).
 */

const PLATE_PATTERN = /^[A-Z0-9]{4,12}$/;

export function normalizeVehicleNo(input: string): string | null {
  if (typeof input !== "string") return null;
  const stripped = input.replaceAll(/[\s-]/g, "").toUpperCase();
  return PLATE_PATTERN.test(stripped) ? stripped : null;
}
