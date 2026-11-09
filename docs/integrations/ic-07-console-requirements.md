# IC-07 KPI views: what the Console needs (Anamika)

Status: **proposal for agreement with Akanksha** (CLD-05). IC-07 says "column names are the contract; changing one
requires Anamika's approval" (`docs/team/member-04-akanksha.md:249`). This page records what the Console code needs
today, where the two team sheets disagree, and which points are open. It does not change any view.

Labels: **Confirmed** = written in a team sheet or in code on `main`. **Assumption** = a reasonable reading that is
not written down. **Open** = needs a decision (see OQ-45 to OQ-48 in `docs/team/open-questions-and-assumptions.md`).
Both team sheets mark their column lists `(R)`, meaning recommended and not agreed.

## 1. Revenue columns

What the Console consumes:

- The report model needs three amounts in integer paise: cash, UPI declared and pass
  (`apps/console/src/lib/reports/model.ts:33-37`, `RevenueByMode`). The Reports screen lists the same three
  (`apps/console/src/components/ReportsView.tsx:31`; sheet `docs/team/member-03-anamika.md:262`).
- The dashboard needs one declared-revenue figure (`member-03-anamika.md:221`) with a label saying UPI is guard-attested
  (`member-03-anamika.md:225`, OQ-05).

What the two sheets list for `v_daily_kpis`:

| Need           | Anamika sheet (`member-03-anamika.md:224`) | Akanksha sheet (`member-04-akanksha.md:243`) |
| -------------- | ------------------------------------------ | -------------------------------------------- |
| Date column    | `day`                                      | `local_date`                                 |
| Total declared | `revenue_declared_paise`                   | `declared_revenue_paise`                     |
| Cash           | `revenue_cash_paise`                       | `cash_paise`                                 |
| UPI            | `revenue_upi_attested_paise`               | `upi_attested_paise`                         |
| Pass           | none                                       | `pass_count` (a count, not money)            |

Findings:

- **Confirmed:** no list contains pass **revenue** in paise. A count cannot fill `RevenueByMode.pass`. The Console needs
  a pass amount column.
- **Confirmed:** the payment event has four modes, `CASH`, `UPI`, `PASS`, `WAIVED`, plus a boolean `upi_attested` that is
  only valid with `UPI` (`packages/contracts/src/events.ts:72-82`). Shift close carries `upi_total_declared_paise` and
  `upi_attested_sum_paise` as two different figures (`docs/integrations/event-envelope.md:43`).
- **Resolved (OQ-45, Afzal, 8 Nov 2026):** use the explicit columns below. Background: the repository never defined "declared revenue". Deriving UPI as total declared minus cash is only
  correct if total declared means cash + UPI + pass, with `WAIVED` excluded. It is also unclear whether "UPI declared"
  (all `UPI` payments) and "UPI attested" (only those with `upi_attested = true`) are the same figure. Because of
  these gaps, **do not derive**; ask for explicit columns computed from `PAYMENT` events.
- **Agreed columns:** `cash_paise`, `upi_paise`, `pass_paise`, and `declared_total_paise` defined as their sum, all
  computed from `PAYMENT` events, non-negative integers, zero for an empty day (`member-04-akanksha.md:253`, "Empty
  facility returns zero rows or zero values"). No derived or subtraction columns. The view's date column name is still
  to be set by Akanksha.

## 2. Overstay

- **Threshold unit:** the CON-09 behaviour text says "hours" (`member-03-anamika.md:275`), but the rule says "at least 30
  minutes" (`:278`) and the storage name is `overstay_minutes_by_class` (`:276`). Akanksha's sheet says a positive
  integer `overstay_threshold_minutes` (`member-04-akanksha.md:265`, `:275`). The Console code uses whole minutes with a
  minimum of 30 (`apps/console/src/lib/overstay.ts`). **Assumption:** minutes. Hours are display only.
- **Per class or per facility:** Anamika's sheet says one threshold per vehicle class with a facility default
  (`member-03-anamika.md:278`); Akanksha's sheet has one column on `facilities` (`member-04-akanksha.md:265`).
  **Resolved (OQ-46):** one threshold per facility for now; per vehicle class is a later version.
- **Boundary:** the CON-09 text says "past threshold" (`member-03-anamika.md:275`). The CLD-07 test expects sessions of
  239, 240 and 241 minutes at a 240 threshold to select "240+", and adds "decide and document"
  (`member-04-akanksha.md:462`). The Console code uses **at or over** (age >= threshold), with age as whole minutes
  rounded down. **Resolved (OQ-46):** at or over.
- **Exclusions:** passes are excluded and exited sessions never appear (`member-03-anamika.md:278`). `open_sessions`
  (migration 0005, now on `main`) has `entry_time` and `pass_id`, so "no `pass_id`"
  is the natural filter. **Assumption.**
- **Output values:** the list shows token, class, entry time and age (`member-03-anamika.md:275`). No status enumeration
  is written down for overstay; the Console shows none beyond the list.
- **Default threshold:** no default is written down (the test table uses 240 minutes as an example only). **Open.**

## 3. Opening hours

- **Confirmed (as written, still marked recommended):** missing configuration means always open, and the setup wizard
  should flag it (`member-04-akanksha.md:275`). A facility closed overnight gets no stale-device alerts (`:278`). Hours are
  judged in facility local time (`member-04-akanksha.md:269`). The stale rule is checked inside and outside hours
  (`:464`).
- **Timezone:** `facilities.timezone` is an IANA name (`supabase/migrations/0001_org_facility_zone_tariff_pass.sql:16`),
  and the Console wizard defaults to `Asia/Kolkata` (`member-03-anamika.md:148`).
- **Open (OQ-47):** where hours are stored and their shape. Akanksha expects columns on `facilities`
  (`member-04-akanksha.md:265`); Anamika says the health page uses "facility shift config" (`member-03-anamika.md:289`);
  migration 0001 has neither. Whether a window may cross midnight, and how closed days are written, are not specified.
  The wizard lists "operating hours" in step 1 (`member-03-anamika.md:148`) but cannot store them until the shape is set.

## 4. Alert delivery (CLD-07)

All of this is Akanksha's recommended design, none of it built:

- **Jobs:** overstay and stale-device checks every 10 minutes through `pg_cron`, logged in `job_runs`
  (`member-04-akanksha.md:264`, `:271`).
- **Delivery:** email through Resend; SMS or WhatsApp is an add-on outside the base build (`:270`).
- **Idempotency:** `alert_log(id, kind, facility_id, subject_id, sent_at)` with a unique `(kind, subject_id)` for overstay;
  insert with `on conflict do nothing` and send only for new rows (`:267-268`). Exactly one overstay message per session
  (`:276`). A threshold change applies to new evaluations only (`:278`).
- **Failure:** a failed mail leaves the row unsent (status column, recommended) and retries on later runs "up to a cap",
  then raises an operational alert (`:277`).
- **What the Console shows:** the Console only configures and displays; alerts are sent by CLD-07
  (`member-03-anamika.md:275`). The health page reads stale markers (`member-04-akanksha.md:274`) and the dashboard
  exceptions list includes stale devices (`member-03-anamika.md:223`).
- **Open (OQ-48):** the retry cap, the status values of an alert row, who receives the email (the report recipient table
  is for reports only), and how a stale marker or alert row is exposed to the Console.

## 5. Other column differences to settle

| View         | Anamika sheet                                                                | Akanksha sheet                                                   |
| ------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `v_hourly`   | `hour_start, entries, exits` (`member-03-anamika.md:224`)                    | `local_date, hour, entries, exits` (`member-04-akanksha.md:244`) |
| `v_zone_now` | `zone_id, zone_name, capacity, occupied, as_of` (`member-03-anamika.md:210`) | same plus `facility_id` (`member-04-akanksha.md:244`)            |

The report also needs overrides by reason code and average-stay distribution, which neither list covers; the sheet
expects separate `v_report_*` views (`member-03-anamika.md:263`).
