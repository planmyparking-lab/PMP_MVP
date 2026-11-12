import type { FacilityLive } from "../lib/data/types";
import { formatIstDateTime } from "../lib/format";
import { deviceHealthFromHeartbeat } from "../lib/heartbeatHealth";
import type { HealthStatus } from "../lib/deviceHealth";
import type { Tone } from "./ui/primitives";
import { Banner, Card, EmptyState, StatCard, StatusBadge } from "./ui/primitives";

const HEALTH_TONE: Record<HealthStatus, Tone> = { green: "ok", amber: "warn", red: "bad" };
const HEALTH_LABEL: Record<HealthStatus, string> = {
  green: "Healthy",
  amber: "Warning",
  red: "Critical",
};

function ago(minutes: number | null): string {
  if (minutes === null) return "Never";
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.floor(minutes / 60);
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

export function LiveDevices({ live }: { live: FacilityLive }) {
  const devices = live.devices.ok ? live.devices.data : [];
  const hb = live.heartbeats;
  const beats = new Map(hb.state === "ok" ? hb.data.map((h) => [h.deviceId, h]) : []);
  const staff = live.staff.ok ? live.staff.data : [];
  const active = devices.filter((d) => d.revokedAt === null).length;
  const guards = staff.filter((s) => s.active).length;

  return (
    <>
      {hb.state === "ok" ? (
        <Banner tone="info" icon="info" title="Health is live; enrolment is not built yet">
          Last heartbeat, queue size and battery come from each phone&rsquo;s latest heartbeat.
          Opening hours are not stored yet (OQ-47), so a silent phone always counts as stale. Adding
          a phone needs the enroll_device function, which does not exist yet.
        </Banner>
      ) : (
        <Banner tone="info" icon="info" title="Enrolment and health are read-only for now">
          Devices and staff below come from the database.{" "}
          {hb.state === "absent"
            ? "Last heartbeat, queue size and battery appear once the device_heartbeats table is deployed."
            : hb.state === "denied"
              ? "The device_heartbeats table exists, but your account cannot read it yet (row-level security)."
              : `Device health could not be read: ${hb.error}`}{" "}
          Adding a phone needs the enroll_device function, which does not exist yet.
        </Banner>
      )}

      <div className="grid grid-4 stagger" style={{ marginBottom: "var(--s-4)" }}>
        <StatCard
          label="Active devices"
          icon="device"
          value={live.devices.ok ? String(active) : undefined}
          foot={live.devices.ok ? "Enrolled and not revoked" : live.devices.error}
        />
        <StatCard
          label="Revoked devices"
          icon="lock"
          value={live.devices.ok ? String(devices.length - active) : undefined}
          foot="Can no longer sync"
        />
        <StatCard
          label="Active guards"
          icon="checkCircle"
          value={live.staff.ok ? String(guards) : undefined}
          foot={live.staff.ok ? "Can sign in with a PIN" : live.staff.error}
        />
        <StatCard
          label="Inactive guards"
          icon="x"
          value={live.staff.ok ? String(staff.length - guards) : undefined}
          foot="Kept for the record"
        />
      </div>

      <div className="stack">
        <Card title="Gate phones" subtitle="One row per enrolled device" flush>
          {!live.devices.ok ? (
            <EmptyState icon="plugOff" title="Devices could not be read">
              {live.devices.error}
            </EmptyState>
          ) : devices.length === 0 ? (
            <EmptyState icon="device" title="No phones enrolled yet">
              Enrolled gate phones appear here.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Enrolled</th>
                    <th>Status</th>
                    {hb.state === "ok" && (
                      <>
                        <th>Health</th>
                        <th>Last heartbeat</th>
                        <th>Queue</th>
                        <th>Oldest unsynced</th>
                        <th>App version</th>
                        <th>Battery</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => {
                    const beat = beats.get(d.id);
                    const health = deviceHealthFromHeartbeat(beat, live.asOf);
                    return (
                      <tr key={d.id}>
                        <td>
                          <b>{d.name}</b>
                        </td>
                        <td className="num">{formatIstDateTime(d.enrolledAt)}</td>
                        <td>
                          {d.revokedAt ? (
                            <StatusBadge tone="off">Revoked</StatusBadge>
                          ) : (
                            <StatusBadge tone="ok">Active</StatusBadge>
                          )}
                        </td>
                        {hb.state === "ok" && (
                          <>
                            <td>
                              {d.revokedAt ? (
                                "—"
                              ) : (
                                <StatusBadge tone={HEALTH_TONE[health.status]}>
                                  {HEALTH_LABEL[health.status]}
                                </StatusBadge>
                              )}
                            </td>
                            <td className="num">{ago(health.heartbeatAgeMinutes)}</td>
                            <td className="num">{health.queueDepth ?? "—"}</td>
                            <td className="num">
                              {health.oldestUnsyncedMinutes === null
                                ? "—"
                                : `${health.oldestUnsyncedMinutes} min`}
                            </td>
                            <td>{beat ? <code>{beat.appVersion}</code> : "—"}</td>
                            <td className="num">
                              {beat?.batteryPct === null || beat === undefined
                                ? "—"
                                : `${beat.batteryPct}%`}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Guards" subtitle="Staff who sign in on the gate phones" flush>
          {!live.staff.ok ? (
            <EmptyState icon="plugOff" title="Staff could not be read">
              {live.staff.error}
            </EmptyState>
          ) : staff.length === 0 ? (
            <EmptyState icon="list" title="No guards added yet">
              Guards are added in setup.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Added</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <span className="who">
                          <span className="who-avatar">{s.name.slice(0, 1).toUpperCase()}</span>
                          {s.name}
                        </span>
                      </td>
                      <td className="num">{formatIstDateTime(s.createdAt)}</td>
                      <td>
                        <StatusBadge tone={s.active ? "ok" : "off"}>
                          {s.active ? "Active" : "Inactive"}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
