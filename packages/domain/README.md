# @pmp/domain (GATE-03, owners: Nikhil, Afzal co-owns)

`fare()` — the single, pure fare calculation shared by the gate app and the console
(integration contract IC-04). Pure and deterministic: no I/O, no clock reads, no randomness;
money is integer paise; errors are typed (`FareError` with codes `NO_TARIFF`, `INVALID_RANGE`,
`CLASS_MISMATCH`, `INVALID_TARIFF`).

Tariff rule JSON is validated against the single zod schema in `@pmp/contracts` (`parseTariff`,
IC-04). The reference fixture set lives in `src/fixtures/`:

- `tariffs.json` — the test tariffs CAR-A, CAR-B, BIKE-A, TRUCK-A, FLAT-A, NIGHT-A, MIN-A (plus
  CAR-A-WIDE, the CAR-A rule set with an open effective window, used by the F11 UTC/leap/midnight
  cases). These are test inputs, not prices.
- `fareCases.json` — the 60-case table from `docs/team/member-02-nikhil.md` section D.3. Case
  `F9-4` is kept **skipped** until OQ-20 decides between "tariff at entry" and "tariff at exit";
  the engine implements the documented default (tariff in force at entry).

`fare()` returns just the paise; `explainFare()` returns the same result plus the computation
steps for the console "try it" panel and dispute resolution. Its `blocks` list is compact:
identical full 1440-minute blocks appear once, with their count in the block-step detail; a partial
remainder appears as a separate entry. Tests: `test/fare.test.ts`
(table-driven fixture run, an independent recomputation cross-check, property tests for
monotonicity, integer money, offset invariance and performance, typed errors, input
immutability, and schema-rejection cases).
