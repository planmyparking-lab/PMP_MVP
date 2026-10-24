# Feature Traceability Matrix

Prepared 24 Oct 2026. Companion to [README.md](README.md). Chain: product requirement → feature ID → owner → implementation location → acceptance criteria → test cases → verification status.

**Reality check.** The repository contains no code. Every implementation location is **Recommended (does not exist yet)** and every verification status is **Not verified**. A test ID listed here means the test is *specified* in the owner's sheet, not that a test file exists or has run. Test counts are computed from the sheets (kinds: U unit, I integration, E end-to-end, N negative, R regression, X non-functional).

## 1. Matrix

| Requirement source | Feature ID | Feature | Owner | Implementation location (Recommended) | Acceptance criteria | Test cases (specified) | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Handbook shared contracts; PRD FR-04, FR-55 (event record) | SYNC-01 | Contracts package | Afzal | `packages/contracts/src/*` | `member-01-afzal.md` sections B and E | `T-SYNC-01-*`: 11 (U7, I2, N1, R1) | Not verified |
| P0-12; PRD FR-44, FR-45 | SYNC-02 | Outbox and idempotent ingest | Afzal | `packages/sync-rules/src/connector.ts`, `supabase/migrations/0004_events_ingest.sql` | `member-01-afzal.md` sections B and E | `T-SYNC-02-*`: 14 (U2, I5, E1, N3, R1, X2) | Not verified |
| P0-12; PRD FR-44 | SYNC-03 | Download sync and PowerSync decision | Afzal | `packages/sync-rules/src/powersync.yaml`, `schema.ts` | `member-01-afzal.md` sections B and E | `T-SYNC-03-*`: 11 (I5, E1, N3, X2) | Not verified |
| P0-4; PRD FR-09 | SYNC-04 | Occupancy computation | Afzal | `packages/sync-rules/src/occupancy.ts` | `member-01-afzal.md` sections B and E | `T-SYNC-04-*`: 13 (U8, I1, E1, N2, R1) | Not verified |
| P0-12; PRD FR-46, FR-22 (partial) | SYNC-05 | Conflict detection | Afzal | `supabase/migrations/0006_conflict_detector.sql`, `conflicts.ts` | `member-01-afzal.md` sections B and E | `T-SYNC-05-*`: 11 (I6, E1, N3, X1) | Not verified |
| P0-12; PRD FR-47, FR-42 (partial) | SYNC-06 | Sync health, heartbeat sender, quarantine | Afzal | `packages/sync-rules/src/health.ts` | `member-01-afzal.md` sections B and E | `T-SYNC-06-*`: 10 (U4, I3, E1, N2) | Not verified |
| P0-12 evidence; PRD 9.6 offline target | SYNC-07 | Simulation harness | Afzal | `tools/sim/` | `member-01-afzal.md` sections B and E | `T-SYNC-07-*`: 7 (U2, I1, E2, N1, X1) | Not verified |
| Handbook; PRD 11.2 DevOps (simplified) | REL-01 | Monorepo, rules, release | Afzal | repo root, `CLAUDE.md`, branch protection | `member-01-afzal.md` sections B and E | `T-REL-01-*`: 5 (I2, E2, N1) | Not verified |
| Phase 2 plan section 8, E7 | PRT-01 | Partner pipeline and pilot agreements | Afzal | outside code: CRM, pilot term sheet | `member-01-afzal.md` sections B and E | `T-PRT-01-*`: 3 (U2, N1) | Not verified |
| P0-2; PRD FR-02, FR-04, FR-06 (FR-01 ANPR excluded) | GATE-01 | Vehicle entry | Nikhil | `apps/gate/app/entry.tsx`, `src/data/writeEvent.ts`, `src/domain/token.ts` | `member-02-nikhil.md` sections B and E | `T-GATE-01-*`: 20 (U6, I3, E2, N5, R1, X3) | Not verified |
| P0-3; PRD FR-16 | GATE-02 | Vehicle exit, lost token | Nikhil | `apps/gate/app/exit.tsx` | `member-02-nikhil.md` sections B and E | `T-GATE-02-*`: 18 (U4, I2, E4, N5, R1, X2) | Not verified |
| P0-3; PRD FR-16, FR-20 (time tiers only) | GATE-03 | Fare engine | Nikhil | `packages/domain/fare.ts` | `member-02-nikhil.md` sections B and E | `T-GATE-03-*`: 13 (U8, I2, N1, R1, X1) | Not verified |
| P0-3; PRD FR-17 (recorded, not processed) | GATE-04 | Payment recording, UPI attestation | Nikhil | `apps/gate/src/domain/payment.ts` | `member-02-nikhil.md` sections B and E | `T-GATE-04-*`: 12 (U3, I2, E2, N3, R1, X1) | Not verified |
| P0-5; PRD FR-51 (partial) | GATE-05 | Monthly pass validation | Nikhil | `apps/gate/app/pass.tsx` | `member-02-nikhil.md` sections B and E | `T-GATE-05-*`: 8 (U2, I1, E1, N3, R1) | Not verified |
| P0-6; PRD FR-21 | GATE-06 | Shift open and close (guard) | Nikhil | `apps/gate/app/shift/*` | `member-02-nikhil.md` sections B and E | `T-GATE-06-*`: 12 (U3, I2, E1, N4, R1, X1) | Not verified |
| P0-7; PRD FR-06, FR-30 | GATE-07 | Override flow | Nikhil | `apps/gate/app/override.tsx` | `member-02-nikhil.md` sections B and E | `T-GATE-07-*`: 8 (U2, I1, E1, N3, R1) | Not verified |
| P0-4; Phase 2 plan drift correction | GATE-08 | Zone count entry | Nikhil | `apps/gate/app/zone-count.tsx` | `member-02-nikhil.md` sections B and E | `T-GATE-08-*`: 7 (U2, I1, E1, N2, R1) | Not verified |
| P0-11; PRD FR-48, 11.1 offline auth | GATE-09 | PIN login, offline auth, enrollment | Nikhil | `apps/gate/app/(auth)/*`, `src/auth/pinAuth.ts` | `member-02-nikhil.md` sections B and E | `T-GATE-09-*`: 16 (U6, I2, E1, N5, R1, X1) | Not verified |
| P0-2; PRD FR-02 | GATE-10 | Printer, QR, fallback | Nikhil | `apps/gate/src/print/escpos.ts` | `member-02-nikhil.md` sections B and E | `T-GATE-10-*`: 10 (U2, I1, E2, N3, R1, X1) | Not verified |
| Handbook; PRD 9.5 graceful degradation | GATE-11 | Paper backfill | Nikhil | `apps/gate/app/backfill.tsx` | `member-02-nikhil.md` sections B and E | `T-GATE-11-*`: 7 (U2, I1, E1, N2, R1) | Not verified |
| Handbook; Phase 2 plan Hindi and English | GATE-12 | App shell, i18n, diagnostics | Nikhil | `apps/gate/app/status.tsx`, `src/i18n/*` | `member-02-nikhil.md` sections B and E | `T-GATE-12-*`: 12 (U3, I1, E2, N2, R1, X3) | Not verified |
| P0-1; PRD FR-49 | CON-01 | Setup wizard, tariff editor | Anamika | `apps/console/app/setup/*`, `settings/tariffs` | `member-03-anamika.md` sections B and E | `T-CON-01-*`: 18 (U5, I4, E2, N4, R1, X2) | Not verified |
| P0-11; PRD FR-27, FR-48, FR-53 (blocklist excluded) | CON-02 | Staff, devices, roles, site switcher | Anamika | `apps/console/app/[facilityId]/settings/*` | `member-03-anamika.md` sections B and E | `T-CON-02-*`: 15 (U2, I5, E2, N4, R1, X1) | Not verified |
| P0-11; PRD FR-48 | CON-03 | Console login and session | Anamika | `apps/console/app/(auth)/login` | `member-03-anamika.md` sections B and E | `T-CON-03-*`: 7 (U1, I1, E1, N3, X1) | Not verified |
| P0-4; PRD FR-23 | CON-04 | Occupancy board | Anamika | `apps/console/app/[facilityId]/occupancy` | `member-03-anamika.md` sections B and E | `T-CON-04-*`: 8 (U1, I2, E2, N1, X2) | Not verified |
| P0-8; PRD FR-23, FR-24, FR-25 | CON-05 | Dashboard | Anamika | `apps/console/app/[facilityId]/page.tsx` | `member-03-anamika.md` sections B and E | `T-CON-05-*`: 10 (U2, I2, E1, N2, R1, X2) | Not verified |
| P0-6; PRD FR-21 | CON-06 | Shift review and sign-off | Anamika | `apps/console/app/[facilityId]/shifts/*` | `member-03-anamika.md` sections B and E | `T-CON-06-*`: 8 (U1, I2, E1, N4) | Not verified |
| P0-12; PRD FR-46 | CON-07 | Conflicts inbox | Anamika | `apps/console/app/[facilityId]/conflicts` | `member-03-anamika.md` sections B and E | `T-CON-07-*`: 8 (I3, E1, N3, R1) | Not verified |
| P0-9; PRD FR-24, FR-25, FR-26, FR-28 | CON-08 | Report templates and render route | Anamika | `apps/console/src/reports/templates/*`, `app/api/reports/[type]/route.ts` | `member-03-anamika.md` sections B and E | `T-CON-08-*`: 11 (U1, I3, E1, N4, X2) | Not verified |
| P0-10 (Phase 2 plan; no PRD FR) | CON-09 | Overstay list and settings | Anamika | `apps/console/app/[facilityId]/overstay` | `member-03-anamika.md` sections B and E | `T-CON-09-*`: 6 (U1, I2, E1, N2) | Not verified |
| Handbook; PRD FR-50 (partial) | CON-10 | Pilot health page | Anamika | `apps/console/app/[facilityId]/health` | `member-03-anamika.md` sections B and E | `T-CON-10-*`: 6 (U1, I1, E1, N2, R1) | Not verified |
| Handbook; Phase 2 plan clickable prototype | CON-11 | Seed data and demo | Anamika | `supabase/seed.sql` | `member-03-anamika.md` sections B and E | `T-CON-11-*`: 5 (I3, E1, N1) | Not verified |
| Phase 2 plan E1, E2 | CON-12 | Baseline study and ROI | Anamika | field templates in `doc/` (Recommended) | `member-03-anamika.md` sections B and E | `T-CON-12-*`: 6 (U1, I2, E1, N1, R1) | Not verified |
| Handbook; PRD 9.9 | CLD-01 | Environments and secrets | Akanksha | Supabase projects, GitHub environments | `member-04-akanksha.md` sections B and E | `T-CLD-01-*`: 4 (U1, I1, N1, X1) | Not verified |
| Handbook; PRD ch.8 data needs | CLD-02 | Schema migrations | Akanksha | `supabase/migrations/0001..0003, 0007..0011` | `member-04-akanksha.md` sections B and E | `T-CLD-02-*`: 7 (U2, I2, N1, R1, X1) | Not verified |
| P0-11; PRD FR-48, 9.3 security, 9.4 multi-tenant | CLD-03 | RLS, device auth, enroll_device | Akanksha | `supabase/migrations`, `supabase/functions/enroll_device` | `member-04-akanksha.md` sections B and E | `T-CLD-03-*`: 16 (U2, I4, E1, N6, R1, X2) | Not verified |
| Handbook; PRD FR-42, FR-50 (partial) | CLD-04 | Heartbeat | Akanksha | `supabase/migrations/0008_device_heartbeats.sql` | `member-04-akanksha.md` sections B and E | `T-CLD-04-*`: 5 (U1, I1, N2, X1) | Not verified |
| P0-8; PRD FR-24, FR-25 | CLD-05 | KPI views | Akanksha | `supabase/migrations/0009_views_kpis.sql` | `member-04-akanksha.md` sections B and E | `T-CLD-05-*`: 8 (U3, I2, N1, R1, X1) | Not verified |
| P0-9; PRD FR-28 | CLD-06 | Report scheduler and email | Anamika | `pg_cron` jobs, `reports` bucket, Resend | `member-03-anamika.md` sections B and E | `T-CLD-06-*`: 10 (U1, I3, E1, N3, X2) | Not verified |
| P0-10; PRD FR-29 (partial), FR-42 (partial) | CLD-07 | Overstay and stale-device alerts | Akanksha | `pg_cron` jobs, functions | `member-04-akanksha.md` sections B and E | `T-CLD-07-*`: 7 (U3, I2, N1, X1) | Not verified |
| PRD FR-56, 15.1 legal risk | CLD-08 | Retention, export, delete | Akanksha | `supabase/migrations/0011`, `data_export` | `member-04-akanksha.md` sections B and E | `T-CLD-08-*`: 7 (I3, N3, X1) | Not verified |
| Handbook; PRD 11.2 DevOps (simplified) | CLD-09 | CI/CD | Akanksha | `.github/workflows/*` | `member-04-akanksha.md` sections B and E | `T-CLD-09-*`: 6 (I3, N2, X1) | Not verified |
| PRD 9.2, 9.7 | CLD-10 | Monitoring, backups, restore drill | Akanksha | Sentry, uptime check, backup job | `member-04-akanksha.md` sections B and E | `T-CLD-10-*`: 6 (I3, E1, N1, X1) | Not verified |
| Phase 2 plan E3 | MET-01 | Physical occupancy audits | Anamika | recording sheet (Recommended) | `member-03-anamika.md` sections B and E | `T-MET-01-*`: 4 (U1, I1, N1, X1) | Not verified |
| Phase 2 plan E4 | MET-02 | Adherence checks | Anamika | recording sheet (Recommended) | `member-03-anamika.md` sections B and E | `T-MET-02-*`: 3 (U1, I1, N1) | Not verified |
| Phase 2 plan metrics section | MET-03 | Weekly metrics pack | Anamika | weekly document (Recommended) | `member-03-anamika.md` sections B and E | `T-MET-03-*`: 3 (U1, I1, N1) | Not verified |

Total specified test cases: **422**. Features: **46**.

## 2. Gap and conflict analysis

- **Features with no owner:** none. Every feature has exactly one primary owner (README section 3).
- **Features with duplicate or conflicting ownership:** none by ID. Three capabilities are split across owners with explicit boundaries and need agreement on one definition: (1) device enrollment: CON-02 (QR screen), CLD-03 (`enroll_device`), GATE-09 (scan); (2) occupancy: SYNC-04 (`occupancy.ts`) versus CLD-05 (`v_zone_now`) must use the same definition (see OQ-16); (3) fare: GATE-03 owns `fare.ts`, CON-01 imports it.
- **Features without any specified test:** none.
- **Features with fewer than 5 specified tests (review depth):** PRT-01 (3), CLD-01 (4), MET-01 (4), MET-02 (3), MET-03 (3).
- **Requirements without acceptance criteria:** none among the 12 P0 items; PRD requirements outside the MVP have no acceptance criteria in this plan by design (section 3).
- **Tests without a clear requirement:** none by construction; every test ID is prefixed by its feature ID. This was not independently audited test by test.
- **Dependencies without an assigned owner:** Hindi string review by a real guard (OQ-11); legal review of retention and consent text (OQ-12); procurement of the test phone, spare devices and thermal printers (OQ-15, OQ-31); access to partner facilities and rate cards (OQ-13, OQ-14); the incumbent system export question (OQ-06). These need a named person.
- **Existing MVP functionality to preserve:** none. No MVP code exists.
- **Verification status summary:** 0 of 46 features verified.

## 3. PRD v1.1 functional requirements not covered, or only partly covered, by the MVP

The PRD lists 56 functional requirements (FR-01 to FR-56). The MVP is the Phase 2 P0 list, so many are deliberately excluded. This table prevents silent loss.

| PRD requirement | Disposition | Covered by | Note |
| --- | --- | --- | --- |
| FR-01 ANPR plate read | Out of MVP scope | none | Optional adapter only if a partner already owns cameras (OQ-21) |
| FR-02 QR fallback entry | Covered | GATE-01, GATE-10 | QR token is the primary entry token in the MVP |
| FR-03 FASTag identification | Out of MVP scope | none | OQ-21 |
| FR-04 Log entry with zone | Covered | GATE-01, SYNC-01 | Zone suggestion; vehicle number optional (OQ-03, OQ-04) |
| FR-05 Two-wheeler plate model | Out of MVP scope | none | Needs ANPR |
| FR-06 Staff manual override | Covered | GATE-07 | Reason code required |
| FR-07 Detect vehicle class | Changed | GATE-01 | Guard selects class manually |
| FR-08 Blocklist | Deferred | none | Should-have in PRD, not in P0 |
| FR-09 Occupancy per zone | Covered | SYNC-04 | Derived from events |
| FR-10 Allocate by occupancy and class | Partly covered | GATE-01 | Zone suggestion only; no allocation engine (OQ-28) |
| FR-11 to FR-14 Reservations, visitor slots, emergency lane, truck zones | Deferred | none | Not in P0 |
| FR-15 EV slots | Deferred | none | Could-have |
| FR-16 Automatic fee | Covered | GATE-02, GATE-03 | OQ-20 |
| FR-17 UPI and card at exit | Changed | GATE-04 | Payment recorded, not processed; operator's own QR (OQ-05) |
| FR-18 FASTag payment | Out of MVP scope | none |  |
| FR-19 Digital receipt via app or SMS | Partly covered | GATE-10 | Printed or on-screen token only; no SMS receipt |
| FR-20 Time-of-day tiers | Partly covered | GATE-03 | Night rate and slabs; no demand pricing |
| FR-21 Automatic shift summary | Covered | GATE-06, CON-06 |  |
| FR-22 Flag billing discrepancies | Partly covered | SYNC-05, GATE-06 | Orphan exit and variance flags |
| FR-23 to FR-25 Dashboard and reports | Covered | CON-04, CON-05, CON-08 |  |
| FR-26 Peak-hour analytics | Covered | CON-08 | Peak heatmap in reports |
| FR-27 Multi-facility view | Covered | CON-02 |  |
| FR-28 Export CSV or PDF | Covered | CON-08, CLD-06 | PDF and Excel |
| FR-29 Capacity alerts to operators | Deferred | none | Not in P0; overstay alerts only (CLD-07) |
| FR-30 Log overrides with staff id | Covered | GATE-07 | Events carry `staff_id` |
| FR-31 to FR-36 AI prediction and pricing | Deferred | none | Needs 30+ days of data |
| FR-37 to FR-39 Find My Vehicle | Deferred | none | P1 only if a partner commits to signage |
| FR-40 to FR-41, FR-43 Driver notifications | Deferred | none |  |
| FR-42 Hardware failure alerts | Partly covered | CLD-07, SYNC-06 | Stale-device alert instead of hardware alerts |
| FR-44 to FR-47 Offline mode | Covered | SYNC-02 to SYNC-06, GATE-11 |  |
| FR-48 Role-based access | Covered | CLD-03, CON-02 |  |
| FR-49 Facility onboarding | Covered | CON-01 |  |
| FR-50 System health | Partly covered | CON-10, CLD-04 |  |
| FR-51 Resident whitelist | Partly covered | GATE-05 | Passes cover regular vehicles |
| FR-52 Admin audit log | Partly covered | CLD-02 | Events are append-only; no separate admin-change log specified yet |
| FR-53 Blocklist management | Deferred | none |  |
| FR-54 CCTV link | Out of MVP scope | none |  |
| FR-55 Tamper-evident audit trail | Covered | SYNC-01, CLD-03 | Append-only events, revoked update and delete |
| FR-56 Retention | Covered | CLD-08 | OQ-12 |

## 4. Phase 2 plan items traced

| Plan item | Feature IDs |
| --- | --- |
| P0-1 Facility setup | CON-01, CLD-02 |
| P0-2 Entry offline | GATE-01, GATE-10, GATE-12 |
| P0-3 Exit, fare, collection | GATE-02, GATE-03, GATE-04 |
| P0-4 Zone occupancy board | SYNC-04, CON-04, GATE-08, CLD-05 |
| P0-5 Monthly pass validation | GATE-05 |
| P0-6 Shift-close reconciliation | GATE-06, CON-06 |
| P0-7 Override logging | GATE-07 |
| P0-8 Console dashboard | CON-05, CLD-05 |
| P0-9 Automated reports | CON-08, CLD-06 |
| P0-10 Overstay flagging | CLD-07, CON-09 |
| P0-11 Roles and multi-site switcher | CLD-03, CON-02, CON-03, GATE-09 |
| P0-12 Sync integrity and conflict log | SYNC-02 to SYNC-07, CON-07 |
| E1/E2 baseline and ROI | CON-12 |
| E3 occupancy accuracy | MET-01 |
| E4 adherence | MET-02 |
| E7 pricing and day-30 meeting | PRT-01 |
