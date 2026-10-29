"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SCHEMA_VERSION } from "@pmp/contracts";
import { FEATURES } from "../lib/features";
import { Icon } from "./ui/Icon";
import type { IconName } from "./ui/Icon";
import { Banner, Card, StatCard, StatusBadge } from "./ui/primitives";
import { useToast } from "./ui/Toast";

const STORAGE_KEY = "pmp.console.dashboardDemo";

const QUICK: { href: string; title: string; text: string; icon: IconName }[] = [
  {
    href: "/setup",
    title: "Set up a facility",
    text: "Check tariffs, capacity and PIN rules",
    icon: "settings",
  },
  {
    href: "/occupancy",
    title: "Occupancy",
    text: "See how zones will be colour-coded",
    icon: "gauge",
  },
  { href: "/reports", title: "Reports", text: "Preview the owner report layout", icon: "file" },
  { href: "/devices", title: "Devices", text: "Understand device health states", icon: "device" },
];

const STEPS = [
  ["Create the facility", "Name, address, slot count and operating hours.", "/setup"],
  ["Define zones and tariffs", "Capacity per zone, vehicle classes and price slabs.", "/setup"],
  ["Add guards and devices", "Guard PINs and one-time phone enrolment codes.", "/devices"],
  ["Run a test drive", "One entry, one exit and one sync arrive from a phone.", "/devices"],
  ["Activate and share reports", "Daily, weekly and monthly reports reach the owner.", "/reports"],
] as const;

// Illustrative bars for the demo view only. Invented; they are not from any facility.
const DEMO_HOURLY = [12, 18, 30, 44, 52, 61, 58, 49, 40, 46, 55, 38];

export function DashboardView() {
  const [demo, setDemo] = useState(false);
  const toast = useToast();

  // Only this non-sensitive preference is remembered.
  useEffect(() => {
    try {
      setDemo(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* storage can be blocked; the default (off) is fine */
    }
  }, []);
  const toggle = () => {
    const next = !demo;
    setDemo(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    toast(next ? "Demo data is on. Everything shown is invented." : "Demo data is off.");
  };

  const maxBar = Math.max(...DEMO_HOURLY);
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Welcome to PlanMyParking</h1>
          <p>
            Your operations overview. This build is not connected to a database yet, so live figures
            show as unavailable instead of invented numbers.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-secondary" aria-pressed={demo} onClick={toggle}>
            <Icon name="sparkle" size={17} />
            {demo ? "Hide demo data" : "Show demo data"}
          </button>
        </div>
      </header>

      {demo ? (
        <Banner tone="warn" icon="sparkle" demo title="DEMO DATA — every figure below is invented">
          It is here only to show how the dashboard will look. It does not come from any facility.
        </Banner>
      ) : (
        <Banner tone="info" icon="plugOff" title="Not connected to a database">
          Live occupancy, entries, devices and exceptions need the database views and sign-in that
          other team members are building. Event schema version {SCHEMA_VERSION}.
        </Banner>
      )}

      <div className="grid grid-4" style={{ marginBottom: "var(--s-4)" }}>
        <StatCard
          label="Occupancy now"
          icon="gauge"
          value={demo ? "68%" : undefined}
          foot={demo ? "Demo: 122 of 180 slots" : "Needs the v_zone_now view"}
          tone={demo ? "warn" : "off"}
          badge={demo ? "Demo" : "Unavailable"}
        />
        <StatCard
          label="Active devices"
          icon="device"
          value={demo ? "3 of 3" : undefined}
          foot={demo ? "Demo: all reporting" : "Needs device_heartbeats"}
          tone={demo ? "warn" : "off"}
          badge={demo ? "Demo" : "Unavailable"}
        />
        <StatCard
          label="Entries today"
          icon="car"
          value={demo ? "412" : undefined}
          foot={demo ? "Demo figure" : "Needs the KPI views"}
          tone={demo ? "warn" : "off"}
          badge={demo ? "Demo" : "Unavailable"}
        />
        <StatCard
          label="Open exceptions"
          icon="alert"
          value={demo ? "2" : undefined}
          foot={demo ? "Demo: 1 conflict, 1 shift variance" : "Needs conflicts and shift data"}
          tone={demo ? "warn" : "off"}
          badge={demo ? "Demo" : "Unavailable"}
        />
      </div>

      <div className="grid grid-main">
        <div className="stack">
          <Card
            title="Arrivals by hour"
            subtitle={demo ? "Demo data" : "Unavailable until the hourly view exists"}
          >
            {demo ? (
              <>
                <div className="bars" role="img" aria-label="Demo chart of arrivals by hour">
                  {DEMO_HOURLY.map((v, i) => (
                    <div key={i} style={{ height: `${(v / maxBar) * 100}%` }} />
                  ))}
                </div>
                <div className="between small muted" style={{ marginTop: 8 }}>
                  <span>08:00</span>
                  <span>Illustrative only</span>
                  <span>19:00</span>
                </div>
              </>
            ) : (
              <div className="empty" style={{ padding: "var(--s-5) 0" }}>
                <div className="empty-icon">
                  <Icon name="gauge" size={24} />
                </div>
                <h3>No arrivals data</h3>
                <p>
                  The hourly chart will draw from the v_hourly view. Turn on demo data to preview
                  it.
                </p>
              </div>
            )}
          </Card>

          <Card
            title="Module status"
            subtitle="What is connected and what is waiting for the backend"
            flush
          >
            {FEATURES.map((f) => (
              <Link key={f.id} href={f.href} className="feature">
                <span
                  className="stat-icon"
                  style={{
                    background: f.state === "partial" ? "var(--info-bg)" : "var(--off-bg)",
                    color: f.state === "partial" ? "var(--info)" : "var(--off)",
                  }}
                >
                  <Icon name={f.state === "partial" ? "plug" : "plugOff"} size={17} />
                </span>
                <div>
                  <h3>{f.title}</h3>
                  <p>{f.works}</p>
                </div>
                <div className="meta">
                  <StatusBadge tone={f.state === "partial" ? "info" : "off"}>
                    {f.state === "partial" ? "Awaiting backend" : "Not built"}
                  </StatusBadge>
                  <span className="small muted">{f.needs.length} dependencies</span>
                </div>
              </Link>
            ))}
          </Card>
        </div>

        <div className="stack">
          <Card title="Quick actions">
            <div className="grid" style={{ gap: "var(--s-3)" }}>
              {QUICK.map((q) => (
                <Link key={q.href + q.title} href={q.href} className="card quick">
                  <span className="stat-icon">
                    <Icon name={q.icon} size={18} />
                  </span>
                  <div>
                    <h3>{q.title}</h3>
                    <p>{q.text}</p>
                  </div>
                  <Icon
                    name="chevron"
                    size={16}
                    style={{ marginLeft: "auto", color: "var(--muted)" }}
                  />
                </Link>
              ))}
            </div>
          </Card>

          <Card title="Getting started with a new facility" subtitle="The path from empty to live">
            <ol className="checklist">
              {STEPS.map(([title, text, href], i) => (
                <li key={title}>
                  <span className="n">{i + 1}</span>
                  <div>
                    <b>
                      <Link href={href} style={{ color: "inherit" }}>
                        {title}
                      </Link>
                    </b>
                    <div className="small muted">{text}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
