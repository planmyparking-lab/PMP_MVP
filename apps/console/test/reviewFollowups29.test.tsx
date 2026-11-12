import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LiveShifts } from "../src/components/LiveShifts";
import { csvCell } from "../src/lib/csv";
import type { ShiftsLive } from "../src/lib/data/shifts";
import { overstayCsv } from "../src/lib/overstayList";

describe("csvCell: formula injection (PR #29 review)", () => {
  it("prefixes text that a spreadsheet would run as a formula", () => {
    for (const v of ["=1+1", "+91", "-2", "@SUM(A1)", "\tx", "\rx"]) {
      expect(csvCell(v)).toBe(`"'${v}"`);
    }
  });

  it("leaves ordinary text, quotes, nulls and numbers alone", () => {
    expect(csvCell("Basement A")).toBe('"Basement A"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a=b")).toBe('"a=b"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(240)).toBe('"240"');
  });

  it("is applied to the overstay export", () => {
    const csv = overstayCsv([
      {
        sessionId: "s1",
        shortCode: "K7Q2M",
        zoneName: '=HYPERLINK("http://x")',
        vehicleClass: "CAR",
        entryTime: "2026-11-08T08:00:00.000Z",
        ageMinutes: 240,
      },
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});

describe("LiveShifts: event limit notice (PR #29 review)", () => {
  const live = (truncated: boolean): ShiftsLive => ({
    facilityName: "Test",
    asOf: "2026-11-12T00:00:00Z",
    shifts: { ok: true, data: { rows: [], skipped: 0 } },
    staffNames: {},
    deviceNames: {},
    truncated,
  });

  it("says when only the most recent 2,000 events were read", () => {
    const html = renderToStaticMarkup(<LiveShifts live={live(true)} />);
    expect(html).toContain("Only the most recent shift events are shown");
    expect(html).toContain("2,000");
  });

  it("shows no notice when the limit was not reached", () => {
    const html = renderToStaticMarkup(<LiveShifts live={live(false)} />);
    expect(html).not.toContain("Only the most recent shift events are shown");
  });
});
