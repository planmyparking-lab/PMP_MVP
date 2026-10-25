# CLD-02 review: `0003_events.sql` contract blockers and append-only gaps

Status: review notes, 25 Oct 2026. Author: Akanksha (CLD-02). `0003_events.sql` is **proposed, not merged, and not applied** to any
migration history. Nothing here changes a shared contract; each item names the decision and the person who owns it.
Labels: **VERIFIED** (read in a file or checked on the local database), **RECOMMENDATION** (not decided).

Evidence for the privilege findings came from running catalog queries on the local Supabase database inside a transaction that
applied `0003_events.sql` and was then rolled back. Role names and ACLs below are therefore the local Supabase defaults.

## HANDOFF: CLD-02 state for Anamika (recorded 25 Oct 2026)

Read this first. Everything below it is the supporting detail. Owner assignments in this document are unchanged; this section only
states the current state and what Anamika is asked to confirm.

### Current state

| Item | State |
| --- | --- |
| `0001_org_facility_zone_tariff_pass.sql`, `0002_staff_devices_memberships.sql` | Recorded in the **local** migration history (verified again just now: history is `0001,0002`). Not merged. |
| `0003_events.sql` | **Not applied** anywhere. Proposed, not merged. It must not merge until the SYNC-01 PR updates the TypeScript contract and T-IC01-C1 verifies both sides (Afzal). |
| `supabase/tests/events_schema.test.sql` | 64 assertions: **63 passed, 1 blocked (TODO)**, out of 64. The blocked one is `authenticated has no direct INSERT on events`, waiting for Afzal's `ingest_events` security-mode answer. The suite is **not fully passing**. Last run was inside a rolled-back transaction with `0003` temporarily applied. |
| `supabase/tests/base_schema.test.sql` | Last run **53 of 53** passed (extended from 38 with defaults, cascade, restrict and index checks) against the local database. |
| `source` vocabulary | Confirmed by Afzal: `LIVE` and `PAPER_BACKFILL`, with `LIVE` as the SQL default. Written into the proposed `0003`. `packages/contracts` has **not** been updated (Afzal will do it in the SYNC-01 PR). |
| Cross-facility composite-FK design (section 10) | **Implemented in `0003` on a provisional team assumption (not confirmed by Afzal):** composite foreign keys (`events.device_id, facility_id` and `events.staff_id, facility_id`) and the unique keys they reference. 9 regression assertions added; 8 of them fail against the old single-column keys. Still subject to Afzal's approval and to Nikhil's and Anamika's confirmation. |
| Migration strategy for that design | **Option A** used: the two unique constraints and the composite keys are in `0003`; `0001` and `0002` are unchanged. |
| Remote database | **No remote database has been modified** by this work. All database runs were on the local Supabase stack. |
| Git | **No Git operations were performed** by this work. Nothing is staged or committed: `0001` to `0003`, both test files and this document are untracked. |
| Unrelated working-tree changes | `.gitignore` (adds `supabase/.branches/`) and `supabase/config.toml` (local port numbers) are modified. They are not part of CLD-02; whoever owns them decides what to do with them. |

### Anamika is asked to confirm (facts about her own plans only)

These are questions about what her features need. The decisions they feed stay with the owners named in sections 8 to 10.

1. **Moving devices or staff between facilities.** Does any Console flow (CON-02 staff, devices and roles; the multi-site switcher) require a
   device or staff member to change facility? The composite-FK proposal would forbid that while events reference the row. The decision
   on adopting the design stays with Afzal and Akanksha; Nikhil is also asked about gate flows (section 10).
2. **Shift identifier.** Do her shift tables and views (`shift_reviews` keyed by `shift_id`, `member-03-anamika.md:236,240`; CON-06) need one stable shift
   identifier shared by `SHIFT_OPEN` and `SHIFT_CLOSE` events? Her answer is input only. Which payload fields the contract uses is Afzal's
   decision, reconciled with Nikhil (section 8).
3. **Dependence on the single-column event foreign keys.** Does any planned migration or view of hers reference `events.device_id` or
   `events.staff_id` in a way that relies on the current single-column keys (for example a foreign key to them, or a join assumption)?
   She should list them, so the change can be judged before it is approved.
4. **The `0011` number.** CLD-02, CLD-07 and her CLD-06 (job helpers, `member-03-anamika.md:331`) all claim `0011`. How would a renumbering
   affect her planned migrations and functions? The numbering decision is Afzal's agreement with Akanksha (section "Other open items").

### Outstanding decisions by owner (unchanged)

- **Afzal:** `ingest_events` SECURITY DEFINER or INVOKER (and so whether `authenticated` keeps INSERT); `schema_version` integer or smallint and its
  maximum; whether JSON-Schema-derived SQL payload CHECKs are dropped; exact payload fields per event type; SQL CHECK or Zod-only for the
  `session_id` rule; approval of the composite-FK design and migration option; the SYNC-01 contract update and T-IC01-C1; `0011` numbering.
- **Afzal and Nikhil:** reconcile payload fields where their sheets differ (section 8); Nikhil's `member-02-nikhil.md:109` still says `GATE` and must be aligned with `LIVE`.
- **Afzal, Nikhil and Anamika:** the shift identifier carried by `SHIFT_OPEN` and `SHIFT_CLOSE` (section 8).
- **Akanksha:** the proposal and its tests (sections 6 and 10), the purge-role and trigger design for retention (deferred), `MAINTAIN` revoke once the hosted
  Postgres version is known.
- **Team:** OQ-30 (`PAYMENT_CORRECTION`), and registering these open items in `open-questions-and-assumptions.md`.

Where to look: privilege findings and the applied revokes, section 5 and 6; confirmed envelope decisions, section 7; Afzal-versus-Nikhil payload
table, section 8; questions for Afzal, section 9; composite-FK proposal, section 10.

## Summary

| # | Issue | Blocks | Decision owner |
| --- | --- | --- | --- |
| 1 | `device_id`: TypeScript string vs SQL uuid foreign key | `0003`, SYNC-02, GATE-09 | Afzal, Nikhil |
| 2 | `facility_id`, `staff_id`, `source` required in SQL, absent from the TypeScript schema | `0003`, SYNC-01 | Afzal |
| 3 | `source` vocabulary: `GATE` vs `LIVE` | `0003`, GATE-01, GATE-11 | Afzal, Nikhil |
| 4 | SQL `payload jsonb` vs top-level fields in the TypeScript schemas | `0003`, SYNC-02 | Afzal |
| 5 | Append-only privilege gaps | `0003` merge, CLD-03, CLD-08 | Akanksha, with Afzal reviewing |

**Update (section 7):** Afzal has since confirmed the event envelope. Items 1 to 4 below are kept as the original findings; the
decisions that resolve them are in section 7. They are decisions, not code: `packages/contracts` has **not** been updated yet.
Item 5 is unchanged and still partly open.

## 1. `device_id`: string vs uuid

- **Evidence (VERIFIED).** `packages/contracts/src/events.ts:21` has `device_id: z.string().min(1)`. `0003_events.sql:9-10` has
  `device_id uuid not null references public.devices(id)`. `devices.id` is a uuid (`0002_staff_devices_memberships.sql:20`).
  The auth claim is also named `device_id` (`member-01-afzal.md:58`); its format is not stated.
- **Impact.** A contract-valid event with a non-uuid device id passes the TypeScript parser and then fails the SQL foreign key,
  so the batch or event is rejected at ingest. This is the only place the two sides can disagree silently.
- **Decision needed.** Make the contract `z.string().uuid()`, or change the SQL type. Afzal owns the contract; Nikhil
  generates the id at enrollment time (GATE-09, IC-05).

## 2. `facility_id`, `staff_id`, `source` missing from TypeScript

- **Evidence (VERIFIED).** The `base` object in `events.ts:17-22` has `id`, `device_id`, `device_time`, `schema_version` only.
  `0003_events.sql:7-12,27` makes `facility_id`, `staff_id` and `source` NOT NULL. Afzal's plan lists all three in `BaseEvent`
  (`member-01-afzal.md:107`), and Nikhil's envelope lists them (`member-02-nikhil.md:109`).
- **Impact.** The implemented contract is narrower than both plans. Anything built from the TypeScript type (gate app writer,
  sync client) cannot supply NOT NULL columns, and tests cannot cross-check SQL against the schema.
- **Decision needed.** Afzal updates `packages/contracts` (needs approval from all four, per the README shared-package rule),
  or states that the server derives them from the JWT claims. `ingest_events` is documented as ignoring a client-sent
  `facility_id`/`device_id` that differs from the claims (`member-01-afzal.md:547`), so how they travel is part of this decision.

## 3. `GATE` vs `LIVE`

- **Evidence (VERIFIED).** Afzal: `source` is `LIVE` or `PAPER_BACKFILL` (`member-01-afzal.md:107`). Nikhil: `GATE` or
  `PAPER_BACKFILL` (`member-02-nikhil.md:109`). `0003_events.sql:28` currently allows `GATE` and `PAPER_BACKFILL`.
  `PAPER_BACKFILL` is the only value both agree on.
- **Impact.** If the contract settles on `LIVE`, every normal event is rejected by the SQL check constraint.
  The check cannot be loosened later without a new migration (forward-only).
- **Decision needed.** Afzal (contract owner) with Nikhil. `events_schema.test.sql` deliberately asserts nothing about `LIVE`.

## 4. SQL `payload jsonb` vs top-level fields

- **Evidence (VERIFIED).** `events.ts` puts payload fields at the top level (for example `session_id`, `amount_paise`, `mode`,
  `target_event_id` at lines 26-56). `0003_events.sql:24` stores payload in `payload jsonb not null default '{}'`,
  with only `session_id` promoted to a column (line 23). Afzal's `BaseEvent` includes a `payload` field
  (`member-01-afzal.md:107`), which matches SQL but not the implemented TypeScript. The payloads for `ZONE_COUNT`,
  `SHIFT_OPEN`, `SHIFT_CLOSE` are unspecified (`events.ts:58`, TODO), and `PAYMENT_CORRECTION` is not defined (OQ-30).
  Related, not part of this item: the documented `PAYMENT.mode` values include `PASS` and `WAIVED`
  (`member-01-afzal.md:111`), while `events.ts` allows only `CASH` and `UPI`.
- **Impact.** Someone must map between the two shapes on the way in. Without a rule, the database accepts any payload
  (including an empty `{}`) for any event type, so payload validity rests on the ingest function alone. KPI views (CLD-05) read
  `payload`, so a shape change later is breaking.
- **Decision needed.** Afzal: one canonical wire shape (nested `payload` or flat), and where it is validated.
  SQL payload checks, if wanted, are a separate decision.

## 5. Append-only privilege gaps

**Requirement (VERIFIED in docs).** `UPDATE` and `DELETE` are revoked for every application role; corrections are new
`OVERRIDE` events (`member-04-akanksha.md:606`, `member-02-nikhil.md:93` and `member-01-afzal.md:552` for the corrections-are-events rule). Tests expected by the plan:
T-SYNC-02-N3 refuses UPDATE and DELETE for "device, manager, owner, service role used by app" (`member-01-afzal.md:369`);
T-CLD-08-N2 denies delete for every role except the purge role (`member-04-akanksha.md:478`). Direct `insert` on `events` is
also meant to be revoked, with only `ingest_events` writing (`member-04-akanksha.md:188`).

**Catalog results, local database, `0003` applied in a rolled-back transaction (VERIFIED):**

| Role | rolsuper | bypassrls | SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `postgres` (table owner) | no | yes | yes | yes | **yes** | **yes** | yes | yes | yes |
| `supabase_admin` | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| `service_role` | no | yes | yes | yes | **yes** | **yes** | **yes** | yes | yes |
| `authenticated` | no | no | yes | **yes** | no | no | **yes** | yes | **yes** |
| `anon` | no | no | no | no | no | no | no | no | no |
| `authenticator` | no | no | no | no | no | no | no | no | no |

Table ACL as stored: `postgres=arwdDxtm`, `authenticated=arDxtm`, `service_role=arwdDxtm` (no entry for `anon`, no PUBLIC entry).
The table has no user triggers. Default privileges in the `public` schema grant all privileges to `anon`, `authenticated`
and `service_role` on every new table, so each new table needs its own revokes.

**Findings**

- `service_role` can UPDATE, DELETE and TRUNCATE `events`. Edge Functions normally run as this role, so the stated rule
  for "service role used by app" is not met. Row-level security does not apply to it (bypassrls).
- The table owner `postgres` can UPDATE and DELETE. This is expected for an owner, but security-definer functions
  (such as `ingest_events`) usually run as the owner, so a bug in any such function could modify events.
- `authenticated` holds INSERT, TRUNCATE, TRIGGER and REFERENCES. RLS does not govern TRUNCATE, so once a login is possible
  an `authenticated` session could empty the table. INSERT conflicts with "direct insert revoked", although RLS currently
  denies it because no policy exists. The same holds for `service_role`.
- The existing tests (`events_schema.test.sql`) check UPDATE/DELETE for `authenticated`, `anon` and PUBLIC only. They do
  not cover `service_role`, TRUNCATE or INSERT, so they pass while these gaps exist.

**Decision needed.** Akanksha proposes; Afzal reviews (permission change, `member-04-akanksha.md` A.8). See the recommendation
below. Nothing has been implemented.

### Recommendation (not implemented)

1. **Narrow the grants in `0003`** (revokes are idempotent and forward-only safe; status in section 6: `UPDATE, DELETE, TRUNCATE,
   TRIGGER, REFERENCES` are now revoked from `authenticated` and `service_role` in `0003`, `MAINTAIN` is deferred); revoke `INSERT`
   from `authenticated` if `ingest_events` is security definer (Afzal to confirm, still open). Keep `SELECT`, and `INSERT` for `service_role` only if a function needs it. Privileges
   are only the first layer: the owner and superusers cannot be limited by grants.
2. **Add a trigger as defence in depth:** a `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger
   (TRUNCATE does not fire row triggers) that raise an error. This protects against bugs in privileged functions. It can be
   disabled by the table owner or a superuser, so it is a safety net and not tamper-proofing.
3. **Purge path (CLD-08):** a dedicated `NOLOGIN` role that alone holds DELETE (the plan already says so,
   `member-04-akanksha.md:292`). The trigger lets a DELETE through only when `current_user` is that role, not on a session
   setting that any caller could set. The purge is a `security definer` function owned by that role, with an empty
   `search_path`, EXECUTE revoked from `anon` and `authenticated`, deleting only rows older than the facility's `retention_days`,
   never entries of unexited sessions, inside one transaction, with `job_runs` and `audit_log` entries.
4. **Honest limit.** The PRD calls the append-only record the "tamper-evident audit trail" (FR-55, per
   `member-01-afzal.md:552`). Grants and triggers make tampering harder, not evident, against a privileged operator. If
   tamper evidence is a real requirement, it needs something extra (for example hash chaining, or an external copy), which is a
   team decision.
5. **Tests to add when implemented:** the plan's table of expected checks (service role, TRUNCATE, INSERT) in
   `events_schema.test.sql`, plus T-CLD-08-N2 once the purge role exists.

## 6. Privilege tests and the proposed patch (added 25 Oct 2026)

### Test coverage now in `supabase/tests/events_schema.test.sql` (44 assertions, `plan(44)`)

The 39 earlier assertions are unchanged. Five were added, using `has_table_privilege` (effective privileges, including any
inherited through role membership):

| New assertion | Requirement it states |
| --- | --- |
| `authenticated` cannot TRUNCATE | RLS does not govern TRUNCATE |
| `authenticated` has no direct INSERT | direct insert revoked, only `ingest_events` writes (`member-04-akanksha.md:188`) |
| `service_role` cannot UPDATE | T-SYNC-02-N3, `member-01-afzal.md:369` |
| `service_role` cannot DELETE | same |
| `service_role` cannot TRUNCATE | append-only (`member-04-akanksha.md:606`) |

Already present and kept: RLS enabled, `anon` holds no privilege, `authenticated`/`anon` lack UPDATE and DELETE, PUBLIC lacks
UPDATE and DELETE (checked through the ACL, since there is no role name for PUBLIC). The owner and superusers are deliberately not
asserted; grants cannot constrain them.

### Current state of the patch (updated 25 Oct 2026, later the same day)

Blocks 1 and 2 are now written into `supabase/migrations/0003_events.sql`. `0003` is still unmerged and **has not been applied** to
local migration history or any remote database. Block 3 is not in the file.

```sql
-- Block 1 (in 0003): append-only for application roles.
revoke update, delete, truncate on table public.events from authenticated, service_role;

-- Block 2 (in 0003): rights no application role needs. TRIGGER lets a role attach triggers to the table,
-- REFERENCES lets it create foreign keys to it.
revoke trigger, references on table public.events from authenticated, service_role;

-- Block 3 (NOT in 0003, needs Afzal): direct INSERT by authenticated users.
revoke insert on table public.events from authenticated;
```

- `MAINTAIN` (the PostgreSQL 17 maintenance privilege) is **not** revoked. It exists only from PostgreSQL 17, so the revoke would
  fail on an older server. `supabase/config.toml` pins major version 17, but no hosted project exists yet to confirm it (CLD-01). It
  can be added once the hosted version is confirmed, or through a version check. It is not an append-only risk.
- `service_role` keeps SELECT and INSERT, so a function running as `service_role` can still write. `authenticated` keeps SELECT
  and INSERT; today RLS denies its INSERT only because no policy exists.
- Revokes do not constrain the table owner (`postgres`) or superusers (`supabase_admin`).

### Test status (VERIFIED, temporary transaction, rolled back)

| Run | Result |
| --- | --- |
| `events_schema.test.sql` with `0003` including Blocks 1 and 2 | 44 planned: **43 ok, 1 `not ok # TODO`** (see below). The suite is **not fully passing**. |
| Same file against the earlier `0003` (no Blocks 1 and 2) | 39 ok, 5 not ok |
| Earlier proposal with Blocks 1, 2 and 3 applied | 44 of 44 ok |
| `base_schema.test.sql` (0001 and 0002 are applied locally) | 38 of 38 ok |

The blocked assertion is `authenticated has no direct INSERT on events`. It is unchanged, and wrapped in pgTAP `todo_start`/`todo_end`
with the reason, so the output reads `not ok 23 ... # TODO blocked: authenticated INSERT depends on ingest_events security model
(Afzal)`. The other 43 assertions pass. If Afzal chooses SECURITY DEFINER, add Block 3 to `0003` and remove the todo wrapper. If he
chooses SECURITY INVOKER, change that assertion together with the new insert policy.

### What is ready, and what needs Afzal

- **Implemented (Akanksha):** Blocks 1 and 2, in `0003`. They remove rights that no documented flow needs and do not depend on how
  `ingest_events` is built. They still need the co-owner review for `supabase/migrations`.
- **Needs Afzal (Block 3):** whether `authenticated` may INSERT. The documents point two ways.
  `member-04-akanksha.md:188` says direct insert is revoked and only `ingest_events` writes. `member-01-afzal.md:156`
  says the function "runs with caller's JWT", which can mean SECURITY INVOKER (the device user then needs INSERT and an
  RLS insert policy) or just that it reads claims from the JWT. Nothing says SECURITY DEFINER has been approved, and it
  is not assumed here.
  **Exact question for Afzal:** will `ingest_events` be SECURITY DEFINER (running as its owner, so device users need no INSERT on
  `events`, and Block 3 applies), or SECURITY INVOKER (running as the signed-in device user, who then needs INSERT plus a
  per-facility RLS insert policy, and Block 3 is dropped)? If DEFINER, he should also confirm the function's owner and
  `search_path`. Whichever is chosen, it is a permission change that he reviews (`member-04-akanksha.md` A.8).
- **Not decided, not proposed:** any trigger, and any DELETE exception. Both wait for the purge-role design.

### Purge role coordination (CLD-08)

Do not add a trigger or a DELETE exception in `0003`. The purge role, its DELETE grant, and the trigger condition
(`current_user` is the purge role) have to be designed together, in the migration that creates the retention function
(`0011`, whose number is still unresolved: CLD-02, CLD-07 and Anamika's CLD-06 all claim it). Until then, `events` has no DELETE path for application roles, and these revokes do not
guarantee append-only behaviour for the table owner (`postgres`) or superusers (`supabase_admin`); a security-definer function
owned by `postgres` could still change events.

## 7. Event-envelope decisions confirmed by Afzal (recorded 25 Oct 2026)

Source: Afzal's confirmation relayed to Akanksha in the working session. It is not yet written in any repository file other
than this one. **`packages/contracts` has not been updated.** Afzal owns it and will change it in the SYNC-01 PR, so until then the
TypeScript and SQL still disagree (verified: `events.ts` still has `device_id: z.string().min(1)`, no `facility_id`, `staff_id`
or `source`, and top-level payload fields).

### Confirmed decisions

| # | Decision | Where it is enforced |
| --- | --- | --- |
| 1 | `id` is a device-generated UUIDv7 and the primary key | SQL: `uuid primary key`. **A uuid column does not enforce version 7**; the version is checked in the contract, not in SQL. |
| 2 | `facility_id` is in the envelope; ingest rejects a value that differs from the JWT facility claim | SQL: NOT NULL foreign key. Claim match: `ingest_events` (Afzal). |
| 3 | `device_id` is a UUID matching the device claim and `devices.id` | SQL: uuid foreign key. Claim match: `ingest_events`. |
| 4 | `staff_id` is in the envelope and identifies active staff of the facility | SQL: NOT NULL foreign key to `staff`. Active and same-facility check: `ingest_events`. |
| 5 | `session_id` is nullable; present for ENTRY, EXIT, PAYMENT, OVERRIDE; null for SHIFT_OPEN, SHIFT_CLOSE, ZONE_COUNT | Column nullable. The per-type rule is **not enforced in SQL** (see open items). |
| 6 | `source` is `LIVE` or `PAPER_BACKFILL`; SQL CHECK, default `LIVE` | SQL: CHECK and default |
| 7 | Type-specific data lives in `payload` jsonb | SQL: `payload jsonb not null default '{}'` |
| 8 | `schema_version` is part of the envelope | SQL: NOT NULL, CHECK > 0, no default |
| 9 | `PAYMENT_CORRECTION` is unresolved and must not be added to the type CHECK | SQL CHECK keeps the seven existing types (OQ-30 stays open) |
| 10 | TypeScript/Zod is the source of truth for payload shape; SQL does not duplicate payload checks beyond agreed envelope constraints | SQL: none |

Decision 6 corrects the earlier disagreement: Afzal's `LIVE` wins over Nikhil's `GATE` (`member-02-nikhil.md:109` still says `GATE` and
needs a text correction). Decision 10 differs from Afzal's own sheet, which says the contract exports a JSON Schema for SQL to mirror
in CHECK constraints (`member-01-afzal.md:120`, step 7). Afzal should confirm that step is dropped.

### Envelope and payload (per Afzal's sheet, `member-01-afzal.md:107-115`)

Envelope columns: `id`, `type`, `facility_id`, `device_id`, `staff_id`, `session_id` (nullable), `device_time`, `source`,
`schema_version`, `payload`. `received_at` is server-side (default `now()`).

| Event | `payload` fields |
| --- | --- |
| `ENTRY` | `vehicle_class`, `zone_id`, `short_code`, optional `vehicle_no`, optional `pass_id` |
| `EXIT` | `fare_paise`, `exit_method` (`SCAN`, `CODE`, `LOOKUP`) |
| `PAYMENT` | `mode` (`CASH`, `UPI`, `PASS`, `WAIVED`), `amount_paise`, `upi_attested` (true only when `mode = UPI`) |
| `OVERRIDE` | `target_event_id`, `reason_code`, optional `note` (required when `OTHER`), `change` |
| `ZONE_COUNT` | `zone_id`, `counted`, `system_count_at_time` |
| `SHIFT_OPEN` | `opening_float_paise` |
| `SHIFT_CLOSE` | `counted_cash_paise`, `expected_cash_paise`, `upi_total_declared_paise`, `upi_attested_sum_paise`, `variance_cash_paise`, `variance_upi_paise`, optional `reason` |

I took these from Afzal's sheet because the confirmation did not list them. They are **not confirmed field by field**, and
Nikhil's sheet (`member-02-nikhil.md:101-107`) differs in several places. The side-by-side comparison and the decisions needed are in
section 8. The current `events.ts` has no payloads for ZONE_COUNT, SHIFT_OPEN or SHIFT_CLOSE (TODO at line 58) and allows only
`CASH` and `UPI` for `PAYMENT.mode`.

### Proposed alignment of `0003_events.sql`

Pending the SYNC-01 dependency below, this is proposed work:

| Change | State |
| --- | --- |
| `source` check `GATE`/`PAPER_BACKFILL` becomes `LIVE`/`PAPER_BACKFILL` | **Done in the working file** |
| `source` default `LIVE` | **Done in the working file** |
| Seven event types kept; no `PAYMENT_CORRECTION` | Unchanged |
| `session_id` stays nullable at column level, no per-type CHECK | Unchanged |
| No payload-specific CHECKs | Unchanged |
| Foreign keys, indexes, unique `(id, facility_id)`, revokes | Unchanged |
| `schema_version` becomes `smallint not null` | **Not applied, needs confirmation** |

Schema version: the column already is `integer not null check (schema_version > 0)` with no default. Recommendation: **keep no
default**, because a default would let a writer silently claim a schema it does not follow, and `SCHEMA_VERSION` is a constant in
code (`version.ts`, currently 1). `smallint` was not applied because it would change an existing column type and the assertion
`events.schema_version is integer`, and the decision itself is unconfirmed. If it is adopted, the contract should add an upper bound
(smallint holds up to 32767, while `events.ts` uses `z.number().int().positive()` with no maximum), otherwise a contract-valid
value above 32767 fails SQL with an out-of-range error. Exact change if confirmed: `schema_version smallint not null check
(schema_version > 0)` and the type assertion changes to `smallint`.

Open point on decision 5: whether SQL should also enforce "session_id present for ENTRY/EXIT/PAYMENT/OVERRIDE, null otherwise" as an
envelope CHECK, or leave it to the contract and `ingest_events`. Not added, because it was not in the confirmed list of SQL changes.
If added, it would be: `check ((type in ('ENTRY','EXIT','PAYMENT','OVERRIDE')) = (session_id is not null))`.

### Tests in `supabase/tests/events_schema.test.sql` (48 assertions, `plan(48)`)

These validate the **proposed SQL migration only**. None validates the TypeScript contract, which has not changed yet.

- **Changed:** every fixture insert now uses `source = 'LIVE'` (it was `GATE`); nothing else in the existing assertions was altered or
  removed. The seven event-type tests and every other existing schema and security assertion remain.
- **Added (4):** an insert without `source` is accepted; `source` then reads `LIVE`; `GATE` is rejected (SQLSTATE 23514);
  `schema_version` has no default.
- **Blocked, unchanged:** `authenticated has no direct INSERT on events` is still wrapped in pgTAP `todo_start`/`todo_end`.
- **Contract test not written:** T-IC01-C1, which checks SQL and TypeScript together, belongs to the SYNC-01 PR (Afzal).

Results (VERIFIED, local database, temporary transaction, rolled back): `events_schema.test.sql` with the proposed `0003` gives
**47 ok and 1 `not ok # TODO`** (the INSERT assertion), 48 planned. `base_schema.test.sql` gives 38 of 38 ok. Afterwards `public.events`
does not exist and local migration history still ends at `0002`. The suite is **not fully passing** until the INSERT question is
answered.

### Merge gate

`0003` must not merge until the SYNC-01 PR updates the TypeScript contract and T-IC01-C1 verifies both sides. Every change to
`0003` in this document is proposed until then.

### Privilege boundary (unchanged by these decisions)

Nothing in Afzal's confirmation answers whether `authenticated` may INSERT, and no file in the repository does. `ingest_events` is
**not** assumed to be SECURITY DEFINER. The question in section 6 stays open: SECURITY DEFINER (no INSERT for `authenticated`) or
SECURITY INVOKER (INSERT plus a per-facility insert policy). The INSERT assertion stays, marked TODO, and `0003` still does not revoke
INSERT from `authenticated`. Decision 4 does depend on this: if `ingest_events` runs as the device user, the staff and facility checks
rely on RLS policies for `staff` as well.

## 8. Payload decision table: Afzal's sheet vs Nikhil's sheet

Compared line by line. Afzal: `member-01-afzal.md:109-115`. Nikhil: `member-02-nikhil.md:101-107`. Neither sheet is the contract: the
contract is IC-01 in `packages/contracts` (Afzal), which has not been updated and does not yet define payloads for three of these
types. "Agree" refers to the payload field names only. This review does not choose between them. Under decision 5, `session_id` is an
envelope column, so Nikhil's listing of it "beyond the common envelope" is not a payload difference.

| Event | Afzal's fields | Nikhil's fields | Agree? | Unresolved difference | Decides |
| --- | --- | --- | --- | --- | --- |
| `ENTRY` | `vehicle_class`, `zone_id`, `short_code`, optional `vehicle_no`, optional `pass_id` | `short_code`, `vehicle_class`, `zone_id`, optional `vehicle_no` (and `session_id`) | Mostly | Nikhil's table omits `pass_id`, but his own GATE-05 text sets `ENTRY.pass_id` (`member-02-nikhil.md:239`). | Afzal, Nikhil confirms |
| `EXIT` | `fare_paise`, `exit_method` (`SCAN`, `CODE`, `LOOKUP`) | `fare_paise`, `tariff_id`, `tariff_version` (and `session_id`) | **No** | Afzal has `exit_method` and no tariff reference; Nikhil has `tariff_id` and `tariff_version` and no `exit_method`. OQ-20 (which tariff applies, and recording `tariff_version` on exit) is open. | Afzal (IC-01); Nikhil for the gate flow; OQ-20 decider |
| `PAYMENT` | `mode` (`CASH`, `UPI`, `PASS`, `WAIVED`), `amount_paise`, `upi_attested` | same three (and `session_id`) | Yes | Nikhil's GATE-04 text also attaches `pass_id` for Pass payments (`member-02-nikhil.md:217`); Afzal's list has no `pass_id` here. `events.ts` allows only `CASH` and `UPI`. `PAYMENT_CORRECTION` is unresolved (OQ-30). | Afzal |
| `OVERRIDE` | `target_event_id`, `reason_code`, optional `note` (required when `OTHER`), `change` | `target_event_id` **or** `session_id`, `reason_code`, optional `note`, optional `correction` | **No** | Field name `change` vs `correction`. `target_event_id` required (Afzal; also `events.ts`) vs alternative with `session_id` (Nikhil; his rule at `:93` also says "`session_id` or `event_id`"). `change` is optional in `events.ts`. | Afzal; Nikhil confirms (GATE-07 needs Afzal's approval of correction semantics, `member-02-nikhil.md:288`) |
| `ZONE_COUNT` | `zone_id`, `counted`, `system_count_at_time` | `zone_id`, `actual_count`, `system_count` | **No** | Two field names differ (`counted` vs `actual_count`; `system_count_at_time` vs `system_count`). Afzal's SYNC-04 drift rule uses `counted − system_count_at_time` (`member-01-afzal.md:197`). `events.ts` has no payload (TODO). | Afzal |
| `SHIFT_OPEN` | `opening_float_paise` | `shift_id`, `float_paise` | **No** | Field name differs (`opening_float_paise` vs `float_paise`). Nikhil has `shift_id`; Afzal's has no shift identifier at all, and `session_id` is null for shift events, so Afzal's version has no field to pair open with close. Anamika's `shift_reviews` is keyed by `shift_id` (`member-03-anamika.md:236,240`). `events.ts` has no payload (TODO). | Afzal, with Nikhil and Anamika |
| `SHIFT_CLOSE` | `counted_cash_paise`, `expected_cash_paise`, `upi_total_declared_paise`, `upi_attested_sum_paise`, `variance_cash_paise`, `variance_upi_paise`, optional `reason` | `shift_id`, `expected_cash_paise`, `counted_cash_paise`, `upi_attested_total_paise`, `upi_declared_total_paise`, `cash_variance_paise`, `upi_variance_paise`, optional `variance_reason` | **No** | Agree on `counted_cash_paise` and `expected_cash_paise`. Differ: `upi_attested_sum_paise` vs `upi_attested_total_paise`; `upi_total_declared_paise` vs `upi_declared_total_paise`; `variance_cash_paise` vs `cash_variance_paise`; `variance_upi_paise` vs `upi_variance_paise`; `reason` vs `variance_reason`; and `shift_id` only in Nikhil's. `events.ts` has no payload (TODO). | Afzal, with Nikhil and Anamika |

Summary: only `PAYMENT` agrees on payload fields. Five of seven events differ on field names or presence. The shift identifier is the
one difference that also affects the database, because shift reviews and shift views (CLD-02 `0007`, CLD-05) need to join open to close.

## 9. Questions for Afzal (not answered here)

1. Is `ingest_events` SECURITY DEFINER or SECURITY INVOKER, and should `authenticated` users have direct INSERT permission on
   `events`? (Section 6. `0003` keeps INSERT, and the TODO assertion stays.)
2. Should `schema_version` remain `integer`, or become `smallint`? If smallint, what maximum will the TypeScript schema enforce?
3. Does "Zod is the source of truth" mean the JSON-Schema-derived SQL payload CHECK constraints (`member-01-afzal.md:120`) are dropped?
4. What exact payload fields and validation rules will the SYNC-01 contract use for each event type? Section 8 lists every
   disagreement.
5. Should the `session_id` rule (present for ENTRY, EXIT, PAYMENT, OVERRIDE; null for the other three) be enforced by a SQL CHECK, or
   only by `ingest_events` and Zod?
6. Added by this audit: should SQL enforce that an event's `device_id` and `staff_id` belong to the event's `facility_id`? Verified on
   the local database (rolled-back transaction): `0003` accepts an event for facility B that references a device and a staff member of
   facility A, because the foreign keys check only that the ids exist. Decision 3 and 4 say the device and staff must belong to the facility;
   today only `ingest_events` could enforce it. A SQL fix needs `unique (id, facility_id)` on `devices` and `staff` (not present in
   `0002`) plus composite foreign keys, which is a migration change and not made here.

### Coordination notes (alignment with the confirmed vocabulary)

- **Nikhil (owner of `apps/gate` and `member-02-nikhil.md`):** the common-envelope line still lists `source` as `GATE` or
  `PAPER_BACKFILL` (`member-02-nikhil.md:109`). It must be aligned with the confirmed `LIVE` or `PAPER_BACKFILL`, and any gate code
  or fixtures that write `source` must use `LIVE`. Not edited here, since the file is Nikhil's.
- **Afzal (owner of `docs/team` and `packages/contracts`):** his sheet already says `LIVE`. The SYNC-01 PR needs to add `source`,
  `facility_id` and `staff_id` to the contract, change `device_id` to a uuid, move payload fields under `payload`, and resolve section 8.
- **Anamika:** shift views and `shift_reviews` depend on the shift identifier decision (`SHIFT_OPEN` and `SHIFT_CLOSE` in section 8).

### Migration review

`0003_events.sql` was re-read against every confirmed decision (1 to 10). It matches them where SQL has a role: uuid primary key,
facility, device and staff foreign keys, nullable `session_id`, payload in jsonb, `source` `LIVE` or `PAPER_BACKFILL` with default
`LIVE`, `schema_version` integer NOT NULL > 0 with no default, and the seven types without `PAYMENT_CORRECTION`. **No further
unambiguous SQL change is needed, so the migration is left unchanged.** The open items above (questions 1, 2, 5, 6) each need a decision
first.

### Test status (unchanged by this review)

`events_schema.test.sql`: 48 assertions, **47 passed, 1 blocked (TODO)**. The blocked one is `authenticated has no direct INSERT on
events`, wrapped in `todo_start`/`todo_end`, unchanged, pending question 1. `base_schema.test.sql`: 38 of 38. Neither suite was
re-run for this review (no test or SQL file changed), and the counts above come from the previous run.

## 10. Composite foreign keys for facility consistency (IMPLEMENTED in `0003` on a PROVISIONAL assumption)

Status: **implemented in the working `0003` and `events_schema.test.sql` (26 Oct 2026), provisional until Afzal confirms.** The design and options below are the original proposal; option A was used. It answers question 6 in section 9. `0003` still must not merge before the SYNC-01 PR and T-IC01-C1; the single-column keys were replaced as recommended.

### Current schema (VERIFIED by reading `0002_staff_devices_memberships.sql`, `0003_events.sql`)

- `staff` and `devices` each have `id uuid primary key` and `facility_id uuid not null references public.facilities (id)`
  (`0002:9-10` and `0002:21-22`). Every device and staff row therefore belongs to exactly one facility.
- `events` has three independent foreign keys: `facility_id` to `facilities(id)`, `device_id` to `devices(id)`, `staff_id` to `staff(id)`
  (`0003:7-12`). Each only checks that the id exists. Nothing links the three, so the facilities can differ.
- Reproduced on the local database in a rolled-back transaction: an event for facility B that references a device and a staff member of
  facility A is **accepted** by `0003` as it stands.
- `(id, facility_id)` can be the target of a composite foreign key once it is declared unique. It is already unique in fact, because
  `id` alone is the primary key; PostgreSQL still requires an explicit unique constraint (or index) on exactly those columns as the
  referenced target. The repository already uses the same pattern twice: `facilities unique (id, org_id)` with the composite foreign key
  from `memberships` (`0001`, `0002:38`), and `events unique (id, facility_id)` (`0003:33`).

### Proposed design

```sql
-- On the referenced tables (needed before the events foreign keys can exist):
alter table public.devices add constraint devices_id_facility_unique unique (id, facility_id);
alter table public.staff   add constraint staff_id_facility_unique   unique (id, facility_id);

-- On events, in place of the two single-column foreign keys:
foreign key (device_id, facility_id) references public.devices (id, facility_id) on delete restrict,
foreign key (staff_id,  facility_id) references public.staff   (id, facility_id) on delete restrict,
```

The `events.facility_id` foreign key to `facilities(id)` stays, and `facility_id` is NOT NULL, so the composite keys are fully checked
(a composite key with a NULL member would be skipped by the default MATCH SIMPLE rule; `device_id`, `staff_id` and `facility_id` are all
NOT NULL, so that cannot happen).

**Should the single-column foreign keys stay?** Recommendation: **replace them.** A composite key already requires that the device (or
staff row) exist, so the single-column keys add no protection. Keeping both is harmless but redundant: it duplicates constraint checks
on every insert and leaves two constraint names for one rule. Keeping them is the smaller diff if reviewers prefer
it, but it carries no benefit. The error code stays SQLSTATE 23503 either way, so the existing "nonexistent device/staff/facility is
rejected" assertions remain valid.

**Behaviour the design adds (to be confirmed):**

- A device or staff row can no longer be moved to another facility (`update ... set facility_id`) while events reference it. That
  protects event history, and is consistent with append-only.
- It does not check that the staff member is `active`, that the device is not revoked, or that `facility_id` equals the JWT claim.
  Those stay in `ingest_events` (decisions 2 to 4).
- Optional: an index on `events (device_id, facility_id)` and `events (staff_id, facility_id)` would speed up deletes and updates on
  `devices` and `staff`. Those are rare, so it is not proposed now.
- If `open_sessions` and `shift_reviews` later reference devices or staff, they should use the same pattern.

**Validated experimentally (rolled-back transaction, local database, nothing kept):** with the two unique constraints and the composite
keys applied after `0003`, an event whose device and staff belong to the event's facility is accepted, an event using another
facility's device is rejected (`events_device_facility_fkey`, 23503), an event using another facility's staff is rejected
(`events_staff_facility_fkey`, 23503), and the existing 48-assertion events suite still gives 47 ok and 1 TODO.

### Proposed regression tests (to add with the fix, in `supabase/tests/events_schema.test.sql`)

Fixtures: add a second facility (facility B) with its own device and staff member to the existing fixtures. Fixture inserts are not
assertions. Expected new assertions, each with SQLSTATE 23503 where it rejects:

1. An event for facility B using facility B's device and staff is accepted (positive case in a second facility; the existing
   facility-A inserts already cover the first).
2. An event for facility B using facility A's device (and B's staff) is rejected.
3. An event for facility B using facility A's staff (and B's device) is rejected.
4. An event for facility A using facility B's device is rejected (the reverse direction).
5. An event whose device and staff both belong to the other facility is rejected.
6. Catalog: `events` has a foreign key on exactly `(device_id, facility_id)` to `devices`, and on `(staff_id, facility_id)` to `staff`.
7. Catalog: `devices` and `staff` each have a unique constraint on exactly `(id, facility_id)`.

About seven assertions, so `plan(55)` becomes about `plan(62)` (to be recounted when written). All 55 existing assertions stay unchanged:
source vocabulary and default, the seven event types, `schema_version`, RLS and the privilege assertions, and the TODO on
`authenticated` INSERT. Assertions 2 to 5 fail against `0003` as it stands, which is the point; the existing "nonexistent facility, device,
staff" tests keep their meaning because the facility foreign key and the composite keys still reject them. A pgTAP check on
`base_schema.test.sql` for the two new unique constraints could be added there instead of item 7.

### Migration strategy (decision needed)

Facts: `0001`, `0002`, `0003` are all untracked, unmerged and unpushed. `0001` and `0002` are applied to the local development database
only. `0003` has never been applied. `supabase/migrations` is co-owned by Afzal and Akanksha; Afzal's `0004` to `0006` use those numbers
in his sheet, and CI is planned to require unique, contiguous numbering. The rule is forward-only: no edits after merge.

| Option | What changes | Pros | Cons |
| --- | --- | --- | --- |
| A. Put the two unique constraints and the composite keys in `0003` | `0003` gains two `alter table` lines and replaces the two foreign keys. `0001` and `0002` are untouched. | No applied migration is edited. `0003` is unmerged, so editing it rewrites nothing. No renumbering, so `0004` to `0006` are unaffected. Local database needs no reset. | `0003` then holds a small change to `devices` and `staff`, which stretches the one-concern-per-file rule. |
| B. Add the two unique constraints to `0002` | `0002` is edited; `0003` replaces the foreign keys. | Constraints sit with their tables; cleanest final history. | Edits a migration that is already applied locally, so the local database needs `supabase db reset`. Acceptable only while nothing is merged. |
| C. A new migration numbered between | A new file for the constraints. | One concern per file. | Needs renumbering `0003` and Afzal's `0004` to `0006`, or a gap; conflicts with the contiguity rule. Not recommended. |
| D. After merge (any later fix) | A new forward-only migration that adds the unique constraints, then drops the two foreign keys and adds the composite ones, using `not valid` and `validate constraint` if the table has data. | Required once `0003` is merged or deployed. | Not available as a free choice now. |

**Recommendation: A**, because it changes nothing already applied and nothing merged, and keeps the other workstreams' numbering intact.
B is acceptable if the team prefers the constraints beside their tables and accepts a local reset. Whichever is chosen, it must be
decided before the PR is opened, and after merge only option D is allowed.

**Decision needed (owner: Akanksha proposes, Afzal approves as migrations co-owner and as the owner of `ingest_events`):**

1. Approve composite foreign keys at all, or leave facility consistency to `ingest_events`.
2. Replace or keep the single-column foreign keys.
3. Option A or B (C and D excluded).
4. Because it changes the rules for `devices` and `staff` rows, confirm with Nikhil and Anamika that no flow needs to move a device or
   staff member between facilities.

## Other open items affecting `0003`

- `0003` is also listed as blocked on `PAYMENT_CORRECTION` (OQ-30) and on the three unspecified payloads (item 4).
- `0011` is claimed by three features (CLD-02, CLD-07, Anamika's CLD-06); renumbering needs Afzal's agreement.
- These choices are not registered in `open-questions-and-assumptions.md` yet; adding them is for the owner of that file.
