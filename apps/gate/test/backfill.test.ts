import { describe, expect, it } from "vitest";

import {
  backfillDuplicateWarning,
  isOlderThan24h,
  resolvePaperTime,
  validateBackfillExit,
  validateBackfillTime,
} from "../src/domain/backfill";
import type { OpenSessionRecord } from "../src/domain/findOpenSession";

/**
 * Paper-backfill rules (T-GATE-11 style): HH:MM resolution ("most recent past instant"), the
 * future/24h time gate (D.11), the typed-amount-means-reason rule (D.11-N1), and the ±10 minute
 * duplicate warning (D.11-U2). The write stays blocked until the IC-01 contract supports
 * backfill provenance — no event is asserted.
 */

const DAY_MS = 24 * 60 * 60_000;

function row(input: Partial<OpenSessionRecord> & { sessionId: string }): OpenSessionRecord {
  return {
    sessionId: input.sessionId,
    shortCode: input.shortCode ?? "P4RK1",
    vehicleClass: input.vehicleClass ?? "Car",
    vehicleNo: input.vehicleNo ?? null,
    enteredAt: input.enteredAt ?? "2026-07-15T14:20:00.000Z",
    zoneId: input.zoneId,
  };
}

describe("resolvePaperTime (T-GATE-11-U1 style)", () => {
  it("resolves today's wall time when it is already past", () => {
    const at = new Date(2026, 6, 15, 15, 0, 0, 0).getTime(); // local 15:00
    const expected = new Date(2026, 6, 15, 14, 35, 0, 0).getTime();
    const result = resolvePaperTime("14:35", at);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Date.parse(result.iso)).toBe(expected);
  });

  it("rolls back to yesterday when today's wall time is still in the future", () => {
    const at = new Date(2026, 6, 15, 10, 0, 0, 0).getTime(); // local 10:00
    const expected = new Date(2026, 6, 15, 14, 35, 0, 0).getTime() - DAY_MS;
    const result = resolvePaperTime("14:35", at);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Date.parse(result.iso)).toBe(expected);
  });

  it("accepts a single leading digit but nothing looser", () => {
    const at = new Date(2026, 6, 15, 15, 0, 0, 0).getTime();
    expect(resolvePaperTime("9:05", at).ok).toBe(true);
    expect(resolvePaperTime("24:00", at).ok).toBe(false);
    expect(resolvePaperTime("9:5", at).ok).toBe(false);
    expect(resolvePaperTime("ab:cd", at).ok).toBe(false);
    expect(resolvePaperTime("14:35 pm", at).ok).toBe(false);
    expect(resolvePaperTime("  ", at).ok).toBe(false);
  });
});

describe("validateBackfillTime (D.11 gate)", () => {
  const now = "2026-07-15T10:00:00Z";
  const opened = "2026-07-15T09:00:00Z";

  it("accepts a paper time inside the window and reports in-shift", () => {
    expect(validateBackfillTime("2026-07-15T09:30:00Z", now, opened)).toEqual({
      ok: true,
      inShift: true,
    });
    expect(validateBackfillTime("2026-07-14T20:00:00Z", now, opened)).toEqual({
      ok: true,
      inShift: false,
    });
    expect(validateBackfillTime("2026-07-15T09:30:00Z", now, null)).toEqual({
      ok: true,
      inShift: false,
    });
  });

  it("rejects future times outright", () => {
    expect(validateBackfillTime("2026-07-15T10:00:01Z", now, opened)).toEqual({
      ok: false,
      issue: "FUTURE",
    });
  });

  it("marks older than 24 hours (supervisor decision is a screen concern)", () => {
    expect(validateBackfillTime("2026-07-14T10:00:00Z", now, opened)).toEqual({
      ok: false,
      issue: "OLDER_THAN_24H",
    });
    expect(validateBackfillTime("2026-07-14T10:00:01Z", now, opened)).toEqual({
      ok: true,
      inShift: false,
    });
  });

  it("fails closed on unparseable instants", () => {
    expect(validateBackfillTime("not-a-date", now, opened)).toEqual({
      ok: false,
      issue: "INVALID_TIME",
    });
    expect(validateBackfillTime(now, "also-not-a-date", opened)).toEqual({
      ok: false,
      issue: "INVALID_TIME",
    });
  });
});

describe("isOlderThan24h", () => {
  it("matches the same boundary, fail-closed on garbage", () => {
    expect(isOlderThan24h("2026-07-14T10:00:00Z", "2026-07-15T10:00:00Z")).toBe(true);
    expect(isOlderThan24h("2026-07-14T10:00:01Z", "2026-07-15T10:00:00Z")).toBe(false);
    expect(isOlderThan24h("", "2026-07-15T10:00:00Z")).toBe(true);
  });
});

describe("validateBackfillExit (D.11-N1: typed amount needs a reason)", () => {
  it("requires mode, then amount, then reason", () => {
    expect(validateBackfillExit({ mode: null, amountPaise: null, reasonCode: null })).toEqual({
      ok: false,
      issue: "MODE_REQUIRED",
    });
    expect(validateBackfillExit({ mode: "CASH", amountPaise: null, reasonCode: null })).toEqual({
      ok: false,
      issue: "AMOUNT_REQUIRED",
    });
    expect(validateBackfillExit({ mode: "CASH", amountPaise: 10.5, reasonCode: null })).toEqual({
      ok: false,
      issue: "AMOUNT_INVALID",
    });
    expect(validateBackfillExit({ mode: "UPI", amountPaise: -1, reasonCode: null })).toEqual({
      ok: false,
      issue: "AMOUNT_INVALID",
    });
    expect(validateBackfillExit({ mode: "CASH", amountPaise: 15000, reasonCode: "" })).toEqual({
      ok: false,
      issue: "REASON_REQUIRED",
    });
  });

  it("accepts a complete draft; zero needs no reason", () => {
    expect(
      validateBackfillExit({ mode: "UPI", amountPaise: 23000, reasonCode: "MISREAD_NUMBER" }),
    ).toEqual({ ok: true });
    expect(validateBackfillExit({ mode: "CASH", amountPaise: 0, reasonCode: null })).toEqual({
      ok: true,
    });
  });
});

describe("backfillDuplicateWarning (D.11-U2: ±10 minutes)", () => {
  const paper = "2026-07-15T14:20:00Z";

  it("warns on a short code hit inside the window", () => {
    const rows = [row({ sessionId: "a", shortCode: "P4RK1", enteredAt: "2026-07-15T14:19:30Z" })];
    expect(backfillDuplicateWarning(rows, { shortCode: "P4RK1", vehicleNo: null }, paper)).toEqual({
      duplicateOf: rows,
    });
  });

  it("warns on a matching plate, not on a different one", () => {
    const hit = row({ sessionId: "a", vehicleNo: "DL01AB1234", enteredAt: "2026-07-15T14:25:00Z" });
    const miss = row({
      sessionId: "b",
      vehicleNo: "KA01XY9999",
      enteredAt: "2026-07-15T14:25:00Z",
    });
    const result = backfillDuplicateWarning(
      [hit, miss],
      { shortCode: null, vehicleNo: "DL01AB1234" },
      paper,
    );
    expect(result.duplicateOf).toEqual([hit]);
  });

  it("is silent beyond the window or on a pattern-invalid code", () => {
    const rows = [
      row({ sessionId: "a", shortCode: "P4RK1", enteredAt: "2026-07-15T14:30:01Z" }),
      row({ sessionId: "b", shortCode: "P4RK1", enteredAt: "2026-07-15T14:09:59Z" }),
    ];
    expect(
      backfillDuplicateWarning(rows, { shortCode: "P4RK1", vehicleNo: null }, paper).duplicateOf,
    ).toEqual([]);
    expect(
      // O is not in the 5-char code alphabet: the code identity cannot match anything
      backfillDuplicateWarning(
        [row({ sessionId: "c", shortCode: "ABCDE", enteredAt: "2026-07-15T14:20:00Z" })],
        { shortCode: "OBLK1", vehicleNo: null },
        paper,
      ).duplicateOf,
    ).toEqual([]);
  });

  it("survives malformed paper times with no warning", () => {
    expect(
      backfillDuplicateWarning(
        [row({ sessionId: "a" })],
        { shortCode: "P4RK1", vehicleNo: null },
        "bad",
      ),
    ).toEqual({ duplicateOf: [] });
  });
});
