"use client";

import { useRef, useState } from "react";
import { parseReportParams } from "../lib/reports/params";
import type { ReportType } from "../lib/reports/model";
import { Icon } from "./ui/Icon";
import {
  Banner,
  Button,
  Card,
  Field,
  Issue,
  PageHeader,
  Segmented,
  StatusBadge,
} from "./ui/primitives";
import { useToast } from "./ui/Toast";

const TYPES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
] as const;
const FORMATS = [
  { value: "xlsx", label: "Excel" },
  { value: "pdf", label: "PDF" },
] as const;

const CONTENT: [string, string][] = [
  ["Utilisation by zone", "KPI views (IC-07)"],
  ["Revenue by mode: cash, UPI declared, pass", "v_daily_kpis"],
  ["Peak-hour heatmap", "v_hourly"],
  ["Average stay distribution", "report views v_report_*"],
  ["Overrides with reason codes", "events (OVERRIDE)"],
  ["Shift variances", "shift views, shift_reviews"],
  ["Conflicts", "sync_conflicts"],
];

export function ReportsView({
  secretConfigured,
  demoEnabled,
}: {
  secretConfigured: boolean;
  demoEnabled: boolean;
}) {
  const [type, setType] = useState<ReportType>("daily");
  const [format, setFormat] = useState<"xlsx" | "pdf">("xlsx");
  const [date, setDate] = useState("2026-10-25");
  const frame = useRef<HTMLIFrameElement>(null);
  const toast = useToast();

  const check = parseReportParams({ type, facility: "demo", date, format });
  const query = `type=${type}&date=${encodeURIComponent(date)}`;
  const period = check.ok ? check.value.period : null;
  const dateIssue = !check.ok && check.issues.some((i) => i.field === "date");
  const dateError = dateIssue
    ? date === ""
      ? "Choose a date."
      : "Enter a real calendar date."
    : undefined;

  const print = () => {
    try {
      frame.current?.contentWindow?.focus();
      frame.current?.contentWindow?.print();
    } catch {
      toast(
        "Your browser blocked printing from the preview. Open it in a new tab and print there.",
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="Owner-ready daily, weekly and monthly reports as PDF and Excel. Real reports need a database; the layout below uses clearly labelled sample data."
        actions={<StatusBadge tone="off">Real data not connected</StatusBadge>}
      />

      <div className="grid grid-3" style={{ marginBottom: "var(--s-4)" }}>
        <Card>
          <div className="between">
            <b>Report route</b>
            <StatusBadge tone="info">Built</StatusBadge>
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            <code>/api/reports/&#123;type&#125;</code> checks requests and is protected by a secret
            header.
          </p>
        </Card>
        <Card>
          <div className="between">
            <b>Server secret</b>
            <StatusBadge tone={secretConfigured ? "ok" : "warn"}>
              {secretConfigured ? "Configured" : "Not set"}
            </StatusBadge>
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            {secretConfigured
              ? "REPORT_ROUTE_SECRET is set on the server. Its value is never sent to the browser."
              : "Without REPORT_ROUTE_SECRET the route refuses every request."}
          </p>
        </Card>
        <Card>
          <div className="between">
            <b>Data source</b>
            <StatusBadge tone="off">Not connected</StatusBadge>
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            An authorised request currently answers 501 &ldquo;report data unavailable&rdquo;.
          </p>
        </Card>
      </div>

      {demoEnabled ? (
        <>
          <Banner
            tone="warn"
            icon="sparkle"
            demo
            title="DEMO REPORT — sample data, not a real facility"
          >
            Every name and number in the preview is invented to show the layout. Do not share it as
            a real report.
          </Banner>
          <div className="grid grid-main">
            <Card
              title="Preview"
              subtitle={
                period
                  ? `${TYPES.find((t) => t.value === type)?.label} report for ${period.start === period.end ? period.start : `${period.start} to ${period.end}`}`
                  : "Choose a valid date"
              }
            >
              {check.ok ? (
                <div className="doc-frame">
                  <iframe ref={frame} title="Demo report preview" src={`/reports/demo?${query}`} />
                </div>
              ) : (
                <Issue tone="bad">
                  <b>That request is invalid.</b> {check.issues.map((i) => i.message).join(" ")}
                </Issue>
              )}
            </Card>
            <div className="stack">
              <Card title="Report options">
                <div className="stack">
                  <div className="field">
                    <span className="label">Report type</span>
                    <Segmented
                      label="Report type"
                      value={type}
                      options={TYPES}
                      onChange={setType}
                    />
                  </div>
                  <Field
                    id="rep-date"
                    label="Any date in the period"
                    hint="Weekly reports run Monday to Sunday; monthly cover the calendar month."
                    error={dateError}
                  >
                    <input
                      id="rep-date"
                      type="date"
                      className="input"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      aria-invalid={!check.ok && check.issues.some((i) => i.field === "date")}
                    />
                  </Field>
                  <div className="field">
                    <span className="label">Format</span>
                    <Segmented
                      label="Format"
                      value={format}
                      options={FORMATS}
                      onChange={setFormat}
                    />
                  </div>
                  <hr className="divider" style={{ margin: 0 }} />
                  {format === "xlsx" ? (
                    check.ok ? (
                      <a
                        className="btn btn-primary"
                        href={`/reports/demo?${query}&format=xlsx`}
                        onClick={() => toast("Demo Excel download started.")}
                      >
                        <Icon name="download" size={17} /> Download demo Excel
                      </a>
                    ) : (
                      <Button variant="primary" icon="download" disabled>
                        Download demo Excel
                      </Button>
                    )
                  ) : (
                    <>
                      <Button variant="primary" icon="printer" disabled={!check.ok} onClick={print}>
                        Print or save as PDF
                      </Button>
                      <p className="small muted">
                        This uses your browser&rsquo;s print dialog on the demo preview. The
                        server-side PDF generator has not been run on a real Linux host yet.
                      </p>
                    </>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </>
      ) : (
        <Banner tone="off" icon="lock" title="The layout demo is switched off in this build" />
      )}

      <div style={{ height: "var(--s-4)" }} />
      <Card
        title="What a real report will contain"
        subtitle="Each section and the data it depends on"
        flush
      >
        <table className="data">
          <thead>
            <tr>
              <th>Section</th>
              <th>Data source needed</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {CONTENT.map(([s, src]) => (
              <tr key={s}>
                <td>{s}</td>
                <td className="muted">{src}</td>
                <td>
                  <StatusBadge tone="off">Not connected</StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
