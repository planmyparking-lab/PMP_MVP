# Alert catalog (CLD-10)

**Status: catalog only. No alert below is wired, and none has been fire-tested** (T-CLD-10-I1..I3 are not run).
Thresholds come from `docs/team/member-04-akanksha.md` section C CLD-10; recipients and tools are not decided.
An alert is not "done" until a deliberately induced failure has reached a named human.

| Alert                                 | Source                                              | Threshold                                       | Recipient                 | Runbook                  | Wired | Fire-tested |
| ------------------------------------- | --------------------------------------------------- | ----------------------------------------------- | ------------------------- | ------------------------ | ----- | ----------- |
| Console health check failing          | Uptime monitor on `/api/health` (not built)         | 2 consecutive failures                          | on-call (TBD)             | [runbook.md](runbook.md) | No    | No          |
| Scheduled job failed                  | `job_runs` table (not created yet; CLD-07 / CLD-08) | any `failed` run, or retry cap reached          | on-call (TBD)             | runbook                  | No    | No          |
| Report email failed or bounced        | Resend webhook (CLD-06, Anamika)                    | any failure or bounce                           | on-call (TBD)             | runbook                  | No    | No          |
| Database size                         | Supabase usage                                      | 70% of plan limit                               | on-call (TBD)             | runbook                  | No    | No          |
| Stale device                          | `stale_devices` job (CLD-07, blocked)               | no heartbeat for 30 minutes while facility open | facility manager and team | runbook                  | No    | No          |
| Function error spike                  | Sentry (functions project)                          | threshold TBD                                   | on-call (TBD)             | runbook                  | No    | No          |
| Backup failed or restore drill failed | backup job / drill log                              | any failure                                     | on-call (TBD)             | [runbook.md](runbook.md) | No    | No          |

Rules still to decide with the team: silence rules must carry an expiry; flapping is handled by requiring 2
consecutive failures; if the alert channel itself is down a secondary channel (SMS or call to the lead) is needed;
escalate to Afzal if the on-call person does not respond within a time to be recorded in the runbook.
