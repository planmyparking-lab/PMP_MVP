import { describe, expect, it } from "vitest";

import {
  DEFAULT_WINDOW_MINUTES,
  findSessionByPlate,
  findSessionByShortCode,
  findSessionsByClassWindow,
  type OpenSessionRecord,
} from "../src/domain/findOpenSession";
import {
  cashChangePaise,
  CONTRACT_PAYABLE_MODES,
  duplicatePaymentSessions,
  exitEventForSession,
  isContractPayableMode,
  paymentEventForSession,
  paymentIntentFor,
  validatePaymentAmount,
  validateUpiAttestation,
} from "../src/domain/paymentRules";
import {
  computeShiftVariance,
  findOpenShift,
  shiftTotals,
  validateShiftClose,
  type ShiftOpenWindow,
} from "../src/domain/shiftTotals";
import { validateZoneCount, zoneGap } from "../src/domain/zoneCount";
import { zoneReminderTimes } from "../src/notifications/zoneReminders";

import type { Event } from "@pmp/contracts";

/**
 * Pure-rule tests mirroring member-02-nikhil.md D-tables:
 * T-GATE-02-U3/E4 (findOpenSession), T-GATE-04-U1/U2 (payment mapping), T-GATE-06-U1/U2/U3/N1/N2
 * (shift totals + closing rules), T-GATE-08 (zone count validation), T-GATE-08-U1 (reminders).
 */

function entry(
  device_id: string,
  at: string,
  sessionId = "11111111-1111-7111-8111-111111111111",
): Event {
  return {
    id: "c1111111-1111-7111-8111-111111111101",
    type: "ENTRY",
    facility_id: "fa777777-7777-7777-8777-777777777777",
    device_id,
    staff_id: "01877777-0000-7000-8000-00000000000a",
    device_time: at,
    source: "LIVE",
    schema_version: 1,
    session_id: sessionId,
    payload: {
      vehicle_class: "Car",
      zone_id: "01899999-8888-7888-8888-888888888801",
      short_code: "ABCDE",
      vehicle_no: "UP32AB1234",
    },
  };
}
function payment(
  device_id: string,
  at: string,
  sessionId: string,
  mode: "CASH" | "UPI",
  amount: number,
  upi_attested = false,
): Event {
  return {
    id: "c2222222-2222-7222-8222-222222222221",
    type: "PAYMENT",
    facility_id: "fa777777-7777-7777-8777-777777777777",
    device_id,
    staff_id: "01877777-0000-7000-8000-00000000000a",
    device_time: at,
    source: "LIVE",
    schema_version: 1,
    session_id: sessionId,
    payload: { mode, amount_paise: amount, upi_attested },
  };
}
function overrideEvent(
  device_id: string,
  at: string,
  sessionId = "11111111-1111-7111-8111-111111111111",
): Event {
  return {
    id: "c3333333-3333-7333-8333-333333333301",
    type: "OVERRIDE",
    facility_id: "fa777777-7777-7777-8777-777777777777",
    device_id,
    staff_id: "01877777-0000-7000-8000-00000000000a",
    device_time: at,
    source: "LIVE",
    schema_version: 1,
    session_id: sessionId,
    payload: {
      target_event_id: "c4444444-4444-7444-8444-444444444401",
      reason_code: "MISREAD_NUMBER",
    },
  };
}

const T0 = "2026-10-25T03:30:00.000Z"; // 09:00 IST — strict UTC instants per repo invariant

describe("findOpenSession (T-GATE-02-U3/E4)", () => {
  const sessions: OpenSessionRecord[] = [
    {
      sessionId: "s-car-1",
      shortCode: "ABCDE",
      vehicleClass: "CAR",
      vehicleNo: "UP32AB1234",
      enteredAt: "2026-10-25T03:00:00.000Z",
    },
    {
      sessionId: "s-car-2",
      shortCode: "BCDFG",
      vehicleClass: "CAR",
      enteredAt: "2026-10-25T01:30:00.000Z",
    },
    {
      sessionId: "s-bike-1",
      shortCode: "CDEFG",
      vehicleClass: "BIKE",
      enteredAt: "2026-10-25T02:15:00.000Z",
    },
  ];

  it("finds exactly one session by short code", () => {
    expect(findSessionByShortCode("ABCDE", sessions)).toEqual({
      kind: "one",
      session: sessions[0],
    });
  });

  it("returns none for an unknown code", () => {
    expect(findSessionByShortCode("VWXYZ", sessions)).toEqual({ kind: "none" });
  });

  it("matches by normalized plate only when a plate was recorded", () => {
    expect(findSessionByPlate("UP32AB1234", sessions)).toEqual({
      kind: "one",
      session: sessions[0],
    });
    expect(findSessionByPlate("MH01CD9999", sessions)).toEqual({ kind: "none" });
  });

  it("returns many matches sorted by entry time for class + window", () => {
    const outcome = findSessionsByClassWindow("CAR", sessions, T0, 360);
    expect(outcome.kind).toBe("many");
    if (outcome.kind === "many") {
      expect(outcome.sessions.map((s) => s.sessionId)).toEqual(["s-car-2", "s-car-1"]);
    }
  });

  it("excludes entries older than the window", () => {
    const sevenHoursOld: OpenSessionRecord = {
      sessionId: "s-car-old",
      shortCode: "DEFGH",
      vehicleClass: "CAR",
      enteredAt: "2026-10-24T20:00:00.000Z",
    };
    expect(findSessionsByClassWindow("CAR", [sevenHoursOld], T0, DEFAULT_WINDOW_MINUTES).kind).toBe(
      "none",
    );
  });

  it("fails closed on a malformed now instant", () => {
    expect(findSessionsByClassWindow("CAR", sessions, "not-an-instant").kind).toBe("none");
  });
});

describe("paymentRules (T-GATE-04-U1/U2, I1)", () => {
  it("maps every screen button to a PAYMENT payload", () => {
    expect(paymentIntentFor("CASH", 6000)).toEqual({
      button: "CASH",
      mode: "CASH",
      amountPaise: 6000,
      upiAttested: false,
    });
    expect(paymentIntentFor("UPI", 6000)).toEqual({
      button: "UPI",
      mode: "UPI",
      amountPaise: 6000,
      upiAttested: true,
    });
    expect(paymentIntentFor("PASS", 6000)).toEqual({
      button: "PASS",
      mode: "PASS",
      amountPaise: 0,
      upiAttested: false,
    });
    expect(paymentIntentFor("WAIVED", 6000)).toEqual({
      button: "WAIVED",
      mode: "WAIVED",
      amountPaise: 0,
      upiAttested: false,
    });
  });

  it("cash change calculator (T-GATE-04-E2): change only when the fare is covered", () => {
    expect(cashChangePaise(10000, 6000)).toBe(4000); // tendered 100.00, fare 60.00
    expect(cashChangePaise(6000, 6000)).toBe(0); // exact money → zero change (still a number)
    expect(cashChangePaise(5900, 6000)).toBeNull(); // tendered below fare → no change due
    expect(cashChangePaise(null, 6000)).toBeNull(); // empty input → row suppressed
    expect(cashChangePaise(60.5, 6000)).toBeNull(); // non-integer paise fails closed
    expect(cashChangePaise(-1, 6000)).toBeNull(); // negative tendered fails closed
    expect(cashChangePaise(10000, -6000)).toBeNull(); // malformed fare fails closed
  });

  it("UPI attestation is true only for UPI (T-GATE-04-U1)", () => {
    expect(validateUpiAttestation("UPI", true)).toEqual({ ok: true });
    expect(validateUpiAttestation("UPI", false)).toEqual({
      ok: false,
      reason: "UPI_MUST_BE_ATTESTED",
    });
    expect(validateUpiAttestation("CASH", true)).toEqual({
      ok: false,
      reason: "ATTESTATION_ONLY_FOR_UPI",
    });
    expect(validateUpiAttestation("CASH", false)).toEqual({ ok: true });
  });

  it("amount must equal the fare for Cash and UPI (T-GATE-04-U2); zero for Pass/Waived", () => {
    expect(validatePaymentAmount("CASH", 6000, 6000)).toEqual({ ok: true });
    expect(validatePaymentAmount("CASH", 4000, 6000)).toEqual({
      ok: false,
      reason: "AMOUNT_MISMATCH",
    });
    expect(validatePaymentAmount("UPI", 6000, 6000)).toEqual({ ok: true });
    expect(validatePaymentAmount("PASS", 0, 6000)).toEqual({ ok: true });
    expect(validatePaymentAmount("WAIVED", 500, 6000)).toEqual({
      ok: false,
      reason: "ZERO_REQUIRED",
    });
  });

  it("every PAYMENT_MODES value is IC-01 encodable (merged SYNC-01 contract)", () => {
    expect(isContractPayableMode("CASH")).toBe(true);
    expect(isContractPayableMode("UPI")).toBe(true);
    expect(isContractPayableMode("PASS")).toBe(true);
    expect(isContractPayableMode("WAIVED")).toBe(true);
    expect(isContractPayableMode("COMP")).toBe(false);
    expect(CONTRACT_PAYABLE_MODES).toEqual(["CASH", "UPI", "PASS", "WAIVED"]);
  });

  it("flags a second payment for the same session (T-GATE-04-I1 local guard)", () => {
    const pid = "d1111111-1111-7111-8111-111111111111";
    expect(
      duplicatePaymentSessions([
        { id: pid, session_id: "sess-1" },
        { id: "d2222222-2222-7222-8222-222222222222", session_id: "sess-1" },
      ]),
    ).toEqual([
      { sessionId: "sess-1", count: 2, eventIds: [pid, "d2222222-2222-7222-8222-222222222222"] },
    ]);
    expect(duplicatePaymentSessions([{ id: pid, session_id: "sess-1" }])).toEqual([]);
  });

  it("locates the EXIT and PAYMENT events of a session", () => {
    const events: Event[] = [
      entry("dev-1", T0, "sess-x"),
      payment("dev-1", T0, "sess-x", "CASH", 6000),
    ];
    expect(exitEventForSession(events, "sess-x")).toBeNull();
    expect(paymentEventForSession(events, "sess-x")?.type).toBe("PAYMENT");
  });
});

describe("shiftTotals (T-GATE-06-U1)", () => {
  const open = "2026-10-25T02:00:00.000Z";
  const close = "2026-10-25T10:00:00.000Z";
  const window: ShiftOpenWindow = { deviceId: "dev-1", openAt: open, closeAt: close };

  it("sums payments by mode and counts vehicles and overrides", () => {
    const events: Event[] = [
      entry("dev-1", "2026-10-25T02:10:00.000Z", "s-a"),
      entry("dev-1", "2026-10-25T03:00:00.000Z", "s-b"),
      entry("dev-2", "2026-10-25T03:30:00.000Z", "s-other"), // other device filtered by default
      payment("dev-1", "2026-10-25T04:00:00.000Z", "s-a", "CASH", 120000),
      payment("dev-1", "2026-10-25T05:00:00.000Z", "s-b", "UPI", 80000, true),
      overrideEvent("dev-1", "2026-10-25T05:30:00.000Z", "s-a"),
      entry("dev-1", "2026-10-24T23:00:00.000Z", "s-before-open"), // before the window
    ];
    const totals = shiftTotals(events, window);
    expect(totals.vehicles).toBe(2);
    expect(totals.paymentsByMode["CASH"]).toEqual({ count: 1, amountPaise: 120000 });
    expect(totals.paymentsByMode["UPI"]).toEqual({ count: 1, amountPaise: 80000 });
    expect(totals.upiAttested).toEqual({ count: 1, amountPaise: 80000 });
    expect(totals.overrides).toBe(1);
  });

  it("keeps payments outside the window out of the totals", () => {
    const events: Event[] = [
      payment("dev-1", "2026-10-25T01:00:00.000Z", "s-pre", "CASH", 500), // before open
      payment("dev-1", "2026-10-25T11:00:00.000Z", "s-post", "CASH", 500), // at/after close
    ];
    expect(shiftTotals(events, window).paymentsByMode).toEqual({});
  });

  it("computes the expected shift window from open/close envelopes per device", () => {
    const shiftD1 = "01899999-1111-7111-8111-111111111101";
    const shiftD2 = "01899999-1111-7111-8111-111111111102";
    const events: Event[] = [
      {
        id: "c5555555-5555-7555-8555-555555555501",
        type: "SHIFT_OPEN",
        facility_id: "fa777777-7777-7777-8777-777777777777",
        device_id: "dev-1",
        staff_id: "01877777-0000-7000-8000-00000000000a",
        device_time: open,
        source: "LIVE",
        schema_version: 1,
        session_id: null,
        payload: { shift_id: shiftD1, opening_float_paise: 50000 },
      },
      {
        id: "c5555555-5555-7555-8555-555555555502",
        type: "SHIFT_CLOSE",
        facility_id: "fa777777-7777-7777-8777-777777777777",
        device_id: "dev-1",
        staff_id: "01877777-0000-7000-8000-00000000000a",
        device_time: close,
        source: "LIVE",
        schema_version: 1,
        session_id: null,
        payload: {
          shift_id: shiftD1,
          counted_cash_paise: 119500,
          expected_cash_paise: 120000,
          upi_total_declared_paise: 81000,
          upi_attested_sum_paise: 80000,
          variance_cash_paise: -500,
          variance_upi_paise: 1000,
        },
      },
      {
        id: "c5555555-5555-7555-8555-555555555503",
        type: "SHIFT_OPEN",
        facility_id: "fa777777-7777-7777-8777-777777777777",
        device_id: "dev-2",
        staff_id: "01877777-0000-7000-8000-00000000000a",
        device_time: open,
        source: "LIVE",
        schema_version: 1,
        session_id: null,
        payload: { shift_id: shiftD2, opening_float_paise: 20000 },
      },
    ];
    expect(findOpenShift(events, "dev-1")).toBeNull(); // closed
    expect(findOpenShift(events, "dev-2")).toEqual({
      deviceId: "dev-2",
      openAt: open,
      shiftId: shiftD2,
      openingFloatPaise: 20000,
    });
    expect(
      findOpenShift(
        events.filter((e) => e.device_id === "dev-1"),
        "dev-1",
      ),
    ).toBeNull();
    const onlyOpen = events.filter((e) => e.type === "SHIFT_OPEN" && e.device_id === "dev-1");
    expect(findOpenShift([...onlyOpen], "dev-1")).toEqual({
      deviceId: "dev-1",
      openAt: open,
      shiftId: shiftD1,
      openingFloatPaise: 50000,
    });
  });
});

describe("variance and close rules (T-GATE-06-U2/U3/N1/N2)", () => {
  const base = {
    openingFloatPaise: 40000,
    countedCashPaise: 119500,
    upiDeclaredPaise: 81000,
    totals: {
      window: { openAt: T0 },
      vehicles: 20,
      paymentsByMode: {
        CASH: { count: 10, amountPaise: 80000 },
        UPI: { count: 10, amountPaise: 80000 },
      },
      upiAttested: { count: 10, amountPaise: 80000 },
      overrides: 0,
    },
    thresholdPaise: 500,
  };

  it("is arithmetically exact to the paisa (T-GATE-06-U2 with float added)", () => {
    // float 40000 + CASH 80000 = 120000 expected; counted 119500 → −500 (matches the sheet row)
    const variance = computeShiftVariance(base);
    expect(variance.expectedCashPaise).toBe(120000);
    expect(variance.cashVariancePaise).toBe(-500);
    expect(variance.upiAttestedTotalPaise).toBe(80000);
    expect(variance.upiVariancePaise).toBe(1000);
  });

  it("threshold is inclusive-beyond: variance == threshold needs no reason, beyond it does (T-GATE-06-U3)", () => {
    const equals = computeShiftVariance({ ...base, upiDeclaredPaise: 80050 });
    expect(equals.upiVariancePaise).toBe(50);
    expect(equals.upiReasonRequired).toBe(false);

    const at500 = computeShiftVariance({ ...base, upiDeclaredPaise: 80500 });
    expect(at500.upiVariancePaise).toBe(500);
    expect(at500.upiReasonRequired).toBe(false);

    const at501 = computeShiftVariance({ ...base, upiDeclaredPaise: 80501 });
    expect(at501.upiReasonRequired).toBe(true);
  });

  it("defaults the threshold to 0 when config is missing (documented recommendation)", () => {
    const v = computeShiftVariance({ ...base, thresholdPaise: null });
    expect(v.thresholdPaise).toBe(0);
    expect(v.cashReasonRequired).toBe(true); // −500 ≠ 0
  });

  it("blocks close without a counted value; zeroes are valid (T-GATE-06-N1)", () => {
    const variance = computeShiftVariance({ ...base, countedCashPaise: 0 });
    expect(validateShiftClose(undefined, variance, "reason text")).toEqual({
      ok: false,
      issue: "COUNTED_CASH_REQUIRED",
    });
    expect(validateShiftClose(null, variance, "reason text")).toEqual({
      ok: false,
      issue: "COUNTED_CASH_REQUIRED",
    });
    expect(validateShiftClose(0, variance, "reason text")).toEqual({ ok: true });
  });

  it("blocks close with unexplained variance (T-GATE-06-N2)", () => {
    const variance = computeShiftVariance({ ...base, countedCashPaise: 118000 }); // −2000 > 500
    expect(validateShiftClose(118000, variance, null)).toEqual({
      ok: false,
      issue: "VARIANCE_REASON_REQUIRED",
    });
    expect(validateShiftClose(118000, variance, "  ")).toEqual({
      ok: false,
      issue: "VARIANCE_REASON_REQUIRED",
    });
    expect(validateShiftClose(118000, variance, "short change given")).toEqual({ ok: true });
  });

  it("rejects non-integer money inputs instead of coercing them to zero", () => {
    expect(() => computeShiftVariance({ ...base, openingFloatPaise: Number.NaN })).toThrow();
    expect(() => computeShiftVariance({ ...base, countedCashPaise: 1.5 })).toThrow();
  });
});

describe("zoneCount (GATE-08 seq 4.3)", () => {
  it("accepts integers within 0..capacity with no warning", () => {
    expect(validateZoneCount(8, 10)).toEqual({ ok: true });
    expect(validateZoneCount(10, 10)).toEqual({ ok: true });
    expect(validateZoneCount(0, 10)).toEqual({ ok: true });
  });

  it("warns but allows above capacity within the 50% safety allowance", () => {
    expect(validateZoneCount(12, 10)).toEqual({ ok: true, warning: "ABOVE_CAPACITY" });
    expect(validateZoneCount(15, 10)).toEqual({ ok: true, warning: "ABOVE_CAPACITY" }); // capacity × 1.5
  });

  it("rejects non-integers, negatives and anything beyond capacity + 50%", () => {
    expect(validateZoneCount(16, 10)).toEqual({ ok: false, issue: "ABOVE_SAFETY_LIMIT" });
    expect(validateZoneCount(-1, 10)).toEqual({ ok: false, issue: "NEGATIVE" });
    expect(validateZoneCount(2.5, 10)).toEqual({ ok: false, issue: "NOT_AN_INTEGER" });
    expect(validateZoneCount(5, -2)).toEqual({ ok: false, issue: "INVALID_CAPACITY" });
  });

  it("documents the C-rule vs D-table limit conflict explicitly (OQ-47)", () => {
    // D.8-U2 literal rows for capacity 50: "0 and 50 accepted; 76 warn+confirm; -1, 2.5 rejected".
    // The C-section's "capacity + 50%" (=75) would reject 76 — impossible under that reading —
    // so the ABSOLUTE_PLUS_50 mode exists to satisfy the table until OQ-47 is decided.
    expect(validateZoneCount(76, 50, { safetyLimitMode: "ABSOLUTE_PLUS_50" })).toEqual({
      ok: true,
      warning: "ABOVE_CAPACITY",
    });
    expect(validateZoneCount(76, 50)).toEqual({ ok: false, issue: "ABOVE_SAFETY_LIMIT" }); // proportional default
    expect(validateZoneCount(-1, 50)).toEqual({ ok: false, issue: "NEGATIVE" });
    expect(validateZoneCount(2.5, 50)).toEqual({ ok: false, issue: "NOT_AN_INTEGER" });
    expect(validateZoneCount(0, 50)).toEqual({ ok: true });
    expect(validateZoneCount(50, 50)).toEqual({ ok: true });
  });

  it("reports the gap direction and magnitude for the screen and MET-01", () => {
    expect(zoneGap(12, 10)).toEqual({ gap: 2, direction: "OVER" });
    expect(zoneGap(8, 10)).toEqual({ gap: -2, direction: "UNDER" });
    expect(zoneGap(10, 10)).toEqual({ gap: 0, direction: "EXACT" });
  });
});

describe("zoneReminders (T-GATE-08-U1)", () => {
  it("schedules reminders at one-third and two-thirds of a known shift length", () => {
    const plan = zoneReminderTimes(T0, 540); // 9 h → T+3 h, T+6 h
    expect(plan.usedDefault).toBe(false);
    expect(plan.remindersIso).toEqual(["2026-10-25T06:30:00.000Z", "2026-10-25T09:30:00.000Z"]);
    expect(plan.reminderAlarms.map((a) => a.atIso)).toEqual(plan.remindersIso);
  });

  it("falls back to the 8-hour default when the length is unknown", () => {
    const plan = zoneReminderTimes(T0, null);
    expect(plan.usedDefault).toBe(true);
    expect(plan.lengthMinutes).toBe(480);
    // 8 h / 3 = 2 h 40 m, 2/3 = 5 h 20 m
    expect(plan.remindersIso).toEqual(["2026-10-25T06:10:00.000Z", "2026-10-25T08:50:00.000Z"]);
  });

  it("floors fractional offsets to whole minutes", () => {
    const plan = zoneReminderTimes(T0, 500); // 1/3 = 166.67 min → floor to 166 whole minutes
    expect(plan.remindersIso[0]).toBe("2026-10-25T06:16:00.000Z");
  });
});
