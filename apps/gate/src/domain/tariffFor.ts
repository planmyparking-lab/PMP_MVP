import { FareError, istDateString, parseInstant } from "@pmp/domain";
import type { Tariff } from "@pmp/contracts";

/**
 * Effective tariff selection for the exit screen (GATE-02 step 4.3, test T-GATE-02-U4).
 *
 * The member sheet's sequence text says "effective at exit time", but its own test table
 * (T-GATE-02-U4) says "per rule chosen in OQ-20 (default: at entry)", and GATE-03's fare engine
 * prices a stay with the tariff in force at ENTRY (documented OQ-20 default). The exit screen
 * must show exactly what `fare()` will charge, so selection follows the same rule: the caller
 * passes the SESSION'S ENTRY instant and this function picks the tariff whose effective window
 * (IST date, inclusive bounds) contains it.
 *
 * Pending OQ-20: if owners ever decide "tariff at exit", this module is the single place to
 * change (call sites keep passing the entry instant; the rule becomes effectiveTo-check at exit).
 *
 * If several tariffs are effective for the same class on that date, the first in the
 * facility-provided list order wins; overlapping windows are a configuration error the Console
 * wizard must prevent (documented interim; compare fare()'s own single-tariff input).
 */
export function tariffFor(
  facilityTariffs: readonly Tariff[],
  vehicleClass: string,
  entryAt: string,
): Tariff | null {
  const instant = parseInstant(entryAt);
  if (instant === null) {
    throw new FareError("INVALID_RANGE", "tariffFor: entryAt must be a UTC ISO 8601 instant");
  }
  const day = istDateString(instant);
  for (const tariff of facilityTariffs) {
    if (tariff.vehicleClass !== vehicleClass) continue;
    if (day < tariff.effectiveFrom) continue;
    if (tariff.effectiveTo !== undefined && day > tariff.effectiveTo) continue;
    return tariff;
  }
  return null; // screen shows "No tariff for this class" and offers Waive/manager (rule 10)
}
