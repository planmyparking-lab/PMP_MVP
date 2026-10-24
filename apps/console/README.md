# apps/console: Operator Console (owner: Anamika)

Next.js (App Router) shell, generated with `create-next-app` and trimmed to a placeholder page.
Features are specified in `docs/team/member-03-anamika.md` (CON-01..12).

Commands (from the repo root, `pnpm --filter @pmp/console <script>`): `dev`, `build`, `start`, `typecheck`.
`build` and `typecheck` run in root `pnpm check`. There are no console tests yet; add `test` when the first
testable module exists. Linting uses the root ESLint config (`eslint-config-next` is not installed; add it
if you want Next-specific rules). Never expose the Supabase service-role key to the browser.
