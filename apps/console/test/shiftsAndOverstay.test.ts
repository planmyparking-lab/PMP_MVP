import { describe, expect, it } from "vitest";
import type { VehicleInside } from "../src/lib/data/types";
import {
  EXAMPLE_THRESHOLD_MINUTES,
  overstayCsv,
  overstayList,
  parseThreshold,
} from "../src/lib/overstayList";
import { buildShiftRows, formatSignedRupees, hasVariance, instantMicros } from "../src/lib/shifts";
import type { ShiftEventRow } from "../src/lib/shifts";

const SHIFT = "0190f0f0-0000-4000-8000-000000000001";
const SHIFT_2 = "0190f0f0-0000-4000-8000-000000000002";
const close = (over: Record<string, unknown> = {}) => ({
  shift_id: SHIFT,
  counted_cash_paise: 50_000,
  expected_cash_paise: 50_000,
  upi_total_declared_paise: 20_000,
  upi_attested_sum_paise: 20_000,
  variance_cash_paise: 0,
  variance_upi_paise: 0,
  ...over,
});
const ev = (
  type: ShiftEventRow["type"],
  device_time: string,
  payload: unknown,
  staff_id = "staff-1",
): ShiftEventRow => ({ type, device_time, device_id: "dev-1", staff_id, payload });

describe("buildShiftRows (CON-06, OQ-51)", () => {
  it("pairs open and close by shift_id and marks the shift closed", () => {
    const { rows, skipped } = buildShiftRows([
      ev("SHIFT_CLOSE", "2026-11-08T14:00:00Z", close()),
      ev("SHIFT_OPEN", "2026-11-08T06:00:00Z", { shift_id: SHIFT, opening_float_paise: 1000 }),
    ]);
    expect(skipped).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      shiftId: SHIFT,
      status: "closed",
      openedAt: "2026-11-08T06:00:00Z",
      closedAt: "2026-11-08T14:00:00Z",
      openingFloatPaise: 1000,
    });
    expect(rows[0]?.close?.countedCashPaise).toBe(50_000);
  });

  it("keeps an open-only shift as open (running or close not synced)", () => {
    const { rows } = buildShiftRows([
      ev("SHIFT_OPEN", "2026-11-08T06:00:00Z", { shift_id: SHIFT, opening_float_paise: 0 }),
    ]);
    expect(rows[0]?.status).toBe("open");
    expect(rows[0]?.close).toBeNull();
  });

  it("skips and counts payloads that fail the shared schema instead of guessing", () => {
    const { rows, skipped } = buildShiftRows([
      ev("SHIFT_CLOSE", "2026-11-08T14:00:00Z", close({ counted_cash_paise: -5 })),
      ev("SHIFT_OPEN", "2026-11-08T06:00:00Z", { shift_id: "not-a-uuid", opening_float_paise: 0 }),
      ev("SHIFT_CLOSE", "2026-11-08T14:00:00Z", { ...close(), extra: 1 }),
    ]);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(3);
  });

  it("uses the latest close and the earliest open when events repeat", () => {
    const { rows } = buildShiftRows([
      ev("SHIFT_CLOSE", "2026-11-08T14:00:00Z", close({ counted_cash_paise: 1 })),
      ev("SHIFT_CLOSE", "2026-11-08T15:00:00Z", close({ counted_cash_paise: 2 }), "staff-2"),
      ev("SHIFT_OPEN", "2026-11-08T07:00:00Z", { shift_id: SHIFT, opening_float_paise: 7 }),
      ev("SHIFT_OPEN", "2026-11-08T06:00:00Z", { shift_id: SHIFT, opening_float_paise: 6 }),
    ]);
    expect(rows[0]?.close?.countedCashPaise).toBe(2);
    expect(rows[0]?.staffId).toBe("staff-2");
    expect(rows[0]?.openingFloatPaise).toBe(6);
  });

  it("sorts newest first and flags variance only when not zero", () => {
    const { rows } = buildShiftRows([
      ev("SHIFT_CLOSE", "2026-11-07T14:00:00Z", close()),
      ev(
        "SHIFT_CLOSE",
        "2026-11-08T14:00:00Z",
        close({ shift_id: SHIFT_2, variance_upi_paise: -250 }),
      ),
    ]);
    expect(rows.map((r) => r.shiftId)).toEqual([SHIFT_2, SHIFT]);
    expect(rows.map(hasVariance)).toEqual([true, false]);
  });
});

describe("shift times are compared as instants, not text (PR #29 review)", () => {
  it("reads microseconds exactly, with Z or an offset", () => {
    expect(instantMicros("2026-11-08T10:00:00Z")).toBe(Date.parse("2026-11-08T10:00:00Z") * 1000);
    expect(instantMicros("2026-11-08T10:00:00.000001Z")).toBe(
      Date.parse("2026-11-08T10:00:00Z") * 1000 + 1,
    );
    expect(instantMicros("2026-11-08T15:30:00.5+05:30")).toBe(
      Date.parse("2026-11-08T10:00:00Z") * 1000 + 500_000,
    );
    expect(instantMicros("yesterday")).toBeNull();
  });

  it("latest close wins even when text order disagrees ('.' sorts before 'Z')", () => {
    const { rows } = buildShiftRows([
      ev("SHIFT_CLOSE", "2026-11-08T10:00:00.000001Z", close({ counted_cash_paise: 2 })),
      ev("SHIFT_CLOSE", "2026-11-08T10:00:00Z", close({ counted_cash_paise: 1 })),
    ]);
    expect(rows[0]?.close?.countedCashPaise).toBe(2);
    expect(rows[0]?.closedAt).toBe("2026-11-08T10:00:00.000001Z");
  });

  it("first open wins across Z and +00:00 spellings of the same clock", () => {
    const { rows } = buildShiftRows([
      ev("SHIFT_OPEN", "2026-11-08T06:00:00.25+00:00", {
        shift_id: SHIFT,
        opening_float_paise: 2,
      }),
      ev("SHIFT_OPEN", "2026-11-08T06:00:00.1Z", { shift_id: SHIFT, opening_float_paise: 1 }),
    ]);
    expect(rows[0]?.openingFloatPaise).toBe(1);
  });

  it("sorts newest first by instant when precisions are mixed", () => {
    const { rows } = buildShiftRows([
      ev("SHIFT_CLOSE", "2026-11-08T10:00:00Z", close()),
      ev("SHIFT_CLOSE", "2026-11-08T10:00:00.000001Z", close({ shift_id: SHIFT_2 })),
    ]);
    expect(rows.map((r) => r.shiftId)).toEqual([SHIFT_2, SHIFT]);
  });

  it("skips an event whose device_time is not a valid instant", () => {
    const { rows, skipped } = buildShiftRows([ev("SHIFT_CLOSE", "not-a-time", close())]);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

describe("formatSignedRupees", () => {
  it("shows the sign as sent and zero without one", () => {
    expect(formatSignedRupees(1250)).toBe("+₹12.50");
    expect(formatSignedRupees(-300)).toBe("−₹3.00");
    expect(formatSignedRupees(0)).toBe("₹0.00");
    expect(() => formatSignedRupees(1.5)).toThrow(RangeError);
  });
});

describe("overstay list (CON-09)", () => {
  const NOW = "2026-11-08T12:00:00Z";
  const v = (id: string, minutesAgo: number, passId: string | null = null): VehicleInside => ({
    sessionId: id,
    shortCode: `T${id}`,
    zoneName: "Basement A",
    vehicleClass: "CAR",
    entryTime: new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString(),
    hasPass: passId !== null,
    passId,
  });

  it("lists at-or-over sessions longest first and leaves out pass holders (OQ-46)", () => {
    const rows = overstayList(
      [v("a", 239), v("b", 240), v("c", 400), v("d", 500, "pass")],
      NOW,
      240,
    );
    expect(rows.map((r) => [r.sessionId, r.ageMinutes])).toEqual([
      ["c", 400],
      ["b", 240],
    ]);
    expect(rows[0]).toMatchObject({ shortCode: "Tc", zoneName: "Basement A" });
  });

  it("reads the threshold safely and falls back to the example value", () => {
    expect(parseThreshold("90")).toEqual({ minutes: 90, fromQuery: true });
    expect(parseThreshold(undefined)).toEqual({
      minutes: EXAMPLE_THRESHOLD_MINUTES,
      fromQuery: false,
    });
    for (const bad of ["29", "abc", "1.5", "-40", ["60"]]) {
      const t = parseThreshold(bad);
      expect(t.minutes).toBe(EXAMPLE_THRESHOLD_MINUTES);
      expect(t.fromQuery).toBe(false);
    }
    expect(parseThreshold("10").error).toMatch(/at least 30/);
  });

  it("exports CSV without number plates and escapes quotes", () => {
    const csv = overstayCsv([
      {
        sessionId: "s1",
        shortCode: 'A"B',
        zoneName: "Zone, 1",
        vehicleClass: "CAR",
        entryTime: "2026-11-08T08:00:00.000Z",
        ageMinutes: 240,
      },
    ]);
    expect(csv).toBe(
      '"token","zone","vehicle_class","entry_time","minutes_inside","session_id"\r\n' +
        '"A""B","Zone, 1","CAR","2026-11-08T08:00:00.000Z","240","s1"\r\n',
    );
    expect(csv).not.toMatch(/vehicle_no/);
  });
});
