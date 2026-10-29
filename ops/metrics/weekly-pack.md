# Weekly pilot metrics pack

Week: TODO (state the window, for example Mon 2026-11-02 to Sun 2026-11-08)
Prepared by: TODO
Reviewed by Afzal on: TODO

Every figure names its source (view, table or sheet) and its time window. If a figure is not available write
`Missing: <reason>` instead of leaving it empty. Check completeness with `checkPackCompleteness` in
`pilot-metrics.mjs`.

## 1. Facility status

TODO: stage (shadow, primary, unassisted), days live, critical incidents. Source: pilot log.

## 2. Occupancy accuracy

TODO: zone and facility accuracy and pass-bar status (95% zone, 97% facility, last two weeks). Source: `audit-sheet.csv` (MET-01).

## 3. Adherence

TODO: adherence percentage and bypass reasons. Source: `adherence-sheet.csv` (MET-02).

## 4. Sync health

TODO: queue depth, oldest unsynced age, sync latency p95, quarantined events, devices on an old schema. Source: `device_heartbeats` and the health page (CON-10).

## 5. Conflicts

TODO: count by type and unresolved over 24 hours. Source: `sync_conflicts`.

## 6. Overrides

TODO: overrides per 100 vehicles, by reason code. Source: `v_daily_kpis`.

## 7. Reports

TODO: delivered, bounced and failed. Source: `job_runs` and Resend.

## 8. Cloud

TODO: uptime against 99.5%, job failures, database size, bill. Source: Supabase dashboard.

## 9. Open issues

TODO: owner, severity, next action.

## 10. Decisions needed from Afzal

TODO: list, or "None this week".
