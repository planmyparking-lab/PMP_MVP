# Testing

## What exists today

- Unit tests with Vitest in `packages/contracts` (`test/contracts.test.ts`, 10 tests). Run `pnpm test`.
- Repo structure and secret-pattern checks: `pnpm check:repo`. Branch name check: `pnpm check:branch`.
- Static checks: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`.
- All of the above run in CI (`.github/workflows/ci.yml`, job `check`).

## What does not exist yet (gaps)

Integration, end-to-end, database (RLS/pgTAP), simulation and load tests; frontend and Android
production builds; migration validation. They cannot exist until the apps and `supabase/` are
initialized. The planned tests (422 cases, IDs `T-<FeatureID>-<kind><n>`) are in `docs/team/member-0N-*.md`
section D and counted in `docs/team/feature-traceability.md`. Those are specifications, not results.

## Adding tests

Place tests next to the package (`packages/<name>/test/*.test.ts`), add `"test": "vitest run"` and
`"typecheck"` scripts to the package, and reference the Test ID in the test name. No external service is
needed for current tests.
