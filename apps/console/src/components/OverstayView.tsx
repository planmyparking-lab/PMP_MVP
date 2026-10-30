"use client";

import { useState } from "react";
import { isOverstay, MIN_OVERSTAY_MINUTES, validateOverstayMinutes } from "../lib/overstay";
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

const COLUMNS = ["Token", "Vehicle class", "Entered", "Time inside", "Alert"] as const;
const DEFAULTS = { threshold: "240", age: "239" };

const whole = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
const hours = (m: number) => `${Math.floor(m / 60)} h ${m % 60} min`;

export function OverstayView() {
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
        actions={<StatusBadge tone="off">Live data disconnected</StatusBadge>}
      />
      <Banner tone="off" icon="plugOff" title="Overstay is not connected to live sessions yet">
        The list needs open_sessions on the main branch (built by Afzal on
        feature/sync-02-open-sessions, not merged), a place to store the threshold (Akanksha), and
        sign-in with security policies. No vehicles are shown or invented.
      </Banner>

      <div className="grid grid-main">
        <Card flush>
          <div className="card-head">
            <div>
              <h2>Vehicles over the limit</h2>
              <p>
                Open sessions at or over the threshold, longest first. Pass holders are left out.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
            </table>
          </div>
          <EmptyState
            icon="clock"
            title="No overstay data yet"
            needs={[
              "open_sessions table on main (Afzal): entry time and pass id per vehicle inside",
              "Threshold storage and the alert job (Akanksha, CLD-07)",
              "Console sign-in and row-level security",
            ]}
          >
            Each row will show the vehicle token (never the number plate by default), its class,
            entry time and how long it has been inside.
          </EmptyState>
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
                A stay exactly equal to the limit counts as over it. That is a provisional choice,
                not yet confirmed (OQ-46).
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
