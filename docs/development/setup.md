# Local setup

The single, maintained setup and workflow instructions are in [`CONTRIBUTING.md`](../../CONTRIBUTING.md)
(sections 1 to 5). Environment variables: [`.env.example`](../../.env.example).

## Environment variables: local vs CI vs production

- **Local:** values in an untracked file (`.env.local`), pointing at a development Supabase project.
- **CI:** GitHub Actions secrets. CI uses none today; add them under Settings > Secrets only when a job needs one.
- **Production:** configured in Vercel, Supabase and EAS project settings; never stored in this repo.
- Never commit real values. `pnpm check:repo` fails if a `.env` file is tracked or a private key pattern appears.
