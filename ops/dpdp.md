# Data protection (DPDP Act, 2023): data inventory and request procedure (DRAFT)

Owner: Akanksha (Member 04). Deliverable from `docs/team/member-04-akanksha.md` (CLD-08, step 4.6, and section I.1:
"DPDP procedure"). Snapshot of 12 Nov 2026 against `main` at `4e936df`; the inventory in section 1 was re-checked against `main`
at `1cc9cc5` on 13 Nov 2026 after review.

**Status: DRAFT. This is not legal advice and nothing here has had legal review.** The retention period, the consent text and
the exact legal duties are open (OQ-12, owner: team with a mentor) and are deliberately **not** filled in below. The
mechanisms in section 3 are the design in the member sheet; **none of them is implemented** (`0011`, `data_export`, the
purge job and facility deletion do not exist). No hosted database exists yet either (`ops/known-limitations.md`, L1), so
today no real personal data is stored anywhere by this system.

## 1. What personal data the system can hold

Read from the migrations on `main` and the event contract (`packages/contracts/src/events.ts`), not from the sheet.

| Data                                           | Where                                                                                                                                                       | Whose                              | Required or optional                           | Notes                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vehicle number (`vehicle_no`)                  | `events.payload` of an `ENTRY` event                                                                                                                        | Vehicle owner / driver             | Optional                                       | Can identify a person. Sits inside a JSON payload, so it needs a JSON-aware export and purge, not a column.                                                                                                                                                                                                      |
| Vehicle number in passes (`vehicle_no`)        | `passes.vehicle_no` (`0001`, required, indexed with `facility_id`)                                                                                          | Pass holder                        | Required                                       | A column, not JSON. The Console Facility page shows it masked. Search, export and erasure must cover it.                                                                                                                                                                                                         |
| Vehicle number in open sessions (`vehicle_no`) | `open_sessions.vehicle_no` (`0005`)                                                                                                                         | Vehicle owner / driver             | Optional                                       | A normalized copy of the `ENTRY` plate, kept by a trigger while the session is open. Erasing the event is not enough: search and erasure must cover this table too.                                                                                                                                              |
| Corrected vehicle number                       | `events.payload.change` of an `OVERRIDE` event                                                                                                              | Vehicle owner / driver             | Optional                                       | A free-form record. An override with reason `MISREAD_NUMBER` can carry the corrected plate here, not only in `note`.                                                                                                                                                                                             |
| Free-text notes                                | `events.payload.note` (`OVERRIDE`); also the `note` columns of `shift_reviews` and `conflict_resolutions` (`0007`, on `main` since PR #31 merged on 13 Nov) | Anyone a guard or manager mentions | Optional (required when the reason is `OTHER`) | Free text can contain anything, including names or phone numbers. Treat as potentially personal.                                                                                                                                                                                                                 |
| Guard name and phone (`name`, `phone`)         | `staff`                                                                                                                                                     | Guard                              | Name required; phone optional                  | `phone` is marked personal data in the migration (OQ-12).                                                                                                                                                                                                                                                        |
| Guard PIN hash and salt                        | `staff.pin_hash`, `staff.pin_salt`                                                                                                                          | Guard                              | Required                                       | A salted hash, never the PIN. Manager roles cannot read these columns: the column grants from pull request #34 (`0010_rls.sql`, which revokes manager SELECT on `pin_hash` and `pin_salt`, with regression tests for direct and wildcard reads, commit `4cf4a44`) are on `main` since #34 merged on 13 Nov 2026. |
| Sign-in IP address and browser                 | `auth.sessions.ip`, `auth.sessions.user_agent`, `auth.audit_log_entries.ip_address` (checked on the local Supabase stack)                                   | Owner, manager                     | Recorded by Supabase Auth                      | An IP address can identify a person. Held outside `public`, so a `public`-only export or purge misses it.                                                                                                                                                                                                        |
| Sign-in email                                  | `auth.users` (Console users, and the generated device login)                                                                                                | Owner, manager; none for a device  | Required for Console users                     | Held by Supabase Auth, outside `public`. The device login is generated, not a person's address.                                                                                                                                                                                                                  |
| Staff and device identifiers on events         | `events.staff_id`, `events.device_id`                                                                                                                       | Guard                              | Required                                       | These link every event to a guard. They are what makes event history "about" a person.                                                                                                                                                                                                                           |

Not stored: no payment card or UPI account data (a payment event holds a mode, an amount and an attestation flag only); no
location; no photographs (none exist in the schema).

## 2. Open decisions that block a final procedure

| #   | Decision                                                                                                                                                                                                                                                                                                                                                     | Where                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| D1  | Default retention period and its minimum, and whether it differs for events, notes and staff records.                                                                                                                                                                                                                                                        | OQ-12                                            |
| D2  | Consent text and where it is shown (Console set-up, gate app, or both) and who may change it.                                                                                                                                                                                                                                                                | OQ-12                                            |
| D3  | Who is the data fiduciary for the pilot (the university team, the partner facility owner, or both) and who answers a request.                                                                                                                                                                                                                                | Not recorded in the repository                   |
| D4  | How a **guard's** erasure request is met. `events` reference `staff` and `devices` with `on delete restrict` (`0003`), so a staff row cannot be deleted while events refer to it. Erasing a person without erasing the facility's event history would need the staff record anonymised (name, phone) instead of deleted. That is a product and legal choice. | Foundation: `0003_events.sql`; decision not made |
| D5  | Whether a legal hold is needed (the sheet says it is not supported in the pilot).                                                                                                                                                                                                                                                                            | Sheet CLD-08, edge cases                         |
| D6  | Time limit for answering a request, and the log format that proves it.                                                                                                                                                                                                                                                                                       | Not recorded in the repository                   |

## 3. Mechanisms in the design (none implemented)

From the member sheet, CLD-08. Names and paths are recommendations (R) unless the sheet marks them (H).

| Need                         | Design                                                                                                                                                                                                                                                                                                     | Status             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Retention                    | `facilities.retention_days`; nightly `retention_purge` run as a dedicated role that alone may delete events; never purges the entries of sessions that have not exited; failure leaves data intact and alerts.                                                                                             | Not built (`0011`) |
| Export (access, portability) | `data_export` Edge Function: owner of the organization only, one facility per call, a zip of CSVs for `events`, `facilities`, `zones`, `tariffs`, `passes`, `shifts`, `overrides`; all or nothing; reads a snapshot.                                                                                       | Not built          |
| Deletion                     | Facility deletion function with two-step confirmation and an optional 7-day hold; deletes rows in dependency order and storage objects; keeps only the facility id and a timestamp in `audit_log`.                                                                                                         | Not built          |
| Audit                        | Append-only `audit_log` entry for every export and deletion, holding no personal data.                                                                                                                                                                                                                     | Table not created  |
| Correction                   | Not in the sheet. Since PR #34 merged (`0010_rls.sql`, 13 Nov 2026), the database allows an owner or manager to update a guard's name and phone in their facility, but the Console form for this edit has not been built yet. A wrong event is corrected by an `OVERRIDE` event, never by editing history. | Partly possible    |

The CSV column names are a contract (the sheet says they must be stable and documented here). They cannot be fixed until
`data_export` is written, so this file does **not** list them; add them when the function exists.

## 4. Request procedure (draft, to be confirmed after D1 to D6)

Until the mechanisms exist, a request cannot be fulfilled by the system, and no hosted data exists. Once a hosted
database holds real data, a request should follow these steps. Every step that depends on an open decision says so.

1. **Receive and record.** Note the date, who asked, what they asked for (access, correction, deletion) and which facility.
   Decide who answers (D3) and by when (D6).
2. **Verify who is asking.** A guard through their facility owner or manager; an owner through their Console sign-in.
   Do not search by vehicle number for an unverified caller.
3. **Find the data.** Use the inventory in section 1: `staff` rows for the guard, `events` rows by `staff_id`, events whose
   payload contains the vehicle number, a note or a `change` record, and the `passes` and `open_sessions` rows for the
   vehicle. Stored plates differ in format, so compare through `normalize_vehicle_no()` (`0005`), not with `=` on raw text.
   A vehicle number search in `events` also needs a JSON-aware query (section 1). For a Console user, include the Supabase
   Auth session and audit records.
4. **Access.** Produce the export for the facility (section 3) and give the requester only their own rows.
5. **Correction.** Staff details: an owner or manager edits them once the policies above exist. Events: add an `OVERRIDE` event with a reason code; never edit
   the original (events are append-only).
6. **Deletion.** Not possible for a guard's events without D4. For a whole facility, use the deletion function once it exists.
7. **Log.** Write the outcome to `audit_log` once it exists; until then, keep a dated note outside the database that
   contains no personal data.
8. **Close.** Tell the requester what was done and what could not be done, and why.

## 5. What is needed to finish this document

- Answers to D1 to D6 (legal review through the university or a mentor, OQ-12).
- `0011` and `data_export` written, so section 3 can state real behaviour and section 3's CSV columns can be listed.
- A test run for T-CLD-08-I1 to I3, N1 to N3 and X1 (sheet D.8), with the evidence linked here. None has been run.
