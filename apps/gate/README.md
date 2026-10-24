# apps/gate: Android gate app (owner: Nikhil)

Expo (React Native) shell, generated from the official `blank-typescript` template and trimmed.
Screens are placeholders; features are specified in `docs/team/member-02-nikhil.md` (GATE-01..12).

Commands (from the repo root, `pnpm --filter @pmp/gate <script>`):

| Script              | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `start` / `android` | Expo dev server (needs a device or emulator; not run in CI) |
| `bundle:android`    | JS bundle export, verifies Metro can resolve everything     |
| `typecheck`, `test` | Run by root `pnpm check`                                    |

Not set up yet: SQLite outbox, EAS builds, native modules. Share code only via `packages/*`.
