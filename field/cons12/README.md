# CON-12: baseline time-and-motion study and ROI statement

Owner: Anamika. Source of truth: `docs/team/member-03-anamika.md` (section C12, D12, Appendices 1 to 3).
This folder holds **blank templates and a calculator only**. No fieldwork has been done and no
facility data is in this repository. Raw sheets from real facilities must not be committed with
vehicle numbers, faces or guard names.

## Files

| File                      | Purpose                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `entry-exit-cycles.csv`   | Appendix 1: one row per timed entry or exit                                                         |
| `shift-closes.csv`        | Appendix 1: one row per timed shift close                                                           |
| `disputes.csv`            | Appendix 1: one row per timed gate dispute                                                          |
| `wage-and-volume.md`      | Appendix 2: wage and volume record, one per facility                                                |
| `roi-statement.md`        | Appendix 3: one-page ROI statement, one per facility                                                |
| `roi.mjs`, `roi.test.mjs` | Calculator for the formula in D12, and its tests (run with `node --test field/cons12/roi.test.mjs`) |

## Protocol (from D12)

- **Sample per facility:** 10 shift closes, 50 entry/exit cycles (25 entries, 25 exits), 10 gate disputes,
  across a normal and a peak period. If fewer than 10 disputes occur, extend the observation or label the
  sample small. Do not invent rows (T-CON-12-N1).
- **Timing:** stopwatch, whole seconds, one observer per gate. Use the same observer method and sampling at
  the start (E1) and again at pilot end (E2).
- **Start and stop points:**
  - Entry: vehicle stops at the barrier until ticket handed or barrier lifted.
  - Exit: ticket presented until barrier lifted after payment.
  - Shift close: first cash count until supervisor signature.
  - Dispute: first complaint until resolution.
- **Excluded:** queue waiting caused by traffic, breaks, training time. Record guard-caused delay separately
  from queue delay in `notes`.
- **Privacy:** record gate and time only. Use a guard code, never a name. No vehicle numbers or faces.
- **Wage:** use the facility's own guard pay or a local labour rate. Label it an estimate if it is not from
  the facility.

## Calculation

```
staff-hours per day = (mean entry/exit seconds x daily vehicles
                       + mean shift-close seconds x shifts per day
                       + mean dispute seconds x disputes per day) / 3600
rupees per month    = staff-hours per day x wage per hour x operating days
```

Money is held in integer paise. Worked example (T-CON-12-U1): 40 s, 600 vehicles, 2 shifts of 1,800 s and
3 disputes of 300 s gives 6.67 + 1.00 + 0.25 = about 7.9 hours per day.

## Decision rule (D12)

- **Pass:** median of the facility hours-per-day figures is at least 1.5 **and** the rupee value is at least
  3 times the proposed monthly price.
- **Kill:** median under 0.75 hours per day. The manpower-savings story fails; re-anchor on revenue leakage,
  overstay recovery and renewal reporting (Phase 2 plan section 20).
- **Neither:** everything between, or hours pass but the rupee test fails. `roi.mjs` reports `"neither"`.

## Open points (see `docs/team/open-questions-and-assumptions.md`, OQ-36)

The sheet does not say whether "mean entry/exit seconds" per vehicle is one combined mean or the entry mean
plus the exit mean, nor which rupee figure the 3x test uses. `roi.mjs` takes the per-vehicle seconds as an
input and uses the median of the facility rupee values, so the decision stays visible in the call.
