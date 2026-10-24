# ParkOS MVP: Team Implementation Plan (Master Coordination Document)

Prepared 24 Oct 2026 for Team PlanMyParking (Afzal, Nikhil, Anamika, Akanksha).

## 0. Read this first: what this plan is based on

**The repository contains no application code.** On inspection, the connected folder `PlanMyParking/` holds only the `doc/` folder with eight product documents (Problem Discovery, Define Phase, Empathy worksheet, Phase 1 submission, Phase 2 plan, PRD v1.1, Executive Blueprint, Working Phase). It is not a git repository and has no source files, schema, migrations, tests, configuration or CI. The team division and architecture used here come from the "ParkOS MVP PRD for Design Partners" and the "ParkOS Engineering Handbook" Claude Docs created in this project on 24 Oct 2026 (they are proposals the team has not yet formally confirmed; see OQ-18).

Consequences for every document in this folder:

- Every feature below has status **Not implemented**. Nothing is "implemented and verified" because nothing has been implemented.
- File names, tables, endpoints, function signatures and commands are **Recommended (does not exist yet)** unless a source document states them. Where a source document states them (for example the table list in the Handbook), they are labelled **Specified in Handbook**.
- No test has been run. All "Verification status" values are **Not verified**.
- Timing: no dates or estimates are given, because there is no velocity data and the weekly hours of each member are unknown (OQ-17). Ordering and gates are given instead. The only dates are those already in the Phase 2 plan.

## 1. Product and MVP scope summary

ParkOS is an operator-first parking operations product for managed facilities of 100 to 500 slots in Tier-1/Tier-2 Indian cities. The MVP runs the gate, the floor and the cash box from an Android phone, works with no internet, and produces owner-ready reports. It is staff-augmentation, not staff replacement. Revenue model: SaaS only; free 30-day pilot with design partners.

In scope (the 12 must-haves, P0-1 to P0-12 from the Phase 2 plan): facility setup, offline entry, exit with fare and payment recording, zone-level occupancy, monthly passes, shift-close reconciliation, override log, Console dashboard, automated reports, overstay flagging, roles with multi-site switcher, sync integrity.

Out of scope: driver app, marketplace, truck parking, ANPR or FASTag (only as later adapters), per-slot sensors, AI features, EV, valet, payment-gateway integration (operators use their own UPI QR), municipal parking.

## 2. Team roster and ownership matrix

| Member | Workstream | Feature prefixes | Sheet |
| --- | --- | --- | --- |
| Afzal (lead) | Architecture, sync core, releases, partners | `SYNC`, `REL`, `PRT` | [member-01-afzal.md](member-01-afzal.md) |
| Nikhil | Gate app (guard phone) and fare engine | `GATE` | [member-02-nikhil.md](member-02-nikhil.md) |
| Anamika | Operator Console, reports, baseline study | `CON` | [member-03-anamika.md](member-03-anamika.md) |
| Akanksha | Cloud, data, DevOps, pilot measurement | `CLD`, `MET` | [member-04-akanksha.md](member-04-akanksha.md) |

Other files: [feature-traceability.md](feature-traceability.md), [open-questions-and-assumptions.md](open-questions-and-assumptions.md).

Source note: the Phase 2 plan assigned roles differently (Afzal product and sales, Anamika research and customer success, Akanksha ops and data, Nikhil engineering lead). The user has since stated that all four are engineers and Afzal is the lead. The ownership above follows the Handbook; confirm in OQ-18.

## 3. Complete feature inventory

Status for every row: **Not implemented**. "P0" refers to the Phase 2 plan must-have list.

| ID | Feature | P0 / source | Owner | Depends on |
| --- | --- | --- | --- | --- |
| SYNC-01 | Contracts package: event schemas, money, reason codes, schema version | Handbook | Afzal | none |
| SYNC-02 | Upload outbox and idempotent `ingest_events` | P0-12 | Afzal | SYNC-01, CLD-02 |
| SYNC-03 | Download sync of config and `open_sessions`; PowerSync-or-outbox decision | P0-12 | Afzal | SYNC-01, CLD-02, CLD-03 |
| SYNC-04 | Occupancy computation with zone-count baseline | P0-4 | Afzal | SYNC-01, SYNC-03 |
| SYNC-05 | Conflict detection and conflict records | P0-12 | Afzal | SYNC-02 |
| SYNC-06 | Sync health signals, heartbeat sender, quarantine | P0-12 | Afzal | SYNC-02, CLD-04 |
| SYNC-07 | Simulation harness (6-hour, 300-vehicle, two-device test) | P0-12 | Afzal | SYNC-02 to SYNC-05, GATE-01, GATE-02 |
| REL-01 | Monorepo, `CLAUDE.md`, branch and review rules, release and rollback | Handbook | Afzal | none |
| PRT-01 | Design-partner pipeline, pilot agreements, day-30 pricing meeting | Phase 2 plan | Afzal | CON-12 (ROI data) |
| GATE-01 | Vehicle entry, token-first, offline | P0-2 | Nikhil | SYNC-01, SYNC-03, GATE-09, GATE-12 |
| GATE-02 | Vehicle exit and lost-token lookup | P0-3 | Nikhil | GATE-01, GATE-03 |
| GATE-03 | Fare engine in `packages/domain` | P0-3 | Nikhil | SYNC-01 |
| GATE-04 | Payment recording and UPI attestation | P0-3 | Nikhil | GATE-02 |
| GATE-05 | Monthly pass validation | P0-5 | Nikhil | SYNC-03 |
| GATE-06 | Shift open and close, guard side | P0-6 | Nikhil | GATE-04 |
| GATE-07 | Override flow and reason codes | P0-7 | Nikhil | SYNC-01 |
| GATE-08 | Zone count entry and reminders | P0-4 | Nikhil | SYNC-04 |
| GATE-09 | PIN login, offline auth and device enrollment | P0-11 | Nikhil | CLD-03, CON-02 |
| GATE-10 | Bluetooth printer, QR display and scan, print fallback | P0-2 | Nikhil | GATE-01 |
| GATE-11 | Paper-sheet backfill | Handbook | Nikhil | GATE-01, GATE-02 |
| GATE-12 | App shell, Hindi/English, status and diagnostics screen, banners | Handbook | Nikhil | SYNC-06 |
| CON-01 | Setup wizard with tariff editor and fare "try it" | P0-1 | Anamika | CLD-02, GATE-03, CON-03 |
| CON-02 | Staff, devices, roles UI and multi-site switcher | P0-11 | Anamika | CLD-03 |
| CON-03 | Console login and session foundation | P0-11 | Anamika | CLD-01, CLD-03 |
| CON-04 | Live occupancy board | P0-4 | Anamika | CLD-05 |
| CON-05 | Dashboard | P0-8 | Anamika | CLD-05 |
| CON-06 | Shift review and sign-off | P0-6 | Anamika | CLD-02, SYNC-02 |
| CON-07 | Conflicts inbox and resolutions | P0-12 | Anamika | SYNC-05 |
| CON-08 | Report templates and PDF/Excel render route | P0-9 | Anamika | CLD-05 |
| CON-09 | Overstay list and settings | P0-10 | Anamika | CLD-07 |
| CON-10 | Pilot health page | Handbook | Anamika | SYNC-06, CLD-04 |
| CON-11 | Seed data and partner demo | Handbook | Anamika | CLD-02 |
| CON-12 | Baseline time-and-motion study and ROI statements | Phase 2 plan | Anamika | none |
| CLD-01 | Supabase environments, secrets, region | Handbook | Akanksha | none |
| CLD-02 | Schema migrations (non-sync) and generated types | Handbook | Akanksha | SYNC-01 |
| CLD-03 | Row-level security, device auth, `enroll_device` | P0-11 | Akanksha | CLD-02 |
| CLD-04 | Heartbeat table and function | Handbook | Akanksha | CLD-02 |
| CLD-05 | KPI SQL views | P0-8 | Akanksha | CLD-02, SYNC-02 |
| CLD-06 | Report scheduler and email | P0-9 | Akanksha | CON-08 |
| CLD-07 | Overstay and stale-device alerts | P0-10 | Akanksha | CLD-02, SYNC-03 |
| CLD-08 | Retention, export and delete | PRD risk register | Akanksha | CLD-02 |
| CLD-09 | CI/CD pipelines | Handbook | Akanksha | REL-01 |
| CLD-10 | Monitoring, backups and restore drill | Handbook | Akanksha | CLD-01 |
| MET-01 | Twice-weekly physical occupancy audits | Phase 2 plan E3 | Akanksha | GATE-08, CON-04 |
| MET-02 | Adherence checks | Phase 2 plan E4 | Akanksha | GATE-01 |
| MET-03 | Weekly metrics pack | Phase 2 plan | Akanksha | MET-01, MET-02, CON-10 |

## 4. Cross-team dependency matrix

Rows depend on columns. Cell shows the feature IDs consumed.

| Consumer \ Provider | Afzal | Nikhil | Anamika | Akanksha |
| --- | --- | --- | --- | --- |
| Afzal | | `GATE-01/02` for SYNC-07 | `CON-12` for PRT-01 | `CLD-02/03/04` |
| Nikhil | `SYNC-01/03/04/06` | | `CON-02` (enrollment QR) | `CLD-03` (`enroll_device`, staff PIN hashes) |
| Anamika | `SYNC-05/06` | `GATE-03` (fare function) | | `CLD-02/03/05/07` |
| Akanksha | `SYNC-01/02/05` (migrations to deploy) | `GATE-08` for MET-01 | `CON-08` (render route) | |

## 5. Integration contracts

All signatures below are **Recommended (does not exist yet)** unless marked. Each contract has an owner, and a contract test listed in the owner's sheet.

| ID | Contract | Provider | Consumers | Content |
| --- | --- | --- | --- | --- |
| IC-01 | Event schemas | Afzal (`packages/contracts`) | all | zod union of `ENTRY`, `EXIT`, `PAYMENT`, `OVERRIDE`, `ZONE_COUNT`, `SHIFT_OPEN`, `SHIFT_CLOSE`; UUIDv7 ids; `device_time` UTC ISO 8601; money in integer paise. Event types specified in Handbook. |
| IC-02 | Sync client API | Afzal (`packages/sync-rules`) | Nikhil | `writeEvent(event)`, `observeOccupancy(facilityId)`, `health()` returning queue depth, oldest unsynced age, last sync, online flag |
| IC-03 | Ingest function | Afzal writes, Akanksha deploys | gate app via sync package | `ingest_events(events jsonb)`, idempotent on event id, rejects unknown or inactive staff into quarantine |
| IC-04 | Fare function and tariff rule JSON | Nikhil (`packages/domain`) | Anamika | `fare(tariff, entryAt, exitAt, vehicleClass) -> paise`; rule fields: grace minutes, hourly slabs, flat, day cap, night rate, effective date |
| IC-05 | Device enrollment | Akanksha (`enroll_device`) | Anamika (QR screen), Nikhil (scan) | One-time code valid 10 minutes returns device credentials with `org_id`, `facility_id`, `device_id` claims |
| IC-06 | Staff PIN hashes | Akanksha (`staff` table), Anamika (set PIN UI) | Nikhil | Salted hash only; synced to enrolled devices of that facility |
| IC-07 | KPI views | Akanksha | Anamika | `v_daily_kpis`, `v_zone_now`, `v_hourly` (names specified in Handbook) |
| IC-08 | Report render route | Anamika | Akanksha | `GET /api/reports/{daily|weekly|monthly}?facility=...` with a shared secret, returns PDF and Excel |
| IC-09 | Heartbeat | Akanksha (`heartbeat(...)`), Afzal sender | Anamika health page | device id, queue depth, oldest unsynced age, app version, schema version, battery |
| IC-10 | Conflict records | Afzal (`sync_conflicts`) | Anamika (resolve UI) | types `DUPLICATE_EXIT`, `ORPHAN_EXIT`, `DUPLICATE_ENTRY`, `CLOCK_SKEW`; resolutions written to `conflict_resolutions` by Console |

## 6. Implementation sequence and parallelism

Ordering is by dependency, not by date. Items in the same wave can run in parallel.

| Wave | Work | Waits for |
| --- | --- | --- |
| 0 | REL-01 repo scaffold; SYNC-01 contracts; CLD-01 environments; CON-12 baseline study starts | nothing |
| 1 | CLD-02 schema; SYNC-02 ingest; CLD-09 CI; CON-03 login; GATE-12 app shell; GATE-03 fare engine | Wave 0 |
| 2 | CLD-03 RLS and enrollment; SYNC-03 download sync (including the PowerSync decision); GATE-09 login and enrollment; CON-02 staff and devices; CON-01 wizard | Wave 1 |
| 3 | GATE-01 entry; GATE-02 exit; GATE-04 payments; GATE-10 printer; SYNC-04 occupancy; SYNC-05 conflicts | Wave 2 |
| 4 | GATE-05 passes; GATE-06 shift; GATE-07 overrides; GATE-08 zone counts; GATE-11 backfill; CLD-05 views; CON-04/05/06/07 | Wave 3 |
| 5 | CON-08 report templates; CLD-06 scheduler; CLD-07 alerts; CON-09 overstay; SYNC-06 health; CLD-04 heartbeat; CON-10; CON-11 seed | Wave 4 |
| 6 | SYNC-07 simulation; RLS test suite; restore drill; usability tests; load test; CLD-08 export and delete; CLD-10 monitoring | Wave 5 |
| 7 | Dry run at a real facility; PRT-01 pilot agreements; MET-01/02/03 begin | Wave 6 |

**Critical path:** SYNC-01 → CLD-02 → SYNC-02/03 → GATE-01/02 → SYNC-07 6-hour test → dry run. The fare engine (GATE-03) must exist before the wizard's "try it" panel and before GATE-02.

## 7. Milestones and completion gates

The Phase 2 plan sets three gates: W6 "MVP running offline end to end on a phone", W10 "one facility live with real vehicles", W15 "at least one signed paid contract". On 24 Oct 2026 the plan was in week 5 of 18 (started 22 Sep 2026) and **no code existed**. The W6 gate is therefore at high risk. The team lead should decide in OQ-24 whether to move the gates or cut scope per the plan's pre-agreed W6 fallback (manual exports for reports and multi-site).

| Gate | Condition | Evidence |
| --- | --- | --- |
| G1 Foundations | Repo, CI, schema, contracts merged; empty apps build | CI green on `main` |
| G2 Offline loop | Entry and exit work in airplane mode on the test phone and sync | SYNC-07 short run report |
| G3 Console loop | Setup wizard to dashboard to report works on seed and real data | CON-01/05/08 test evidence |
| G4 Pilot-ready | All items of the Pilot-Readiness Gate in the Handbook | Section 11 below, signed by Afzal |
| G5 Live | First facility in primary stage with no critical incident for 5 days | Phase 2 pilot protocol evidence |

## 8. Shared resources and ownership

| Resource | Owner | Change rule |
| --- | --- | --- |
| `packages/contracts` | Afzal | PR approved by all four |
| `packages/sync-rules` | Afzal | Nikhil reviews API changes |
| `packages/domain` (`fare.ts`) | Nikhil | Anamika reviews |
| `supabase/migrations` | Akanksha (sync migrations written by Afzal) | One file per change, never edited after merge; Afzal reviews anything touching `events` |
| `supabase/functions`, RLS | Akanksha | Afzal reviews permission changes |
| `apps/gate` | Nikhil | Afzal reviews sync, permission and payment code |
| `apps/console` | Anamika | Akanksha reviews anything touching views or RLS |
| `.github/workflows` | Akanksha | Afzal approves |
| `CLAUDE.md` | Afzal | PR approved by all four |

## 9. Testing and review strategy

- Every feature has unit, integration, end-to-end, negative, regression and, where relevant, non-functional tests, specified in the owner's sheet with IDs of the form `T-<FeatureID>-<kind><n>` (kinds: U unit, I integration, E end-to-end, N negative, R regression, X non-functional).
- Money, sync, permission and shift-close code is not merged without tests that a human has read.
- Every pull request needs green CI and one approval from a member of a different workstream.
- AI-generated code and tests are treated as drafts: the author runs them, reads them, and records the command and result as evidence.
- Test commands cannot be established from the repository because none exists; each sheet states the recommended commands and marks them **to be confirmed once scaffolded**.

## 10. Integration and regression strategy

- Contract tests (one per IC-xx) run in CI on every pull request that touches either side.
- After each wave, the whole earlier suite re-runs; a failing earlier test blocks merging.
- Cross-workstream end-to-end flows to keep green from Wave 3 on: enroll device → login → open shift → entry → exit → sync → dashboard → shift close → report.
- There is no existing MVP functionality to preserve; regression sections in the sheets therefore mean "tests from earlier waves".

## 11. Risks, blockers and mitigations

| ID | Risk | Mitigation |
| --- | --- | --- |
| R-01 | No code at week 5 while the W6 gate requires an offline MVP | Decide gate move or cut (OQ-24); freeze scope to the 12 P0 items |
| R-02 | Offline sync is unproven (PowerSync fit unknown) | SYNC-03 spike with a go/no-go on the duplicate-exit and 6-hour tests, then fallback outbox |
| R-03 | UPI attested by guard is not independently verifiable | Variance flag at shift close; MET-02 spot checks; revisit dynamic QR after pilot (OQ-05) |
| R-04 | Heavy reliance on AI-generated code without review | Review and test rules in section 9 |
| R-05 | Four members, coursework, no recorded weekly hours | Capture hours (OQ-17) before estimating |
| R-06 | Partners run incumbent systems (for example Park+) with unknown exports | Shadow-run design; ask for CSV export at kickoff (OQ-06) |
| R-07 | Production backups may need a paid plan | Verify tier or schedule `pg_dump` (OQ-07) |
| R-08 | Product name inconsistent across documents | Decide one name (OQ-08) before partner material goes out |

## 12. Final release-readiness checklist (pilot-ready)

- [ ] Every feature in section 3 has status "Implemented and verified" in `feature-traceability.md`, with evidence links.
- [ ] 6-hour offline test, 300 vehicles, two phones: zero lost or duplicated sessions (SYNC-07).
- [ ] Median entry under 8 seconds and 4 taps on a low-cost test phone, airplane mode (GATE-01).
- [ ] A non-technical person configures a facility in under 45 minutes unaided (CON-01).
- [ ] Permission matrix test green; a guard device cannot read another facility's data (CLD-03).
- [ ] Backup restore drill completed once; alerts reach a named person (CLD-10).
- [ ] Fare calculator matches between gate app and Console on the shared case table (GATE-03, CON-01).
- [ ] Reports render and email for seed data and for the dry-run facility (CON-08, CLD-06).
- [ ] Paper fallback sheet printed for every gate.
- [ ] Open questions OQ-01 to OQ-08 resolved or consciously accepted.
- [ ] One dry run at a real facility with the shadow-run protocol, signed off by Afzal.

## 13. Open questions

See [open-questions-and-assumptions.md](open-questions-and-assumptions.md).

## 14. Validation record and known gaps (24 Oct 2026)

Checks that were run (scripted, structural):

- Four individual sheets exist, one per member; each assigned feature ID from section 3 has its own headings in the owner's sheet (46 of 46 features).
- Each sheet has sections A to J (Akanksha's also has a short section K listing its own gaps).
- 422 test cases are specified across the sheets; every feature has at least 3 (PRT-01, MET-02 and MET-03 have 3; CLD-01 and MET-01 have 4). `feature-traceability.md` computes its counts from the sheets.
- No sheet states that a test has passed. Every status is "Not implemented".
- Open-question numbers cited in the sheets (OQ-01 to OQ-27) all exist in `open-questions-and-assumptions.md`, which also defines OQ-28 to OQ-32 for points the sheets mention by name.

Known gaps and limits:

- The sheets were drafted in parallel by separate passes and then checked by script and by spot reads; they have **not** been read line by line for contradictions. Treat the first full read by each owner as a review step.
- `PAYMENT_CORRECTION` appears only in Nikhil's sheet; it is not yet in the contracts defined for SYNC-01 (OQ-30). Add it before GATE-04 starts.
- Sheets mark some behaviour as Recommended where the Handbook did not specify it (for example `sync_conflicts` columns, `ingest_events` result codes, `enrollment_codes`, `alert_log`). These need the owners' agreement before coding.
- The occupancy definition in SYNC-04 (`occupancy.ts`) and in CLD-05 (`v_zone_now`) must be agreed in writing (see the traceability file).
- Test commands are recommendations only; no repository exists to establish real ones.
- The Handbook and PRD for design partners live as Claude Docs in this project, not as files in this folder.
