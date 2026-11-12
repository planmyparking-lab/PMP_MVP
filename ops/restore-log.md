# Restore log (CLD-10)

One row per drill. The local drill proves the dump, restore and checksum pipeline only; it is **not** the production
drill, and its fingerprint does not verify privileges, policy predicates, function bodies, view definitions, indexes or RLS flags.
The production drill (T-CLD-10-E1), which restores a real backup into a fresh hosted project, has **not been run**.

| Date (UTC) | Target and source                                           | Elapsed | Scope                | Result | Run by                             |
| ---------- | ----------------------------------------------------------- | ------- | -------------------- | ------ | ---------------------------------- |
| 2026-10-29 | local supabase_db_pmp-mvp (synthetic, schema 0001-0003)     | 7s      | 10 tables, 2409 rows | MATCH  | Claude Code, on Akanksha's machine |
| 2026-11-12 | local supabase_db_pmp-mvp (synthetic, migrations 0001-0006) | 20s     | 16 tables, 2932 rows | MATCH  | Claude Code, on Akanksha's machine |
