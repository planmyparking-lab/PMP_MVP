# Contributing

## Workflow

1. Pick a feature ID from `docs/team/feature-traceability.md`.
2. Branch from `main`: `<type>/<slug>`, lowercase, e.g. `feature/gate-05-token-entry`, `fix/sync-03-dup-ack`.
   Types: `feature|fix|chore|docs|test|refactor|spike`. Checked by `pnpm check:branch`.
3. Commit with Conventional Commits: `feat(gate): add token entry screen`, `fix(contracts): ...`.
4. Run `pnpm check` locally. Fix failures before pushing.
5. Open a PR using the template. CI must pass.

## Review rules

- Every PR needs one approval from a CODEOWNER of the touched paths.
- Changes to `packages/*`, `supabase/migrations`, or sync rules also need a reviewer from another workstream.
- Breaking event-shape changes bump `SCHEMA_VERSION` (`packages/contracts/src/version.ts`).
- Branch protection is configured by the repo admin in GitHub settings, not by files here; recommended
  settings: require PR, require the `CI` checks, require CODEOWNERS review, no direct pushes to `main`.

## Testing

Add tests for the Test IDs you touch (`T-<FeatureID>-<kind><n>`). Never mark a test as verified in
`docs/team/feature-traceability.md` unless you ran it.

## Docs

Do not duplicate docs. Update the one canonical file under `docs/` and link to it.
