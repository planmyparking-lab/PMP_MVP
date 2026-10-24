# PMP_MVP: ParkOS MVP (PlanMyParking)

Operator-first parking operations: an offline-first Android gate app, a Next.js operator console, and a
Supabase backend, in one pnpm monorepo.

> **Status: scaffold.** Structure, tooling, CI, the shared `contracts` package and placeholder app shells
> exist. No product features or database schema are implemented yet. Plans live in `docs/team/`.

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

## Technologies

Implemented: TypeScript, pnpm workspaces, zod, Vitest, ESLint, Prettier, GitHub Actions.
Planned: React Native (Expo) + SQLite, Next.js on Vercel, Supabase (Postgres, Auth, RLS, Edge Functions), Resend, Sentry.
Architecture: `docs/architecture/overview.md`.

## Getting started

Prerequisites: Git, Node 22 (`.nvmrc`), pnpm 10.28 (`npm install -g pnpm@10.28.0`).

```bash
git clone https://github.com/planmyparking-lab/PMP_MVP.git && cd PMP_MVP
pnpm install
pnpm check        # repo structure, format, lint, typecheck, tests
```

Run the console shell with `pnpm --filter @pmp/console dev`. Full workflow, branch and commit rules:
[CONTRIBUTING.md](CONTRIBUTING.md). Environment variables: `.env.example` (nothing reads them yet).
Tests: `docs/testing/strategy.md`. GitHub settings an admin must apply: `docs/development/github-repository-settings.md`.

## Where to start

1. `docs/team/README.md` (team index, ownership, dependencies, integration contracts IC-01..IC-10)
2. Your member sheet: `docs/team/member-0N-*.md`
3. `CONTRIBUTING.md` (branching, commits, PR review rules)
