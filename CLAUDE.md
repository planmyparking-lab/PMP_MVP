# CLAUDE.md: guidance for AI-assisted development

- Read `docs/team/README.md` first, then your member sheet in `docs/team/`.
- Do not invent requirements. If a spec is missing, add it to `docs/team/open-questions-and-assumptions.md`.
- Money is integer paise. Events are append-only. Ids are UUIDv7 generated on device.
- Shared packages (`packages/*`, `supabase/migrations`) need a second workstream owner's review.
- Never claim a test passes unless you ran it. Run `pnpm check` before opening a PR.
- Do not commit secrets or `.env` files.
