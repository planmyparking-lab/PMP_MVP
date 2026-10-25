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

## Running the tests

No install is needed. From the repository root:

```bash
node --test ops/metrics/pilot-metrics.test.mjs field/cons12/roi.test.mjs
```

These tests are **not** part of `pnpm check` or CI. They have been run on Node 26.1.0 only. The repository
pins Node 22 (`.nvmrc`, used by CI) and Node 22 has **not** been verified. Adding them to `pnpm check` and
CI needs edits to the root `package.json` and `.github/workflows/ci.yml`, which other owners review; the
proposal is in the pull request discussion, not applied here.

## Not built, and why

- `weekly.sql` and `adherence.sql`: they query `events`, `device_heartbeats`, `sync_conflicts` and `job_runs`,
  whose columns do not exist yet (CLD-02, owner Akanksha). Writing them now would invent a schema.
- A CSV-reading command line tool: add it after the open points in OQ-35 are decided, so the bar
  evaluation is not hard-wired to a guess.
- The kill criterion for MET-01 (below 90% zone accuracy after four weeks across three facilities) is not
  coded; the wording does not say whether it applies to every zone or an average (OQ-35).
