# RLS and permission matrix (CLD-03)

Owner: Akanksha (Member 04). Evidence document for `CLD-03` (`docs/team/member-04-akanksha.md`, section C, step 16: "matrix
table committed in `ops/rls-matrix.md`").

**Status: describes migration `0010_rls.sql` as proposed in pull request #34 (commit `1073188`). That pull request is
under review and not merged, so none of this is in force on `main` yet.** If #34 changes before it merges, this file must
change with it. The behaviour below was read from the migration files and checked by the pgTAP suites
`rls_policies.test.sql` (111 assertions) and `rls_sync_tables.test.sql` (40 assertions), run on a local Supabase stack
on 12 Nov 2026 (not CI). The matrix follows section D.3 of the member sheet; where the sheet is silent or ambiguous the
choice is fail-closed and recorded as OQ-58 (`docs/team/open-questions-and-assumptions.md`; the row is added by
PR #34 and does not exist on `main` yet).

## 1. Who the roles are

| Role                    | How the database recognises it                                                                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner                   | A `memberships` row with `role = 'owner'` and `facility_id` null (organization-wide), through `is_member()` / `is_org_member()`.                                                                                                               |
| Manager                 | A `memberships` row with `role = 'manager'` for one facility (or organization-wide), through `is_member()`.                                                                                                                                    |
| Guard (membership)      | `role = 'guard'` has **no policy anywhere**: guards act through their enrolled phone, not through a person login.                                                                                                                              |
| Device (enrolled phone) | A Supabase auth user whose JWT `app_metadata` carries `role = 'device'`, `device_id` and `facility_id` **and** matches a non-revoked `devices` row (`auth_user_id`). `device_facility()` returns the facility or null. Fails closed otherwise. |
| Anonymous (`anon`)      | No privilege on any table, view or function in `public`.                                                                                                                                                                                       |
| `service_role`          | Server side only (Edge Functions, jobs). Not covered by these policies.                                                                                                                                                                        |

## 2. Table matrix

Every public table has RLS enabled. "Owner/manager" means a member of the row's facility (or organization) as above. A
dash means no policy and no privilege: the operation is denied.

| Table                  | Select                                                                               | Insert                                                                                                    | Update                                                | Delete                  | Device (phone)                                                  |
| ---------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------- | --------------------------------------------------------------- |
| `organizations`        | Owner/manager of the organization or any of its facilities                           | -                                                                                                         | Organization-wide owner                               | -                       | -                                                               |
| `facilities`           | Owner/manager; the facility's own devices                                            | -                                                                                                         | Owner, columns `name`, `timezone`, `slot_count` only  | -                       | Read own facility                                               |
| `zones`                | Owner/manager; own devices                                                           | Owner/manager                                                                                             | Owner/manager                                         | Owner/manager           | Read own facility                                               |
| `tariffs`              | Owner/manager; own devices                                                           | Owner/manager                                                                                             | Owner/manager                                         | Owner/manager           | Read own facility                                               |
| `passes`               | Owner/manager; own devices                                                           | Owner/manager                                                                                             | Owner/manager                                         | Owner/manager           | Read own facility                                               |
| `staff`                | Owner/manager, columns `id`, `facility_id`, `name`, `phone`, `active`, `created_at`  | - (staff and PINs are created by `set_staff_pin`, IC-06, not yet written)                                 | Owner/manager, columns `name`, `phone`, `active` only | Owner/manager           | Never the table; the view `staff_for_device` (section 4)        |
| `devices`              | Owner/manager                                                                        | - (devices are created by `enroll_device`, IC-05, not yet written)                                        | Owner/manager, columns `name`, `revoked_at` only      | Owner/manager           | -                                                               |
| `enrollment_codes`     | Owner/manager                                                                        | Owner/manager                                                                                             | Owner/manager                                         | Owner/manager           | -                                                               |
| `memberships`          | Everyone their own rows; owner the whole organization; manager their facility's rows | Organization-wide owner                                                                                   | Organization-wide owner                               | Organization-wide owner | -                                                               |
| `events`               | Owner/manager                                                                        | - (only `ingest_events` writes)                                                                           | - (revoked)                                           | - (revoked)             | - (devices read no events, OQ-58 item 1)                        |
| `open_sessions`        | Owner/manager; own devices                                                           | - (maintained by a trigger on `events`)                                                                   | -                                                     | -                       | Read own facility                                               |
| `sync_conflicts`       | Owner/manager                                                                        | - (written by the detector)                                                                               | -                                                     | -                       | -                                                               |
| `shift_reviews`        | Owner/manager                                                                        | Owner/manager, `reviewed_by` = the caller, and the shift must have a `SHIFT_CLOSE` event in that facility | - (append-only)                                       | - (append-only)         | -                                                               |
| `conflict_resolutions` | Owner/manager of the conflict's facility                                             | Owner/manager of the conflict's facility, `resolved_by` = the caller                                      | - (append-only)                                       | - (append-only)         | -                                                               |
| `device_heartbeats`    | Owner/manager                                                                        | - (only `heartbeat()` writes)                                                                             | -                                                     | -                       | Writes through `heartbeat()` only; reads nothing (OQ-58 item 2) |

## 3. Views and functions

| Object                                                                               | Who can use it                                    | Notes                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v_daily_kpis`, `v_hourly` (0009)                                                    | `authenticated`; `anon` has no access             | `security_invoker`: a caller sees only the events and facilities that their own policies allow. Nothing here widens access.                                                                                     |
| `staff_for_device` (0010)                                                            | `authenticated`, select only                      | Runs as its owner on purpose; its `WHERE` is the access control: active staff of `device_facility()` only. Exposes `id`, `name`, `pin_hash`, `pin_salt`, `active`. A person who is not a device gets zero rows. |
| `is_member(facility_id, roles)`, `is_org_member(org_id, roles)`, `device_facility()` | `authenticated`; revoked from `public` and `anon` | `security definer`, `search_path = ''`, schema-qualified, read `auth.uid()` and `auth.jwt()`.                                                                                                                   |
| `ingest_events(events jsonb)` (0004)                                                 | `authenticated`                                   | Identifies the caller by `devices.auth_user_id` for a non-revoked device. Does **not** yet check the JWT claims (see section 5).                                                                                |
| `heartbeat(...)` (0008)                                                              | `authenticated`                                   | Requires `auth_user_id`, the `device_id` claim and `role = 'device'`, a non-revoked device; one generic `42501` for every failure.                                                                              |

## 4. Privileges beyond RLS

RLS does not govern `TRUNCATE`, `REFERENCES`, `TRIGGER` or column-level access, so these are set with privileges and are tested:

- `authenticated` holds no `TRUNCATE`, `REFERENCES` or `TRIGGER` on any public table; `anon` holds nothing. A catalog
  assertion fails for **any** future table that keeps the default grants, so each new migration must repeat the revoke.
- PIN material: no application role can read or write `staff.pin_hash` or `staff.pin_salt`. Devices get the hashes only
  through `staff_for_device`.
- Device identity: no application role can write `devices.auth_user_id`; managers can only rename a device or set
  `revoked_at`.
- Facility ownership: no application role can update `facilities.id`, `org_id` or `created_at`, so an owner cannot move a facility into
  another organization.
- No policy is literally `true`, and every policy is scoped to `authenticated` (both asserted by the catalog tests).

## 5. Known gaps and assumptions

| Gap                                                                                                                                                                                                                                      | Where recorded                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `ingest_events` still finds the device by `auth_user_id` alone. Defence in depth would also require the JWT claims that `device_facility()` checks; `0004` is merged, so this belongs in the IC-01 validation rewrite (proposed `0013`). | OQ-58 item 7, OQ-52                                      |
| A manager can still clear `devices.revoked_at` (un-revoke a device).                                                                                                                                                                     | OQ-58 item 7                                             |
| Managers keep full write on `enrollment_codes`, so a manager can reset `used_at` or extend `expires_at`. Recommended: managers insert codes only and codes are consumed through `enroll_device`.                                         | OQ-58 item 5                                             |
| No staff can be created and no PIN set until `set_staff_pin` exists, so the Console cannot add guards yet.                                                                                                                               | OQ-58 item 8                                             |
| No `ALTER DEFAULT PRIVILEGES` rule: each migration revokes the three privileges itself and the catalog test enforces it.                                                                                                                 | OQ-58 item 6                                             |
| Not covered because the tables or functions do not exist: `job_runs`, `audit_log`, `alert_log`, `enroll_device`, `v_zone_now`. Their policies belong with the migration that creates each.                                               | `docs/team/member-04-akanksha.md` CLD-03, CLD-05, CLD-07 |
| Performance of per-row `is_member()` in policies under load is unproven.                                                                                                                                                                 | OQ-56                                                    |

## 6. How to re-verify

```text
pnpm test:db     # applies 0001-0010 in a rolled-back transaction on the local Supabase stack; needs Docker
```

`rls_policies.test.sql` covers owners, managers of two facilities, devices (valid, revoked, mismatched claims), a stranger,
`anon`, and the privilege boundary; `rls_sync_tables.test.sql` covers `open_sessions`, `sync_conflicts`, `shift_reviews`,
`conflict_resolutions` and the `facilities` column grants. The `event_parity` suite fails on `main` today for an unrelated
reason (the IC-01 validation gap, OQ-52).
