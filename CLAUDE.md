# CLAUDE.md: guidance for AI-assisted development

- Read `docs/team/README.md` first, then your member sheet in `docs/team/`.
- Do not invent requirements. If a spec is missing, add it to `docs/team/open-questions-and-assumptions.md`.
- Money is integer paise. Events are append-only. Ids are UUIDv7 generated on device.
- Shared packages (`packages/*`, `supabase/migrations`) need a second workstream owner's review.
- Never claim a test passes unless you ran it. Run `pnpm check` before opening a PR.
- Do not commit secrets or `.env` files.

## Occupancy rule: two phones at one gate

Occupancy is derived (`computeOccupancy` in `packages/sync-rules`), never kept as an incremented counter. Each phone sees its own events at once and the other
phone's only after sync, so counts on two phones can differ briefly. After a baseline (`ZONE_COUNT`), a cross-device exit is corrected via the
`closedSessions` input (OQ-16 amendment), not just by waiting for sync — without it, the baseline-branch count would stay wrong permanently, not briefly.
`closedSessions` needs download sync (SYNC-03) to be real; pass `[]` until then. The Console shows the merged truth regardless. Do not add a stored
per-zone counter to fix this.
