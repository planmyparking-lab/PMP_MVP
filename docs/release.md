# Release process (REL-01)

Owner: Afzal. Companion to [development/deployment.md](development/deployment.md) (the workflows that actually run
this) and [development/github-repository-settings.md](development/github-repository-settings.md) (item D6, the
ruleset _proposed_ to restrict who may create a release tag — not active today: GitHub Free returns 403 for both
Rulesets and classic branch protection on this private repository, confirmed in [OQ-65](team/open-questions-and-assumptions.md).
Until the plan changes, anyone with write access can push a `v*` tag and start `deploy-prod.yml`).

## Tagging convention

A release tag is `vMAJOR.MINOR.PATCH` with an optional pre-release suffix, for example `v1.2.3` or `v0.0.0-test`.
This is enforced, not just documented: `scripts/deploy-preflight.mjs`'s `isReleaseTag()` rejects anything else
(`vNext`, `v1`, a branch name) before `deploy-prod.yml` does anything with it, and `scripts/deploy-preflight.test.mjs`
asserts this in CI.

- **MAJOR**: a breaking change to the event envelope or a payload shape that existing clients cannot read or write
  (see "Bumping `SCHEMA_VERSION`" below — this almost always means a schema bump too).
- **MINOR**: a new feature, migration, or endpoint that does not break an existing client.
- **PATCH**: a fix with no shape change.
- **`-pre` suffix**: a pre-release or sandbox test tag (`v0.0.0-test` is the literal tag `deployment.md` uses for the
  CLD-09 dry run). Never a candidate for `supabase/config.toml`'s `project_id` or any other identifier.

Tag the latest commit on `main`. Do not tag an older commit to "go back" — see Rollback.

## Bumping `SCHEMA_VERSION`

`SCHEMA_VERSION` (`packages/contracts/src/version.ts`) is the gate app's own build version for the event envelope.
The server's floor is `min_supported_schema_version()`, a SQL function in `supabase/migrations/0004_ingest_events.sql`
(both `min_supported_schema_version()` and `max_supported_schema_version()` currently return `1`; there is no
migration yet that raises the floor). `isSupported(clientVersion, minSupported)` (`packages/contracts/src/version.ts`)
is the one place that compares them; the gate's `isSyncBlocked()` (`apps/gate/src/syncGate.ts`) calls it with the
server's `min_supported_version` (returned on every `ingest_events` call) to decide the `syncBlocked` banner — a
build whose `SCHEMA_VERSION` falls below the floor stops syncing but keeps working offline (SYNC-03/06).

To ship a breaking envelope or payload change:

1. Bump `SCHEMA_VERSION` in `packages/contracts/src/version.ts`. Update `MAX_SCHEMA_VERSION` only if the new version
   would exceed it (it is a sanity ceiling shared with the envelope's own Zod cap, `z.number().int().positive().max(MAX_SCHEMA_VERSION)`
   — not derived from the SQL column's real capacity, which is a full `integer`, not `smallint` — so raise it only
   when actually needed, which in practice is close to never).
2. Update `packages/contracts/src/events.ts` (and any payload schema) for the new shape, so the envelope accepts the
   new version's events going forward. `ingest_events` (`0004`) and the payload validation migration (`0011`,
   promoted from `supabase/proposed-migrations/0013_ingest_events_payload_validation.sql`, OQ-52) must agree with the
   Zod schema — `event_parity.test.sql` enforces this. **If this is a breaking payload-shape change and a grace
   period is kept (step 4), the new migration must accept _both_ shapes**, choosing which validation to apply by the
   event's own `schema_version` — `event_payload_error(event_type, payload)` (`0011`) takes no `schema_version`
   argument today and validates every event of a type against one fixed shape, so a naive migration that simply
   replaces the old shape's validation will reject payloads from any client still on the old version, even though
   that client is still above the floor and believes it is allowed to keep syncing. This is exactly the data-loss
   case the grace period exists to prevent; it is not automatic.
3. Write a new migration that raises `max_supported_schema_version()` to (at least) the new `SCHEMA_VERSION`. This is
   a separate SQL ceiling from the contracts package's `MAX_SCHEMA_VERSION` (step 1) — `isSupported()` never looks at
   the SQL function, only `ingest_events` does. Skipping this step is silent until the gate build in step 4 actually
   ships: every event from a client on the new `SCHEMA_VERSION` is then rejected with `SCHEMA_VERSION_TOO_NEW` and
   can end up quarantined on the device. Ship this migration **before or in the same release as** that gate build,
   never after.
4. Decide whether to raise `min_supported_schema_version()`. Raising it immediately cuts off any client still on the
   old version; **keeping the existing floor for a grace period needs no new migration at all** — `min_supported_schema_version()`
   simply isn't touched yet. What the grace period actually requires is step 2's dual-shape payload migration, so
   that clients on the old (still-supported) version don't have their payloads rejected the moment the new shape's
   validation lands. When the grace period ends, raise the floor in its own migration (a hard date or a
   manually-triggered follow-up — there is no auto-expiring floor today); document the choice in that migration's
   own header, the way `0004`'s header documents the current floor.
5. Ship the gate build with the new `SCHEMA_VERSION` **before or in the same release as** the migration that raises
   the floor, never after — a build still on the old version syncing against a raised floor is exactly `syncBlocked`.
6. Record the change here, in a line added to "History" below, once it ships.

## Rollback

Migrations are forward-only: `supabase/README.md` states the rule directly ("migrations are forward-only... never
edit a merged migration"), and `development/deployment.md` describes the real enforcement — `supabase db push`
itself refuses to push a checkout whose migration history is behind what the remote database already has. **Nothing
automatically stops someone editing an old migration's SQL in place**: `scripts/check-migrations.mjs` only checks
file naming, contiguous numbers, RLS and literal-`true` policies — it does not diff against git history or detect an
in-place edit of an already-numbered file. The rule holds because reviewers enforce it and because a hosted database
that already applied the old version would reject a mismatched re-push, not because of a pre-merge check. There is
no "undo a migration" step:

- **Database**: a bad migration is corrected by a new, forward migration — never edited or reverted in place. Write
  the fix, open a PR, merge, tag, deploy as normal. Tagging an older commit cannot roll a database back either, for
  the same `supabase db push` reason above.
- **Console**: redeploy the previous Vercel build (once a Console deploy pipeline exists — not yet, see
  `development/deployment.md`'s "Not implemented" table). This is only safe when the release being rolled back from
  added no migration the older build depends on — if it did, the older build will query a column, table or view that
  didn't exist yet when it was built, or miss one a forward migration since removed.
- **Gate app**: an EAS update (OTA) can roll back a JavaScript-only change on the existing native build immediately.
  A native-code change (for example a new native module) needs a new build and store/internal-distribution rollout;
  there is no OTA rollback for that case. **Never roll the gate back below the current `min_supported_schema_version()`
  floor** — a build on a lower `SCHEMA_VERSION` than the floor is exactly the `syncBlocked` case (see above), so an
  OTA rollback that crosses a floor raised since the build it targets trades the original bug for a sync outage.
- **If the bad release also needs the server to stop accepting a version**: raise `min_supported_schema_version()` in
  a new migration (see above) rather than trying to make old clients disappear any other way.

No rollback has been drilled yet (REL-01 step 8, `T-REL-01-E1`/`E2`) — the deploy workflows themselves are not live
(`development/deployment.md`'s "Not implemented" table: no Supabase projects or GitHub environments exist, CLD-01).
Once they are, the first production deploy's drill should be: deploy a trivial tagged release, then exercise the
Console/Gate rollback steps above against it, and record the result here under History.

## History

| Date | Tag | SCHEMA_VERSION | Notes                                                                                                                                                                                                                                                   |
| ---- | --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —    | —   | 1              | No tagged release yet. `SCHEMA_VERSION` has been `1` since `packages/contracts` was created in the scaffold commit [`8eacbbf`](https://github.com/planmyparking-lab/PMP_MVP/commit/8eacbbfbb1748b7fa9bc28474e6b152399bfa1b9) and has never been bumped. |
