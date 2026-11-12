import Link from "next/link";
import type { ReactNode } from "react";
import { ACTIVITY_LIMIT, ACTIVITY_TYPES, ACTIVITY_WINDOW_DAYS } from "../lib/activity";
import type { ActivityLine } from "../lib/activity";
import type { ActivityLive } from "../lib/data/activity";
import { formatIstDateTime } from "../lib/format";
import { Banner, Card, EmptyState, PageHeader, StatusBadge } from "./ui/primitives";
import type { Tone } from "./ui/primitives";

const TYPE_LABEL: Record<ActivityLine["type"], string> = {
  ENTRY: "Entry",
  EXIT: "Exit",
  PAYMENT: "Payment",
  OVERRIDE: "Override",
  ZONE_COUNT: "Zone count",
  SHIFT_OPEN: "Shift open",
  SHIFT_CLOSE: "Shift close",
  UNKNOWN: "Unknown",
};

const TYPE_TONE: Record<ActivityLine["type"], Tone> = {
  ENTRY: "ok",
  EXIT: "info",
  PAYMENT: "ok",
  OVERRIDE: "warn",
  ZONE_COUNT: "info",
  SHIFT_OPEN: "off",
  SHIFT_CLOSE: "off",
  UNKNOWN: "bad",
};

function FilterTabs({ current }: { current: ActivityLive["filter"]["type"] }) {
  const tabs: { label: string; type: string | null }[] = [
    { label: "All", type: null },
    ...ACTIVITY_TYPES.map((t) => ({ label: TYPE_LABEL[t], type: t })),
  ];
  return (
    <nav className="tabs" aria-label="Filter by event type">
      {tabs.map((t) => (
        <Link
          key={t.label}
          href={t.type ? `/activity?type=${t.type.toLowerCase()}` : "/activity"}
          aria-current={current === t.type ? "page" : undefined}
          className="tab-link"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function ActivityView({
  live,
  liveStatus,
  reason,
}: {
  live?: ActivityLive;
  liveStatus?: ReactNode;
  reason?: string;
}) {
  const scoped = live && (live.filter.sessionId || live.filter.eventIds.length > 0);
  return (
    <>
      <PageHeader
        title="Activity"
        description={`Every entry, exit, payment, override, zone count and shift event from the gate phones${scoped ? "" : ` in the last ${ACTIVITY_WINDOW_DAYS} days`}, newest first. Number plates are never shown.`}
        actions={liveStatus ?? <StatusBadge tone="off">Live data disconnected</StatusBadge>}
      />

      {!live ? (
        <Card flush>
          <EmptyState icon="plugOff" title="Activity is not available">
            {reason ?? "Sign in to read the event log."}
          </EmptyState>
        </Card>
      ) : (
        <>
          {scoped && (
            <Banner tone="info" icon="info" title="Showing the events of one conflict or session">
              <Link href="/activity">Show all activity</Link>
            </Banner>
          )}
          {live.truncated && (
            <Banner tone="warn" icon="alert" title="Only the most recent events are shown">
              This page reads at most {ACTIVITY_LIMIT.toLocaleString("en-IN")} events. Use a type
              filter to see older ones of one kind.
            </Banner>
          )}
          <Card flush>
            <div style={{ padding: "var(--s-3) var(--s-5) 0" }}>
              <FilterTabs current={live.filter.type} />
            </div>
            {!live.lines.ok ? (
              <EmptyState icon="plugOff" title="Events could not be read">
                {live.lines.error}
              </EmptyState>
            ) : live.lines.data.length === 0 ? (
              <EmptyState icon="list" title="No events">
                Nothing matches this filter yet. Events appear once the gate phones sync.
              </EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Event</th>
                      <th>Details</th>
                      <th>Guard</th>
                      <th>Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.lines.data.map((l) => (
                      <tr key={l.id} className={l.attention ? "row-attention" : undefined}>
                        <td className="num">{formatIstDateTime(l.deviceTime)}</td>
                        <td className="nowrap">
                          <StatusBadge tone={l.valid ? TYPE_TONE[l.type] : "bad"}>
                            {TYPE_LABEL[l.type]}
                          </StatusBadge>
                          {l.backfill && (
                            <div className="small muted" title="Keyed in later from the paper slip">
                              Paper backfill
                            </div>
                          )}
                        </td>
                        <td>
                          {l.detail}
                          {l.sessionId && (
                            <div className="small">
                              <Link href={`/activity?session=${l.sessionId}`}>Whole session</Link>
                            </div>
                          )}
                        </td>
                        <td className="nowrap">{live.staffNames[l.staffId] ?? "Unknown guard"}</td>
                        <td className="nowrap">
                          {live.deviceNames[l.deviceId] ?? "Unknown phone"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
