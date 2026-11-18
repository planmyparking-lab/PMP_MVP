# Implementation Sheet: Anamika (Operator Console, Reports, Baseline Study)

Features owned: `CON-01` to `CON-12`, plus `CLD-06` and `MET-01` to `MET-03` (reassigned from Akanksha). Master document: [README.md](README.md). Traceability: [feature-traceability.md](feature-traceability.md). Open questions: [open-questions-and-assumptions.md](open-questions-and-assumptions.md).

## 0. How to read this sheet (honesty legend)

- **The repository has no application code.** No Console, no schema, no tests and no CI exist. Every feature below has status **Not implemented**. Nothing in this sheet is "implemented and verified".
- **(S)** = Specified in the Handbook, the MVP PRD or the Phase 2 plan written for this project. **(R)** = Recommended (does not exist yet); the name or shape is a proposal that must be confirmed when the repo is scaffolded.
- No test has been run. Every "Verification status" is **Not verified**. Do not mark anything verified without the evidence described in section E.
- No dates or estimates appear here. Order and dependencies are in README section 6.
- Commands are marked "recommended, to be confirmed once the repo is scaffolded".
- Anamika's role in the Handbook: operator Console, report templates, partner demo, baseline time study and ROI statements. The Phase 2 plan originally cast Anamika as research and customer success; the user has since said all four are engineers. Ownership of CON-12 (a field activity) is kept with Anamika per the Handbook; see OQ-18.

## A. Role and Ownership

### A1. Objective

Deliver everything an owner or manager sees and configures: the web Console that sets up a facility, shows live and historical numbers, reviews shifts and conflicts, and produces owner-ready reports; the seed data and demo that partners see; and the field evidence (baseline study, ROI statements) that proves value in rupees.

### A2. Scope of responsibility

| Area | Detail |
| --- | --- |
| Console app (S: `apps/console`) | Next.js App Router, TypeScript, Vercel, shadcn/ui, Tailwind, `@supabase/ssr`, Recharts (one chart), zod from `packages/contracts` |
| Pages (S) | login, dashboard, occupancy, shifts and shift detail, conflicts, overstay, reports, settings (facility, zones, tariffs, passes, staff, devices), health, 7-step setup wizard |
| Report route (S) | `api/reports/[type]/route.ts`, Node runtime, `puppeteer-core` with `@sparticuz/chromium` for PDF, `exceljs` for Excel |
| Report templates (S) | `src/reports/templates/` daily, weekly, monthly |
| Console-written tables (S) | `shift_reviews`, `conflict_resolutions` (migrations owned by Akanksha; Anamika specifies columns) |
| Seed and demo (S) | Three fake facilities with 30 days of synthetic events in `supabase/seed.sql` (shared with Akanksha); clickable prototype |
| Field (S) | Baseline time-and-motion study and per-facility ROI statements |

### A3. Features owned (primary owner, per README)

`CON-01` setup wizard with tariff editor and fare "try it"; `CON-02` staff, devices, roles UI and multi-site switcher; `CON-03` login and session foundation; `CON-04` occupancy board; `CON-05` dashboard; `CON-06` shift review and sign-off; `CON-07` conflicts inbox; `CON-08` report templates and render route; `CON-09` overstay list and settings; `CON-10` pilot health page; `CON-11` seed data and demo; `CON-12` baseline study and ROI statements.

Reassigned to Anamika from Akanksha: `CLD-06` report scheduler and email; `MET-01` physical occupancy audits; `MET-02` adherence checks; `MET-03` weekly metrics pack (see "Features moved from Akanksha" after section C).

### A4. Explicitly outside Anamika's scope

| Not hers | Owner |
| --- | --- |
| `fare` function itself (`packages/domain`) | Nikhil (GATE-03); Anamika consumes it and reviews |
| Schema, RLS, `enroll_device`, KPI views, alerts, backups (all CLD-xx except `CLD-06`) | Akanksha |
| Event contracts, ingest, sync, occupancy computation, conflict detection | Afzal (SYNC-xx) |
| Guard-side screens, PIN verification on the phone, printer | Nikhil (GATE-xx) |
| Pilot agreements and pricing meeting | Afzal (PRT-01); Anamika supplies CON-12 data |

### A5. Relevant modules and files (all (R) unless marked (S))

```text
apps/console/                                  (S)
  app/(auth)/login/page.tsx                    (S)
  app/[facilityId]/page.tsx                    (S) dashboard
  app/[facilityId]/occupancy/page.tsx          (S)
  app/[facilityId]/shifts/page.tsx             (S)
  app/[facilityId]/shifts/[id]/page.tsx        (S)
  app/[facilityId]/conflicts/page.tsx          (S)
  app/[facilityId]/overstay/page.tsx           (S)
  app/[facilityId]/reports/page.tsx            (S)
  app/[facilityId]/settings/{facility,zones,tariffs,passes,staff,devices}/   (S)
  app/[facilityId]/health/page.tsx             (S)
  app/setup/[step]/page.tsx                    (S)
  app/api/reports/[type]/route.ts              (S)
  src/components/{KpiCard,ZoneBar,VarianceBadge,DataAsOf}.tsx   (S)
  src/reports/templates/{daily,weekly,monthly}.tsx              (S)
  src/lib/supabase/{server,client}.ts          (S)
  src/lib/format.ts                            (S) paise to rupees, IST dates
  src/lib/permissions.ts                       (R) role helper used only for display
  src/lib/wizard/{steps,draft}.ts              (R) wizard state and draft persistence
  src/lib/reports/{queries,excel}.ts           (R)
supabase/seed.sql                              (S, shared with Akanksha)
field/cons12/                                  (R) CSV templates, ROI sheet
```

### A6. Dependencies on other members

| Needs | From | Used by |
| --- | --- | --- |
| Event and config zod schemas (IC-01) | Afzal | all forms, reports |
| `sync_conflicts` and conflict types (IC-10) | Afzal | CON-07 |
| Health metrics and heartbeat (IC-09) | Afzal sender, Akanksha table | CON-10 |
| Fare function and tariff rule JSON (IC-04) | Nikhil | CON-01 try-it |
| `enroll_device`, staff table, RLS (IC-05, IC-06) | Akanksha | CON-02, CON-03 |
| KPI views (IC-07) | Akanksha | CON-04, CON-05, CON-08 |
| Scheduler that calls the render route (IC-08) | Anamika (`CLD-06`, moved from Akanksha); Akanksha deploys the Supabase side | CON-08 |
| Overstay alert job and threshold settings | Akanksha | CON-09 |

### A7. Decisions Anamika can make alone

Layout and visual design within shadcn/ui; wording of Console labels and errors; wizard step copy and templates for "mall", "market", "hospital"; report layout and chart choices within the content list in CON-08; ordering of columns; pagination size; seed-data realism; ROI worksheet format.

### A8. Decisions requiring coordination

| Decision | With whom |
| --- | --- |
| Any change to a view's columns or a table used by the Console | Akanksha (migration) |
| Any change to the tariff rule JSON | Nikhil and Afzal (IC-04 and IC-01) |
| Fields on `shift_reviews` and `conflict_resolutions` | Akanksha (migration) and Afzal |
| Report content for owners (what the monthly report must show) | Afzal with design partners (OQ-19) |
| Report render secret and scheduler call shape | Anamika (owner of both ends); Akanksha reviews secrets handling |
| Console-visible roles and what each can do | Akanksha (RLS) and Afzal |
| Online-only Console rule (no offline mode) | Settled in Handbook; changing it needs Afzal |

## B. Feature Inventory

Status of every row: **Not implemented**. Priority: P0 = pilot cannot start without it; P1 = pilot can start but suffers; P2 = optional polish.

| ID | Feature | Business purpose | User or system | Required final behaviour (short) | Priority | Dependencies | Acceptance (short) | Testing requirements |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CON-01 | Setup wizard, tariff editor, try-it | Operator configures a facility without a developer (P0-1) | Owner, manager | 7 steps with draft saving, zod validation, templates, shared fare panel, test-drive checklist | P0 | CLD-02, GATE-03, CON-03 | Configured by a non-technical person in under 45 minutes; fare panel matches gate cases | U, I, E, N, R, X (usability) |
| CON-02 | Staff, devices, roles, site switcher | Control who can do what; enroll phones (P0-11) | Owner, manager | Add or deactivate guards with PIN, enroll devices by QR with 10-minute code, switch sites by role | P0 | CLD-03 | Role matrix holds; enrollment works once, expires | U, I, E, N, X (permissions) |
| CON-03 | Login and session foundation | Secure access | Owner, manager | Supabase SSR session, protected routes, logout, role load | P0 | CLD-01, CLD-03 | Unauthenticated users never see data | U, I, E, N |
| CON-04 | Occupancy board | See each zone now (P0-4) | Owner, manager | Per-zone bars from `v_zone_now`, Realtime with 10-second polling fallback, "as of" label | P0 | CLD-05 | Updates within 10 s of an event; stale label works | I, E, X |
| CON-05 | Dashboard | One-screen performance (P0-8) | Owner, manager | KPI cards, hourly chart, zone board, exceptions from views, "as of" everywhere | P0 | CLD-05 | KPIs equal an independent SQL oracle; loads under 2 s | U, I, E, X |
| CON-06 | Shift review and sign-off | Close the loop on cash and UPI variance (P0-6) | Manager, owner | List shifts, highlight variance, drill to events, sign-off writes `shift_reviews` | P0 | CLD-02, SYNC-02 | Sign-off recorded once, attributable; no event edits | U, I, E, N |
| CON-07 | Conflicts inbox | Resolve sync conflicts visibly (P0-12) | Manager, owner | Side-by-side conflict view; Keep first, Keep second, Mark as test, Add note; writes `conflict_resolutions` | P0 | SYNC-05 | Events never edited; every resolution attributable | U, I, E, N |
| CON-08 | Report templates and render route | Owner-ready proof (P0-9) | Owner, manager, scheduler | Daily, weekly, monthly PDF and Excel from the same queries; secret-protected route | P0 | CLD-05 | Totals equal dashboard; renders in under 10 s | U, I, E, N, X |
| CON-09 | Overstay list and settings | Flag long stays (P0-10) | Manager | Threshold setting per facility and class; list of open sessions over threshold | P1 | CLD-07 | List equals oracle; threshold change takes effect | U, I, E, N |
| CON-10 | Pilot health page | Spot stale devices and queues early | Team, manager | Per-device last sync, queue depth, oldest unsynced age, version, battery, quarantined count | P1 | SYNC-06, CLD-04 | Red state shown when heartbeat is stale | I, E |
| CON-11 | Seed data and demo | Safe demos and tests | Team, partners | Three fake facilities, 30 days of events with overrides, conflicts, bad-variance shift | P1 | CLD-02 | Seed loads from scratch; demo shows every Console page populated | I, E |
| CON-12 | Baseline study and ROI statements | Prove value in rupees | Team, partners | Time-and-motion at pilot facilities; ROI statement per facility | P0 | none | Pass bar and kill criterion applied; signed by operator | Field protocol, data QA |
| CLD-06 | Report scheduler and email | Owners get daily, weekly, monthly reports automatically | `pg_cron`, `pg_net`, Console render route, Resend, Storage | Jobs call the render route, store files in private `reports` bucket, email 7-day signed links | High | CON-08 | A report email with working links arrives for each cadence; failures logged | Integration with stub route, email deliverability, job idempotency |
| MET-01 | Twice-weekly physical occupancy audits | Prove or disprove zone-level accuracy | Field operator (Anamika), Afzal | Counts at three moments per zone, twice a week, per facility; accuracy per zone and facility | Critical (pilot success criterion) | GATE-08, CON-04 | Sheet complete; pass bar 95% zone, 97% facility sustained for final two weeks | Protocol checks, sheet validation script |
| MET-02 | Adherence checks | Prove staff log vehicles in the system | Field operator | Three random hours per week compared with independent count | Critical | GATE-01 | At least 90% in week 4 | Protocol checks |
| MET-03 | Weekly metrics pack | Single weekly truth for the team | Team, partners | Published each Monday with fixed contents | High | MET-01, MET-02, CON-10 | Pack published with all sections, sources named | Completeness checklist |

## C. Feature-by-Feature Implementation Instructions

Common rules for every Console feature (apply to C1 to C12; not repeated):

- **CR-1 Server first.** Server components by default; client components only for forms, the occupancy board and the hourly chart.
- **CR-2 Security by database.** Row-level rules (CLD-03) are the real security; hiding buttons is a courtesy only.
- **CR-3 States.** Every page has loading, empty and error states before it is "done".
- **CR-4 Money and time.** Money is integer paise, shown as rupees through `lib/format.ts` (S); times shown in IST.
- **CR-5 Freshness.** Every figure that comes from live data shows an "as of" time via `DataAsOf` (S).
- **CR-6 Shared schemas.** Every form validates with the zod schemas from `packages/contracts` (S); error text in plain words.
- **CR-7 No edits to events.** The Console never updates or deletes `events` rows; corrections are new records in Console-owned tables.
- **CR-8 Logging.** Server actions log one structured line: action, actor id, facility id, result, duration. No vehicle numbers or PINs in logs. Errors go to Sentry (S).

### C1. CON-01 Setup wizard, tariff editor and fare "try it"

1. **Problem.** A manager with no developer must configure zones, tariffs, passes, shifts, staff and devices correctly; a wrong tariff causes billing disputes.
2. **Expected behaviour.** Seven steps (S): 1 Facility details; 2 Zones with capacity and allowed vehicle classes; 3 Tariffs built from a rule form with a "try it" panel; 4 Pass types; 5 Shifts and variance thresholds; 6 Staff and devices; 7 Test drive checklist. Draft saved after every step. Templates for "mall", "market", "hospital" prefill steps 2 to 5 (S).
3. **Preconditions.** Signed-in owner or manager (CON-03); schema for facilities, zones, tariffs, passes exists (CLD-02); fare function importable (GATE-03); contract schemas exist (SYNC-01).
4. **Implementation sequence.**
   1. Define wizard state shape per step as zod schemas in `packages/contracts` (coordinate with Afzal) or `src/lib/wizard/steps.ts` (R) if not yet in contracts.
   2. Build `app/setup/[step]/page.tsx` (S) with a step rail; each step is a server action saving a draft row (R: `facility_setup_drafts` table, requested from Akanksha) so a reload resumes.
   3. Step 1: name, address, timezone default Asia/Kolkata, slot count, operating hours, retention default (value pending OQ-12).
   4. Step 2: repeatable zone rows (name, capacity integer, allowed classes multi-select). Rule: sum of capacities should equal slot count or show a warning, not an error.
   5. Step 3: tariff rule form per vehicle class with fields grace minutes, hourly slabs (list of from-minute, to-minute, price), flat price, day cap, night window and rate, effective-from date. Right-hand "try it" panel: inputs entry time, exit time, class; output fare in rupees from the shared `fare` function (IC-04). Show which rule fired.
   6. Step 4: pass types (name, vehicle class, validity days, price). Step 5: shift definitions (name, start, end), cash and UPI variance thresholds (paise), overstay threshold (links to CON-09).
   7. Step 6: embeds CON-02 components (add guard, add device).
   8. Step 7: test-drive checklist reads live data: one entry event, one exit event, one sync arrival, one device enrolled; each item turns green from the database, not from the user's click.
   9. Final "Activate facility" action sets facility status `active`; before that the gate app cannot enroll (rule enforced by CLD-03).
5. **Files.** `app/setup/[step]/page.tsx` (S); `src/lib/wizard/{steps,draft}.ts` (R); `src/components/TariffEditor.tsx` (R); `src/components/FareTryIt.tsx` (R); `src/lib/templates.ts` (R) with the three facility templates.
6. **Functions, endpoints, models.** Server actions `saveStep(step, data)` (R), `activateFacility(facilityId)` (R); reads of `facilities`, `zones`, `tariffs`, `passes`, `shifts` config (tables S in Handbook except where noted); imports `fare` from `packages/domain` (S).
7. **Input and output contracts.** Input: zod-validated step payloads. Output: rows in config tables synced down to phones (IC via SYNC-03). Tariff rule JSON shape is IC-04; any change goes through Nikhil.
8. **Data flow.** Form → server action → zod parse → insert or update through RLS-limited client → draft row updated → on activation config rows are final → sync to enrolled phones.
9. **Validation and business rules.** Capacity integers at least 1; tariff slabs contiguous, no gaps or overlaps; grace minutes at least 0; prices in whole paise; effective-from date not in the past for new versions; day cap not below the highest single slab; night window may cross midnight; at least one zone and one active tariff per vehicle class that the facility allows; thresholds non-negative.
10. **Success behaviour.** Saved step shows "Saved" with time; "Activate" is enabled only when steps 1 to 5 are valid; step 7 shows all green.
11. **Failure behaviour.** Server errors keep the user's input on screen and explain which field failed; a network failure shows "Not saved, try again" and never navigates forward; concurrent edit by another manager shows a version conflict message and offers reload.
12. **Edge cases.** Editing a tariff after the facility is live creates a new version with a future `effective_from`, never overwrites history; deleting a zone with open sessions is refused; a zone capacity reduced below current occupancy shows a warning; vehicle class removed from a zone with a tariff warns; two tabs open on the same draft; wizard abandoned for days.
13. **Security.** Only owner and manager roles (manager restricted to own facility) may write; guards and devices cannot reach Console routes; all writes go through RLS; no service-role key in the client.
14. **Logging.** Log `wizard.step_saved`, `wizard.activated`, `tariff.version_created` with actor and facility.
15. **Tests summary.** Unit: step schemas, slab contiguity, template loaders. Integration: draft persistence, activation guard. E2E: full wizard on seed data. Negative: invalid slabs, role misuse. Usability: unaided 45-minute run. Detail in section D.
16. **Acceptance criteria.** See E1.
17. **Definition of done.** All T-CON-01 tests pass with recorded evidence; usability test passed by a non-team person; fare try-it agrees with the shared case table (GATE-03); reviewed by Nikhil for the tariff form and Akanksha for the tables.

### C2. CON-02 Staff, devices, roles UI and multi-site switcher

1. **Problem.** Owners must control who can operate gates and which phones are trusted, and see only the sites they own.
2. **Expected behaviour.** Staff list with add, edit, deactivate; PIN set by a manager (4 to 6 digits), never shown again; devices list with "Add device" showing a QR with a one-time code valid 10 minutes (S); revoke device; role-based site switcher: owner sees all facilities of the organization, manager one, guard none.
3. **Preconditions.** CON-03 session; `staff`, `devices`, `memberships` tables and `enroll_device` (CLD-03); the PIN hashing function server-side (CLD-03 decision: hash on the server).
4. **Implementation sequence.** (1) Staff table page with server-side pagination. (2) Add-guard form (name, optional phone, PIN) calling server action `createGuard` (R) that sends the PIN to a database function which salts and hashes it (R: `set_staff_pin(staff_id, pin)`, written by Akanksha); the PIN never reaches logs. (3) Deactivate sets `active=false`; reactivation requires a new PIN. (4) Devices page: "Add device" calls `create_enrollment_code(facility_id)` (R, Akanksha) returning code and expiry; render QR with a client-side QR library (R) containing a payload `parkos-enroll:<code>:<facilityId>` (R). (5) Countdown to expiry; "Regenerate" invalidates the previous code. (6) Revoke device sets `revoked_at`; the next sync of that device fails closed. (7) Site switcher component reads memberships and lists allowed facilities.
5. **Files.** `app/[facilityId]/settings/staff/`, `.../devices/` (S); `src/components/{SiteSwitcher,EnrollQr,PinDialog}.tsx` (R); `src/lib/permissions.ts` (R).
6. **Functions and models.** Tables `staff`, `devices`, `memberships` (S in Handbook); functions `enroll_device` (S, IC-05), `create_enrollment_code` (R), `set_staff_pin` (R).
7. **Contracts.** IC-05 enrollment (consumed), IC-06 staff PIN hashes (the Console writes through the function; the phone reads hashes after sync).
8. **Data flow.** Manager → PIN dialog → server action → DB function hashes → staff row → sync to enrolled devices → phone checks PIN locally (GATE-09). Enrollment: Console QR → phone scan → `enroll_device` → device user created.
9. **Rules.** PIN 4 to 6 digits, numeric, not all identical, not sequential (reject 1234, 0000); a facility must keep at least one active manager or owner; a guard belongs to exactly one facility; an owner cannot deactivate the last owner; enrollment code single-use and expires after 10 minutes.
10. **Success.** Guard appears in list; device appears after first sync with last-seen time.
11. **Failure.** Expired or reused code: the phone gets a clear error and the Console offers a new code; failed PIN save shows nothing was saved.
12. **Edge cases.** Two managers regenerate codes at once (last wins, earlier code invalid); lost phone (revoke); guard with same phone number at two facilities; manager removes own access (blocked); PIN reset while guard is mid-shift offline (takes effect at next sync; documented).
13. **Security.** PIN plaintext exists only in the request to the function; no PIN in logs, analytics, error reports or URL; enrollment codes random, at least 128 bits of entropy or at least 8 characters with rate limits (value to be confirmed by Akanksha); only owner or manager may create codes; audit every credential action.
14. **Logging.** `staff.created`, `staff.deactivated`, `pin.reset`, `enrollment.code_created`, `device.revoked` with actor; never the PIN.
15. **Tests summary.** Unit: PIN policy, permission helper. Integration: role matrix against RLS, code expiry. E2E: enroll a simulated device. Negative: manager of site A touching site B. Detail in D.
16. **Acceptance.** E2. **Definition of done.** All T-CON-02 tests pass; Akanksha confirms the functions; Nikhil confirms a phone can enroll with the QR.

### C3. CON-03 Console login and session foundation

1. **Problem.** All Console pages require a trustworthy identity and role.
2. **Behaviour.** Email and password login through Supabase Auth (R: confirm method; magic link is an alternative, OQ-25); session cookies via `@supabase/ssr` (S); middleware redirects unauthenticated users to `/login`; logout clears the session; role and accessible facilities loaded once per request.
3. **Preconditions.** Supabase project exists (CLD-01); `memberships` and RLS (CLD-03).
4. **Sequence.** (1) `src/lib/supabase/{server,client}.ts` (S). (2) `middleware.ts` (R) refreshing the session. (3) Login page with zod-validated form. (4) `getSessionContext()` (R) returning user, role, facilities. (5) Layout wraps pages and renders the site switcher. (6) Handle password reset via Supabase flow if chosen.
5. **Files.** `app/(auth)/login/page.tsx` (S), `middleware.ts` (R), `src/lib/supabase/*` (S), `src/lib/session.ts` (R).
6. **Contracts.** Consumes Auth and memberships; guards and devices are never valid Console users (device users have `role = device`, rejected at middleware).
7. **Rules.** Generic error on bad credentials (no user enumeration); rate limit repeated failures (Supabase setting, confirm with Akanksha); session expiry shows a re-login page and preserves the target URL only if same-origin.
8. **Failure.** Auth outage shows a plain "Sign-in is temporarily unavailable" page and logs to Sentry.
9. **Edge cases.** User with no memberships sees "No access, ask your owner"; user removed while logged in loses access on next request; open redirect attempts on `next` parameter rejected.
10. **Security.** Cookies HttpOnly, Secure, SameSite=Lax; CSRF protection for server actions per Next.js defaults; no tokens in URLs.
11. **Logging.** `auth.login_success`, `auth.login_failed` (no email in failure logs beyond a hash), `auth.logout`.
12. **Tests.** T-CON-03 series. **Done.** Unauthenticated access test green on every route in the app.

### C4. CON-04 Live occupancy board

1. **Problem.** Owners want to see which zones are full now.
2. **Behaviour.** One bar per zone (count of capacity, percent), color by threshold (below 70%, 70 to 90%, above 90%; thresholds R), vehicle class chips, updates through Supabase Realtime with a 10-second polling fallback (S); `DataAsOf` shows the view's computed time; a banner appears when no gate has synced for over 30 minutes (from CON-10 data).
3. **Preconditions.** `v_zone_now` (S, CLD-05); RLS lets the Console read it.
4. **Sequence.** (1) Server component fetches initial rows. (2) Client `ZoneBoard` subscribes to Realtime on the table that backs the view (R: the board subscribes to `open_sessions` changes and refetches the view; Supabase Realtime does not publish views directly, so verify with Akanksha). (3) Fallback `setInterval` 10 s when the channel is closed. (4) Show "Live" or "Updating every 10 s" state.
5. **Files.** `app/[facilityId]/occupancy/page.tsx` (S), `src/components/ZoneBar.tsx` (S), `src/components/ZoneBoard.client.tsx` (R).
6. **Contracts.** IC-07 `v_zone_now` columns (R): `zone_id`, `zone_name`, `capacity`, `occupied`, `as_of`.
7. **Rules.** Occupied never shown below 0 or above capacity without an "over capacity" flag; counts from the view only, no recomputation in the browser.
8. **Failure.** Realtime failure falls back to polling silently with a small indicator; query failure keeps last data and marks it stale.
9. **Edge cases.** Zone deleted while open; capacity changed; zone with no tariff; two gates syncing out of order; browser tab asleep (refetch on focus).
10. **Security.** Facility scoping by RLS only.
11. **Logging.** Client reports Realtime disconnects to Sentry with count, not payload.
12. **Tests.** T-CON-04 series including 10-second update check. **Done.** Board matches `v_zone_now` oracle in seed and in the simulation harness (SYNC-07).

### C5. CON-05 Dashboard

1. **Problem.** Owners cannot currently see performance on one screen.
2. **Behaviour (S).** Cards: vehicles today, declared revenue, occupancy now, average stay, overrides per 100 vehicles; hourly arrivals chart (Recharts); zone board; exceptions list (open conflicts, shifts with variance, stale devices). Every card shows "as of".
3. **Preconditions.** `v_daily_kpis`, `v_zone_now`, `v_hourly` (S); seed data (CON-11).
4. **Sequence.** (1) Server component `page.tsx` with parallel view queries. (2) `KpiCard` components. (3) `HourlyChart.client.tsx` (R). (4) Exceptions list querying `sync_conflicts`, `shifts` with variance over threshold, `device_heartbeats`. (5) Date selector (today, yesterday, last 7 days) via URL parameter.
5. **Contracts.** IC-07 columns (R): `v_daily_kpis(facility_id, day, vehicles, revenue_declared_paise, revenue_cash_paise, revenue_upi_attested_paise, avg_stay_minutes, overrides, overrides_per_100)`; `v_hourly(facility_id, hour_start, entries, exits)`. Names of the views are (S); columns are (R) and agreed with Akanksha.
6. **Rules.** No arithmetic on money in components; "declared" revenue label makes clear UPI is guard-attested (OQ-05); overrides per 100 vehicles uses entries as denominator and handles zero.
7. **Failure.** Per-card error boundaries so one failed query does not blank the page.
8. **Edge cases.** No data yet (empty state with setup prompt); day boundary at IST midnight; facility with multiple shifts across midnight; clock-skew events.
9. **Security.** RLS only; no cross-facility ids in URLs without membership check (404 not 403).
10. **Logging.** Query duration per view in server log; slow query over 1 s flagged.
11. **Tests.** T-CON-05 series with oracle SQL. **Done.** Every KPI equals the oracle on seed; page loads under 2 s on the target profile.

### C6. CON-06 Shift review and sign-off

1. **Problem.** Variance at shift close needs a manager's review trail.
2. **Behaviour.** List of shifts (date, guard, expected cash, counted cash, UPI-attested total, UPI declared total, variances, status); variance highlighted by `VarianceBadge`; detail page drills to the events of that shift; "Sign off" with optional note writes `shift_reviews`.
3. **Preconditions.** `SHIFT_OPEN`/`SHIFT_CLOSE` events and shift views (SYNC-02, CLD-02); `shift_reviews` table (R columns: `id`, `shift_id`, `reviewed_by`, `reviewed_at`, `status` in `approved|flagged`, `note`).
4. **Sequence.** (1) Shifts list page with filters. (2) Detail page with events table (read-only). (3) Sign-off server action inserting one review row; a second review creates a newer row, older rows remain. (4) Flagged status adds shift to dashboard exceptions.
5. **Contracts.** Reads shift view; writes `shift_reviews`; no writes to events.
6. **Rules.** Only owner or manager of the facility can review; a guard cannot review own shift (they have no Console access); sign-off allowed only for closed shifts; variance above threshold requires a note.
7. **Failure.** Duplicate click guarded by a unique constraint on (`shift_id`, `reviewed_by`, `status`) (R) and disabled button.
8. **Edge cases.** Shift not yet synced (shown as "waiting for sync" with device last sync); shift closed offline and arriving late; negative variance vs positive variance; shift reopened by an owner event.
9. **Security.** Attributable actor id from session, never from request body.
10. **Logging.** `shift.reviewed`.
11. **Tests.** T-CON-06 series. **Done.** Sign-off visible in dashboard exceptions and audit view; events untouched (verified by checksum before and after).

### C7. CON-07 Conflicts inbox

1. **Problem.** Sync conflicts must be shown and resolved by a person, never dropped (P0-12).
2. **Behaviour.** Inbox of open conflicts with type (`DUPLICATE_EXIT`, `ORPHAN_EXIT`, `DUPLICATE_ENTRY`, `CLOCK_SKEW`; IC-10), age and facility; detail shows the competing events side by side; actions Keep first, Keep second, Mark as test entry, Add note; each writes `conflict_resolutions` (R columns: `id`, `conflict_id`, `action`, `note`, `resolved_by`, `resolved_at`).
3. **Preconditions.** `sync_conflicts` populated by SYNC-05.
4. **Sequence.** (1) List with filters and unresolved-first ordering. (2) Detail layout with two columns. (3) Resolve server action: insert resolution, set conflict status `resolved` via a database function (R: `resolve_conflict`, written by Akanksha or Afzal) so status and resolution change atomically. (4) Reports and KPIs must treat "Mark as test" and "Keep first/second" consistently; coordinate with CLD-05 (which events count).
5. **Rules.** Resolutions never edit events; "Keep first/second" only changes which event the reporting views count (view logic owned by Akanksha); unresolved conflicts older than 24 hours appear on the dashboard exception list.
6. **Failure and edge cases.** Conflict resolved by two managers concurrently (second sees "already resolved"); conflict whose events were quarantined; `CLOCK_SKEW` offers only "Add note" or "Acknowledge".
7. **Security.** Manager of the facility only; owner of the organization.
8. **Logging.** `conflict.resolved` with action.
9. **Tests.** T-CON-07 series. **Done.** Each conflict type can be created in seed, resolved, and reflected in KPIs; event rows unchanged.

### C8. CON-08 Report templates and render route

1. **Problem.** Owners need proof of performance at contract renewal.
2. **Behaviour.** Route `GET /api/reports/{daily|weekly|monthly}?facility=<id>&date=<yyyy-mm-dd>&format=pdf|xlsx` (R query shape; route path is (S)); requires a shared secret header from Akanksha's scheduler or a signed-in manager session; Node runtime; renders React template to HTML, then PDF through `puppeteer-core` with `@sparticuz/chromium` (S); Excel through `exceljs` (S).
3. **Content (per Handbook).** Utilisation by zone; revenue declared by mode (cash, UPI attested, pass); peak-hour heatmap; average stay distribution; overrides with reason codes; shift variances; conflicts.
4. **Preconditions.** KPI views plus additional report queries (R: `v_report_*` views requested from Akanksha); seed data.
5. **Sequence.** (1) Define report data shape in `src/lib/reports/queries.ts` (R). (2) Build the three templates with print CSS (A4, page breaks). (3) HTML-to-PDF function with timeouts. (4) Excel builder using the same query results, one sheet per section. (5) Authorization middleware for secret or session. (6) Return file with content-disposition; store nothing (Akanksha stores and emails).
6. **Rules.** PDF and Excel totals identical to the dashboard for the same period; "declared" wording for UPI; IST dates; facility name and generation time on every page; no vehicle numbers in reports (privacy default, OQ-26).
7. **Failure.** Chromium failure returns 500 with a job id and logs to Sentry; scheduler retries (Akanksha); partial data renders sections with "no data for this period".
8. **Edge cases.** Month with no events; leap and month boundaries; very long month (31 days); facility in setup; report for a deleted zone; cold start time on Vercel for Chromium (risk: confirm function size and timeout limits of the Vercel plan, R: verify).
9. **Security.** Secret compared in constant time; secret in environment variable, never in repo; session path requires manager of the facility; rate limit per facility.
10. **Logging.** `report.render` with type, facility, duration, bytes.
11. **Tests.** T-CON-08 series including a render-time check. **Done.** All three reports render for seed and for the dry-run facility; totals match dashboard; delivered by CLD-06 to Gmail and Outlook test inboxes.

### C9. CON-09 Overstay list and settings

1. **Problem.** Operators lose revenue when vehicles stay unbilled for long.
2. **Behaviour.** Settings: threshold in hours per vehicle class and facility; list: open sessions past threshold with token, class, entry time, age; export CSV. Alerts are sent by CLD-07; the Console only configures and displays.
3. **Preconditions.** `open_sessions` (SYNC-03/CLD), threshold storage (R: `facility_settings.overstay_minutes_by_class`, owned by Akanksha).
4. **Sequence.** (1) Settings form validated by zod. (2) List page querying `open_sessions` joined to zones, filtered by threshold. (3) CSV export server action. (4) Link from dashboard exceptions.
5. **Rules.** Threshold at least 30 minutes; passes excluded; sessions already exited never appear; one threshold per class with a facility default.
6. **Failure and edge cases.** Threshold changed while sessions exist (list updates; alerts only fire once per session per CLD-07); vehicle number absent (token shown); stale snapshot labelled with "as of".
7. **Security.** Manager of the facility; export logged.
8. **Tests.** T-CON-09. **Done.** List equals oracle for seeded open sessions; setting flows to the alert job.

### C10. CON-10 Pilot health page

1. **Problem.** The team must see problems before partners do.
2. **Behaviour.** Table of devices with last sync, last heartbeat, queue depth, oldest unsynced age, app version, schema version, battery, status chip (green under thresholds, amber, red); quarantined event count; schema-version distribution; stale devices highlighted.
3. **Preconditions.** `device_heartbeats` (S, CLD-04) and `health()` data from Afzal.
4. **Sequence.** Query heartbeats joined to devices; compute status client-side from thresholds defined in README/Handbook (queue over 200 red, oldest age over 30 minutes red, stale heartbeat over 30 minutes during opening hours red); auto-refresh every 30 seconds.
5. **Rules.** Thresholds in one constants file (R); opening-hours logic uses facility shift config.
6. **Failure and edge cases.** Device never sent a heartbeat (shown "never"); clock skew; revoked devices hidden by default.
7. **Security.** Owner and manager; team-wide view limited to an internal admin role (R, OQ-27).
8. **Tests.** T-CON-10. **Done.** Stale device shows red within one refresh after threshold.

### C11. CON-11 Seed data and demo

1. **Problem.** Demos and tests must never use real data.
2. **Behaviour.** `supabase/seed.sql` (S) creates three fake facilities (R: a mall, a market, a hospital) with zones, tariffs, passes, staff (fake names, fixed PINs documented only in the seed file and never reused in production), devices, 30 days of synthetic events including overrides, a duplicate-exit conflict, an orphan exit, a shift with bad variance, open sessions over threshold; plus a script to reset.
3. **Preconditions.** Schema migrations applied (CLD-02); contract event shapes (SYNC-01).
4. **Sequence.** (1) Generator script `supabase/seed/generate.ts` (R) producing deterministic SQL from a fixed random seed. (2) Include arrival curves per facility type (weekday peaks, weekend peaks). (3) Include explicit edge fixtures for each Console test. (4) Document oracle numbers per facility (vehicles per day, revenue) in `supabase/seed/ORACLE.md` (R) so tests have known answers. (5) Clickable prototype for partners: Console in demo mode pointed at the seed project only.
5. **Rules.** Seed runs only on dev and staging, refused on production by a guard in the script; no real vehicle numbers; plates are clearly synthetic.
6. **Edge cases.** Seed re-run is idempotent (truncate by facility id then reinsert).
7. **Tests.** T-CON-11. **Done.** Every Console page shows non-empty data on seed; oracle numbers reproduced by SQL.

### C12. CON-12 Baseline time-and-motion study and ROI statements

1. **Problem.** The pilot must prove that ParkOS saves time and money in rupees, and the manpower story could fail (Phase 2 kill criterion).
2. **Behaviour.** A field protocol run before any code touches a gate (Phase 2 plan, experiment E1), then repeated at the end (E2); output is a per-facility ROI statement in rupees signed off by the operator. Full protocol and templates in section D12 and Appendix 1 to 3.
3. **Preconditions.** Access to the facility, operator consent, guards informed; no software needed.
4. **Sequence.** (1) Agree with operator which shifts and gates to time. (2) Prepare templates (Appendix 1). (3) Time 10 shift-closes, 50 entry/exit cycles, 10 disputes with a stopwatch. (4) Record local wage data (Appendix 2). (5) Compute hours per day and rupees per month (Appendix 3). (6) Apply pass bar and kill criterion. (7) Share with Afzal for PRT-01 pricing meeting. (8) Repeat identical study at week 5 of each pilot and compute the delta.
5. **Rules.** The same observer method and sampling both times; no leading questions; times recorded in seconds; distinguish guard-attributable delay from queue delay; conversion uses the facility's actual or local wage, not a national average.
6. **Failure and edge cases.** Too few disputes in the window (extend observation, do not invent); guard changes behaviour when watched (record and note); facility has several gates (sample proportionally); wage data refused (use local labour-market rate and label as estimate).
7. **Security and privacy.** No vehicle numbers or faces recorded; observer notes use gate and time only; wage data of individual guards is not stored by name.
8. **Tests.** Data QA checks in D12. **Done.** Signed ROI statement per facility with raw sheets attached.

### Features moved from Akanksha (rebalancing)

The four features below were reassigned from Akanksha to Anamika by the repository owner. The text was moved without change except the owner name; paths and dependencies keep their original (Recommended) status. `CLD-06` stays in the CLD series so existing references remain valid.

### C13. CLD-06: Report scheduler and email

1. **Problem.** Owners should receive proof of performance without logging in. Reports render in the Console (Node runtime); delivery and scheduling belong to the database scheduler (H decision 5).
2. **Expected behaviour.** Jobs `daily_report` (06:30 IST daily), `weekly_report` (Monday 07:00 IST), `monthly_report` (1st, 07:00 IST) (H). For each active facility the job calls the Console route, stores the PDF and Excel in the private `reports` bucket (H), creates signed links valid 7 days (H), and emails them via Resend (H) to the facility's configured recipients.
3. **Preconditions.** `CON-08` route live in staging with a shared secret; Resend domain verified; recipients configured per facility (R table `report_recipients(facility_id, email, cadence)`; add to `0011` or a later migration).
4. **Implementation sequence.**
   1. Enable `pg_cron` and `pg_net` extensions (H).
   2. Create a SQL function `run_report_job(cadence text)` (R) that loops facilities, calls the route via `net.http_get` with the secret header, polls or receives the file location, writes to Storage, and sends email. Because Edge Functions stay small (H), the sending step may be a short Edge Function `send_report_email` (R) that takes `{facility_id, cadence, file_urls}` and calls Resend.
   3. Schedule with `cron.schedule` using UTC equivalents of IST (06:30 IST = 01:00 UTC; 07:00 IST = 01:30 UTC); document the conversion in `ops/runbook.md` since pg_cron uses UTC unless configured.
   4. Write a row in `job_runs` (H) at start and finish with status and detail.
   5. Idempotency key `(job, facility_id, period_start)`; a rerun for the same period replaces the files and does not send a second email unless forced by an operator flag (R).
   6. Resend webhook endpoint (R) records bounce and complaint events into `job_runs` detail or a `email_events` table (R), which feeds the alert in CLD-10.
5. **Files.** `supabase/migrations/<next-free>_*` at promotion (job helpers; no number fixed in advance, OQ-64), `supabase/functions/send_report_email/index.ts` (R), `ops/runbook.md`.
6. **Contracts.** IC-08: `GET /api/reports/{daily|weekly|monthly}?facility=...` with `REPORT_ROUTE_SECRET`; response: PDF and Excel bytes or a manifest with two URLs (confirm with Anamika; recommended: two requests with `format=pdf|xlsx`).
7. **Data flow.** `pg_cron` → `run_report_job` → Console route → files → `reports` bucket → signed URLs → Resend → recipients; every step logged in `job_runs`.
8. **Validation and rules.** Period boundaries computed in facility local time. Recipients validated as emails. Signed URL lifetime exactly 7 days (H).
9. **Success.** Each recipient gets one email per period with two working links; `job_runs` shows success.
10. **Failure.** Route failure: retry up to 3 times with backoff inside the job (R), then `job_runs.status = failed` and an alert (CLD-10). Email failure: record and alert. A failure for one facility never blocks others.
11. **Edge cases.** No events in the period (send a "no activity" report, do not skip silently); facility with no recipient (log and skip, warn); route slow beyond timeout (mark failed, do not duplicate); duplicate scheduler invocation (idempotency key); bucket public by mistake (CI policy check that bucket is private).
12. **Security.** Bucket private; signed links only; route secret in Supabase secrets; links never logged in full.
13. **Logging.** `job_runs` rows; Resend message ids stored; failures to Sentry.
14. **Tests.** T-CLD-06-U1, I1..I3, E1, N1..N3, X1..X2.
15. **Acceptance.** Three cadences each produce a deliverable email in staging with a stub and with the real route; a forced failure raises an alert.
16. **Definition of done.** E and J; evidence: `job_runs` export, screenshot of received emails, deliverability results.

### C14. MET-01: Twice-weekly physical occupancy audits

1. **Problem.** "Real-time occupancy" is the highest-risk claim in the plan; it must be tested against physical counts.
2. **Expected behaviour.** Twice a week for each pilot facility, Anamika counts each zone physically at three moments (suggested: opening period, mid-day peak, late period; moments recorded per facility), enters a `ZONE_COUNT` event through the gate app (GATE-08), and logs the system value and the gap on the audit sheet. Accuracy per zone and per facility is computed weekly.
3. **Preconditions.** GATE-08 and CON-04 working; zones defined in the wizard; at least one pilot facility live in shadow or primary stage.
4. **Protocol.**
   1. Before the audit, tell the guard on duty that an audit is happening only if the operator requires it; do not coach behavior. Surprise timing is the default (Phase 2 plan: surprise physical audits).
   2. At each of the three moments, for each zone: (a) read the system count from the Console board and note its "as of" time; (b) count vehicles physically within a defined short window (target under 5 minutes per zone) or use two people for large zones; (c) re-read the system count if the zone changed during the count and record both values; (d) enter the physical count as `ZONE_COUNT`; (e) write one row on the sheet.
   3. Vehicles in transit (entering or leaving during the count): count them as present only if they have passed the zone boundary marker; note the number in `notes`.
   4. Two-person check on one zone per visit (second counter blind to the first) to estimate counting error; record `counter_b`.
   5. After each visit, the same day: compute `abs_error = |system - physical|`, `pct_error = abs_error / max(physical, 1)`, and zone accuracy as `1 - pct_error` floored at 0.
5. **Recording sheet `ops/metrics/audit-sheet.csv` (R).** Columns: `visit_id, facility_id, date_local, moment (1|2|3), zone_id, counter_a, counter_b (optional), physical_count, system_count, system_as_of_time, system_count_after (optional), abs_error, pct_error, notes, entered_zone_count_event_id`.
6. **Calculations (weekly).**
   - Zone-level accuracy for a zone = mean of `1 - pct_error` over its rows in the week.
   - Facility-level accuracy = `1 - (sum of abs_error over zones) / (sum of physical_count over zones)`, computed per moment then averaged.
   - Sustained check: pass bar is at least 95% zone-level and at least 97% facility-level, sustained across the final two weeks of the 4-week measurement window (Phase 2 plan E3).
   - Kill criterion: if zone-level accuracy stays below 90% after four weeks of tuning across three facilities, stop calling the count "real-time" and position it as a directional indicator (Phase 2 plan §7 and §20; PRD partner copy already commits to saying so).
7. **Drift analysis.** Track drift per shift: if a zone drifts by more than 3% per shift repeatedly, flag it as a likely unmonitored side entrance (H: from PRD section 4 "When the count drifts").
8. **Contracts.** Consumes `ZONE_COUNT` events (IC-01) and `v_zone_now` (IC-07).
9. **Success.** All visits recorded; calculations reproducible from the CSV by the verification script.
10. **Failure.** Missing moments are recorded as missed, not back-filled; visits with a system outage are marked `excluded` with a reason.
11. **Edge cases.** Zone closed for event or maintenance (exclude with note); device offline at count time (system value may lag; record device last sync time from the health page; accuracy reported both with and without offline-lagged rows); very small zones (accuracy percentages unstable; report absolute error too).
12. **Security and privacy.** Do not record plate numbers on the audit sheet; counts only.
13. **Logging.** Audit sheet committed or stored in the shared metrics folder with version history.
14. **Tests (of the protocol and calculation).** T-MET-01-U1, I1, N1, X1.
15. **Acceptance.** Two audits a week for each live facility; calculation script reproduces the weekly numbers; bars evaluated.
16. **Definition of done.** E and J; evidence: sheets and the weekly summary in MET-03.

### C15. MET-02: Adherence checks

1. **Problem.** Plans assume at least 90% of vehicle entries are logged in the system, unassisted, by week 4 (Phase 2 plan E4).
2. **Expected behaviour.** Three random hours per week per facility, count entries independently and compare with the system's `ENTRY` count for the same hour.
3. **Preconditions.** GATE-01 live at the facility; independent counting method available (gate video review or a manual observer).
4. **Protocol.**
   1. Choose three random hours per facility per week from opening hours using a recorded random draw (R: spreadsheet random function with seed noted), spread across at least two days and including at least one peak hour.
   2. Independent count: an observer at the gate counts every vehicle entering during the hour with a tally counter, separated by vehicle class; or count from video afterward with two reviewers for one hour per week.
   3. System count: query `events` where `type = 'ENTRY'` and `device_time` in the hour for the facility (R query saved in `ops/metrics/adherence.sql`).
   4. Adherence = `system_entries / independent_entries` for the hour, capped at 100% for reporting, with overcounts listed separately.
   5. Every bypass found (vehicle entered, no event) is logged with time, class, and the reason from a short interview with the guard (Phase 2 plan: interview the staff member about why).
5. **Recording sheet `ops/metrics/adherence-sheet.csv` (R).** Columns: `facility_id, date_local, hour_start, method (observer|video), observer_id, independent_entries, system_entries, adherence_pct, bypass_count, bypass_reasons, notes`.
6. **Pass bar.** At least 90% in week 4 with no team presence on site except the weekly review (Phase 2 plan pilot week 4 "Unassisted").
7. **Contracts.** Reads `events` through the same access the Console uses; read-only.
8. **Success / failure.** Hours missed are recorded; if adherence under 70% at end of week 3, raise a flag to Afzal (Phase 2 risk R3 early-warning signal).
9. **Edge cases.** Observer presence changes guard behavior (note it; week 4 uses video where possible); two-wheelers entering side by side (count each; note); staff vehicles (counted as `STAFF_VEHICLE` override per reason codes, H).
10. **Security and privacy.** Video reviewed on site or on the operator's system only; no copies of footage leave the facility; sheet has no plate numbers.
11. **Tests.** T-MET-02-U1, I1, N1.
12. **Acceptance and DoD.** Three hours a week recorded for each live facility; weekly figure in MET-03.

### C16. MET-03: Weekly metrics pack

1. **Problem.** The team needs one weekly, evidence-based view of pilot health.
2. **Expected behaviour.** Published every Monday (H cadence: Monday metrics review). Fixed sections:
   1. Facility status: stage (shadow, primary, unassisted), days live, critical incidents.
   2. Occupancy accuracy: zone and facility (MET-01), pass bar status.
   3. Adherence: percentage and bypass reasons (MET-02).
   4. Sync health: queue depth, oldest unsynced age, sync latency p95, quarantined events, devices on old schema (from the Handbook metrics table (H) and `device_heartbeats`).
   5. Conflicts: count by type, unresolved over 24 hours.
   6. Overrides per 100 vehicles, by reason code.
   7. Reports: delivered, bounced, failed (from `job_runs` and Resend).
   8. Cloud: uptime against 99.5%, job failures, database size, bill.
   9. Open issues: owner, severity, next action.
   10. Decisions needed from Afzal.
3. **Preconditions.** MET-01, MET-02 sheets current; CON-10 health page shows the sync figures.
4. **Implementation.** Template `ops/metrics/weekly-pack.md` (R). Each figure names its source (view, table, sheet) and the time window. A small SQL file `ops/metrics/weekly.sql` (R) produces the database-derived numbers so they are reproducible.
5. **Success.** Pack published with no empty sections; any missing figure is stated as missing with the reason.
6. **Edge cases.** No live facility that week (publish a "no data" pack with blockers); partial week (state the window); disputed number (link to the query).
7. **Tests.** T-MET-03-U1, I1, N1.
8. **Acceptance and DoD.** Template complete; query reproduces the figures; pack reviewed by Afzal at the Monday review.

---


## D. Detailed Testing Protocol

Conventions. Test ID = `T-<FeatureID>-<kind><n>`; kinds: U unit, I integration, E end-to-end, N negative, R regression, X non-functional. Verification method values: ASSERT (automated assertion), SQL (database query), UI (UI check by script), LOG, MANUAL (recorded by a person with evidence). Priority: C critical, H high, M medium, L low. Recommended tools (R): Vitest for unit, Playwright for integration and end-to-end, a local Supabase instance for database-backed tests, axe for accessibility. Test data: the seed fixtures from CON-11 unless stated. **No test has been run; all are Not verified.**

Regression note: no existing MVP functionality exists, so R tests mean "tests from earlier waves still passing" and protect the integration contracts.

### D1. CON-01 Setup wizard

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CON-01-U1 | Slab contiguity validator accepts valid slabs | none | Run validator | slabs 0-60, 60-120, 120-240 | valid | ASSERT | C |
| T-CON-01-U2 | Validator rejects gap and overlap | none | Run validator | slabs 0-60 and 90-120; 0-90 and 60-120 | two errors naming the gap and overlap | ASSERT | C |
| T-CON-01-U3 | Night window crossing midnight accepted | none | Validate | 22:00 to 06:00 | valid | ASSERT | H |
| T-CON-01-U4 | Zone capacity must be integer at least 1 | none | Validate | 0, -1, 2.5, "a" | each rejected | ASSERT | H |
| T-CON-01-U5 | Capacity sum differs from slot count gives warning not error | none | Validate | sum 180 vs 200 | warning flag only | ASSERT | M |
| T-CON-01-I1 | Draft persists and resumes | signed-in manager; draft table exists | Save step 2, reload, open wizard | two zones | step 2 shows both zones | UI and SQL | C |
| T-CON-01-I2 | Activation blocked until steps 1 to 5 valid | draft with step 4 missing | Press Activate | none | disabled, reason listed | UI | C |
| T-CON-01-I3 | Config rows created on activation | complete draft | Activate | seed template "mall" | rows in zones, tariffs, passes, shifts; facility status active | SQL | C |
| T-CON-01-I4 | Try-it equals shared fare function | shared case table from GATE-03 | For each case enter times and class | 60 cases | Console fare equals expected for every case | ASSERT | C |
| T-CON-01-E1 | Full wizard on a fresh facility | staging project, manager login | Complete steps 1 to 7 with Playwright | mall template, edited tariff | all steps saved; step 7 items green after a simulated entry, exit and sync | UI | C |
| T-CON-01-E2 | Tariff edit after go-live creates new version | active facility | Change hourly rate | new price, effective tomorrow | new row with future effective date; old row unchanged | SQL | H |
| T-CON-01-N1 | Guard device cannot reach wizard | device login | Open `/setup/1` | device session | redirected to login or 403 | UI | C |
| T-CON-01-N2 | Manager of another facility cannot write | two facilities | POST step save for facility B | manager A session | rejected, no row | SQL | C |
| T-CON-01-N3 | Delete zone with open session refused | seed open session | Delete zone | zone id | refused with message | UI and SQL | H |
| T-CON-01-N4 | Network drop during save | wizard open | Block network, save | any | "Not saved" shown; input kept; step does not advance | UI | H |
| T-CON-01-R1 | Contract schema tests from SYNC-01 still pass | CI | Run contracts tests | none | green | ASSERT | H |
| T-CON-01-X1 | Unaided usability run | printed sheet of tariffs and zones; person not on team | Observe unaided setup | sheet | under 45 minutes; list of hesitations recorded | MANUAL (video, notes) | C |
| T-CON-01-X2 | Accessibility of wizard | axe | Scan each step | none | no critical violations; keyboard-only completion possible | ASSERT and MANUAL | M |

### D2. CON-02 Staff, devices, roles

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CON-02-U1 | PIN policy | none | Validate | 1234, 0000, 1111, 4826, 12345, 1234567, "12a4" | reject first three and last two; accept 4826, 12345 | ASSERT | C |
| T-CON-02-U2 | Permission helper | none | Call per role | owner, manager, guard, device | matches matrix in D-X below | ASSERT | H |
| T-CON-02-I1 | Create guard hashes PIN server-side | local DB | Create guard with PIN 4826 | name, PIN | `staff.pin_hash` set, salt set, no plaintext anywhere in table or logs | SQL and LOG | C |
| T-CON-02-I2 | Enrollment code single use | active facility | Create code, use twice | code | first succeeds, second fails | SQL | C |
| T-CON-02-I3 | Enrollment code expires | active facility | Create code, wait past 10 minutes (clock control) | code | rejected | SQL | C |
| T-CON-02-I4 | Regenerate invalidates previous | active facility | Create code A, regenerate B, use A | codes | A rejected | SQL | H |
| T-CON-02-I5 | Revoke device blocks next sync | enrolled device | Revoke, device attempts ingest | events | rejected | SQL | C |
| T-CON-02-E1 | Add guard then add device flow | manager login | Add guard, add device, show QR | none | guard in list; QR with countdown; device appears after simulated enrollment | UI | C |
| T-CON-02-E2 | Site switcher by role | seed: owner with 3 facilities, manager with 1 | Log in as each | none | owner sees 3, manager 1 | UI | C |
| T-CON-02-N1 | Manager of A edits staff of B | two facilities | Call server action | staff of B | rejected | SQL | C |
| T-CON-02-N2 | Last owner cannot be deactivated | one owner | Deactivate | owner | refused | UI and SQL | H |
| T-CON-02-N3 | PIN never in logs | any | Create guard, grep server logs and Sentry payload | PIN | not found | LOG | C |
| T-CON-02-N4 | Guard attempts Console login | guard user | Visit `/` | credentials | denied | UI | C |
| T-CON-02-R1 | Contract test IC-05 | CI | Run enrollment contract test with Akanksha's function | none | green | ASSERT | H |
| T-CON-02-X1 | Permission matrix | all roles | Execute matrix in D-X | all routes | only allowed cells succeed | ASSERT | C |

### D3. CON-03 Login and session

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CON-03-U1 | Redirect target sanitizer | none | Call helper | `/dash`, `https://evil.com`, `//evil.com` | only first accepted | ASSERT | C |
| T-CON-03-I1 | Middleware refreshes session | local | Request with near-expiry session | cookie | refreshed, request ok | ASSERT | H |
| T-CON-03-E1 | Login and logout | seed manager | Login, view dashboard, logout, press back | credentials | after logout back button shows login | UI | C |
| T-CON-03-N1 | Every route unauthenticated | none | Request each route and API | no cookie | redirect or 401 | ASSERT | C |
| T-CON-03-N2 | Bad credentials message | none | Login with wrong password, then unknown email | both | identical generic message | UI | H |
| T-CON-03-N3 | Device role rejected | device user | Request Console page | device JWT | denied | ASSERT | C |
| T-CON-03-X1 | Cookie flags | staging HTTPS | Inspect cookies | login | HttpOnly, Secure, SameSite set | MANUAL | M |

### D4. CON-04 Occupancy board

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CON-04-U1 | Color band function | none | Call | 0, 69, 70, 90, 91, 100, 105 percent | correct band; 105 flagged over capacity | ASSERT | M |
| T-CON-04-I1 | Board equals `v_zone_now` | seed | Load page, query view | none | identical counts | ASSERT and SQL | C |
| T-CON-04-I2 | Polling fallback | Realtime disabled | Insert event, wait | one entry | board updates within 10 s | UI | C |
| T-CON-04-E1 | Event shows within 10 s with Realtime | staging | Insert entry via harness | one entry | count increments within 10 s | UI | C |
| T-CON-04-E2 | Stale banner | no heartbeat for 31 minutes (clock control) | Open page | none | banner visible | UI | H |
| T-CON-04-N1 | Other facility zones not visible | two facilities | Open with manager A | facility B id | 404 | UI | C |
| T-CON-04-X1 | 360 px layout | viewport 360x740 | Screenshot and check | none | no horizontal scroll; bars readable | UI and MANUAL | H |
| T-CON-04-X2 | Update latency under load | SYNC-07 harness running | Measure event to display | 20 devices | 95th percentile under 10 s | LOG | H |

### D5. CON-05 Dashboard

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CON-05-U1 | Overrides per 100 handles zero entries | none | Call | entries 0, 250 | 0 shown not NaN; 250 correct | ASSERT | M |
| T-CON-05-U2 | Format paise to rupees | none | Call | 0, 1, 99, 100, 123456 | Rs 0.00, 0.01, 0.99, 1.00, 1,234.56 | ASSERT | H |
| T-CON-05-I1 | KPIs equal SQL oracle | seed ORACLE | Load day with known data | day 1 of each facility | all five KPIs exact | ASSERT and SQL | C |
| T-CON-05-I2 | Date selector via URL | seed | Open `?range=7d` | none | totals equal sum of daily | ASSERT | M |
| T-CON-05-E1 | Dashboard journey | manager login | Open dashboard, change range, open exception | none | each exception link opens the right page | UI | H |
| T-CON-05-N1 | One failed query does not blank page | force `v_hourly` error | Load | none | chart card shows error; others render | UI | H |
| T-CON-05-N2 | Empty facility | new facility | Load | none | empty state with setup link | UI | M |
| T-CON-05-R1 | Dashboard unchanged after conflict resolution | CON-07 done | Resolve conflict, reload | none | KPIs follow documented rule | ASSERT | H |
| T-CON-05-X1 | Load time | mid-range Android profile, 4G throttle | Measure | none | under 2 s to usable | MANUAL (trace saved) | C |
| T-CON-05-X2 | Mobile 360 px | viewport 360 | Screenshot | none | usable, no overlap | UI | H |

### D6. CON-06 Shift review

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CON-06-U1 | Variance badge thresholds | none | Call | variance 0, threshold-1, threshold, threshold+1 | badge states correct | ASSERT | M |
| T-CON-06-I1 | Sign-off writes one review | closed seed shift | Sign off | note | one `shift_reviews` row with actor | SQL | C |
| T-CON-06-I2 | Events checksum unchanged | closed shift | Hash events before and after sign-off | none | equal | SQL | C |
| T-CON-06-E1 | Review journey | manager login | List, open bad-variance shift, sign off with note | seed shift | status shown; exception disappears from dashboard if approved | UI | H |
| T-CON-06-N1 | Sign off open shift refused | open shift | Press sign off | none | disabled or rejected | UI | H |
| T-CON-06-N2 | Variance above threshold without note refused | bad-variance shift | Sign off empty note | none | validation error | UI | H |
| T-CON-06-N3 | Double submit | closed shift | Double click | none | one row | SQL | M |
| T-CON-06-N4 | Wrong facility | two facilities | Manager A signs B's shift | ids | rejected | SQL | C |

### D7. CON-07 Conflicts inbox

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CON-07-I1 | Each conflict type resolvable | seed one of each type | Resolve each | actions per type | resolution rows; conflict status resolved | SQL | C |
| T-CON-07-I2 | Atomic resolve | force failure after insert | Call resolve | none | both changes or neither | SQL | C |
| T-CON-07-I3 | Events unchanged | any | Hash events before and after | none | equal | SQL | C |
| T-CON-07-E1 | Inbox journey | manager login | Open inbox, open duplicate exit, Keep first | seed | removed from open list; KPIs follow rule | UI | H |
| T-CON-07-N1 | Concurrent resolution | two sessions | Both resolve | same conflict | second sees "already resolved" | UI | H |
| T-CON-07-N2 | CLOCK_SKEW restricted actions | seed | Open | none | only Add note and Acknowledge offered | UI | M |
| T-CON-07-N3 | Other facility conflict | two facilities | Open by id | foreign id | 404 | UI | C |
| T-CON-07-R1 | Contract test IC-10 | CI | Detector creates conflict; inbox reads | crafted events | shown with correct fields | ASSERT | H |

### D8. CON-08 Reports

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CON-08-U1 | Week and month range helpers | none | Call | 28 Feb leap year, 31 Dec, week crossing month | correct inclusive ranges in IST | ASSERT | H |
| T-CON-08-I1 | Totals equal dashboard | seed | Render daily and weekly; compare with dashboard | day 1 | identical totals | ASSERT | C |
| T-CON-08-I2 | Excel sheets equal PDF numbers | seed | Parse xlsx and PDF text | monthly | matching numbers | ASSERT | H |
| T-CON-08-I3 | No vehicle numbers in output | seed with plates | Search outputs | plate strings | not found | ASSERT | C |
| T-CON-08-E1 | Scheduler to inbox | CLD-06 | Trigger job on staging | facility | email with link, file opens, numbers right | MANUAL and LOG | C |
| T-CON-08-N1 | Missing secret | none | Call route without secret or session | none | 401 | ASSERT | C |
| T-CON-08-N2 | Wrong secret and rate limit | none | 100 wrong tries | none | 401 and limited | ASSERT | H |
| T-CON-08-N3 | Empty period | new facility | Render | none | file with "no data" sections | ASSERT | M |
| T-CON-08-N4 | Chromium failure path | force error | Render | none | 500, job id, Sentry event | LOG | H |
| T-CON-08-X1 | Render time | staging cold and warm | Time standard report | seed month | under 10 s warm; cold time recorded | MANUAL | H |
| T-CON-08-X2 | Print layout | PDF | Inspect pages | monthly | A4, no cut tables, readable fonts | MANUAL | M |

### D9. CON-09 Overstay

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CON-09-U1 | Threshold validation | none | Validate | 0, 29, 30, 240 minutes | first two rejected | ASSERT | M |
| T-CON-09-I1 | List equals oracle | seed open sessions | Compare with SQL | threshold 4 h | same set | SQL | C |
| T-CON-09-I2 | Passes excluded | seed pass session | Check list | none | not listed | SQL | H |
| T-CON-09-E1 | Change threshold | manager | Lower to 2 h, reload | none | more rows; alert job picks up value | UI and LOG | H |
| T-CON-09-N1 | Exported CSV excludes plates by default | none | Export | none | no plate column unless enabled (OQ-26) | ASSERT | M |
| T-CON-09-N2 | Other facility | two facilities | Open | foreign id | 404 | UI | C |

### D10. CON-10 Health page

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CON-10-U1 | Status function | none | Call | queue 0, 200, 201; age 29, 31 min; heartbeat age 31 min | correct green, amber, red | ASSERT | H |
| T-CON-10-I1 | Reads heartbeat rows | seed heartbeats | Load | none | devices listed with values | SQL and UI | H |
| T-CON-10-E1 | Stale device goes red | clock control | Advance 31 minutes | none | red after next refresh | UI | H |
| T-CON-10-N1 | Never-seen device | enrolled, no heartbeat | Load | none | shows "never" | UI | M |
| T-CON-10-N2 | Revoked device hidden | revoked device | Load | none | hidden by default | UI | M |
| T-CON-10-R1 | Contract test IC-09 | CI | Insert heartbeat via function; read page | values | match | ASSERT | H |

### D11. CON-11 Seed and demo

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CON-11-I1 | Seed from scratch | empty local DB with migrations | Run seed | none | no errors; row counts match ORACLE | SQL | C |
| T-CON-11-I2 | Seed idempotent | seeded DB | Run again | none | same counts | SQL | H |
| T-CON-11-I3 | Refused on production | production env var | Run | none | aborts | LOG | C |
| T-CON-11-E1 | Every page populated | seeded staging | Visit all Console pages | none | no empty state except intended | UI | H |
| T-CON-11-N1 | No real data | seed | Scan for real-looking phone numbers and plates | seed | only synthetic patterns | ASSERT | H |

### D12. CON-12 Field protocol and data QA

Protocol (E1 baseline; the same steps at pilot end for E2):

| Item | Specification |
| --- | --- |
| Sample | 10 shift-closes, 50 entry/exit cycles (25 entries, 25 exits), 10 disputes at the gate, at the pilot facility, at a normal and a peak period |
| Timing | Stopwatch in seconds, one observer per gate; start and stop events defined in Appendix 1 |
| Excluded | Queue waiting caused by traffic; breaks; training time |
| Wage conversion | Local wage per hour from the facility's own guard pay or a local labour rate (Appendix 2); label estimate if not from the facility |
| Computation | Staff-hours per day = (mean entry/exit seconds x daily vehicles + mean shift-close seconds x shifts + mean dispute seconds x disputes per day) / 3600; rupees per month = hours per day x wage per hour x operating days |
| Pass bar | Median of the three facility hours-per-day figures at least 1.5 hours per day AND rupee value at least 3 times the proposed monthly price |
| Kill criterion | Under 0.75 hours per day: manpower-savings story fails; re-anchor on revenue leakage, overstay recovery and renewal reporting (Phase 2 plan section 20) |

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected | Verification | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CON-12-U1 | Computation sheet correct | template spreadsheet | Enter worked example | 40 s entry, 600 vehicles, 2 shifts at 1,800 s, 3 disputes at 300 s | 6.67 + 1.0 + 0.25 = 7.9 h/day | ASSERT (spreadsheet formula check) | H |
| T-CON-12-I1 | Sample size met | filled sheets | Count rows | none | 10, 50, 10 present | MANUAL | C |
| T-CON-12-I2 | Outliers flagged | filled sheets | Flag times above 3 times the median | none | flagged and explained | MANUAL | M |
| T-CON-12-N1 | Insufficient disputes | fewer than 10 observed | Record | none | extend observation or label sample small | MANUAL | H |
| T-CON-12-E1 | Operator sign-off | ROI statement drafted | Present to operator | none | signed or written reason | MANUAL (photo of signed sheet) | C |
| T-CON-12-R1 | Repeat at pilot end | same method | Repeat study | none | delta computed with identical sampling | MANUAL | C |

### D13. CLD-06 Report scheduler and email

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-CLD-06-U1 | Period boundary calculation | Function | Compute daily, weekly, monthly periods in IST | fixed clock samples | Correct start and end (Monday start, month start) | Unit test | High |
| T-CLD-06-I1 | Job with stub route | Stub returning two small files | Trigger `run_report_job('daily')` | one facility | Files in bucket; `job_runs` success; one email accepted by Resend sandbox | Bucket listing, DB, Resend log | High |
| T-CLD-06-I2 | Signed link lifetime | Report stored | Generate link; fetch now; inspect expiry | link | Works now; expiry parameter equals 7 days | HTTP check and token inspection | Medium |
| T-CLD-06-I3 | Idempotency | Same period run twice | Run job twice | same facility | Files replaced, one email only | `job_runs`, email log | High |
| T-CLD-06-E1 | Real route end to end | Console route on staging | Run job against staging route with seed data | seed | Email with working PDF and Excel; totals equal dashboard | Manual check plus script | High |
| T-CLD-06-N1 | Route down | Stub returns 500 | Run job | one failing facility, one healthy | 3 retries, failed row, other facility succeeds, alert raised | `job_runs`, alert log | High |
| T-CLD-06-N2 | Facility without recipients | None configured | Run job | facility | Skipped with warning logged | `job_runs` | Medium |
| T-CLD-06-N3 | Public bucket check | Bucket policies | Attempt unauthenticated fetch of a stored object path | anon request | Denied | HTTP status | Critical |
| T-CLD-06-X1 | Email deliverability | Resend domain with SPF and DKIM | Send test reports to Gmail and Outlook test accounts | two accounts | Inbox (not spam); headers show SPF and DKIM pass | Headers screenshot | High |
| T-CLD-06-X2 | Cron time conversion | Schedules created | Inspect `cron.job` entries | schedules | UTC times correspond to 06:30, 07:00 IST | SQL output | Medium |

### D14. MET-01 to MET-03 Measurement tests

| Test ID | Scenario | Preconditions | Steps | Input/data | Expected result | Verification | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-MET-01-U1 | Accuracy formulas | Calculation script | Feed hand-computed sample sheets | 3 zones, 3 moments | Script equals hand results | Script test | High |
| T-MET-01-I1 | Sheet to events cross-check | Audit rows with event ids | Join sheet to `ZONE_COUNT` events | sample | Every sheet row has a matching event with the same count | SQL | Medium |
| T-MET-01-N1 | Incomplete sheet | Missing zone row | Run validation | partial sheet | Validation lists the missing row; week marked incomplete | Script output | Medium |
| T-MET-01-X1 | Counting error estimate | Two-person count rows | Compute counter disagreement | sample | Reported with the week; flags above 5% | Script output | Low |
| T-MET-02-U1 | Adherence formula and cap | Script | Independent 100, system 92; independent 80, system 85 | two rows | 92% and 100% with 5 overcount reported | Script test | High |
| T-MET-02-I1 | Query returns entries for the hour | Seed events | Run `adherence.sql` for an hour | seed | Count equals known seed count | SQL | High |
| T-MET-02-N1 | Random-hour draw rejects closed hours | Opening hours config | Draw hours | config | No hour outside opening hours; at least two days | Script output | Low |
| T-MET-03-U1 | Pack completeness | Template | Run completeness check on a sample pack | sample | All 10 sections present | Checklist script | Medium |
| T-MET-03-I1 | Query reproducibility | `weekly.sql` | Run twice on same data | seed | Identical output | Diff | Medium |
| T-MET-03-N1 | Missing source | A source sheet missing | Build pack | none | Section states "missing: reason" not a blank | Review | Low |

---


### D-X. Cross-cutting tests

Permission matrix (T-CON-02-X1 executes this; allowed = A, denied = D):

| Route or action | Owner | Manager (own site) | Manager (other site) | Guard user | Device | Anonymous |
| --- | --- | --- | --- | --- | --- | --- |
| Dashboard, occupancy, reports | A | A | D | D | D | D |
| Setup, tariffs, zones | A | A | D | D | D | D |
| Staff and devices | A | A | D | D | D | D |
| Shift sign-off, conflicts | A | A | D | D | D | D |
| Health page | A | A | D | D | D | D |
| Report route with secret | A | A | A | A | A | A (secret only) |
| Any events update or delete | D | D | D | D | D | D |

Playwright flows to keep in CI (R): `login-logout`, `wizard-full`, `staff-device-enroll`, `dashboard-oracle`, `occupancy-update`, `shift-signoff`, `conflict-resolve`, `report-download`, `overstay-threshold`, `health-stale`. Accessibility (X): axe on dashboard, wizard, conflicts. Mobile: dashboard, occupancy, reports at 360 px. Performance: dashboard under 2 s, board update under 10 s, report under 10 s warm, on a mid-range Android profile over throttled 4G.

## E. Acceptance Criteria and Completion Checklist

### E1. CON-01
- [ ] Seven steps save drafts and resume after reload (T-CON-01-I1)
- [ ] Activation blocked until valid (T-CON-01-I2) and creates config rows (T-CON-01-I3)
- [ ] Try-it equals shared fare table on all cases (T-CON-01-I4)
- [ ] Tariff changes after go-live create versions (T-CON-01-E2)
- [ ] Unaided usability run under 45 minutes (T-CON-01-X1)
- [ ] Role misuse rejected (T-CON-01-N1, N2)
- [ ] Documentation updated: wizard fields and templates listed
- [ ] Reviewed by Nikhil (tariff form) and Akanksha (tables)
### E2. CON-02
- [ ] PIN policy enforced and hashed server-side, no plaintext in logs (T-CON-02-I1, N3)
- [ ] Enrollment code single use, expires, regenerates (T-CON-02-I2 to I4)
- [ ] Revoke blocks sync (T-CON-02-I5)
- [ ] Permission matrix passes (T-CON-02-X1)
- [ ] A real phone enrolled using the QR (evidence with Nikhil)
### E3. CON-03
- [ ] No route accessible unauthenticated (T-CON-03-N1); device role rejected (N3); redirect sanitized (U1)
### E4. CON-04
- [ ] Equals `v_zone_now` (I1); updates within 10 s (E1, I2); stale banner (E2); 360 px (X1)
### E5. CON-05
- [ ] All KPIs equal the oracle (T-CON-05-I1); under 2 s (X1); error isolation (N1); "as of" on every card
### E6. CON-06
- [ ] Sign-off recorded once and attributable (I1); events unchanged (I2); validation rules (N1, N2)
### E7. CON-07
- [ ] All four conflict types resolvable (I1); atomic (I2); events unchanged (I3); concurrency handled (N1)
### E8. CON-08
- [ ] Totals equal dashboard (I1); no vehicle numbers (I3); secret enforced (N1, N2); render time recorded (X1); email delivered via CLD-06 (E1)
### E9. CON-09
- [ ] List equals oracle (I1); threshold flows to alert job (E1)
### E10. CON-10
- [ ] Red state appears for stale device (E1); contract test IC-09 green (R1)
### E11. CON-11
- [ ] Seed reproduces ORACLE (I1); refused on production (I3); demo pages populated (E1)
### E12. CON-12
- [ ] Sample sizes met; computation sheet verified; pass bar or kill criterion applied; operator signature; end-of-pilot repeat done

### E13. CLD-06
- [ ] three cadences deliver [ ] 7-day links [ ] private bucket [ ] idempotent [ ] failure alerts [ ] deliverability proven [ ] T-CLD-06-* run
- Evidence: `job_runs` export, email screenshots, header evidence

### E14. MET-01
- [ ] two audits per week per live facility [ ] sheets complete [ ] bars evaluated [ ] T-MET-01-* run
- Evidence: Sheets, weekly summary

### E15. MET-02
- [ ] three hours per week per live facility [ ] bypass reasons recorded [ ] T-MET-02-* run
- Evidence: Sheets

### E16. MET-03
- [ ] pack each Monday with all sections [ ] sources named [ ] reviewed by Afzal [ ] T-MET-03-* run
- Evidence: Published packs

**Evidence required to close any feature:** test run output saved (log or CI link), screenshots or video for UI and field items, SQL query result for database checks, and a reviewer's name on the pull request. A test file existing is not evidence.

## F. Dependencies and Integration Contracts

| IC | Direction | Owner | Anamika's use | Contract test (ID) |
| --- | --- | --- | --- | --- |
| IC-01 event schemas | consumed | Afzal | forms and report parsing | T-CON-01-R1 |
| IC-04 fare and tariff JSON | consumed | Nikhil | try-it panel | T-CON-01-I4 |
| IC-05 enrollment | consumed | Akanksha | QR screen | T-CON-02-R1 |
| IC-06 staff PIN hashes | provided (PIN entry) / consumed | Akanksha | `set_staff_pin` call | T-CON-02-I1 |
| IC-07 KPI views | consumed | Akanksha | dashboard, board, reports | T-CON-05-I1 |
| IC-08 report route | **provided** | Anamika | route | T-CON-08-N1 and T-CON-08-E1 |
| IC-09 heartbeat | consumed | Akanksha, Afzal | health page | T-CON-10-R1 |
| IC-10 conflicts | consumed | Afzal | inbox | T-CON-07-R1 |

Shared-file conflicts to manage: `packages/contracts` (changes need all four approvals); migrations (never write SQL migrations herself; request from Akanksha with exact columns); view definitions (Akanksha owns; Anamika requests columns in a pull request comment). Milestones: no calendar dates; each feature starts when the dependencies in section B exist (README section 6).

## G. Error Handling and Edge Cases (cross-cutting)

| Situation | Expected behaviour |
| --- | --- |
| Gate has not synced for hours | Console shows "as of" and stale banner; numbers never presented as live |
| Duplicate action (double click, retried request) | Idempotent server actions; unique constraints; disabled buttons |
| Invalid state transition (sign off open shift, activate incomplete facility) | Refused with a plain message |
| Partial failure (render succeeds, email fails) | Route result independent; scheduler retry is Akanksha's; Console shows last render status if available |
| Concurrent edits | Version conflict message, reload offered; no silent overwrite |
| Permission mismatch (role changed mid-session) | Next request re-evaluates; 404 on foreign ids |
| External timeouts (Chromium, Auth, Realtime) | Fallbacks defined per feature; Sentry event |
| Unexpected database state (missing config, zone without tariff) | Page shows a warning chip, not a crash |

## H. Security, Privacy and Data Integrity

- Authentication through Supabase Auth with SSR cookies; authorization by RLS; Console code never uses the service role key.
- Secrets (report secret, Supabase keys) only in Vercel and GitHub environment variables; none in the repo; none in this document.
- PINs: plaintext only inside one request; hashed and salted in the database; never logged or sent to Sentry.
- Data minimisation: reports and exports exclude vehicle numbers by default (OQ-26); logs exclude vehicle numbers and phone numbers.
- Integrity: Console never edits or deletes events; corrections are separate records; every Console write stores the actor id from the session.
- Abuse: rate limits on login, report route and enrollment code creation (settings confirmed with Akanksha).
- Audit: every administrative change recorded in `audit_log` (S) through database triggers or functions owned by Akanksha.
- DPDP Act 2023: retention and deletion controls are CLD-08; the Console exposes request buttons for export and delete (owner only) when CLD-08 exists.
- No real user data in demos; seed data synthetic.

## I. Deliverables

Required: all CON-01 to CON-12 features working per section C; Playwright and unit tests with run output; seed and ORACLE file; report templates and route; wizard templates; field templates and signed ROI statements; short `apps/console/README.md` (R) with run instructions; list of known limitations; review-ready pull requests with evidence.

Optional: Hindi labels for supervisor pages; tooltips on KPIs; dark mode; CSV export on more pages.

## J. Definition of Done

A Console feature is done only when: implemented per section C; all its D tests exist and pass with evidence saved; acceptance checklist in E ticked; reviewed by a teammate of another workstream; integrated and demonstrated against Akanksha's real views or functions (not mocks) where they exist; documentation updated; and the feature row in `feature-traceability.md` changed from Not verified to Verified with a link to the evidence.

Recommended commands (to be confirmed once the repo is scaffolded; none have been run):

```text
pnpm install
pnpm --filter console typecheck
pnpm --filter console lint
pnpm --filter console test            # unit
supabase start && supabase db reset   # applies migrations and seed locally
pnpm --filter console test:e2e        # Playwright against local Supabase
pnpm --filter console build
```

## Appendix 1: Time-and-motion recording template (CON-12)

| Sheet | Columns |
| --- | --- |
| Entry/exit cycles | cycle id, facility, gate, date, period (normal or peak), type (entry or exit), start event, stop event, seconds, guard code (not name), notes (override, dispute, reprint) |
| Shift closes | close id, facility, shift name, start (cash-out begins), stop (sign-off done), seconds, mismatch amount, who resolved |
| Disputes | dispute id, facility, type (fee, lost token, damage, other), start, stop, seconds, outcome, amount |

Start and stop definitions: entry from vehicle stopping at the barrier to ticket handed or barrier lifted; exit from presenting ticket to barrier lifted after payment; shift close from first cash count to supervisor signature; dispute from first complaint to resolution.

## Appendix 2: Wage and volume record

| Field | Value |
| --- | --- |
| Facility | |
| Guard monthly pay (range) or local labour rate per hour | |
| Source (operator statement, local posting) | |
| Daily vehicles (entries), weekday and weekend | |
| Shifts per day, disputes per day (operator estimate and observed) | |
| Operating days per month | |

## Appendix 3: ROI statement (one page per facility)

1. Facility, date, observer. 2. Measured means and medians (entry, exit, shift close, dispute). 3. Staff-hours per day today (formula in D12). 4. Rupees per month today. 5. Expected reduction target to be measured at pilot end (not promised): entry/exit handling time down at least 30 percent and shift close down at least 50 percent (Phase 2 hypotheses E2). 6. Proposed monthly price tier. 7. Pass bar result (median at least 1.5 hours per day and rupee value at least 3 times price) or kill result (under 0.75 hours per day). 8. Operator signature or written reason.
