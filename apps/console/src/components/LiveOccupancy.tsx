import type { FacilityLive } from "../lib/data/types";
import { formatIstDateTime } from "../lib/format";
import { occupancyView } from "../lib/occupancyBand";
import { BAND_LABEL, BAND_TONE } from "./LiveDashboard";
import { Card, EmptyState, StatusBadge } from "./ui/primitives";

const BAND_COLOUR = {
  ok: "var(--ok-bright)",
  warn: "#f5a524",
  bad: "#f04438",
  info: "#3b82f6",
  off: "#94a3b8",
};

function Ring({ percent, tone }: { percent: number; tone: keyof typeof BAND_COLOUR }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const p = Math.min(Math.max(percent, 0), 100);
  return (
    <svg viewBox="0 0 84 84" width="84" height="84" className="ring" aria-hidden="true">
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--line)" strokeWidth="9" />
      <circle
        cx="42"
        cy="42"
        r={r}
        fill="none"
        stroke={BAND_COLOUR[tone]}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${(p / 100) * c} ${c}`}
        transform="rotate(-90 42 42)"
        className="ring-arc"
      />
      <text x="42" y="47" textAnchor="middle" className="ring-text">
        {Math.round(percent)}%
      </text>
    </svg>
  );
}

function duration(fromIso: string, nowIso: string): string {
  const mins = Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(fromIso)) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ${mins % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** CON-04 / MET-01: how the zone's latest physical count compared with the system (SYNC-04 rule, #28). */
function PhysicalCount({ live, zoneId }: { live: FacilityLive; zoneId: string }) {
  if (!live.zoneChecks.ok) {
    return <div className="zone-check small muted">Physical counts could not be read.</div>;
  }
  const c = live.zoneChecks.data[zoneId];
  if (!c) return <div className="zone-check small muted">No physical count recorded yet.</div>;
  const sign = c.drift > 0 ? "+" : "";
  return (
    <div className="zone-check small">
      <span className="muted">
        Last physical count {formatIstDateTime(c.countedAt)}: {c.counted} counted, system showed{" "}
        {c.systemCountAtTime}
      </span>{" "}
      {c.flagged ? (
        <StatusBadge tone="warn">{`Off by ${sign}${c.drift} (over 3%)`}</StatusBadge>
      ) : (
        <StatusBadge tone="ok">
          {c.drift === 0 ? "Matched" : `Within 3% (${sign}${c.drift})`}
        </StatusBadge>
      )}
      {c.stale && <span className="muted"> · over 24 h old</span>}
    </div>
  );
}

export function LiveOccupancy({ live }: { live: FacilityLive }) {
  return (
    <div className="stack">
      {!live.zones.ok ? (
        <Card flush>
          <EmptyState icon="plugOff" title="Zones could not be read">
            {live.zones.error}
          </EmptyState>
        </Card>
      ) : live.zones.data.length === 0 ? (
        <Card flush>
          <EmptyState icon="gauge" title="No zones are set up for this facility">
            Add zones and their capacity in facility setup.
          </EmptyState>
        </Card>
      ) : (
        <div className="zone-grid stagger">
          {live.zones.data.map((z) => {
            const v = z.capacity > 0 ? occupancyView(z.occupied, z.capacity) : null;
            const tone = v ? BAND_TONE[v.band] : "off";
            return (
              <div key={z.id} className={`card zone-card zone-${tone}`}>
                <div className="zone-card-head">
                  <div>
                    <h3>{z.name}</h3>
                    <span className="small muted">{z.vehicleClass}</span>
                  </div>
                  {v ? (
                    <StatusBadge tone={v.overCapacity ? "bad" : tone}>
                      {v.overCapacity ? "Over capacity" : BAND_LABEL[v.band]}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="off">No capacity</StatusBadge>
                  )}
                </div>
                <div className="zone-card-body">
                  <Ring percent={v?.percent ?? 0} tone={tone} />
                  <dl className="zone-stats">
                    <div>
                      <dt>Inside</dt>
                      <dd className="num">{z.occupied}</dd>
                    </div>
                    <div>
                      <dt>Free</dt>
                      <dd className="num">{Math.max(z.capacity - z.occupied, 0)}</dd>
                    </div>
                    <div>
                      <dt>Capacity</dt>
                      <dd className="num">{z.capacity}</dd>
                    </div>
                  </dl>
                </div>
                <PhysicalCount live={live} zoneId={z.id} />
              </div>
            );
          })}
        </div>
      )}

      <Card
        title="Vehicles inside"
        subtitle="Open sessions, oldest first. Vehicle numbers are hidden (OQ-26)."
        flush
        action={
          live.inside.ok ? (
            <StatusBadge tone="info">{live.inside.data.length} inside</StatusBadge>
          ) : undefined
        }
      >
        {!live.inside.ok ? (
          <EmptyState icon="plugOff" title="Open sessions could not be read">
            {live.inside.error}
          </EmptyState>
        ) : live.inside.data.length === 0 ? (
          <EmptyState icon="car" title="No vehicles inside">
            Every entry has a matching exit.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Zone</th>
                  <th>Class</th>
                  <th>Entered</th>
                  <th>Parked for</th>
                  <th>Pass</th>
                </tr>
              </thead>
              <tbody>
                {live.inside.data.slice(0, 200).map((s) => (
                  <tr key={s.sessionId}>
                    <td>
                      <code>{s.shortCode}</code>
                    </td>
                    <td>{s.zoneName}</td>
                    <td>{s.vehicleClass}</td>
                    <td className="num">{formatIstDateTime(s.entryTime)}</td>
                    <td className="num">{duration(s.entryTime, live.asOf)}</td>
                    <td>{s.hasPass ? <StatusBadge tone="ok">Pass</StatusBadge> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
