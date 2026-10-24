# Contributing

This is the single workflow document. Branch rules, commits, reviews and local checks are defined
here; GitHub-side settings are in `docs/development/github-repository-settings.md`.

## 1. One-time setup

Requirements: Git, Node 22 (`.nvmrc`), pnpm 10.28 (`packageManager` in `package.json`).

```bash
git clone https://github.com/planmyparking-lab/PMP_MVP.git
cd PMP_MVP
npm install -g pnpm@10.28.0     # or: corepack enable (needs admin rights on Windows)
pnpm install
pnpm check                      # must pass before you start
```

Environment variables: see `.env.example`. Copy what you need into an untracked local file
(`.env.local`). No current command reads any variable, so `pnpm check` needs none.

## 2. What you can run today

| Command                             | What it does                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm check`                        | Everything below, in CI order                                                |
| `pnpm check:repo`                   | Required files exist, no tracked `.env`, no obvious secrets, READMEs present |
| `pnpm format` / `pnpm format:check` | Prettier write / verify                                                      |
| `pnpm lint`                         | ESLint                                                                       |
| `pnpm typecheck`                    | `tsc` in every package that defines `typecheck`                              |
| `pnpm test`                         | Vitest in every package that defines `test` (today: `packages/contracts`)    |
| `pnpm check:branch`                 | Validates your current branch name                                           |

`apps/gate` and `apps/console` are placeholder shells (no features yet). `supabase/` is not initialized.

## 3. Branches

`main` is the integrated, stable branch. Do not work on it. Create a branch per task:

`<type>/<slug>` with type `feature|fix|test|docs|refactor|chore|spike`, lowercase, digits and hyphens.
Put the feature ID in the slug: `feature/gate-05-monthly-pass`, `fix/sync-02-duplicate-ack`.
No personal names. Checked by `pnpm check:branch` and by CI.

## 4. Commits

Conventional Commits, imperative, short subject:

```
feat(gate): add monthly pass validation
fix(contracts): reject fractional paise
test(domain): cover night-rate fare cases
docs(team): update ownership conflicts
refactor(sync-rules): simplify outbox retry
chore(ci): pin action versions
```

Scope is the area (`gate`, `console`, `contracts`, `domain`, `sync-rules`, `supabase`, `ci`, `team`).
There is no commit-lint tool; reviewers enforce this.

## 5. Day-to-day flow

```bash
git switch main && git pull --ff-only origin main
git switch -c feature/gate-05-monthly-pass
# ...work, commit small...
pnpm check
git fetch origin && git rebase origin/main     # or: git merge origin/main
git push -u origin feature/gate-05-monthly-pass
```

1. Open a pull request into `main` with the template filled in.
2. CI must pass: required check names are `check` and `branch-name` (`audit` is advisory).
3. Respond to review with new commits; resolve conversations when addressed.
4. After approval, merge using the method the repository allows (recommended: squash).
5. Clean up: `git switch main && git pull --ff-only && git branch -d <branch>`.

**Conflicts:** rebase or merge `origin/main` into your branch, resolve in your editor, re-run
`pnpm check`, then push (use `--force-with-lease` only after a rebase of your own branch).
Never resolve a conflict in a shared contract by picking a side silently; talk to its owner (section 7).

## 6. Review expectations

- One approval from a code owner of the touched paths (`.github/CODEOWNERS`) is the target policy.
- Whether GitHub actually enforces that is a repository setting; see the settings handoff doc.
  Do not assume enforcement from this file.
- Authors do not approve their own PRs. Keep PRs small and tied to a feature ID.
- Reviewers check: tests exist for the Test IDs touched, no secrets, docs updated, contract rules (below).

## 7. Shared interfaces and migrations

Rules (details and owners: `docs/integrations/contracts.md`):

- `packages/contracts`, `packages/domain`, `packages/sync-rules` and `supabase/migrations` are shared.
  A change needs a reviewer from another workstream in addition to the code owner.
- Breaking event-shape change: bump `SCHEMA_VERSION` in the same PR and announce it.
- Migrations are forward-only, one concern per file, with RLS and a test. Never edit a merged migration.
- Contract changes are proposed with a PR that edits the contract doc first.

## 8. Tests and docs

Add tests for the Test IDs you touch (`T-<FeatureID>-<kind><n>`); see `docs/testing/strategy.md`.
Do not mark anything verified in `docs/team/feature-traceability.md` unless you ran it.
Update the one canonical document; do not copy content between docs.
