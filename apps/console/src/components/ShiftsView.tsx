"use client";

import {
  Banner,
  Card,
  EmptyState,
  Field,
  PageHeader,
  StatusBadge,
  UnavailableButton,
} from "./ui/primitives";
import { Tip } from "./ui/primitives";

const COLUMNS = [
  "Date",
  "Guard",
  "Expected cash",
  "Counted cash",
  "UPI declared",
  "Variance",
  "Status",
] as const;

const WHY = "Shift records and the review table are not connected yet.";

export function ShiftsView() {
  return (
    <>
      <PageHeader
        title="Shifts"
        description="Review cash and UPI variance at the end of every shift, drill into the events, and sign off with a note."
        actions={
          <UnavailableButton
            variant="primary"
            icon="check"
            reason="Signing off a shift needs the shift_reviews table and sign-in, which are not built yet."
          >
            Sign off shift
          </UnavailableButton>
        }
      />
      <Banner tone="off" icon="plugOff" title="Shift data is not available">
        Once you are signed in and row-level security lets you read events, this page lists every
        shift from the gate phones&rsquo; shift events. Signing off still needs the shift_reviews
        table (Akanksha). No shifts are invented.
      </Banner>

      <Card flush>
        <div className="card-head" style={{ flexWrap: "wrap" }}>
          <div className="row" style={{ width: "100%" }}>
            <Tip text={WHY}>
              <Field id="sh-from" label="From">
                <input
                  suppressHydrationWarning
                  id="sh-from"
                  type="date"
                  className="input"
                  disabled
                  aria-describedby="sh-why"
                />
              </Field>
            </Tip>
            <Tip text={WHY}>
              <Field id="sh-to" label="To">
                <input suppressHydrationWarning id="sh-to" type="date" className="input" disabled />
              </Field>
            </Tip>
            <Tip text={WHY}>
              <Field id="sh-status" label="Status">
                <select suppressHydrationWarning id="sh-status" className="select" disabled>
                  <option>All shifts</option>
                </select>
              </Field>
            </Tip>
            <Tip text={WHY}>
              <Field id="sh-var" label="Variance">
                <select suppressHydrationWarning id="sh-var" className="select" disabled>
                  <option>Any</option>
                </select>
              </Field>
            </Tip>
            <span id="sh-why" className="small muted">
              Filters unlock when shift data is connected.
            </span>
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
          title="No shifts to show"
          needs={[
            "Shift open and close events with cash and UPI totals (gate app, sync)",
            "Shift views and the shift_reviews table (Akanksha)",
            "Console sign-in and security policies",
          ]}
        >
          Each shift will list expected and counted cash, declared UPI and the variance, highlighted
          when it passes the facility&rsquo;s threshold.
        </EmptyState>
      </Card>

      <div style={{ height: "var(--s-4)" }} />
      <div className="grid grid-3">
        {[
          ["1. Close", "The guard closes the shift on the phone and counts the cash.", "off"],
          ["2. Review", "You see the variance. Anything over the threshold is highlighted.", "off"],
          [
            "3. Sign off",
            "You approve or flag it. Events are never edited; your review is a separate record.",
            "off",
          ],
        ].map(([t, text]) => (
          <Card key={t}>
            <div className="between">
              <b>{t}</b>
              <StatusBadge tone="off">Not built</StatusBadge>
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>
              {text}
            </p>
          </Card>
        ))}
      </div>
    </>
  );
}
