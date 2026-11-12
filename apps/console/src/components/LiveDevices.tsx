import type { FacilityLive } from "../lib/data/types";
import { formatIstDateTime } from "../lib/format";
import { Banner, Card, EmptyState, StatCard, StatusBadge } from "./ui/primitives";

export function LiveDevices({ live }: { live: FacilityLive }) {
  const devices = live.devices.ok ? live.devices.data : [];
  const staff = live.staff.ok ? live.staff.data : [];
  const active = devices.filter((d) => d.revokedAt === null).length;
  const guards = staff.filter((s) => s.active).length;

  return (
    <>
      <Banner tone="info" icon="info" title="Enrolment and health are read-only for now">
        Devices and staff below come from the database. Last-seen, queue size and battery need the
        device_heartbeats table, and adding a phone needs the enroll_device function (both CLD-03 /
        CLD-04, not built yet).
      </Banner>

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

      <div className="grid grid-2" style={{ alignItems: "start" }}>
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
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
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
                    </tr>
                  ))}
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
