## What / why

<!-- one paragraph -->

## Feature IDs

<!-- e.g. SYNC-03, GATE-05 (see docs/team/feature-traceability.md) -->

## Checklist

- [ ] Branch name follows `type/<FEATURE-ID>-slug`
- [ ] `pnpm check` passes locally (paste result below)
- [ ] Tests added/updated for the Test IDs touched (`T-<ID>-...`)
- [ ] Touches a shared contract (`packages/contracts`, migrations, sync rules)? Then a second workstream owner is requested for review
- [ ] Docs updated if behavior or contracts changed
- [ ] No secrets, no `.env` files

## Check output

```
paste `pnpm check` summary
```
