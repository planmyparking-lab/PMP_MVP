"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CONFLICT_ACTION_LABELS,
  CONFLICT_TYPES,
  allowedConflictActions,
  conflictAgeMinutes,
  isUnresolvedOver24Hours,
} from "../lib/conflicts";
import type { ConflictType, SyncConflictRow } from "../lib/conflicts";
import {
  Banner,
  Card,
  EmptyState,
  Issue,
  PageHeader,
  StatusBadge,
  Tabs,
  UnavailableButton,
} from "./ui/primitives";

const TYPE_DETAILS: Readonly<Record<ConflictType, { label: string; text: string }>> = {
  DUPLICATE_EXIT: {
    label: "Duplicate exit",
    text: "Two exits were recorded for the same vehicle session, usually from two phones syncing late.",
  },
  ORPHAN_EXIT: {
    label: "Orphan exit",
    text: "An exit arrived with no matching entry. A later entry may close this conflict automatically.",
  },
  DUPLICATE_ENTRY: {
    label: "Duplicate entry",
    text: "The same normalized vehicle number has more than one open session in this facility.",
  },
  CLOCK_SKEW: {
    label: "Clock skew",
    text: "A live event's device time was more than five minutes ahead of the server receipt time.",
  },
};

const SEVERITY = [
  { tone: "info", label: "Pending review", text: "Open for no more than 24 hours" },
  { tone: "warn", label: "Over 24 hours", text: "Also appears on the dashboard" },
  { tone: "ok", label: "Resolved", text: "A resolution time is recorded" },
] as const;

const RESOLUTION_UNAVAILABLE =
  "Resolving needs the atomic resolve_conflict function and row-level security. The conflict_resolutions table exists (0007).";

function ageLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours < 24) return remaining === 0 ? `${hours} h` : `${hours} h ${remaining} min`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours === 0 ? `${days} d` : `${days} d ${remainingHours} h`;
}

export interface ConflictsViewProps {
  /** Rows must be parsed with parseSyncConflictRows before they reach this view. */
  rows: readonly SyncConflictRow[];
  /** Server-supplied instant keeps age calculations stable for the rendered page. */
  nowIso: string;
  /** True when `rows` is a real query result for the signed-in user. */
  connected?: boolean;
  /** Query failure for a connected session. */
  error?: string;
  /** Why the page is disconnected (offline build, signed out, no access). */
  reason?: string;
  /** Shown instead of the facility id when the rows belong to one known facility. */
  facilityName?: string;
}

export function ConflictsView({
  rows,
  nowIso,
  connected = false,
  error,
  reason,
  facilityName,
}: ConflictsViewProps) {
  const [type, setType] = useState<ConflictType>(() => rows[0]?.type ?? "DUPLICATE_EXIT");
  const current = TYPE_DETAILS[type];
  const visibleRows = rows
    .filter((row) => row.type === type)
    .toSorted((a, b) => {
      const status = Number(a.status === "RESOLVED") - Number(b.status === "RESOLVED");
      return status || a.created_at.localeCompare(b.created_at);
    });

  return (
    <>
      <PageHeader
        title="Conflicts"
        description="When two phones disagree, a person decides. Every resolution is recorded and no event is ever edited."
      />
      {connected ? (
        error ? (
          <Banner tone="bad" icon="alert" title="Conflicts could not be read">
            {error}
          </Banner>
        ) : (
          <Banner tone="info" icon="info" title="Live and read-only">
            {`${rows.filter((r) => r.status === "OPEN").length} open of ${rows.length} recorded. `}
            Resolving needs the resolve_conflict function, which is not built yet, so actions stay
            disabled. The table that records resolutions already exists.
          </Banner>
        )
      ) : (
        <Banner
          tone={rows.length > 0 ? "warn" : "off"}
          icon={rows.length > 0 ? "alert" : "plugOff"}
          title={
            rows.length > 0
              ? "Resolution actions are unavailable"
              : "Live conflict query is not connected yet"
          }
        >
          {rows.length > 0
            ? "These are supplied sync_conflicts rows. Review actions stay disabled until the resolution table, atomic function, sign-in and RLS exist."
            : `${reason ? `${reason} ` : ""}The sync_conflicts table exists and the row parser is ready, so no conflicts are invented.`}
        </Banner>
      )}

      <div className="grid grid-main">
        <Card flush>
          <div style={{ padding: "var(--s-3) var(--s-5) 0" }}>
            <Tabs
              label="Conflict type"
              value={type}
              onChange={setType}
              options={CONFLICT_TYPES.map((value) => {
                const open = rows.filter((r) => r.type === value && r.status === "OPEN").length;
                return {
                  value,
                  label:
                    open > 0 ? `${TYPE_DETAILS[value].label} (${open})` : TYPE_DETAILS[value].label,
                };
              })}
            />
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Age</th>
                  <th>Facility</th>
                  <th>Events</th>
                  <th>Status</th>
                  <th>Resolution</th>
                </tr>
              </thead>
              {visibleRows.length > 0 && (
                <tbody>
                  {visibleRows.map((row) => {
                    const overdue = isUnresolvedOver24Hours(row, nowIso);
                    const resolved = row.status === "RESOLVED";
                    return (
                      <tr key={row.id}>
                        <td className="num">
                          {ageLabel(conflictAgeMinutes(row.created_at, nowIso))}
                        </td>
                        <td>
                          {facilityName ? (
                            <span title={row.facility_id}>{facilityName}</span>
                          ) : (
                            <code title={row.facility_id}>{row.facility_id}</code>
                          )}
                        </td>
                        <td>
                          <b>{row.event_ids.length}</b>{" "}
                          {row.event_ids.length === 1 ? "event" : "events"}
                          <div className="small">
                            <Link href={`/activity?events=${row.event_ids.slice(0, 20).join(",")}`}>
                              View events
                            </Link>
                          </div>
                          {row.session_id && (
                            <div className="small muted" title={row.session_id}>
                              Session {row.session_id}
                            </div>
                          )}
                        </td>
                        <td>
                          <StatusBadge tone={resolved ? "ok" : overdue ? "warn" : "info"}>
                            {resolved ? "Resolved" : overdue ? "Over 24 hours" : "Pending review"}
                          </StatusBadge>
                        </td>
                        <td>
                          <UnavailableButton reason={RESOLUTION_UNAVAILABLE}>
                            Review
                          </UnavailableButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              )}
            </table>
          </div>
          {visibleRows.length === 0 && (
            <EmptyState
              icon="swap"
              title={`No ${current.label.toLowerCase()} conflicts to show`}
              needs={
                rows.length === 0 && !connected
                  ? [
                      "Console sign-in and facility-scoped RLS",
                      "A server query that selects sync_conflicts rows",
                      "The resolve_conflict function for actions",
                    ]
                  : undefined
              }
            >
              {connected
                ? "Nothing of this type has been recorded for this facility."
                : rows.length === 0
                  ? "Parsed rows can be passed into this view once the secure server query exists."
                  : "The supplied result contains no conflicts of this type."}
            </EmptyState>
          )}
        </Card>

        <div className="stack">
          <Card title={current.label} subtitle="What this conflict means">
            <p style={{ marginBottom: 12 }}>{current.text}</p>
            <div className="small muted" style={{ marginBottom: 8 }}>
              Allowed actions for this type
            </div>
            <div className="row">
              {allowedConflictActions(type).map((action) => (
                <UnavailableButton key={action} reason={RESOLUTION_UNAVAILABLE}>
                  {CONFLICT_ACTION_LABELS[action]}
                </UnavailableButton>
              ))}
            </div>
            {type === "CLOCK_SKEW" && (
              <div style={{ marginTop: 12 }}>
                <Issue tone="info">
                  Clock skew only permits a note or acknowledgement. It never offers a choice
                  between events.
                </Issue>
              </div>
            )}
          </Card>
          <Card title="Status levels">
            <div className="stack-sm">
              {SEVERITY.map((status) => (
                <div className="between" key={status.label}>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  <span className="small muted">{status.text}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
