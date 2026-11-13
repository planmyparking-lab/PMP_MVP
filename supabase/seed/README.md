# Demo seed (CON-11)

Synthetic data for demos and Console tests: three fake facilities (a mall, a market and a hospital) with 30+ days of events.
Nothing here is real. Plates start with `XX-` (not an Indian state code), staff names carry `Demo-`, and the logins use the reserved `.test` domain.

## Load it

```sh
npx supabase@2.122.0 start      # local stack, migrations applied
pnpm seed:demo                  # loads the data, then checks ORACLE.md with SQL
```

It takes about 15 seconds. Running it again replaces only the demo rows: demo facilities, the demo organisation and the demo users. Other rows stay.

| Login (local only)               | Password            | Sees                 |
| -------------------------------- | ------------------- | -------------------- |
| `owner@demo.pmp.test`            | `Demo-Parking-2026` | all three facilities |
| `hospital.manager@demo.pmp.test` | `Demo-Parking-2026` | the hospital only    |

Demo staff PINs are in `generate.mjs` (`STAFF_PINS`) and nowhere else. Never reuse them.

**Before `pnpm test:db`**, reset the database (`npx supabase@2.122.0 db reset`, then re-enable pgTAP). Some SQL tests count rows on an empty database.

**Console pages stay empty for now.** No migration on main has RLS read policies yet, so a signed-in user reads no rows (OQ-61).

## What is in it

- **Facilities and setup:** zones per vehicle class (`Car`, `Bike`) and IC-04 tariffs (hourly slabs with a day cap, per entry, flat). Each facility also has passes (one expired, one with dues), four staff (the mall has one former, inactive member) and an entry phone and an exit phone (the mall has one revoked spare).
- **Traffic:** arrival curves per facility type. The mall peaks in the evenings and at weekends, the market has morning and evening peaks, and the hospital has an OPD morning peak and runs 24 hours. Payments are cash, UPI, pass or waived. About 2% of exits carry overrides.
- **Shifts:** two 12-hour shifts a day (08:00 and 20:00 IST) on the exit phone, plus a zone count every day at 15:00.
- **Edge fixtures in every facility:**
  - a duplicate exit;
  - an orphan exit;
  - a day shift ₹500 short;
  - three sessions that never exit, so they are over the overstay threshold.

## Files

- `generate.mjs`: the deterministic generator (fixed `SEED`). Run `--sql` for the SQL, or `--oracle` for `ORACLE.md`.
- `ORACLE.md`: expected numbers. Regenerate it after any generator change: `node supabase/seed/generate.mjs --oracle > supabase/seed/ORACLE.md`. A Console test fails if it is stale.
- `../../scripts/seed-demo.mjs`: the loader with the local-only guards. `--print` writes the SQL without touching a database.

## Safety

The loader talks only to this project's local Supabase container through `docker exec`. It uses the same checks as `pnpm test:db`, and it never reads a database URL or a key. It also refuses when `NODE_ENV` or `PMP_ENV` starts with `prod`. The SQL refuses to run unless the loader has set `pmp.demo_seed` for the session.

Decisions and open points: OQ-60 and OQ-61 in `docs/team/open-questions-and-assumptions.md`.
