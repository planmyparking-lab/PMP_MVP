"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { formatRupees } from "@pmp/contracts";
import type { ShiftsLive } from "../lib/data/shifts";
import { formatIstDateTime } from "../lib/format";
import { formatSignedRupees, hasVariance, SHIFT_EVENT_LIMIT } from "../lib/shifts";
import type { ShiftRow } from "../lib/shifts";
import {
  Banner,
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  StatusBadge,
  Tabs,
  UnavailableButton,
} from "./ui/primitives";

type Filter = "all" | "variance" | "closed" | "open";

const SIGN_OFF_WHY =
  "Signing off writes a shift_reviews row. That table and its security policy are not built yet (Akanksha).";

function Money({ paise }: { paise: number | undefined }) {
  return <span className="num">{paise === undefined ? "—" : formatRupees(paise)}</span>;
}

function Variance({ paise }: { paise: number | undefined }) {
  if (paise === undefined) return <span className="muted">—</span>;
  return <StatusBadge tone={paise === 0 ? "ok" : "warn"}>{formatSignedRupees(paise)}</StatusBadge>;
}

export function LiveShifts({ live, liveStatus }: { live: ShiftsLive; liveStatus?: ReactNode }) {
  const [filter, setFilter] = useState<Filter>("all");
  const build = live.shifts.ok ? live.shifts.data : null;
  const rows = build?.rows ?? [];
  const closed = rows.filter((r) => r.status === "closed");
  const withVariance = rows.filter(hasVariance);
  const visible = rows.filter((r: ShiftRow) =>
    filter === "all"
      ? true
      : filter === "variance"
        ? hasVariance(r)
        : filter === "closed"
          ? r.status === "closed"
          : r.status === "open",
  );
  const who = (id: string) => live.staffNames[id] ?? "Unknown guard";
  const device = (id: string) => live.deviceNames[id] ?? "Unknown device";

  return (
    <>
      <PageHeader
        title="Shifts"
        description="Cash and UPI at the close of every shift in the last 30 days, read from the shift events the gate phones send."
        actions={
          <>
            {liveStatus}
            <UnavailableButton variant="primary" icon="check" reason={SIGN_OFF_WHY}>
              Sign off shift
            </UnavailableButton>
          </>
        }
      />
      {!live.shifts.ok ? (
        <Banner tone="bad" icon="alert" title="Shift events could not be read">
          {live.shifts.error}
        </Banner>
      ) : (
        <Banner tone="info" icon="info" title="Read-only for now">
          Shifts are built from SHIFT_OPEN and SHIFT_CLOSE events until the shift views exist.
          Variances are shown exactly as the phone sent them; the sign convention and the
          &ldquo;needs a note&rdquo; threshold are not decided yet (OQ-22).
          {build && build.skipped > 0
            ? ` ${build.skipped} event(s) had a payload that did not match the contract and were left out.`
            : ""}
        </Banner>
      )}
      {live.truncated && (
        <Banner tone="warn" icon="alert" title="Only the most recent shift events are shown">
          This page reads at most the latest {SHIFT_EVENT_LIMIT.toLocaleString("en-IN")} shift
          events. The limit was reached, so older shifts from the last 30 days may be missing, and
          the oldest shift shown may be missing its open or close.
        </Banner>
      )}

      <div className="grid grid-4 stagger" style={{ marginBottom: "var(--s-4)" }}>
        <StatCard
          label="Shifts (30 days)"
          icon="clock"
          value={build ? String(rows.length) : undefined}
          foot="Opened or closed"
        />
        <StatCard
          label="Closed"
          icon="checkCircle"
          value={build ? String(closed.length) : undefined}
          foot="A close event arrived"
        />
        <StatCard
          label="With variance"
          icon="alert"
          value={build ? String(withVariance.length) : undefined}
          foot="Cash or UPI not zero"
        />
        <StatCard
          label="Still open"
          icon="device"
          value={build ? String(rows.length - closed.length) : undefined}
          foot="Running, or close not synced yet"
        />
      </div>

      <Card flush>
        <div style={{ padding: "var(--s-3) var(--s-5) 0" }}>
          <Tabs
            label="Filter shifts"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `All (${rows.length})` },
              { value: "variance", label: `With variance (${withVariance.length})` },
              { value: "closed", label: `Closed (${closed.length})` },
              { value: "open", label: `Open (${rows.length - closed.length})` },
            ]}
          />
        </div>
        {visible.length === 0 ? (
          <EmptyState icon="clock" title="No shifts to show">
            {rows.length === 0
              ? "No shift was opened or closed on a gate phone in the last 30 days."
              : "No shift matches this filter."}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Closed</th>
                  <th>Guard</th>
                  <th>Expected cash</th>
                  <th>Counted cash</th>
                  <th>Cash variance</th>
                  <th>UPI declared</th>
                  <th>UPI attested</th>
                  <th>UPI variance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.shiftId}>
                    <td className="num">
                      {r.closedAt ? formatIstDateTime(r.closedAt) : "—"}
                      {r.openedAt && (
                        <div className="small muted">Opened {formatIstDateTime(r.openedAt)}</div>
                      )}
                    </td>
                    <td className="nowrap">
                      <b>{who(r.staffId)}</b>
                      <div className="small muted">{device(r.deviceId)}</div>
                    </td>
                    <td>
                      <Money paise={r.close?.expectedCashPaise} />
                    </td>
                    <td>
                      <Money paise={r.close?.countedCashPaise} />
                    </td>
                    <td>
                      <Variance paise={r.close?.varianceCashPaise} />
                    </td>
                    <td>
                      <Money paise={r.close?.upiDeclaredPaise} />
                    </td>
                    <td>
                      <Money paise={r.close?.upiAttestedPaise} />
                    </td>
                    <td>
                      <Variance paise={r.close?.varianceUpiPaise} />
                    </td>
                    <td>
                      {r.status === "closed" ? (
                        <StatusBadge tone="info">Closed · not reviewed</StatusBadge>
                      ) : (
                        <StatusBadge tone="off">Open or waiting for sync</StatusBadge>
                      )}
                      {r.close?.reason && (
                        <div className="small muted" title={r.close.reason}>
                          Guard note: {r.close.reason}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
