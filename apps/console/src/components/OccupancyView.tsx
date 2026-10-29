"use client";

import { useState } from "react";
import { overridesPer100 } from "../lib/kpi";
import { occupancyView } from "../lib/occupancyBand";
import type { OccupancyBand } from "../lib/occupancyBand";
import { Icon } from "./ui/Icon";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Issue,
  PageHeader,
  StatusBadge,
  Tabs,
} from "./ui/primitives";
import type { Tone } from "./ui/primitives";
import { useToast } from "./ui/Toast";

const BAND: Record<OccupancyBand, { colour: string; tone: Tone; label: string; text: string }> = {
  low: { colour: "#12a995", tone: "ok", label: "Comfortable", text: "Below 70% of capacity." },
  medium: { colour: "#e5a50a", tone: "warn", label: "Filling up", text: "70% to 90% of capacity." },
  high: { colour: "#d92d20", tone: "bad", label: "Nearly full", text: "Above 90% of capacity." },
};

const DEFAULTS = { occupied: "122", capacity: "180", overrides: "4", entries: "250" };

/** Whole-number text only: "12" is fine, "1.5", "", "-3" and "abc" are not. */
const parseCount = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

function Gauge({
  percent,
  colour,
  shown,
  capacity,
}: {
  percent: number;
  colour: string;
  shown: number;
  capacity: number;
}) {
  const clamped = Math.max(0, Math.min(percent, 100));
  return (
    <div className="gauge">
      <svg
        viewBox="0 0 220 128"
        role="img"
        aria-label={`${percent.toFixed(0)} percent of capacity in use`}
      >
        <path
          d="M 20 110 A 90 90 0 0 1 200 110"
          fill="none"
          stroke="#e8edf3"
          strokeWidth="16"
          strokeLinecap="round"
          pathLength="100"
        />
        <path
          d="M 20 110 A 90 90 0 0 1 200 110"
          fill="none"
          stroke={colour}
          strokeWidth="16"
          strokeLinecap="round"
          pathLength="100"
          strokeDasharray={`${clamped} 100`}
          style={{ transition: "stroke-dasharray 0.4s ease, stroke 0.3s" }}
        />
        {[70, 90].map((t) => {
          const a = Math.PI * (1 - t / 100);
          return (
            <line
              key={t}
              x1={110 + 76 * Math.cos(a)}
              y1={110 - 76 * Math.sin(a)}
              x2={110 + 100 * Math.cos(a)}
              y2={110 - 100 * Math.sin(a)}
              stroke="#94a3b8"
              strokeWidth="1.5"
            />
          );
        })}
      </svg>
      <div className="gauge-value num" style={{ marginTop: -54 }}>
        {percent.toFixed(0)}%
      </div>
      <div className="muted small">
        {shown} of {capacity} slots
      </div>
    </div>
  );
}

export function OccupancyView() {
  const [tab, setTab] = useState<"calc" | "live">("calc");
  const [v, setV] = useState(DEFAULTS);
  const toast = useToast();
  const set = (k: keyof typeof DEFAULTS) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });

  const occupied = parseCount(v.occupied);
  const capacity = parseCount(v.capacity);
  const overrides = parseCount(v.overrides);
  const entries = parseCount(v.entries);
  const occErr = occupied === null ? "Enter a whole number of 0 or more." : undefined;
  const capErr =
    capacity === null || capacity < 1
      ? "Capacity must be a whole number of at least 1."
      : undefined;
  const view =
    occupied !== null && capacity !== null && capacity >= 1
      ? occupancyView(occupied, capacity)
      : null;
  const band = view ? BAND[view.band] : null;
  const per100 =
    overrides !== null && entries !== null ? overridesPer100(overrides, entries) : null;

  const preset = (pct: number) => {
    const cap = capacity && capacity >= 1 ? capacity : 180;
    setV({ ...v, capacity: String(cap), occupied: String(Math.round((cap * pct) / 100)) });
  };
  const reset = () => {
    setV(DEFAULTS);
    toast("Calculator reset to its example values.");
  };

  return (
    <>
      <PageHeader
        title="Occupancy"
        description="See how each zone is doing right now. Live counts need the database; until then you can try the colour rules on your own numbers."
        actions={<StatusBadge tone="off">Live data disconnected</StatusBadge>}
      />
      <Tabs
        label="Occupancy views"
        value={tab}
        onChange={setTab}
        options={[
          { value: "calc", label: "Rules calculator" },
          { value: "live", label: "Live zones" },
        ]}
      />

      {tab === "live" ? (
        <Card flush>
          <EmptyState
            icon="plugOff"
            title="Live occupancy is not connected"
            needs={[
              "v_zone_now database view: zone, capacity, occupied, as-of time (Akanksha)",
              "Row-level security policies and Console sign-in (CLD-03, CON-03)",
              "Realtime or 10-second polling wiring (Anamika, after the view exists)",
            ]}
            action={
              <Button variant="primary" icon="gauge" onClick={() => setTab("calc")}>
                Try the rules calculator
              </Button>
            }
          >
            When the view exists, this tab will show one bar per zone with an &ldquo;as of&rdquo;
            time. Counts always come from the database, never from the browser.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Banner tone="info" title="Example calculator — not facility data">
            The numbers below are ones you type. The result shows how the Console will colour a
            zone; it is not a live reading.
          </Banner>
          <div className="grid grid-main">
            <Card
              title="Zone capacity gauge"
              subtitle="Updates as you type"
              action={band ? <StatusBadge tone={band.tone}>{band.label}</StatusBadge> : undefined}
            >
              {view && band && capacity !== null ? (
                <>
                  <Gauge
                    percent={view.percent}
                    colour={band.colour}
                    shown={view.displayed}
                    capacity={capacity}
                  />
                  <div
                    className="grid grid-3"
                    style={{ marginTop: "var(--s-4)", gap: "var(--s-3)" }}
                  >
                    {[
                      ["Occupied", String(view.displayed)],
                      ["Available", String(Math.max(capacity - view.displayed, 0))],
                      ["Capacity", String(capacity)],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="card"
                        style={{ padding: "var(--s-3) var(--s-4)", boxShadow: "none" }}
                      >
                        <div className="small muted">{label}</div>
                        <div className="num" style={{ fontSize: 22, fontWeight: 650 }}>
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: "var(--s-4)" }}>
                    {view.overCapacity ? (
                      <Issue tone="bad">
                        <b>Over capacity.</b> {occupied} vehicles reported for {capacity} slots. The
                        Console shows the count capped at capacity and flags this zone.
                      </Issue>
                    ) : (
                      <Issue tone={band.tone === "ok" ? "ok" : band.tone}>
                        <b>{band.label}.</b> {band.text}
                      </Issue>
                    )}
                  </div>
                </>
              ) : (
                <EmptyState icon="gauge" title="Enter valid numbers">
                  Fix the highlighted fields to see the gauge.
                </EmptyState>
              )}
              <div className="legend" style={{ marginTop: "var(--s-4)" }}>
                <span>
                  <i style={{ background: BAND.low.colour }} />
                  Under 70%
                </span>
                <span>
                  <i style={{ background: BAND.medium.colour }} />
                  70% to 90%
                </span>
                <span>
                  <i style={{ background: BAND.high.colour }} />
                  Over 90%
                </span>
              </div>
            </Card>

            <div className="stack">
              <Card
                title="Try your numbers"
                action={
                  <Button size="sm" variant="ghost" icon="reset" onClick={reset}>
                    Reset
                  </Button>
                }
              >
                <div className="stack">
                  <div className="grid grid-2">
                    <Field id="occ" label="Vehicles in zone" error={occErr}>
                      <input
                        id="occ"
                        className="input num"
                        inputMode="numeric"
                        value={v.occupied}
                        onChange={set("occupied")}
                        aria-invalid={!!occErr}
                        aria-describedby="occ-msg"
                      />
                    </Field>
                    <Field id="cap" label="Zone capacity" error={capErr}>
                      <input
                        id="cap"
                        className="input num"
                        inputMode="numeric"
                        value={v.capacity}
                        onChange={set("capacity")}
                        aria-invalid={!!capErr}
                        aria-describedby="cap-msg"
                      />
                    </Field>
                  </div>
                  {capacity !== null && capacity >= 1 && (
                    <input
                      type="range"
                      min={0}
                      max={Math.round(capacity * 1.2)}
                      value={Math.min(occupied ?? 0, Math.round(capacity * 1.2))}
                      onChange={(e) => setV({ ...v, occupied: e.target.value })}
                      aria-label="Vehicles in zone slider"
                    />
                  )}
                  <div className="row">
                    <span className="small muted" style={{ width: "100%" }}>
                      Quick examples
                    </span>
                    {[
                      ["Quiet", 30],
                      ["Busy", 80],
                      ["Nearly full", 95],
                      ["Over", 110],
                    ].map(([label, pct]) => (
                      <Button key={label} size="sm" onClick={() => preset(Number(pct))}>
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
              </Card>

              <Card
                title="Overrides per 100 vehicles"
                subtitle="Overrides ÷ entries × 100. With no entries the result is 0, never an error."
              >
                <div className="grid grid-2">
                  <Field
                    id="ovr"
                    label="Overrides"
                    error={overrides === null ? "Whole number of 0 or more." : undefined}
                  >
                    <input
                      id="ovr"
                      className="input num"
                      inputMode="numeric"
                      value={v.overrides}
                      onChange={set("overrides")}
                      aria-invalid={overrides === null}
                      aria-describedby="ovr-msg"
                    />
                  </Field>
                  <Field
                    id="ent"
                    label="Entries"
                    error={entries === null ? "Whole number of 0 or more." : undefined}
                  >
                    <input
                      id="ent"
                      className="input num"
                      inputMode="numeric"
                      value={v.entries}
                      onChange={set("entries")}
                      aria-invalid={entries === null}
                      aria-describedby="ent-msg"
                    />
                  </Field>
                </div>
                <div style={{ marginTop: "var(--s-4)" }} className="between">
                  <span className="muted small">
                    <Icon name="info" size={14} style={{ verticalAlign: -2 }} /> A high rate can
                    mean guards are bypassing the system.
                  </span>
                  <b className="num" style={{ fontSize: 22 }}>
                    {per100 === null ? "—" : per100.toFixed(2)}
                  </b>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
