# apps/console: Operator Console (owner: Anamika)

Next.js (App Router) shell, generated with `create-next-app` and trimmed to a placeholder page.
Features are specified in `docs/team/member-03-anamika.md` (CON-01..12).

Commands (from the repo root, `pnpm --filter @pmp/console <script>`): `dev`, `build`, `start`, `typecheck`.
`build` and `typecheck` run in root `pnpm check`. There are no console tests yet; add `test` when the first
testable module exists. Linting uses the root ESLint config (`eslint-config-next` is not installed; add it
if you want Next-specific rules). Never expose the Supabase service-role key to the browser.

## Connecting to Supabase (CON-03)

Create `apps/console/.env.local` (never commit it) with the DEV project's public values:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

Without them the Console runs as an "Offline preview" and every live figure shows as unavailable. With them,
`proxy.ts` sends signed-out visitors to `/login`, and the server loaders in `src/lib/data/` read zones,
`open_sessions`, `sync_conflicts`, devices, staff and today's events with the user's own JWT (RLS applies; the
service-role key is never used). Rows only appear once CLD-03 policies exist (see OQ-50).
