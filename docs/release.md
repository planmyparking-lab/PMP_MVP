# Release process (REL-01)

Owner: Afzal. Companion to [development/deployment.md](development/deployment.md) (the workflows that actually run
this) and [development/github-repository-settings.md](development/github-repository-settings.md) (the ruleset that
restricts who may create a release tag, item D6).

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
   would exceed it (it is a sanity ceiling, not a target — raise it only when actually needed).
2. Update `packages/contracts/src/events.ts` (and any payload schema) for the new shape, so the envelope accepts the
   new version's events going forward. `ingest_events` (`0004`) and the payload validation migration (`0011`,
   promoted from `supabase/proposed-migrations/0013_ingest_events_payload_validation.sql`, OQ-52) must agree with the
   Zod schema — `event_parity.test.sql` enforces this.
3. Write a new migration that raises `max_supported_schema_version()` to (at least) the new `SCHEMA_VERSION`. This is
   a separate SQL ceiling from the contracts package's `MAX_SCHEMA_VERSION` (step 1) — `isSupported()` never looks at
   the SQL function, only `ingest_events` does. Skipping this step is silent until the gate build in step 4 actually
   ships: every event from a client on the new `SCHEMA_VERSION` is then rejected with `SCHEMA_VERSION_TOO_NEW` and
   can end up quarantined on the device. Ship this migration **before or in the same release as** that gate build,
   never after.
4. Decide whether to raise `min_supported_schema_version()`. Raising it immediately cuts off any client still on the
   old version; a grace period means writing a new migration that keeps the old floor for a time (a hard date or a
   manually-triggered follow-up migration — there is no auto-expiring floor today) before a later migration raises
   it. Document the choice in the migration's own header, the way `0004`'s header documents the current floor.
5. Ship the gate build with the new `SCHEMA_VERSION` **before or in the same release as** the migration that raises
   the floor, never after — a build still on the old version syncing against a raised floor is exactly `syncBlocked`.
6. Record the change here, in a line added to "History" below, once it ships.

## Rollback

Migrations are forward-only (`CLAUDE.md`; enforced by `scripts/check-migrations.mjs` and the runner's own commit
guard, `docs/team/README.md`). There is no "undo a migration" step:

- **Database**: a bad migration is corrected by a new, forward migration — never edited or reverted in place. Write
  the fix, open a PR, merge, tag, deploy as normal. `supabase db push` itself refuses to push a checkout whose
  migration history is behind what the remote database already has, so tagging an older commit cannot roll a
  database back either (`development/deployment.md`'s own note).
- **Console**: redeploy the previous Vercel build (once a Console deploy pipeline exists — not yet, see
  `development/deployment.md`'s "Not implemented" table).
- **Gate app**: an EAS update (OTA) can roll back a JavaScript-only change on the existing native build immediately.
  A native-code change (for example a new native module) needs a new build and store/internal-distribution rollout;
  there is no OTA rollback for that case.
- **If the bad release also needs the server to stop accepting a version**: raise `min_supported_schema_version()` in
  a new migration (see above) rather than trying to make old clients disappear any other way.

No rollback has been drilled yet (REL-01 step 8, `T-REL-01-E1`/`E2`) — the deploy workflows themselves are not live
(`development/deployment.md`'s "Not implemented" table: no Supabase projects or GitHub environments exist, CLD-01).
Once they are, the first production deploy's drill should be: deploy a trivial tagged release, then exercise the
Console/Gate rollback steps above against it, and record the result here under History.

## History

| Date | Tag | SCHEMA_VERSION | Notes                                                                                                                          |
| ---- | --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| —    | —   | 1              | No tagged release yet. `SCHEMA_VERSION` has been `1` since `packages/contracts` was created (PR #8) and has never been bumped. |
