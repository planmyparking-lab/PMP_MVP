# Ingest load test (k6)

Owner: Akanksha (Member 04). Implements the script named in `docs/team/member-04-akanksha.md`, section D.10
(`tools/load/ingest.k6.js`) for tests **T-CLD-10-X1** and **T-CLD-05-X1**.

## Status: not run

| Part                                                                      | State                                                                                                                                                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events.js` (event generator)                                             | **Tested.** 11 tests in `events.test.mjs`, plus a one-off check against the real `ingest_events` (below).                                                                                       |
| `ingest.k6.js` (the load scenario)                                        | **Written, syntax-checked only, never run.** k6 is not installed on the development machine, no staging project exists (CLD-01) and no device can be enrolled (`enroll_device` is not written). |
| The thresholds (p95 < 300 ms ingest, p95 < 500 ms views, no failed batch) | **Not measured.** No result from this script exists. Do not quote one.                                                                                                                          |

## What it simulates

The scenario from D.10: 20 enrolled devices (one k6 virtual user each), one event every 5 seconds for one hour. Each
device cycles ENTRY, EXIT, PAYMENT (one parking session per three events). At random a device goes offline for 5 to 10
minutes, buffers its events and then sends them in one batch (about 60 to 120 events, within the 500 per call limit of
`ingest_events`). After the run, `teardown` times `v_daily_kpis` and `v_hourly` as an owner or manager.

Pass criteria, as k6 thresholds: `ingest_events` p95 under 300 ms, `ingest_failed_batches` equal to 0 (a batch fails if
the HTTP call fails, any event is rejected, or accepted plus duplicates differs from the batch size), and view p95 under
500 ms. The numbers are the (H) values in the member sheet.

## Prerequisites (all currently missing)

1. A **staging** Supabase project with migrations applied (CLD-01, CLD-09). Never run this against production: it writes
   about 14,400 events.
2. 20 enrolled devices in one facility with active staff (needs `enroll_device`, IC-05, or a seeded set of auth users
   with the device claims `role = 'device'`, `device_id`, `facility_id`).
3. A device JSON file **outside the repository** (tokens are secrets), one entry per device:
   `[{ "token": "<device JWT>", "device_id": "...", "facility_id": "...", "staff_id": "...", "zone_id": "..." }]`.
4. An owner or manager JWT for that facility (devices cannot read the KPI views).
5. [k6](https://k6.io) installed.

## Run

```text
k6 run -e TARGET=staging -e SUPABASE_URL=<staging url> -e SUPABASE_ANON_KEY=<staging anon key> \
       -e DEVICES_FILE=<absolute path to devices.json> -e MANAGER_TOKEN=<owner or manager jwt> \
       tools/load/ingest.k6.js
```

`TARGET=staging` and `DEVICES_FILE` are both required; the script stops at start-up without them. `DEVICES_FILE` has no
default on purpose (a default path inside the repository could be committed by accident), and `tools/load/devices*.json`
is gitignored as a second line of defence. Keep the file outside the repository anyway. `TARGET=staging` is a
confirmation, not a check: the script cannot tell which project the URL points at.

What the numbers mean: an EXIT comes 5 seconds after its ENTRY with a random fare of 1 to 40 rupees and vehicle class
`CAR`, so the run measures ingest timing, not realistic revenue (a real grace period would make such a stay free, and
tariffs name the class `Car`). Do not read KPI values from this data as a result. Events still buffered when the run
ends are not sent, so the row count will be slightly under 14,400.

Set `DURATION=5m` for a short rehearsal and `SKIP_VIEW_CHECK=true` to leave out the view check. Without `MANAGER_TOKEN`
and without `SKIP_VIEW_CHECK=true` the run stops in `setup`, on purpose: an empty view measurement would pass its
threshold and look like a result.

## Tests that exist

```text
node --test tools/load/events.test.mjs
```

They check, without k6 or a database: UUIDv7 ids with the right timestamp; UTC times with a literal `Z`; the 5 character
short code rule; the ENTRY, EXIT, PAYMENT cycle and one session per cycle; that the envelope and payload keys equal the
contract fixtures in `packages/contracts/fixtures/events/valid` exactly; no duplicate id in 14,400 events; that
outages last 60 to 120 steps and lose no event; that `ingest.k6.js` parses; and that it has no default device file, requires
`TARGET=staging`, and that `.gitignore` covers `tools/load/devices.json`. This file is not in `pnpm test:scripts`
yet (that list is in `package.json` and is also edited by other work).

## One-off check against the real database (12 Nov 2026, not repeatable from the repository)

Generated events were sent through the real `ingest_events` on the local Supabase stack, inside a transaction that was
rolled back, with migrations `0004` to `0006` and the staged payload validators
(`supabase/proposed-migrations/0013_*`) applied and one seeded device and active guard:

| Call                                              | Result                                                          |
| ------------------------------------------------- | --------------------------------------------------------------- |
| 3 events                                          | 3 accepted                                                      |
| 120 events (an outage flush)                      | 120 accepted                                                    |
| the same 120 events again (a retry)               | 120 duplicates, 0 rejected                                      |
| 1 event with a fractional fare (negative control) | 1 rejected, `INVALID_PAYLOAD` (so the validators were in force) |

No conflicts were raised. A first attempt used a start date in the future and every event raised a clock-skew
conflict; `ingest.k6.js` starts the device clock at the time of the run for that reason. The database was unchanged
afterwards.

This shows the generated events are valid. It says nothing about speed, because it was one connection on a laptop.
