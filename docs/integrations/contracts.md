# Integration guide: shared interfaces and ownership

Source of truth for the contracts themselves: `docs/team/README.md` section 5 (IC-01..IC-10) and each
provider's sheet. This file adds how to change them and who may touch what. Nothing here defines a
new API; items not implemented are labelled **Planned**.

## Shared components

| Component                                                              | Where                                   | Owner (CODEOWNERS)                                                                                    | Status                                                                                                                 | Other members may                                                  |
| ---------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Event schemas, money, reason codes, schema version (IC-01)             | `packages/contracts`                    | Afzal                                                                                                 | Implemented for ENTRY, EXIT, PAYMENT, OVERRIDE; envelope only for ZONE_COUNT, SHIFT_OPEN, SHIFT_CLOSE; tests run in CI | Propose changes by PR; owner plus one other workstream must review |
| Fare function and tariff JSON (IC-04)                                  | `packages/contracts`, `packages/domain` | Nikhil, Afzal co-owns (C-1 resolved)                                                                  | Fare calculation and tariff schema implemented; partner semantics and Console integration remain unverified            | Console consumes only; changes go through the owner                |
| Sync client API (IC-02)                                                | `packages/sync-rules`                   | Afzal                                                                                                 | Planned, blocked on the sync spike decision                                                                            | Gate app consumes only                                             |
| Database schema, RLS, ingest function (IC-03, IC-05..07, IC-09, IC-10) | `supabase/migrations`                   | Afzal and Akanksha co-own (C-3 resolved)                                                              | Planned (no migrations yet)                                                                                            | Request columns via PR to the contract doc                         |
| Edge Functions                                                         | `supabase/functions`                    | Akanksha                                                                                              | Planned                                                                                                                |                                                                    |
| Report scheduler and email (CLD-06)                                    | Supabase `pg_cron`/`pg_net` jobs        | Anamika (moved from Akanksha); migrations and functions need approval from a CODEOWNER of `supabase/` | Planned                                                                                                                |                                                                    |
| Report render route (IC-08)                                            | `apps/console`                          | Anamika                                                                                               | Planned                                                                                                                | Akanksha's scheduler consumes                                      |
| Environment variable names                                             | `.env.example`                          | Whoever adds the variable                                                                             | Implemented (list is planned usage)                                                                                    | Add a variable in the same PR that reads it                        |

## Conventions (from the existing contracts package)

- Money is integer paise; reject floats and negatives.
- Event ids are UUIDs generated on device; `device_time` is UTC ISO 8601 with `Z`.
- Parsing returns `{ ok: true, value } | { ok: false, issues }`; no exceptions for invalid input.
- Unknown event types are rejected. `OTHER` override reason requires a note.

## IC-04 tariff and fare proposal

The tariff JSON schema is exported by `@pmp/contracts`; the pure fare calculation and
explanation report are exported by `@pmp/domain`. Money is integer paise. The implementation
selects the tariff effective on the entry instant's IST date, rounds positive fractional-minute
durations up, applies grace to the whole stay, and applies day caps per 24-hour block. These
semantics are covered by the checked-in fixture table, including the single OQ-20 case that
remains skipped pending the tariff-at-entry versus tariff-at-exit decision.

Two additional tariff details remain provisional and require partner/owner confirmation before
production pricing: a night multiplier is applied once to the post-cap subtotal for the stay,
and a null-ended hourly slab marks the open tail while `repeat` prices beyond the last finite
slab. The schema requires `repeat` for hourly-slab tariffs. The implementation and tests make
these assumptions explicit; they do not constitute approval of the business rules.

## Proposing a contract change

1. Open a PR that edits the contract text (`docs/team` section 5 or this file) before or with the code.
2. Label the PR with the IC number. The provider owner and one consumer owner must approve.
3. Breaking change: bump `SCHEMA_VERSION`, update `docs/team/feature-traceability.md`, notify consumers.
4. Migrations: forward-only; consumer features must tolerate the previous version until the minimum
   supported version is raised.

## Safe sequence for dependent work

Follow `docs/team/README.md` section 6. In short: contracts (IC-01) first, then schema, then ingest and
sync, then gate and console features that consume them. The fare function must exist before the exit
flow and the console "try it" panel.

## Unresolved decisions

OQ-20 (tariff semantics), night-multiplier and open-ended-slab partner semantics above,
OQ-30 (`PAYMENT_CORRECTION` event type), payloads of ZONE_COUNT, SHIFT_OPEN and SHIFT_CLOSE.
See `docs/team/open-questions-and-assumptions.md`.
