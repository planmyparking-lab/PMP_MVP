# MET-01..03: pilot measurement

Owner: Anamika. Source of truth: `docs/team/member-03-anamika.md` (C14 to C16, D14). This folder holds blank
sheets, the weekly pack template and the calculation library. No audit has been performed and no pilot data
exists here. Never record vehicle numbers on any sheet.

| File                              | Feature | Purpose                                                        |
| --------------------------------- | ------- | -------------------------------------------------------------- |
| `audit-sheet.csv`                 | MET-01  | One row per zone per moment per visit                          |
| `adherence-sheet.csv`             | MET-02  | One row per audited hour                                       |
| `weekly-pack.md`                  | MET-03  | Monday pack with the 10 fixed sections                         |
| `pilot-metrics.mjs`, `*.test.mjs` | all     | Formulas, random hour draw, pack completeness check, and tests |

Run the tests (no install needed): `node --test ops/metrics/pilot-metrics.test.mjs field/cons12/roi.test.mjs`. These tests are **not** part of
`pnpm check` or CI yet; wiring them needs a change to root `package.json`/CI, which other owners review.

## Not built, and why

- `weekly.sql` and `adherence.sql`: they query `events`, `device_heartbeats`, `sync_conflicts` and `job_runs`,
  whose columns do not exist yet (CLD-02, owner Akanksha). Writing them now would invent a schema.
- A CSV-reading command line tool: add it after the open points in OQ-35 are decided, so the bar
  evaluation is not hard-wired to a guess.
- The kill criterion for MET-01 (below 90% zone accuracy after four weeks across three facilities) is not
  coded; the wording does not say whether it applies to every zone or an average (OQ-35).
