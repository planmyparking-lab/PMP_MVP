"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { deviceHealthStatus, HEALTH_THRESHOLDS } from "../lib/deviceHealth";
import type { HealthStatus } from "../lib/deviceHealth";
import { Icon } from "./ui/Icon";
import { Modal } from "./ui/Modal";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Issue,
  PageHeader,
  StatCard,
  StatusBadge,
} from "./ui/primitives";
import type { Tone } from "./ui/primitives";
import { useToast } from "./ui/Toast";

const TONE: Record<HealthStatus, Tone> = { green: "ok", amber: "warn", red: "bad" };
const LABEL: Record<HealthStatus, string> = { green: "Healthy", amber: "Warning", red: "Critical" };
const DEFAULTS = { queue: "12", oldest: "5", heartbeat: "2", open: "yes" };
const SCENARIOS: { label: string; v: typeof DEFAULTS }[] = [
  { label: "Healthy", v: DEFAULTS },
  { label: "Backlog", v: { queue: "260", oldest: "8", heartbeat: "2", open: "yes" } },
  { label: "Slow sync", v: { queue: "40", oldest: "45", heartbeat: "3", open: "yes" } },
  { label: "Gone quiet", v: { queue: "5", oldest: "1", heartbeat: "50", open: "yes" } },
  { label: "Never reported", v: { queue: "0", oldest: "0", heartbeat: "", open: "yes" } },
];

const whole = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

export function DevicesView({ live }: { live?: ReactNode } = {}) {
  const [v, setV] = useState(DEFAULTS);
  const [enrol, setEnrol] = useState(false);
  const toast = useToast();
  const set = (k: keyof typeof DEFAULTS) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });

  const queue = whole(v.queue);
  const oldest = whole(v.oldest);
  const never = v.heartbeat.trim() === "";
  const hb = never ? null : whole(v.heartbeat);
  const status =
    queue !== null && oldest !== null && (never || hb !== null)
      ? deviceHealthStatus({
          queueDepth: queue,
          oldestUnsyncedMinutes: oldest,
          heartbeatAgeMinutes: hb,
          duringOpeningHours: v.open === "yes",
        })
      : null;
  const { red, amber } = HEALTH_THRESHOLDS;
  const bad = "Whole number of 0 or more.";

  return (
    <>
      <PageHeader
        title="Devices"
        description={
          live
            ? "Enrolled gate phones and guards for this facility. Health signals arrive once the heartbeat table exists."
            : "Know which phones are online, in sync and healthy before an operator calls you. Live monitoring needs the heartbeat table."
        }
        actions={
          <Button variant="primary" icon="plug" onClick={() => setEnrol(true)}>
            Add device
          </Button>
        }
      />
      {live ?? (
        <>
          <Banner tone="info" icon="plugOff" title="No devices are connected to this console">
            Device status, last-seen times and queue sizes will come from the device_heartbeats
            table. The counts below show a dash rather than zero, because zero would claim that
            nothing is wrong.
          </Banner>

          <div className="grid grid-4" style={{ marginBottom: "var(--s-4)" }}>
            <StatCard
              label="Healthy"
              icon="checkCircle"
              foot="Reporting within limits"
              tone="off"
              badge="Disconnected"
            />
            <StatCard
              label="Warning"
              icon="alert"
              foot="Backlog or slow sync"
              tone="off"
              badge="Disconnected"
            />
            <StatCard
              label="Critical"
              icon="alert"
              foot="Needs attention now"
              tone="off"
              badge="Disconnected"
            />
            <StatCard
              label="Never reported"
              icon="plugOff"
              foot="Enrolled but silent"
              tone="off"
              badge="Disconnected"
            />
          </div>

          <Card title="Device list" subtitle="One row per enrolled phone" flush>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Status</th>
                    <th>Last heartbeat</th>
                    <th>Queue</th>
                    <th>Oldest unsynced</th>
                    <th>App version</th>
                    <th>Battery</th>
                  </tr>
                </thead>
              </table>
            </div>
            <EmptyState
              icon="device"
              title="No device data yet"
              needs={[
                "device_heartbeats table and the health sender (Akanksha, Afzal)",
                "Enrolment function and one-time codes (Akanksha)",
                "Row-level security and sign-in",
              ]}
              action={
                <Button icon="info" onClick={() => setEnrol(true)}>
                  How enrolment will work
                </Button>
              }
            >
              Enrolled phones will appear here with their last heartbeat, queue depth, app version
              and battery. Nothing is invented in the meantime.
            </EmptyState>
          </Card>
        </>
      )}
      <div style={{ height: "var(--s-4)" }} />
      <div className="grid grid-main">
        <Card
          title="Status rules explorer"
          subtitle="Example inputs, not device data"
          action={
            <Button
              size="sm"
              variant="ghost"
              icon="reset"
              onClick={() => {
                setV(DEFAULTS);
                toast("Explorer reset.");
              }}
            >
              Reset
            </Button>
          }
        >
          <div className="stack">
            <div className="row">
              {SCENARIOS.map((s) => (
                <Button key={s.label} size="sm" onClick={() => setV(s.v)}>
                  {s.label}
                </Button>
              ))}
            </div>
            <div className="grid grid-2">
              <Field id="d-queue" label="Queued events" error={queue === null ? bad : undefined}>
                <input
                  id="d-queue"
                  className="input num"
                  inputMode="numeric"
                  value={v.queue}
                  onChange={set("queue")}
                  aria-invalid={queue === null}
                />
              </Field>
              <Field
                id="d-oldest"
                label="Oldest unsynced (minutes)"
                error={oldest === null ? bad : undefined}
              >
                <input
                  id="d-oldest"
                  className="input num"
                  inputMode="numeric"
                  value={v.oldest}
                  onChange={set("oldest")}
                  aria-invalid={oldest === null}
                />
              </Field>
              <Field
                id="d-hb"
                label="Heartbeat age (minutes)"
                hint="Leave blank for a device that never reported."
                error={!never && hb === null ? bad : undefined}
              >
                <input
                  id="d-hb"
                  className="input num"
                  inputMode="numeric"
                  value={v.heartbeat}
                  onChange={set("heartbeat")}
                  aria-invalid={!never && hb === null}
                />
              </Field>
              <Field id="d-open" label="Time of day">
                <select id="d-open" className="select" value={v.open} onChange={set("open")}>
                  <option value="yes">During opening hours</option>
                  <option value="no">Outside opening hours</option>
                </select>
              </Field>
            </div>
            {status ? (
              <div className={`issue tone-${TONE[status]}`} role="status">
                <Icon name={status === "green" ? "checkCircle" : "alert"} size={20} />
                <div>
                  <b style={{ fontSize: 16 }}>{LABEL[status]}</b>
                  <div className="small">
                    {status === "green" && "Everything is within limits."}
                    {status === "amber" && "One reading is above the early-warning level."}
                    {status === "red" && "At least one reading is above the critical limit."}
                  </div>
                </div>
              </div>
            ) : (
              <Issue tone="bad">Fix the highlighted fields to see a status.</Issue>
            )}
          </div>
        </Card>
        <Card title="The rules" subtitle="How a device chip is coloured">
          <table className="data" style={{ marginBottom: 12 }}>
            <thead>
              <tr>
                <th>Reading</th>
                <th>Warning</th>
                <th>Critical</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Queued events</td>
                <td className="num">over {amber.queueDepth}</td>
                <td className="num">over {red.queueDepth}</td>
              </tr>
              <tr>
                <td>Oldest unsynced</td>
                <td className="num">over {amber.oldestUnsyncedMinutes} min</td>
                <td className="num">over {red.oldestUnsyncedMinutes} min</td>
              </tr>
              <tr>
                <td>Heartbeat age*</td>
                <td className="num">over {amber.heartbeatAgeMinutes} min</td>
                <td className="num">over {red.heartbeatAgeMinutes} min</td>
              </tr>
            </tbody>
          </table>
          <p className="small muted" style={{ marginBottom: 12 }}>
            *Counted only during opening hours. A device that never reported is critical during
            opening hours.
          </p>
          <Issue tone="warn">
            The critical limits come from the specification. The <b>warning</b> levels are
            provisional (OQ-39) and wait for confirmation.
          </Issue>
          <div style={{ marginTop: 12 }} className="row">
            <StatusBadge tone="ok" />
            <StatusBadge tone="warn" />
            <StatusBadge tone="bad" />
            <StatusBadge tone="off" />
          </div>
        </Card>
      </div>

      <Modal open={enrol} onClose={() => setEnrol(false)} title="Adding a device">
        <ol className="checklist" style={{ marginBottom: 12 }}>
          <li>
            <span className="n">1</span>
            <span>
              You press <b>Add device</b> and a QR code with a one-time code appears (valid 10
              minutes).
            </span>
          </li>
          <li>
            <span className="n">2</span>
            <span>The guard phone scans it and is enrolled to this facility.</span>
          </li>
          <li>
            <span className="n">3</span>
            <span>The device appears in the list after its first sync.</span>
          </li>
        </ol>
        <Issue tone="warn">
          Code generation needs the <code>create_enrollment_code</code> database function and
          sign-in, which are not built yet. No code can be created from this screen today.
        </Issue>
      </Modal>
    </>
  );
}
