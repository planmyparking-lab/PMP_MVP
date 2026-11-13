import { formatRupees } from "@pmp/contracts";
import type { FacilityConfigLive } from "../lib/data/facilityConfig";
import { formatIstDate } from "../lib/format";
import { Banner, Card, EmptyState, PageHeader, StatCard, StatusBadge } from "./ui/primitives";

const PASS_TONE = { active: "ok", expiring: "warn", expired: "off" } as const;
const PASS_LABEL = {
  active: "Active",
  expiring: "Expires within 7 days",
  expired: "Expired",
} as const;

function safeDate(d: string): string {
  try {
    return formatIstDate(d.slice(0, 10));
  } catch {
    return d;
  }
}

/** Read-only facility configuration: zones, tariffs and monthly passes (migration 0001). */
export function FacilityView({ live, reason }: { live?: FacilityConfigLive; reason?: string }) {
  if (!live) {
    return (
      <>
        <PageHeader
          title="Facility"
          description="Zones, tariffs and monthly passes for the selected facility."
        />
        <Card flush>
          <EmptyState icon="plugOff" title="Facility details are not available">
            {reason ?? "Sign in to read the facility configuration."}
          </EmptyState>
        </Card>
      </>
    );
  }
  const zones = live.zones.ok ? live.zones.data : [];
  const tariffs = live.tariffs.ok ? live.tariffs.data : [];
  const passes = live.passes.ok ? live.passes.data : [];
  const capacity = zones.reduce((s, z) => s + z.capacity, 0);
  const activePasses = passes.filter((p) => p.state !== "expired").length;
  const dues = passes.reduce((s, p) => s + p.duesPaise, 0);

  return (
    <>
      <PageHeader
        title={live.facility.name}
        description={`Configuration as stored in the database. ${live.facility.slotCount} slots, time zone ${live.facility.timezone}. Editing happens in Setup once saving is built.`}
      />
      <div className="grid grid-4 stagger" style={{ marginBottom: "var(--s-4)" }}>
        <StatCard
          label="Zones"
          icon="gauge"
          value={live.zones.ok ? String(zones.length) : undefined}
          foot={`${capacity} zone slots`}
        />
        <StatCard
          label="Tariffs"
          icon="file"
          value={live.tariffs.ok ? String(tariffs.length) : undefined}
          foot="Including older versions"
        />
        <StatCard
          label="Monthly passes"
          icon="checkCircle"
          value={live.passes.ok ? String(activePasses) : undefined}
          foot={`${passes.length - activePasses} expired`}
        />
        <StatCard
          label="Pass dues"
          icon="alert"
          value={live.passes.ok ? formatRupees(dues) : undefined}
          foot="Owed on passes"
        />
      </div>

      <div className="stack">
        <Card title="Zones" subtitle="Capacity and the vehicle class each zone takes" flush>
          {!live.zones.ok ? (
            <EmptyState icon="plugOff" title="Zones could not be read">
              {live.zones.error}
            </EmptyState>
          ) : zones.length === 0 ? (
            <EmptyState icon="gauge" title="No zones yet">
              Zones are created in facility setup.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th>Vehicle class</th>
                    <th>Capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {zones.map((z) => (
                    <tr key={z.id}>
                      <td>
                        <b>{z.name}</b>
                      </td>
                      <td>{z.vehicleClass}</td>
                      <td className="num">{z.capacity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Tariffs"
          subtitle="What the gate phones charge, per vehicle class, checked against the shared tariff contract"
          flush
        >
          {!live.tariffs.ok ? (
            <EmptyState icon="plugOff" title="Tariffs could not be read">
              {live.tariffs.error}
            </EmptyState>
          ) : tariffs.length === 0 ? (
            <EmptyState icon="file" title="No tariffs yet">
              Tariffs are set in facility setup; every vehicle class needs one before activation.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Vehicle class</th>
                    <th>From</th>
                    <th>Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {tariffs.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <b>{t.vehicleClass}</b>
                      </td>
                      <td className="num">{safeDate(t.effectiveFrom)}</td>
                      <td>
                        {t.summary.ok ? (
                          <ul className="rule-lines">
                            {t.summary.lines.map((l) => (
                              <li key={l}>{l}</li>
                            ))}
                          </ul>
                        ) : (
                          <StatusBadge tone="bad">{t.summary.error}</StatusBadge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Monthly passes"
          subtitle="Number plates are partly hidden. Soonest expiry first."
          flush
        >
          {live.passesTruncated && (
            <div style={{ padding: "var(--s-3) var(--s-5)" }}>
              <Banner tone="warn" icon="alert" title="Only the first 500 passes are shown" />
            </div>
          )}
          {!live.passes.ok ? (
            <EmptyState icon="plugOff" title="Passes could not be read">
              {live.passes.error}
            </EmptyState>
          ) : passes.length === 0 ? (
            <EmptyState icon="checkCircle" title="No monthly passes">
              Passes issued for this facility appear here.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Valid to</th>
                    <th>Status</th>
                    <th>Dues</th>
                  </tr>
                </thead>
                <tbody>
                  {passes.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <code>{p.plate}</code>
                      </td>
                      <td className="num">{safeDate(p.validTo)}</td>
                      <td>
                        <StatusBadge tone={PASS_TONE[p.state]}>{PASS_LABEL[p.state]}</StatusBadge>
                      </td>
                      <td className="num">
                        {p.duesPaise > 0 ? (
                          <StatusBadge tone="warn">{formatRupees(p.duesPaise)}</StatusBadge>
                        ) : (
                          "—"
                        )}
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
