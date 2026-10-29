# Sync conflicts (SYNC-05, IC-10)

Migration `0006_conflict_detector.sql`. An `after insert` trigger on `events` (`events_20_detect_conflicts`) writes to `public.sync_conflicts`.
Events are never edited or dropped; conflicts are records for a person to resolve (Console CON-07 writes `conflict_resolutions` later).

| Type              | Raised when                                                                                                                              | Key (one open conflict per facility, type and key) |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `DUPLICATE_EXIT`  | a second `EXIT` with a different id arrives for the same `session_id`; a third is appended to the open conflict                          | session                                            |
| `ORPHAN_EXIT`     | an `EXIT` arrives with no `ENTRY` for its session; closed automatically (`resolution: entry_arrived`) when the entry arrives             | session                                            |
| `DUPLICATE_ENTRY` | an `ENTRY` with a plate whose normalized value (uppercase letters and digits) is already open in the same facility under another session | the new session                                    |
| `CLOCK_SKEW`      | `abs(device_time - received_at)` is more than 5 minutes; `PAPER_BACKFILL` events are skipped (their old time is intended)                | the event                                          |

Session ids are never assumed to be unique across facilities: all keys include the facility.
Rules: a failing detector raises a warning and never rolls back the event insert. A plate that exited properly and re-enters is not a duplicate.
`open_sessions` (0005, `events_10_apply_open_sessions`) runs first: an `EXIT` that arrives before its `ENTRY` is remembered through `events`, so the late
`ENTRY` opens nothing. Tests: `supabase/tests/open_sessions.test.sql`, `supabase/tests/conflicts.test.sql`.

Not covered yet: resolving conflicts, RLS policies (CLD-03), CLOCK_SKEW handling in occupancy (SYNC-04), and the Console inbox.
