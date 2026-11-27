"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { formatIstDateTime } from "../lib/format";
import { isOverstay, MIN_OVERSTAY_MINUTES, validateOverstayMinutes } from "../lib/overstay";
import { overstayCsv } from "../lib/overstayList";
import type { OverstayListRow } from "../lib/overstayList";
import {
  Button,
  Banner,
  Card,
  EmptyState,
  Field,
  Issue,
  PageHeader,
  StatusBadge,
} from "./ui/primitives";
import { useToast } from "./ui/Toast";

const COLUMNS = ["Token", "Zone", "Vehicle class", "Entered", "Time inside"] as const;
const DEFAULTS = { threshold: "240", age: "239" };

const whole = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
const hours = (m: number) => `${Math.floor(m / 60)} h ${m % 60} min`;

export interface OverstayLive {
  facilityName: string;
  asOf: string;
  thresholdMinutes: number;
  /** False when the example threshold is in use because no valid ?threshold= was given. */
  thresholdFromQuery: boolean;
  thresholdError?: string;
  rows: OverstayListRow[];
  /** Set when open_sessions could not be read. */
  error?: string;
}

function downloadCsv(rows: readonly OverstayListRow[], facilityName: string) {
  const blob = new Blob([overstayCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `overstay-${facilityName.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function OverstayView({
  live,
  liveStatus,
}: { live?: OverstayLive; liveStatus?: ReactNode } = {}) {
  const [v, setV] = useState(DEFAULTS);
  const toast = useToast();
  const threshold = whole(v.threshold);
  const age = whole(v.age);
  const check = validateOverstayMinutes(threshold ?? Number.NaN);
  const flagged = check.ok && age !== null ? isOverstay(age, check.minutes) : null;

  return (
    <>
      <PageHeader
        title="Overstay"
        description="Spot vehicles that have been inside longer than the limit you set. Alerts go to the manager once per vehicle."
        actions={liveStatus ?? <StatusBadge tone="off">Live data disconnected</StatusBadge>}
      />
      {live ? (
        live.error ? (
          <Banner tone="bad" icon="alert" title="Open sessions could not be read">
            {live.error}
          </Banner>
        ) : (
          <Banner tone="info" icon="info" title="The limit is not saved yet">
            {live.thresholdFromQuery
              ? `Showing vehicles at or over ${hours(live.thresholdMinutes)}, the limit you entered.`
              : `Showing vehicles at or over ${hours(live.thresholdMinutes)}, an example limit; the facility default is not decided yet (OQ-46).`}{" "}
            Saving a limit per facility and emailing alerts need Akanksha&rsquo;s threshold storage
            and alert job (CLD-07).
            {live.thresholdError ? ` ${live.thresholdError}` : ""}
          </Banner>
        )
      ) : (
        <Banner tone="off" icon="plugOff" title="Overstay is not connected to live sessions yet">
          Sign in with a Supabase project, and row-level security must let you read open_sessions
          (CLD-03). No vehicles are shown or invented.
        </Banner>
      )}

      <div className="grid grid-main">
        <Card flush>
          <div className="card-head">
            <div>
              <h2>Vehicles over the limit</h2>
              <p>
                Open sessions at or over the limit, longest first. Pass holders are left out and
                number plates are never shown.
              </p>
            </div>
            {live && !live.error && (
              <button
                suppressHydrationWarning
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={live.rows.length === 0}
                onClick={() => {
                  downloadCsv(live.rows, live.facilityName);
                  toast(`Exported ${live.rows.length} row(s) as CSV.`);
                }}
              >
                Export CSV
              </button>
            )}
          </div>
          {live && !live.error && (
            <form method="get" className="limit-form">
              <label htmlFor="ov-limit">Limit (minutes)</label>
              <div className="limit-form-row">
                <input
                  suppressHydrationWarning
                  id="ov-limit"
                  name="threshold"
                  className="input num"
                  inputMode="numeric"
                  defaultValue={String(live.thresholdMinutes)}
                  aria-describedby="ov-limit-hint"
                />
                <button suppressHydrationWarning type="submit" className="btn btn-primary">
                  Apply
                </button>
                <span id="ov-limit-hint" className="small muted">
                  At least {MIN_OVERSTAY_MINUTES}. Not saved.
                </span>
              </div>
            </form>
          )}
          {live && !live.error && live.rows.length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {live.rows.map((r) => (
                    <tr key={r.sessionId}>
                      <td>
                        <code>{r.shortCode}</code>
                      </td>
                      <td>{r.zoneName}</td>
                      <td>{r.vehicleClass}</td>
                      <td className="num">{formatIstDateTime(r.entryTime)}</td>
                      <td>
                        <StatusBadge tone="warn">{hours(r.ageMinutes)}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : live && !live.error ? (
            <EmptyState icon="checkCircle" title="No vehicle is over the limit">
              Every vehicle inside has been there for less than {hours(live.thresholdMinutes)}, or
              holds a pass.
            </EmptyState>
          ) : (
            <EmptyState
              icon="clock"
              title="No overstay data yet"
              needs={[
                "Console sign-in with a Supabase project (CON-03)",
                "Row-level security so open_sessions is readable (CLD-03)",
                "Threshold storage and the alert job (Akanksha, CLD-07)",
              ]}
            >
              Each row will show the vehicle token (never the number plate by default), its zone,
              class, entry time and how long it has been inside.
            </EmptyState>
          )}
        </Card>

        <div className="stack">
          <Card
            title="Try the rule"
            subtitle="Example numbers, not live data"
            action={
              <Button
                size="sm"
                variant="ghost"
                icon="reset"
                onClick={() => {
                  setV(DEFAULTS);
                  toast("Overstay example reset.");
                }}
              >
                Reset
              </Button>
            }
          >
            <div className="stack">
              <Field
                id="ov-threshold"
                label="Alert after (minutes)"
                hint={`At least ${MIN_OVERSTAY_MINUTES} minutes.`}
                error={check.ok ? undefined : check.message}
              >
                <input
                  suppressHydrationWarning
                  id="ov-threshold"
                  className="input num"
                  inputMode="numeric"
                  value={v.threshold}
                  onChange={(e) => setV({ ...v, threshold: e.target.value })}
                  aria-invalid={!check.ok}
                />
              </Field>
              <Field
                id="ov-age"
                label="A vehicle has been inside (minutes)"
                error={age === null ? "Enter whole minutes." : undefined}
              >
                <input
                  suppressHydrationWarning
                  id="ov-age"
                  className="input num"
                  inputMode="numeric"
                  value={v.age}
                  onChange={(e) => setV({ ...v, age: e.target.value })}
                  aria-invalid={age === null}
                />
              </Field>
              {flagged === null ? (
                <Issue tone="bad">Fix the highlighted fields to see the result.</Issue>
              ) : flagged ? (
                <Issue tone="warn">
                  <b>Over the limit.</b> {hours(age ?? 0)} inside; the limit is{" "}
                  {hours(threshold ?? 0)}.
                </Issue>
              ) : (
                <Issue tone="ok">
                  <b>Within the limit.</b> {hours(age ?? 0)} inside; the limit is{" "}
                  {hours(threshold ?? 0)}.
                </Issue>
              )}
              <p className="small muted">
                A stay exactly equal to the limit counts as over it (decided in OQ-46).
              </p>
            </div>
          </Card>

          <Card
            title="How alerts will work"
            subtitle="As documented for CLD-07; none of it is built"
          >
            <ol className="checklist small">
              <li>
                <span className="n">1</span>
                <span>A job checks every 10 minutes for vehicles at or over the limit.</span>
              </li>
              <li>
                <span className="n">2</span>
                <span>The manager is emailed once per vehicle; a log prevents repeats.</span>
              </li>
              <li>
                <span className="n">3</span>
                <span>
                  If the email fails it is retried on later runs. The retry limit is not decided yet
                  (OQ-48).
                </span>
              </li>
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
