import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { drift } from "@pmp/sync-rules";
import { LiveOccupancy } from "../src/components/LiveOccupancy";
import type { FacilityLive } from "../src/lib/data/types";
import { zoneChecks, zoneCountRecords } from "../src/lib/zoneDrift";

const Z1 = "0190f0f0-0000-7000-8000-0000000000a1";
const Z2 = "0190f0f0-0000-7000-8000-0000000000a2";
const NOW = "2026-11-13T12:00:00Z";
const row = (id: string, zone: string, counted: number, system: number, at: string) => ({
  id,
  device_time: at,
  payload: { zone_id: zone, counted, system_count_at_time: system },
});

describe("zone physical counts (SYNC-04 drift rule from @pmp/sync-rules)", () => {
  const records = zoneCountRecords([
    row("e1", Z1, 50, 50, "2026-11-13T05:00:00Z"),
    row("e2", Z1, 52, 50, "2026-11-13T09:30:00Z"), // latest valid for Z1: +2 of 50 = 4% -> flagged
    row("e3", Z1, 10, 99, "2026-11-13T12:30:00Z"), // 30 min in the future: ignored
    row("e4", Z2, 101, 100, "2026-11-11T09:00:00Z"), // +1 of 100 = 1% -> not flagged, and over 24 h old
    { id: "bad", device_time: "2026-11-13T11:00:00Z", payload: { zone_id: Z1, counted: -1 } },
  ]);

  it("leaves out rows whose payload breaks the contract", () => {
    expect(records.map((r) => r.id)).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("picks the same count as drift() and applies the 3% flag", () => {
    const checks = zoneChecks(records, [Z1, Z2, "never-counted"], NOW);
    expect(checks[Z1]).toMatchObject({
      counted: 52,
      systemCountAtTime: 50,
      drift: 2,
      flagged: true,
    });
    expect(checks[Z1]?.drift).toBe(drift(records, Z1, NOW));
    expect(checks[Z2]).toMatchObject({ drift: 1, flagged: false, stale: true });
    expect(checks["never-counted"]).toBeNull();
  });

  it("flags any difference when the system showed an empty zone", () => {
    const empty = zoneCountRecords([row("e9", Z1, 1, 0, "2026-11-13T10:00:00Z")]);
    expect(zoneChecks(empty, [Z1], NOW)[Z1]?.flagged).toBe(true);
  });
});

describe("occupancy board", () => {
  const live = (zoneChecksValue: FacilityLive["zoneChecks"]): FacilityLive =>
    ({
      facility: { id: "f1", orgId: "o1", name: "Demo", timezone: "Asia/Kolkata", slotCount: 300 },
      asOf: NOW,
      zones: {
        ok: true,
        data: [
          { id: Z1, name: "Cars", capacity: 200, vehicleClass: "Car", occupied: 50 },
          { id: Z2, name: "Bikes", capacity: 100, vehicleClass: "Bike", occupied: 100 },
        ],
      },
      inside: { ok: true, data: [] },
      zoneChecks: zoneChecksValue,
    }) as unknown as FacilityLive;

  it("shows the latest physical count of each zone and flags drift over 3%", () => {
    const html = renderToStaticMarkup(
      <LiveOccupancy
        live={live({
          ok: true,
          data: {
            [Z1]: {
              counted: 52,
              systemCountAtTime: 50,
              drift: 2,
              flagged: true,
              countedAt: "2026-11-13T09:30:00Z",
              stale: false,
            },
            [Z2]: null,
          },
        })}
      />,
    );
    expect(html).toContain("52 counted, system showed");
    expect(html).toContain("Off by +2 (over 3%)");
    expect(html).toContain("No physical count recorded yet.");
  });

  it("keeps the board up when physical counts cannot be read", () => {
    const html = renderToStaticMarkup(
      <LiveOccupancy live={live({ ok: false, error: "zone counts: denied" })} />,
    );
    expect(html).toContain("Physical counts could not be read.");
    expect(html).toContain("Cars");
  });
});
