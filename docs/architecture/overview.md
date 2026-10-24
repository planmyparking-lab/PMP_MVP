# Architecture overview

Gate app (Expo, SQLite) writes append-only events locally and syncs them to Supabase through an
idempotent `ingest_events` function. Sessions are derived from events. The console reads from
Postgres under RLS. A conflict detector flags DUPLICATE_EXIT, ORPHAN_EXIT, DUPLICATE_ENTRY and
CLOCK_SKEW. Full details: `docs/team/README.md` and `docs/team/member-01-afzal.md`.
