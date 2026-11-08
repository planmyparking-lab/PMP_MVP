import Link from "next/link";
import { isUnresolvedOver24Hours } from "../lib/conflicts";
import type { FacilityLive, Loaded } from "../lib/data/types";
import { overridesPer100 } from "../lib/kpi";
import { occupancyView } from "../lib/occupancyBand";
import type { OccupancyBand } from "../lib/occupancyBand";
import { LiveRefresh } from "./LiveRefresh";
import { ParkingScene } from "./art/ParkingScene";
import { Icon } from "./ui/Icon";
import type { IconName } from "./ui/Icon";
import { Card, EmptyState, StatusBadge } from "./ui/primitives";
import type { Tone } from "./ui/primitives";

export const BAND_TONE: Record<OccupancyBand, Tone> = { low: "ok", medium: "warn", high: "bad" };
export const BAND_LABEL: Record<OccupancyBand, string> = {
  low: "Comfortable",
  medium: "Filling up",
  high: "Nearly full",
};

function greeting(asOf: string): string {
  const h = new Date(Date.parse(asOf) + 330 * 60_000).getUTCHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Kpi({
  label,
  icon,
  value,
  sub,
  tone,
  error,
  href,
  meter,
}: {
  label: string;
  icon: IconName;
  value: string;
  sub: string;
  tone?: Tone;
  error?: string;
  href?: string;
  meter?: number;
}) {
  const body = (
    <>
      <div className="kpi-top">
        <span>{label}</span>
        <span className={`kpi-icon${tone ? ` tone-${tone}` : ""}`}>
          <Icon name={icon} size={17} />
        </span>
      </div>
      {error ? (
        <>
          <div className="kpi-value unavailable">—</div>
          <div className="kpi-sub" title={error}>
            Unavailable: {error}
          </div>
        </>
      ) : (
        <>
          <div className="kpi-value num">{value}</div>
          {meter !== undefined && (
            <div className={`meter meter-${tone ?? "ok"}`}>
              <span style={{ width: `${Math.min(Math.max(meter, 0), 100)}%` }} />
            </div>
          )}
          <div className="kpi-sub">{sub}</div>
        </>
      )}
    </>
  );
  return href ? (
    <Link href={href} className="card kpi kpi-link">
      {body}
    </Link>
  ) : (
    <div className="card kpi">{body}</div>
  );
}

function err<T>(v: Loaded<T>): string | undefined {
  return v.ok ? undefined : v.error;
}

export function LiveDashboard({ live }: { live: FacilityLive }) {
  const zones = live.zones.ok ? live.zones.data : [];
  const capacity = zones.reduce((s, z) => s + z.capacity, 0);
  const occupied = zones.reduce((s, z) => s + z.occupied, 0);
  const occ = capacity > 0 ? occupancyView(occupied, capacity) : null;

  const openConflicts = live.conflicts.ok
    ? live.conflicts.data.filter((c) => c.status === "OPEN")
    : [];
  const overdue = openConflicts.filter((c) => isUnresolvedOver24Hours(c, live.asOf)).length;

  const devices = live.devices.ok ? live.devices.data : [];
  const activeDevices = devices.filter((d) => d.revokedAt === null).length;
  const guards = live.staff.ok ? live.staff.data.filter((s) => s.active).length : 0;

  const today = live.today.ok ? live.today.data : null;
  const hours = today?.entriesByHour ?? [];
  const maxHour = Math.max(1, ...hours);
  const nowHour = new Date(Date.parse(live.asOf) + 330 * 60_000).getUTCHours();

  return (
    <>
      <header className="hero-banner">
        <div>
          <span className="eyebrow">{greeting(live.asOf)}</span>
          <h1>{live.facility.name}</h1>
          <p>
            Live overview of your facility. Figures come straight from the event log and refresh on
            their own.
          </p>
          <div className="actions">
            <LiveRefresh asOf={live.asOf} />
            <Link href="/occupancy" className="btn btn-secondary btn-sm">
              Occupancy board <Icon name="arrowRight" size={15} />
            </Link>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <ParkingScene id="dash" />
        </div>
      </header>

      <div className="grid grid-4 stagger" style={{ marginBottom: "var(--s-4)" }}>
        <Kpi
          label="Occupancy now"
          icon="gauge"
          value={occ ? `${Math.round(occ.percent)}%` : "—"}
          sub={
            capacity > 0
              ? `${occupied} of ${capacity} zone slots in use`
              : "No zones with capacity are set up"
          }
          tone={occ ? BAND_TONE[occ.band] : "off"}
          meter={occ?.percent}
          error={err(live.zones)}
          href="/occupancy"
        />
        <Kpi
          label="Entries today"
          icon="car"
          value={today ? String(today.entries) : "—"}
          sub={today ? `${today.exits} exits since midnight IST` : ""}
          error={err(live.today)}
        />
        <Kpi
          label="Open conflicts"
          icon="swap"
          value={String(openConflicts.length)}
          sub={overdue > 0 ? `${overdue} open for over 24 hours` : "None older than 24 hours"}
          tone={overdue > 0 ? "warn" : openConflicts.length > 0 ? "info" : "ok"}
          error={err(live.conflicts)}
          href="/conflicts"
        />
        <Kpi
          label="Active devices"
          icon="device"
          value={`${activeDevices}`}
          sub={`${devices.length - activeDevices} revoked · ${guards} active guards`}
          error={err(live.devices)}
          href="/devices"
        />
      </div>

      <div className="grid grid-main">
        <div className="stack">
          <Card
            title="Arrivals by hour"
            subtitle="ENTRY events today, by the gate phone's clock (IST)"
            action={today ? <StatusBadge tone="ok">{today.entries} today</StatusBadge> : undefined}
          >
            {today ? (
              today.entries === 0 ? (
                <EmptyState icon="car" title="No arrivals yet today">
                  Entries recorded on the gate phones appear here once they sync.
                </EmptyState>
              ) : (
                <>
                  <div className="bars bars-24" role="img" aria-label="Arrivals by hour today">
                    {hours.map((v, i) => (
                      <div
                        key={i}
                        className={i === nowHour ? "now" : undefined}
                        style={{ height: `${Math.max((v / maxHour) * 100, v > 0 ? 4 : 1.5)}%` }}
                        data-tip={`${String(i).padStart(2, "0")}:00 · ${v}`}
                      />
                    ))}
                  </div>
                  <div className="between small muted" style={{ marginTop: 8 }}>
                    <span>00:00</span>
                    <span>12:00</span>
                    <span>23:00</span>
                  </div>
                </>
              )
            ) : (
              <EmptyState icon="plugOff" title="Arrivals could not be read">
                {err(live.today)}
              </EmptyState>
            )}
          </Card>

          <Card
            title="Zones"
            subtitle="Vehicles inside each zone right now"
            action={
              <Link href="/occupancy" className="btn btn-ghost btn-sm">
                Open board <Icon name="arrowRight" size={15} />
              </Link>
            }
          >
            {!live.zones.ok ? (
              <EmptyState icon="plugOff" title="Zones could not be read">
                {live.zones.error}
              </EmptyState>
            ) : zones.length === 0 ? (
              <EmptyState icon="gauge" title="No zones yet">
                Zones are created in facility setup.
              </EmptyState>
            ) : (
              <div className="zone-mini">
                {zones.map((z) => {
                  const v = z.capacity > 0 ? occupancyView(z.occupied, z.capacity) : null;
                  return (
                    <div key={z.id} className="zone-mini-row">
                      <div className="between">
                        <b>{z.name}</b>
                        <span className="small muted num">
                          {z.occupied} / {z.capacity}
                        </span>
                      </div>
                      <div className={`meter meter-${v ? BAND_TONE[v.band] : "off"}`}>
                        <span style={{ width: `${v ? Math.min(v.percent, 100) : 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Today at a glance">
            <dl className="glance">
              <div>
                <dt>Vehicles inside</dt>
                <dd className="num">{live.inside.ok ? live.inside.data.length : "—"}</dd>
              </div>
              <div>
                <dt>Exits today</dt>
                <dd className="num">{today ? today.exits : "—"}</dd>
              </div>
              <div>
                <dt>Overrides today</dt>
                <dd className="num">{today ? today.overrides : "—"}</dd>
              </div>
              <div>
                <dt>Overrides per 100</dt>
                <dd className="num">
                  {today ? overridesPer100(today.overrides, today.entries).toFixed(1) : "—"}
                </dd>
              </div>
            </dl>
            <p className="small muted" style={{ marginTop: 12 }}>
              A high override rate can mean guards are bypassing the system.
            </p>
          </Card>

          <Card title="Needs attention">
            <div className="stack-sm">
              {overdue > 0 && (
                <Link href="/conflicts" className="attn tone-warn">
                  <Icon name="alert" size={16} />
                  {overdue} conflict{overdue === 1 ? "" : "s"} open for over 24 hours
                </Link>
              )}
              {occ && occ.band === "high" && (
                <Link href="/occupancy" className="attn tone-bad">
                  <Icon name="gauge" size={16} />
                  Facility is above 90% full
                </Link>
              )}
              {zones
                .filter((z) => z.occupied > z.capacity)
                .map((z) => (
                  <Link key={z.id} href="/occupancy" className="attn tone-bad">
                    <Icon name="alert" size={16} />
                    {z.name} reports more vehicles than its capacity
                  </Link>
                ))}
              {live.devices.ok && activeDevices === 0 && (
                <Link href="/devices" className="attn tone-info">
                  <Icon name="device" size={16} />
                  No active gate phone is enrolled
                </Link>
              )}
              {overdue === 0 &&
                !(occ && occ.band === "high") &&
                !zones.some((z) => z.occupied > z.capacity) &&
                !(live.devices.ok && activeDevices === 0) && (
                  <div className="attn tone-ok">
                    <Icon name="checkCircle" size={16} />
                    All clear right now
                  </div>
                )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
