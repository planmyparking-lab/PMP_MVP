## Purpose and summary

<!-- What does this change and why? -->

## Related issue / assignment

<!-- Feature ID(s) from docs/team/feature-traceability.md, e.g. GATE-05. Issue link if any. -->

## Implementation details and decisions

<!-- Key design choices, trade-offs, anything a reviewer should look at first. -->

## Testing performed

<!-- Commands run and results. Test IDs covered (T-<FeatureID>-...). Say what you did NOT test. -->

```
pnpm check
```

## Configuration, migration and breaking changes

- [ ] No config / env var / migration changes
- [ ] Changes described here (new env vars also added to `.env.example`; migrations are forward-only):
- [ ] No breaking change to a shared contract. If there is one: `SCHEMA_VERSION` bumped and consumers notified

## Integration dependencies

<!-- Other PRs, features or contracts (IC-xx) this depends on or unblocks. -->

## Screenshots / recordings (UI changes)

## Checklist

- [ ] Branch name follows `type/slug` and commits follow Conventional Commits
- [ ] CI is green (`check`, `branch-name`)
- [ ] Docs updated where behavior or contracts changed
- [ ] If shared code (`packages/*`, `supabase/migrations`) changed: reviewer from another workstream requested
- [ ] No secrets, `.env` files, or unrelated changes included
