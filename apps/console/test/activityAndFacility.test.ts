import { describe, expect, it } from "vitest";
import tariffs from "../../../packages/domain/src/fixtures/tariffs.json";
import { maskNote, parseActivityFilter, summarizeEvent } from "../src/lib/activity";
import type { EventRowIn } from "../src/lib/activity";
import { describeTariff, maskPlate, passState } from "../src/lib/facilityConfig";

const ZONE = "00000000-0000-4000-8000-0000000000c1";
const zoneName = (id: string) => (id === ZONE ? "Basement A" : "Unknown zone");
const row = (type: string, payload: unknown, over: Partial<EventRowIn> = {}): EventRowIn => ({
  id: "0190f0f0-0000-7000-8000-000000000001",
  type,
  device_time: "2026-11-12T06:00:00Z",
  received_at: "2026-11-12T06:00:05Z",
  source: "LIVE",
  staff_id: "s1",
  device_id: "d1",
  session_id: "0190f0f0-0000-7000-8000-000000000009",
  payload,
  ...over,
});

describe("activity log lines (all gate event types)", () => {
  it("summarises an entry without ever showing the number plate", () => {
    const l = summarizeEvent(
      row("ENTRY", {
        vehicle_class: "CAR",
        zone_id: ZONE,
        short_code: "7K2QX",
        vehicle_no: "MH12AB1234",
      }),
      zoneName,
    );
    expect(l).toMatchObject({ type: "ENTRY", valid: true, attention: false });
    expect(l.detail).toBe("Token 7K2QX · CAR · Basement A");
    expect(JSON.stringify(l)).not.toContain("MH12AB1234");
  });

  it("describes exits, payments, overrides, zone counts and shifts", () => {
    expect(
      summarizeEvent(row("EXIT", { fare_paise: 4000, exit_method: "SCAN" }), zoneName).detail,
    ).toBe("Fare ₹40.00 · token scanned");
    expect(
      summarizeEvent(
        row("PAYMENT", { mode: "UPI", amount_paise: 4000, upi_attested: true }),
        zoneName,
      ).detail,
    ).toBe("₹40.00 UPI, attested");
    const waived = summarizeEvent(
      row("PAYMENT", { mode: "WAIVED", amount_paise: 0, upi_attested: false }),
      zoneName,
    );
    expect(waived.attention).toBe(true);
    const ov = summarizeEvent(
      row("OVERRIDE", {
        target_event_id: "0190f0f0-0000-7000-8000-000000000002",
        reason_code: "OTHER",
        note: "Gate jammed",
      }),
      zoneName,
    );
    expect(ov).toMatchObject({ detail: "Other: Gate jammed", attention: true });
    const zc = summarizeEvent(
      row(
        "ZONE_COUNT",
        { zone_id: ZONE, counted: 52, system_count_at_time: 50 },
        { session_id: null },
      ),
      zoneName,
    );
    expect(zc).toMatchObject({
      detail: "Basement A: counted 52, system showed 50 (+2)",
      attention: true,
    });
    const close = summarizeEvent(
      row(
        "SHIFT_CLOSE",
        {
          shift_id: "00000000-0000-4000-8000-000000005001",
          counted_cash_paise: 61500,
          expected_cash_paise: 66000,
          upi_total_declared_paise: 0,
          upi_attested_sum_paise: 0,
          variance_cash_paise: -4500,
          variance_upi_paise: 0,
        },
        { session_id: null },
      ),
      zoneName,
    );
    expect(close.detail).toBe("Counted ₹615.00 of ₹660.00 expected (−₹45.00)");
  });

  it("marks paper backfill and flags a payload that breaks the contract", () => {
    expect(
      summarizeEvent(
        row("EXIT", { fare_paise: 1, exit_method: "SCAN" }, { source: "PAPER_BACKFILL" }),
        zoneName,
      ).backfill,
    ).toBe(true);
    const bad = summarizeEvent(row("EXIT", { fare_paise: -1, exit_method: "SCAN" }), zoneName);
    expect(bad).toMatchObject({ valid: false, attention: true });
    expect(summarizeEvent(row("PAYMENT_CORRECTION", {}), zoneName)).toMatchObject({
      type: "UNKNOWN",
      valid: false,
    });
  });

  it("accepts only known filters from the URL", () => {
    const id = "0190f0f0-0000-7000-8000-000000000009";
    expect(parseActivityFilter({ type: "override", session: id })).toEqual({
      type: "OVERRIDE",
      sessionId: id,
      eventIds: [],
    });
    expect(
      parseActivityFilter({ type: "drop table", session: "x", events: `${id},nope,${id}` }),
    ).toEqual({ type: null, sessionId: null, eventIds: [id, id] });
  });
});

describe("activity privacy and timing", () => {
  it("masks plates and phone numbers typed into override notes", () => {
    expect(maskNote("Plate MH12AB1234, call 98765 43210")).toBe("Plate ••••, call •••• ••••");
    expect(maskNote("  Gate jammed  ")).toBe("Gate jammed");
    const ov = summarizeEvent(
      row("OVERRIDE", {
        target_event_id: "0190f0f0-0000-7000-8000-000000000002",
        reason_code: "MISREAD_NUMBER",
        note: "was MH-12-AB-1234 not MH12AB1243",
      }),
      zoneName,
    );
    expect(ov.detail).toBe("Misread number: was •••• not ••••");
    expect(JSON.stringify(ov)).not.toMatch(/1234|1243/);
  });

  it("keeps both the phone's time and the receipt time", () => {
    const l = summarizeEvent(
      row("EXIT", { fare_paise: 0, exit_method: "SCAN" }, { received_at: "2026-11-14T09:00:00Z" }),
      zoneName,
    );
    expect(l).toMatchObject({
      deviceTime: "2026-11-12T06:00:00Z",
      receivedAt: "2026-11-14T09:00:00Z",
    });
  });
});

describe("facility configuration", () => {
  const base = {
    id: "0192f0a0-0000-7000-9000-00000000a009",
    facilityId: "f1",
    vehicleClass: "Car",
    effectiveFrom: "2026-11-01",
    graceMinutes: 0,
  };
  const linesOf = (rule: object) => {
    const s = describeTariff({ ...base, ...rule });
    if (!s.ok) throw new Error(s.error);
    return s.lines;
  };

  it("describes FLAT as a price per started 24 hours, as the fare engine charges it", () => {
    expect(linesOf({ model: "FLAT", flatPaise: 5000 })).toEqual(["₹50.00 for every started 24 h"]);
  });

  it("describes PER_ENTRY as one price however long the stay", () => {
    expect(linesOf({ model: "PER_ENTRY", flatPaise: 1000, graceMinutes: 5 })).toEqual([
      "₹10.00 once per entry, however long the stay",
      "First 5 min free",
    ]);
  });

  it("describes night pricing as an amount added on top, never as a share of the fare", () => {
    const slabs = {
      model: "HOURLY_SLABS",
      slabs: [{ upToMinutes: 60, pricePaise: 3000 }],
      repeat: { everyMinutes: 60, pricePaise: 2000 },
    };
    expect(
      linesOf({ ...slabs, night: { fromHHMM: "2200", toHHMM: "0600", multiplierPercent: 50 } }).at(
        -1,
      ),
    ).toBe("Stay touching 22:00–06:00 (night): 50% of the fare added on top");
    expect(
      linesOf({ ...slabs, night: { fromHHMM: "2200", toHHMM: "0600", surchargePaise: 2500 } }).at(
        -1,
      ),
    ).toBe("Stay touching 22:00–06:00 (night): ₹25.00 added");
  });

  it("describes a contract-valid tariff in plain words", () => {
    const s = describeTariff(tariffs[0]);
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.model).toBe("HOURLY_SLABS");
      expect(s.lines).toEqual([
        "Up to 1 h: ₹30.00",
        "1 h to 3 h: ₹60.00",
        "After that: ₹20.00 for every started 1 h",
        "First 15 min free",
        "At most ₹300.00 per day",
      ]);
    }
  });

  it("reports a rule that breaks the contract instead of summarising it", () => {
    const s = describeTariff({ model: "FLAT", flatPaise: -5 });
    expect(s.ok).toBe(false);
  });

  it("masks number plates and classifies pass validity", () => {
    expect(maskPlate("MH12AB1234")).toBe("MH••••••34");
    expect(maskPlate("mh-12 ab 1234")).toBe("MH••••••34");
    expect(maskPlate("DL3CAF0001")).toBe("DL••••••01");
    // Short values would be mostly visible with first and last two, so they are hidden completely.
    for (const short of ["AB1", "MH12AB", "KA0112"]) expect(maskPlate(short)).toBe("••••");
    // Never more than four characters of any plate are visible.
    for (const plate of ["MH12AB1234", "XX-MA-0412", "TN09BZ12345"])
      expect(maskPlate(plate).replace(/•/g, "").length).toBeLessThanOrEqual(4);
    expect(passState("2026-11-11", "2026-11-12")).toBe("expired");
    expect(passState("2026-11-19", "2026-11-12")).toBe("expiring");
    expect(passState("2026-12-31", "2026-11-12")).toBe("active");
  });
});
