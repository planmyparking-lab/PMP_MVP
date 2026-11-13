# MET-01..03: pilot measurement

Owner: Anamika. Source of truth: `docs/team/member-03-anamika.md` (C14 to C16, D14). This folder holds blank
sheets, the weekly pack template and the calculation library. No audit has been performed and no pilot data
exists here. Never record vehicle numbers on any sheet.

| File                              | Feature | Purpose                                                                |
| --------------------------------- | ------- | ---------------------------------------------------------------------- |
| `audit-sheet.csv`                 | MET-01  | One row per zone per moment per visit                                  |
| `adherence-sheet.csv`             | MET-02  | One row per audited hour                                               |
| `weekly-pack.md`                  | MET-03  | Monday pack with the 10 fixed sections                                 |
| `weekly.sql`                      | MET-03  | Existing-table queries for conflicts and overrides                     |
| `pilot-metrics.mjs`, `*.test.mjs` | all     | Formulas, audit completeness, random hour draw, pack checks, and tests |

## Running the tests

No install is needed. From the repository root:

```bash
pnpm test:pilot   # same as: node --test field/cons12/roi.test.mjs ops/metrics/pilot-metrics.test.mjs; CI runs it in the check job
```

These tests run in CI (`pnpm test:pilot`, a step of the `check` job) and locally in `pnpm check`. They have also
been run on Node 22.23.2 (the repository runtime pinned by `.nvmrc`) and Node 26.1.0.

## Database-query status

- `weekly.sql` covers the sources that exist: `events`, `sync_conflicts` and `device_heartbeats` (0008). It
  reports conflict counts by type, conflicts unresolved for more than 24 hours at the report boundary, overrides
  per 100 entries by reason code, the week's sync latency (p50, p95, max of `received_at - device_time`, LIVE
  events only) and each phone's latest heartbeat. `device_heartbeats` keeps one row per phone, so the heartbeat part
  is a snapshot at query time, not a weekly history. Quarantined events and report runs have no database source; the
  query prints `missing: ...` for them instead of inventing a number.
- `weekly.sql` was run on 13 Nov 2026 against the local stack (migrations 0001 to 0008) loaded with the CON-11 demo
  seed (`pnpm seed:demo`, PR #47) plus one hand-inserted heartbeat, for Demo Mall and the week before the run. Overrides, latency (p50 21 s,
  p95 38 s, matching the seed's 2 to 39 s delay) and heartbeats returned the expected rows. The conflict sections
  returned zeros: `sync_conflicts.created_at` is the time of detection, and the seed's conflicts were detected at
  load time, after that week. Run it only against the local stack, never a real
  project, for development checks.
- `adherence.sql` is written but has not been run against a database.

## Not built, and why

- A CSV-reading command line tool: add it after the open points in OQ-35 are decided, so the bar
  evaluation is not hard-wired to a guess.
- The kill criterion for MET-01 (below 90% zone accuracy after four weeks across three facilities) is not
  coded; the wording does not say whether it applies to every zone or an average (OQ-35).
- The T-MET-01-X1 counter-disagreement percentage is not coded because the specification does not define
  its denominator. `counter_a`, `counter_b` and the 5% flag are clear, but choosing counter A, the larger
  count or their mean would produce different results; that decision needs to be recorded first.
