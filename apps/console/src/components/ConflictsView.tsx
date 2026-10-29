"use client";

import { useState } from "react";
import { Icon } from "./ui/Icon";
import {
  Banner,
  Card,
  EmptyState,
  Field,
  Issue,
  PageHeader,
  StatusBadge,
  Tabs,
  Tip,
} from "./ui/primitives";

const TYPES = [
  {
    value: "DUPLICATE_EXIT",
    label: "Duplicate exit",
    text: "Two exits were recorded for the same vehicle session, usually from two phones syncing late.",
    actions: ["Keep first", "Keep second", "Mark as test entry", "Add note"],
  },
  {
    value: "ORPHAN_EXIT",
    label: "Orphan exit",
    text: "An exit arrived with no matching entry, for example the entry was made while a phone was offline and lost.",
    actions: ["Keep first", "Keep second", "Mark as test entry", "Add note"],
  },
  {
    value: "DUPLICATE_ENTRY",
    label: "Duplicate entry",
    text: "The same vehicle appears to have been entered twice within a short time.",
    actions: ["Keep first", "Keep second", "Mark as test entry", "Add note"],
  },
  {
    value: "CLOCK_SKEW",
    label: "Clock skew",
    text: "A phone's clock was far from the server's when an event was recorded.",
    actions: ["Add note", "Acknowledge"],
  },
] as const;

const SEVERITY = [
  { tone: "info", label: "Pending review", text: "Waiting for a manager" },
  { tone: "warn", label: "Over 24 hours", text: "Also appears on the dashboard" },
  { tone: "ok", label: "Resolved", text: "A resolution is recorded" },
] as const;

type TypeKey = (typeof TYPES)[number]["value"];

export function ConflictsView() {
  const [type, setType] = useState<TypeKey>("DUPLICATE_EXIT");
  const current = TYPES.find((t) => t.value === type)!;
  const WHY = "Conflict data and the resolve function are not connected yet.";

  return (
    <>
      <PageHeader
        title="Conflicts"
        description="When two phones disagree, a person decides. Every resolution is recorded and no event is ever edited."
      />
      <Banner tone="off" icon="plugOff" title="Conflict resolution is not built yet">
        It needs the sync_conflicts table, conflict_resolutions and the resolve_conflict function
        (Afzal, Akanksha). No conflicts are invented here.
      </Banner>

      <div className="grid grid-main">
        <Card flush>
          <div className="card-head">
            <div className="row" style={{ width: "100%" }}>
              <Tip text={WHY}>
                <Field id="c-search" label="Search">
                  <div className="input-group">
                    <span className="prefix">
                      <Icon name="search" size={15} />
                    </span>
                    <input
                      id="c-search"
                      className="input has-prefix"
                      placeholder="Short code or device"
                      disabled
                    />
                  </div>
                </Field>
              </Tip>
              <Tip text={WHY}>
                <Field id="c-status" label="Status">
                  <select id="c-status" className="select" disabled>
                    <option>Open first</option>
                  </select>
                </Field>
              </Tip>
            </div>
          </div>
          <div style={{ padding: "0 var(--s-5)", paddingTop: "var(--s-3)" }}>
            <Tabs
              label="Conflict type"
              value={type}
              onChange={setType}
              options={TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Age</th>
                  <th>Facility</th>
                  <th>Competing events</th>
                  <th>Status</th>
                  <th>Resolution</th>
                </tr>
              </thead>
            </table>
          </div>
          <EmptyState
            icon="swap"
            title={`No ${current.label.toLowerCase()} conflicts to show`}
            needs={[
              "sync_conflicts table, filled by the sync service (Afzal)",
              "conflict_resolutions and resolve_conflict (Akanksha)",
              "Sign-in and security policies",
            ]}
          >
            This list will show each conflict side by side with the two competing events.
          </EmptyState>
        </Card>

        <div className="stack">
          <Card title={current.label} subtitle="What this conflict means">
            <p style={{ marginBottom: 12 }}>{current.text}</p>
            <div className="small muted" style={{ marginBottom: 6 }}>
              Actions a manager will have
            </div>
            <div className="row">
              {current.actions.map((a) => (
                <Tip key={a} text={WHY}>
                  <span className="badge tone-off">{a}</span>
                </Tip>
              ))}
            </div>
            {current.value === "CLOCK_SKEW" && (
              <div style={{ marginTop: 12 }}>
                <Issue tone="info">
                  Clock skew only allows a note or an acknowledgement, because there is no pair of
                  events to choose between.
                </Issue>
              </div>
            )}
          </Card>
          <Card title="Status levels">
            <div className="stack-sm">
              {SEVERITY.map((s) => (
                <div className="between" key={s.label}>
                  <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                  <span className="small muted">{s.text}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
