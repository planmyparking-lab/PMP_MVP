# PMP_MVP: ParkOS MVP (PlanMyParking)

Operator-first parking operations: an offline-first Android gate app, a Next.js operator console, and a
Supabase backend, in one pnpm monorepo.

> **Status: scaffold.** Structure, tooling, CI and the shared `contracts` package exist. The apps and
> database are not implemented yet. Plans live in `docs/team/`.

## Layout

| Path                  | Purpose                                                                        | Owner            |
| --------------------- | ------------------------------------------------------------------------------ | ---------------- |
| `apps/gate`           | Android gate app (Expo, SQLite outbox)                                         | Nikhil           |
| `apps/console`        | Operator console (Next.js)                                                     | Anamika          |
| `packages/contracts`  | Event schemas, money, reason codes, schema version (zod)                       | Afzal            |
| `packages/domain`     | Shared fare logic (stub)                                                       | Afzal            |
| `packages/sync-rules` | Sync/outbox rules (stub, pending spike)                                        | Afzal            |
| `supabase/`           | Migrations and Edge Functions (not created yet)                                | Afzal / Akanksha |
| `docs/`               | `team/` plans and specs, plus architecture, development, testing, integrations | all              |
| `scripts/`            | Repo and branch-name checks                                                    | Akanksha         |
| `.github/`            | CI, CODEOWNERS, PR/issue templates                                             | Akanksha         |

## Getting started

Requires Node 22 (`.nvmrc`) and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm check        # repo structure, format, lint, typecheck, tests
```

Individual: `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test`, `pnpm check:repo`.
Copy `.env.example` to your local env file; never commit real values.

## Where to start

1. `docs/team/README.md` (ownership, dependencies, integration contracts IC-01..IC-10)
2. Your member sheet: `docs/team/member-0N-*.md`
3. `CONTRIBUTING.md` (branching, commits, PR review rules)
