import { computeFare } from "./fare";
import type { FareComputation } from "./fare";
import type { Tariff } from "@pmp/contracts";

/**
 * Explanation variant of the fare engine (GATE-03): same inputs, same validation, same result, but
 * it also returns the computation steps so the Console "try it" panel (CON-01) and dispute
 * resolution can show how a fare was built. Throws the same typed `FareError`s as `fare()` —
 * the F10 error rows expect identical behaviour from both functions.
 */

export type ExplainFareReport = FareComputation;

export function explainFare(
  tariff: Tariff | null | undefined,
  entryAt: string,
  exitAt: string,
  vehicleClass: string,
): ExplainFareReport {
  return computeFare(tariff, entryAt, exitAt, vehicleClass);
}
