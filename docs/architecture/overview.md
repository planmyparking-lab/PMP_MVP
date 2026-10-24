# Architecture overview

**Implemented:** a pnpm monorepo with a shared contracts package (`packages/contracts`: event schemas,
money in paise, reason codes, schema version). Nothing else runs yet.

**Planned (specified in `docs/team`, not built):**

```
Gate app (Expo, SQLite outbox)  --events-->  Supabase (Postgres, RLS, Edge Functions, Mumbai)
        ^                                         |  derived sessions, KPI views, conflicts
        |  config + open sessions                 v
        +---------------------------------  Operator Console (Next.js, Vercel)
```

- Events are append-only (ENTRY, EXIT, PAYMENT, OVERRIDE, ZONE_COUNT, SHIFT_OPEN, SHIFT_CLOSE); sessions are derived.
- Ingest is idempotent on event id; a conflict detector flags DUPLICATE_EXIT, ORPHAN_EXIT, DUPLICATE_ENTRY, CLOCK_SKEW.
- Payments: operators use their own UPI QR; the guard attests receipt; no payment gateway in the MVP.
- Sync approach (PowerSync vs a hand-rolled outbox) is undecided pending a spike.

Details and integration contracts IC-01..IC-10: `docs/team/README.md`. Interfaces and ownership:
`docs/integrations/contracts.md`.
