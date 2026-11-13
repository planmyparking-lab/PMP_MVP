# CLD-05 KPI views: `v_daily_kpis` and `v_hourly`

Migration: `supabase/migrations/0009_views_kpis.sql`. Tests: `supabase/tests/kpi_views.test.sql`,
`supabase/tests/kpi_golden_day.test.sql` (T-CLD-05-U1, section 7), `supabase/tests/kpi_oracle.test.sql` (T-CLD-05-I2,
section 8).
Spec: `docs/team/member-04-akanksha.md` CLD-05, IC-07 (`docs/integrations/ic-07-console-requirements.md`), OQ-45.

## 1. Scope

| Item                                | State                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v_daily_kpis`                      | Implemented                                                                                                                                         |
| `v_hourly`                          | Implemented                                                                                                                                         |
| `v_zone_now`                        | **Deferred.** It must equal Afzal's `occupancy.ts` on shared fixtures (T-CLD-05-U2), and that definition is unresolved (OQ-A7). Nothing is guessed. |
| Conflict-resolution effects on KPIs | **Not implemented**, see section 4                                                                                                                  |

Both views are `security_invoker = true`. `anon` has no privilege, `authenticated` has `select`.

## 2. Columns

```text
v_hourly(facility_id uuid, local_date date, hour integer, entries integer, exits integer)

v_daily_kpis(facility_id uuid, local_date date, vehicles integer,
             cash_paise bigint, upi_paise bigint, pass_paise bigint, declared_total_paise bigint,
             pass_count integer, avg_stay_minutes numeric, overrides integer,
             overrides_per_100 numeric, orphan_exits integer)
```

`local_date` and `hour` keep the names of the CLD-05 sheet; no newer decision exists in the repository (Anamika's sheet
uses `day` and `hour_start`, still open in IC-07 section 5). Two columns are not in OQ-45's list:
`pass_count` (a count of entries made with a pass, not money, kept from the sheet) and `orphan_exits` (the sheet asks for
an orphans column). Drop `pass_count` if Anamika does not want it; the revenue columns never use it.

## 3. Semantics

**Revenue (OQ-45).** Only `PAYMENT` events. `cash_paise`, `upi_paise`, `pass_paise` are the sums of modes `CASH`, `UPI`,
`PASS`. `WAIVED` is excluded from every total. Any other mode (unknown, lower case, missing) is excluded too, never counted
as valid revenue. `upi_paise` includes UPI that is not attested; there is no attested column (OQ-45: no derived columns).
`declared_total_paise` = the sum of the three. Revenue columns are never null; an active day with no valid payment reads 0.
Every PAYMENT event of a session counts, each once (events are unique by id), so a session with a fare and a second payment
reports both. The same payment re-sent by a device under a new event id would be counted twice; whether a session may
legitimately carry more than one payment is open question OQ-62.

**Amounts.** Only a JSON number that is a whole number from 0 to the bigint maximum counts. A string, boolean, null,
fraction, negative, out-of-range number, array, missing key or non-object payload adds 0 and never raises an error (the cast
sits behind `CASE`, whose evaluation order PostgreSQL guarantees). Sums are `numeric`, so adding cannot overflow; each figure
is clamped to the bigint maximum at the end. If the true total exceeds 9.22e18 paise the total saturates and can be below
the true sum of the three; contract-valid amounts (safe JavaScript integers) cannot reach that.

**Sessions.** Paired by `(facility_id, session_id)`. The first ENTRY and first EXIT of a session count; later ones are
duplicates, ignored here and left to `sync_conflicts`. An EXIT with no ENTRY is an orphan: counted in `orphan_exits`, left out
of all stay figures, still counted in `v_hourly.exits` (an exit physically happened). An ENTRY with no EXIT is an open
vehicle with no stay. A stay whose exit is earlier than its entry is invalid and excluded from `avg_stay_minutes`.
`avg_stay_minutes` is the mean of per-session minutes, rounded to 2 places, null when the day has no valid stay.
It is computed as the mean of the stays in seconds, divided by 60 once, then rounded half away from zero (`round(avg(seconds)
/ 60, 2)`). Dividing each stay by 60 first, as an earlier draft of 0009 did, rounds every quotient at 16 decimals and turned
an exact 104.855 into 104.85 (found by the oracle test, section 8). When the exact mean lies on a rounding boundary, the mean
in seconds has at most two decimals and the division by 60 terminates, so the result is exact there.

**Time.** Everything is in `facilities.timezone` (IANA, must be valid), converted from `device_time`. An invalid name makes
any query that reaches that facility's rows fail, including an unfiltered query over every facility. The column has no check
constraint: adding one changes `facilities` (`0001`), so it belongs in its own migration, not in this views migration. Until
then the Console setup wizard validates the name (Anamika, PR #33 review).

**Midnight convention.** A session spanning midnight is split by event: `vehicles`, `pass_count` and `v_hourly.entries` use the
ENTRY's date and hour; exits, orphans, stay and `v_hourly.exits` use the EXIT's; revenue uses the date of the session's first
EXIT (sheet: "attribute revenue to exit date"), or the payment's own date when the session has no EXIT; overrides use the
OVERRIDE event's date. A day can therefore show exits or revenue without entries, and `overrides_per_100` is null when
`vehicles` is 0.

**Late exits move revenue.** Because of that rule, a payment recorded while its session has no EXIT yet counts on the
payment's own date; when the session's first EXIT syncs later, the same payment moves to the EXIT's date. The total never
changes, but a figure produced for the payment's date before the exit arrived (for example a daily report already emailed)
can differ from what the views show afterwards. Consumers that freeze a day's numbers should record what they sent rather
than expect the views to reproduce it. Tested in `kpi_views.test.sql` (facility F6).

**Empty periods.** A facility or day with no events produces no row (the sheet allows "zero rows or zero values"); days
between two active days are not generated. Revenue is never null on a row that exists.

**Determinism.** First-wins ties break on `device_time`, then event id (the pass flag of the first entry depends on it).

## 4. Conflict resolutions: what can and cannot be established

| Action                    | Established?        | Why                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| first-wins (the default)  | Yes                 | Sheet CLD-05: "count first exit only, rest flagged". Implemented.                                                                                                                                                                                                                                                                                         |
| `KEEP_FIRST`              | Same as the default | It changes nothing, so reading it is unnecessary.                                                                                                                                                                                                                                                                                                         |
| `KEEP_SECOND`             | **No**              | Needs: when a conflict counts as resolved; which resolution wins if several exist (the table is append-only, so a conflicting second resolution is possible); what "second" is. `sync_conflicts.event_ids` is ordered only when the conflict is created; a third exit is appended unordered. For ORPHAN_EXIT and DUPLICATE_ENTRY "second" has no meaning. |
| `MARK_AS_TEST_ENTRY`      | **No**              | Nothing says which events of the session are removed (entry only, the whole session, its payments and overrides) or whether it applies to a conflict that is still OPEN.                                                                                                                                                                                  |
| `ADD_NOTE`, `ACKNOWLEDGE` | No effect           | Notes and acknowledgements carry no counting rule. Whether they close a conflict is OQ-49.                                                                                                                                                                                                                                                                |

Blockers, exactly: OQ-49 (which actions close a conflict) is open; `resolve_conflict()` does not exist, so nothing links a
`conflict_resolutions` row to `sync_conflicts.status`; `status = 'RESOLVED'` is also set by the detector itself
(`entry_arrived`) with no resolution row; `conflict_resolutions` has no status column and none was invented. A resolution
record alone is therefore never treated as a resolved conflict. Tracked as OQ-55. Until it is decided every view uses
first-wins, and the Console must not tell a manager that KEEP_SECOND or MARK_AS_TEST_ENTRY changed the dashboard.

## 5. Performance

Environment: local Supabase Postgres 17 in Docker Desktop on Windows, default settings (`work_mem` 4 MB), parallel query
disabled because the container's shared-memory segment is too small for it. Not a staging project and not the k6 run.

Dataset (synthetic, inserted in one rolled-back transaction, `analyze`d): **400,000 events**, 100,000 ENTRY, 120,000 EXIT
(20,000 duplicates), 100,000 PAYMENT, 80,000 OVERRIDE; 100,000 sessions, 10 facilities, 60 days. Migrations 0004 to 0006
triggers were not present during the load. Table owner (no RLS) unless stated.

| Query                         | Old proposal (ms, successive runs) | New 0009 (ms, successive runs) |
| ----------------------------- | ---------------------------------- | ------------------------------ |
| daily, one facility, 30 days  | 2981, 3392, 2069, 1737             | 419, 316, 290, 275             |
| hourly, one facility, one day | 372, 383, 386, 503                 | 52, 49, 49, 54                 |
| daily, all facilities         | 2871, 2245, 1829                   | 5021, 3324, 3190               |
| hourly, all facilities        | 1213, 984, 1058                    | 759, 860, 855                  |

The numbers above were measured in the local environment described here. The benchmark harness is not included in this
repository, so the results are not independently reproducible from the repository as committed.

What changed: the cause of the old proposal's slowness was not profiled, so it is unverified and this page does not claim to
explain it. The new views group the events of a session in one scan, without a session-pairing join, and in the observed plan
of the new one-facility query the `facility_id` filter reaches the index scan on `events_facility_device_time_idx`.
That observation does not prove why the old proposal was slow. A date filter cannot be pushed into the events scan (the local date is derived), so cost grows with the facility's history.

Correctness check at this size: totals of vehicles, hourly entries and exits, cash, UPI, pass and overrides from the views
equalled independent sums over the raw events (all seven comparisons true). That was a one-off check on this benchmark data
and is not committed. The reproducible row-by-row comparison is `kpi_oracle.test.sql` (section 8); it measures correctness
only, not timing.

RLS dominates once policies exist (stand-in policies, because 0010 is not in this chain):

| Case (authenticated, 400k events)                                                               | ms            |
| ----------------------------------------------------------------------------------------------- | ------------- |
| Per-row `is_member(facility_id, ...)` policy, as proposed in 0010: daily, one facility, 30 days | 9424, 2724    |
| Same policy, daily, all facilities (one run)                                                    | 40448         |
| Once-per-query policy (`facility_id in (select my_facilities())`): daily, one facility          | 294, 316, 392 |
| Same, hourly, one facility, one day                                                             | 65            |
| Same, daily, all facilities                                                                     | 2705          |

**Conclusion.** The 500 ms target (T-CLD-05-X1, p95 after the k6 run) is **not shown to pass**. Measured: a facility-filtered
query on the new views stays near 0.3 to 0.4 s in this setup with a few runs each (too few for a p95), an unfiltered scan takes
3 to 5 s and is slower than the old proposal for `v_daily_kpis`, and a per-row membership policy as in the proposed 0010 turns
a 0.3 s query into several seconds. 0009 cannot fix the last item. Recommended order (OQ-56): (a) evaluate membership once per
query in the 0010 events and facilities policies, then re-measure on staging data; (b) only if X1 still fails, a
facility-and-date-bounded function, or (c) a rollup table with a documented refresh. (b) and (c) add API or maintenance
that no specification defines, so none was built. The Console must always filter by `facility_id`. Even a "today only"
query aggregates the facility's whole history (the local date cannot be pushed into the events scan), and the Console
dashboard refreshes every 10 seconds, so each refresh repeats that cost; this is part of OQ-56.

## 6. RLS and dependency on 0010

0009 depends only on 0001 to 0003. Reading the views needs `select` policies on `events` and on `facilities` (the view joins
`facilities` under the caller's rights). Those policies are in the proposed 0010, which is not in this repository, so with
0001 to 0009 alone a signed-in user reads zero rows (tested). The positive isolation tests use two **stand-in** policies created
inside the test transaction; they prove the views run with the caller's rights and isolate facilities and organizations,
not that 0010's policies are correct. Re-running this file after 0010 lands does **not** validate 0010: permissive policies
combine with OR, so the stand-in policies would stay in force beside the real ones and could mask a real policy that wrongly
allows or denies access, and the deny-by-default assertion passes trivially once an events policy exists. A separate
0010-specific RLS test is required. It must exercise the actual 0010 policies, with no permissive stand-in policy created, and
read the KPI views through them.

Migration contiguity: 0009 follows 0008 with no gap. The proposals in the refresh workspace continue at 0010, then 0012,
0013, so 0011 is currently unassigned; this change creates none and does not touch 0010.

## 7. Test coverage against T-CLD-05

| Test                                                            | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1 daily golden day                                             | Covered by `kpi_golden_day.test.sql` (5 of 5): the full spec golden day of 100 entries, 90 distinct first exits (89 paired plus 1 orphan; a duplicate EXIT is excluded), 10 overrides, 5 pass entries, CASH 250,000 and UPI 136,000 paise, and a midnight-spanning session. The complete golden-date `v_daily_kpis` row, including `facility_id` and `local_date`, and the next-date row are compared with hand-computed literals using `results_eq`. The 90 is checked through `v_hourly.exits`, because `v_daily_kpis` has no exits column. The exit counting is an assumption (OQ-57). The smaller golden day in `kpi_views.test.sql` remains as an edge-case test |
| U2 zone now equals occupancy                                    | **Not covered** (`v_zone_now` deferred)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| U3 hourly edges (00:00, 00:59:59, 01:00, 23:59:59, +05:45 zone) | Covered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| I1 RLS through the views                                        | Covered with stand-in policies for 0001 to 0009 only; **not** validated against 0010, which needs its own test (section 6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| I2 oracle comparison on 30 days of seed                         | Covered: `kpi_oracle.test.sql`, 25 of 25 against local 0001 to 0009 (section 8). Correctness only; not a performance result and not a 0010 RLS result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| N1 empty facility                                               | Covered (no rows, no error)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| R1 column contract against an IC-07 file                        | **Partly**: columns, order and types are asserted; no IC-07 column-list file exists to compare with                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| X1 performance after k6 load                                    | **Not covered**, see section 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 8. Oracle test (T-CLD-05-I2): `kpi_oracle.test.sql`

Runs with `pnpm test:db` in one transaction that is rolled back. Plan: 25 assertions.

**Fixture.** Deterministic: `generate_series`, modular arithmetic and md5-derived ids, no random values. Three facilities
in three zones: Asia/Kolkata (+05:30), Asia/Kathmandu (+05:45) and America/New_York (the period crosses the 1 Nov 2026
DST change). Each facility has 8 to 14 generated sessions on every local date from 2026-10-15 to 2026-11-13, with entries in
all 24 local hours. In total there are 4,025 events in 1,189 sessions, 1,080 of them with an ENTRY, inserted directly as `PAPER_BACKFILL` through the 0005
and 0006 triggers. The fixture covers:

- valid ENTRY/EXIT pairs, zero-length and negative stays;
- one explicit local-midnight crossing per facility and day, plus late entries whose stays cross midnight;
- duplicate EXITs, some later and some earlier than the other exit;
- duplicate ENTRYs, including same-instant ties with opposite pass flags;
- one orphan EXIT per facility and day, half of them with a payment;
- open sessions with a payment, and payment-only sessions;
- CASH, UPI and PASS payments, attested and unattested UPI, WAIVED, CARD, lower-case `cash` and a missing mode;
- malformed amounts: missing key, JSON string, boolean, null, negative, fraction and 1e30. `5000.0` counts as valid;
- OVERRIDE events.

Three single edge days outside the 30 dates add a day with vehicles but no valid stay, a day with no vehicles (null
`avg_stay_minutes` and `overrides_per_100`), and a day with one open entry. Sixteen assertions check this coverage against
the raw fixture events, not the views.

**Oracle independence.** Expected rows come from a PL/pgSQL oracle that reads only `events` and `facilities`. One
assertion checks that the source text of the oracle functions names neither view. The oracle loops facility by facility
and session by session, and finds the first ENTRY and first EXIT with `order by device_time, id limit 1`. It walks each
session's payments one at a time and increments per-day and per-hour counters in temporary tables. Local dates and hours
come from setting the session `TimeZone` to the facility's zone and casting, not from `at time zone`. The average stay is
summed seconds divided once. The rules it encodes are those in section 3. It shares no CTE or query structure with 0009.

**Comparison.** Every row of both views, unfiltered, is compared with the oracle:

- row counts;
- `except all` in both directions (unexpected rows and missing rows);
- an ordered `results_eq` over every column, NULLs included;
- grand totals.

**Result: 25 of 25 pass** with 0001 to 0009 applied locally in the rolled-back transaction; `kpi_views.test.sql` still passes
37 of 37.

**Precision defect found and fixed.** Against the first draft of 0009 the test passed 22 of 25, with all three failures on one
value. Facility Kathmandu on 2026-10-22 has 10 valid stays totalling 62,913 s. Their exact mean is 6,291.3 s, or 104.855
min, which the documented rule rounds to 104.86. The draft divided each stay by 60 before averaging; those quotients are
rounded at 16 decimals, their mean came out as 104.85499999999999999, and the view reported 104.85. 0009 now averages seconds
and divides once (section 3) and reports 104.86. No other KPI rule changed. The fixture is kept on this boundary on purpose.

**Mutation check.** Each controlled error below was applied to the views in a scratch transaction (rolled back, no file
changed) and was detected:

| Injected error                                  | Assertions failed                                       |
| ----------------------------------------------- | ------------------------------------------------------- |
| `v_hourly` in UTC instead of the facility zone  | 4 (hourly count, both `except all`, `results_eq`)       |
| WAIVED counted as cash                          | 4 (both daily `except all`, daily `results_eq`, totals) |
| zero-length stays excluded (`>` for `>=`)       | 3 (both daily `except all`, daily `results_eq`)         |
| per-row division put back (`avg(seconds / 60)`) | 3 (both daily `except all`, daily `results_eq`)         |

**Not shown by this test.** Performance or p95 (X1), RLS (I1), bigint saturation (amounts stay far below it; covered in
`kpi_views.test.sql`), conflict-resolution effects (section 4), and behaviour on staging or production data.
