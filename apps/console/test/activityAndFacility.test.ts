import { describe, expect, it } from "vitest";
import tariffs from "../../../packages/domain/src/fixtures/tariffs.json";
import { parseActivityFilter, summarizeEvent } from "../src/lib/activity";
import type { EventRowIn } from "../src/lib/activity";
import { describeTariff, maskPlate, passState } from "../src/lib/facilityConfig";

const ZONE = "00000000-0000-4000-8000-0000000000c1";
const zoneName = (id: string) => (id === ZONE ? "Basement A" : "Unknown zone");
const row = (type: string, payload: unknown, over: Partial<EventRowIn> = {}): EventRowIn => ({
  id: "0190f0f0-0000-7000-8000-000000000001",
  type,
  device_time: "2026-11-12T06:00:00Z",
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

describe("facility configuration", () => {
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
    expect(maskPlate("MH12AB1234")).toBe("MH12••••34");
    expect(maskPlate("mh-12 ab 1234")).toBe("MH12••••34");
    expect(maskPlate("AB1")).toBe("••••");
    expect(passState("2026-11-11", "2026-11-12")).toBe("expired");
    expect(passState("2026-11-19", "2026-11-12")).toBe("expiring");
    expect(passState("2026-12-31", "2026-11-12")).toBe("active");
  });
});
