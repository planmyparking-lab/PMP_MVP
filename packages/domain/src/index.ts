// Fare engine (GATE-03, IC-04) — the single fare calculation shared by the gate app and the Console.
// Tariff schema and types come from @pmp/contracts (single tariff schema home, IC-04).
export {
  fare,
  durationMinutes,
  FareError,
  isFareError,
  IST_OFFSET_MINUTES,
  istDateString,
  parseInstant,
} from "./fare";
export type { FareErrorCode, FareComputation, FareStep } from "./fare";
export { explainFare } from "./explainFare";
export type { ExplainFareReport } from "./explainFare";
