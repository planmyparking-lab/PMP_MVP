# Sync conflicts (SYNC-05, IC-10)

Migration `0006_conflict_detector.sql`. An `after insert` trigger on `events` (`events_20_detect_conflicts`) writes to `public.sync_conflicts`.
Events are never edited or dropped; conflicts are records for a person to resolve (Console CON-07 writes `conflict_resolutions` later).

| Type              | Raised when                                                                                                                                                       | Key (one open conflict per facility, type and key) |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `DUPLICATE_EXIT`  | a second `EXIT` with a different id arrives for the same `session_id`; a third is appended to the open conflict                                                   | session                                            |
| `ORPHAN_EXIT`     | an `EXIT` arrives with no `ENTRY` for its session; closed automatically (`resolution: entry_arrived`) when the entry arrives                                      | session                                            |
| `DUPLICATE_ENTRY` | an `ENTRY` that opened its session, with a plate whose normalized value (uppercase letters and digits) is already open in the same facility under another session | the new session                                    |
| `CLOCK_SKEW`      | `device_time` is more than 5 minutes AHEAD of `received_at`; events behind it (offline uploads) and `PAPER_BACKFILL` are not flagged                              | the event                                          |

Session ids are never assumed to be unique across facilities: all keys include the facility.
Rules: a failing detector raises a warning and never rolls back the event insert. A plate that exited properly and re-enters is not a duplicate.
`open_sessions` (0005, `events_10_apply_open_sessions`) runs first: an `EXIT` that arrives before its `ENTRY` is remembered through `events`, so the late
`ENTRY` opens nothing. Tests: `supabase/tests/open_sessions.test.sql`, `supabase/tests/conflicts.test.sql`.

## Decisions from the SYNC-05 review

- **Concurrency.** Both triggers first take a transaction-scoped advisory lock per (facility, session) (`lock_session`, 0005), and the detector also
  takes one per (facility, plate) before the DUPLICATE_ENTRY check. Without it, an ENTRY racing an EXIT (or two EXITs) each miss the other's uncommitted
  row and leave a stale open session or a missing conflict. The lock is taken outside the exception blocks: a deadlock (two batches touching the same
  sessions in opposite order) fails the `ingest_events` call and the outbox retries it. Test: `pnpm test:db:concurrency` (two overlapping transactions
  against the local database; pgTAP cannot do this because it runs in one transaction).
- **Index.** `events_facility_session_type_idx (facility_id, session_id, type) where session_id is not null` serves the per-event EXIT/ENTRY lookups.
- **Late ENTRY.** A late ENTRY for a session that already exited opened nothing, so it is not compared with a newer session of the same plate. The
  check only runs for an ENTRY whose event actually opened its session.
- **Clock skew (spec reading, needs confirmation).** The spec text says "more than 5 minutes from `received_at`" but a phone that was offline legitimately
  uploads events hours late, so the two-sided test flags normal behaviour. SYNC-04 already treats only events more than 5 minutes ahead of the receiving
  clock as suspect, so CLOCK_SKEW now follows the same rule. A device whose clock is far behind is not detected here; GATE-12 shows the clock-skew banner
  from the last server time on the phone itself. Change the comparison in `detect_conflicts()` if the spec owner wants both directions.
- **Facility scoping.** Already done: every key, the unique index, the orphan auto-resolve and `open_sessions` are per facility.

Not covered yet: resolving conflicts, RLS policies (CLD-03), CLOCK_SKEW handling in occupancy (SYNC-04), and the Console inbox.

The Console row parser, action matrix and exact backend requests are documented in
[`console-backend-handoffs.md`](console-backend-handoffs.md). Resolution remains disabled until OQ-49 and the atomic
function are settled.
