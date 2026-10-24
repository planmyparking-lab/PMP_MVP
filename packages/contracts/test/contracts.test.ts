import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, formatRupees, isSupported, parseEvent, toPaise } from "../src/index.js";

const id = "0192f0a0-0000-7000-8000-000000000001";
const sid = "0192f0a0-0000-7000-8000-000000000002";
const common = {
  id,
  device_id: "dev-1",
  device_time: "2026-01-01T10:00:00Z",
  schema_version: SCHEMA_VERSION,
};

describe("money (T-SYNC-01-U*)", () => {
  it("converts rupees to integer paise", () => {
    expect(toPaise(12.5)).toBe(1250);
    expect(toPaise(0.1 + 0.2)).toBe(30);
  });
  it("rejects negatives and sub-paise precision", () => {
    expect(() => toPaise(-1)).toThrow();
    expect(() => toPaise(1.234)).toThrow();
  });
  it("formats paise", () => {
    expect(formatRupees(123456)).toBe("₹1,234.56");
  });
});

describe("version", () => {
  it("gates on min supported version", () => {
    expect(isSupported(1, 1)).toBe(true);
    expect(isSupported(1, 2)).toBe(false);
  });
});

describe("events", () => {
  it("accepts a valid ENTRY", () => {
    expect(parseEvent({ ...common, type: "ENTRY", session_id: sid }).ok).toBe(true);
  });
  it("rejects unknown type", () => {
    expect(parseEvent({ ...common, type: "NOPE" }).ok).toBe(false);
  });
  it("rejects fractional or negative payment amounts", () => {
    const p = { ...common, type: "PAYMENT", session_id: sid, mode: "CASH" };
    expect(parseEvent({ ...p, amount_paise: 10.5 }).ok).toBe(false);
    expect(parseEvent({ ...p, amount_paise: -1 }).ok).toBe(false);
    expect(parseEvent({ ...p, amount_paise: 1000 }).ok).toBe(true);
  });
  it("upi_attested only with mode UPI", () => {
    const p = { ...common, type: "PAYMENT", session_id: sid, amount_paise: 500 };
    expect(parseEvent({ ...p, mode: "CASH", upi_attested: true }).ok).toBe(false);
    expect(parseEvent({ ...p, mode: "UPI", upi_attested: true }).ok).toBe(true);
  });
  it("OVERRIDE with OTHER requires a note", () => {
    const o = {
      ...common,
      type: "OVERRIDE",
      session_id: sid,
      target_event_id: id,
      reason_code: "OTHER",
    };
    expect(parseEvent(o).ok).toBe(false);
    expect(parseEvent({ ...o, note: "gate jammed" }).ok).toBe(true);
  });
  it("rejects non-UTC device_time", () => {
    expect(
      parseEvent({
        ...common,
        device_time: "2026-01-01T10:00:00+05:30",
        type: "ENTRY",
        session_id: sid,
      }).ok,
    ).toBe(false);
  });
});
