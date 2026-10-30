import { describe, expect, it } from "vitest";

import { initialPrintState, reducePrintState, deliverReceipt } from "../src/print/printMachine";
import { fakePrinterTransport } from "../src/print/printer";

/**
 * Print honesty machine (GATE-10): one receipt → one automatic retry → final report; late
 * attempts after a terminal stage are dropped; manual reprints start a fresh pair; a hanging
 * transport surfaces TIMEOUT (never a silent pass, T-GATE-10 style).
 */

const bytes = new Uint8Array([0x1b, 0x40]);

describe("reducePrintState", () => {
  it("walks attempt → OK", () => {
    let state = reducePrintState(initialPrintState, { kind: "start" });
    expect(state.stage).toBe("PRINTING");
    state = reducePrintState(state, { kind: "attemptDone", outcome: "OK" });
    expect(state).toEqual({ stage: "OK", attemptsUsed: 1, lastOutcome: "OK" });
  });

  it("retries once after an error, then ends FAILED with the outcome recorded", () => {
    let state = reducePrintState(initialPrintState, { kind: "start" });
    state = reducePrintState(state, { kind: "attemptDone", outcome: "ERROR" });
    expect(state.stage).toBe("PRINTING");
    state = reducePrintState(state, { kind: "attemptDone", outcome: "ERROR" });
    expect(state.stage).toBe("FAILED");
    expect(state.attemptsUsed).toBe(2);
    expect(state.lastOutcome).toBe("ERROR");
  });

  it("a second-attempt OK saves the print", () => {
    let state = reducePrintState(initialPrintState, { kind: "start" });
    state = reducePrintState(state, { kind: "attemptDone", outcome: "TIMEOUT" });
    state = reducePrintState(state, { kind: "attemptDone", outcome: "OK" });
    expect(state.stage).toBe("OK");
    expect(state.attemptsUsed).toBe(2);
  });

  it("drops late attempts after a terminal stage", () => {
    let state = reducePrintState(initialPrintState, { kind: "start" });
    state = reducePrintState(state, { kind: "attemptDone", outcome: "OK" });
    expect(reducePrintState(state, { kind: "attemptDone", outcome: "ERROR" })).toBe(state);
  });

  it("manual reprint from PRINTING is a no-op; from OK it starts a fresh pair", () => {
    let state = reducePrintState(initialPrintState, { kind: "start" });
    state = reducePrintState(state, { kind: "manualReprint" });
    expect(state.attemptsUsed).toBe(0);
    state = reducePrintState(state, { kind: "attemptDone", outcome: "OK" });
    expect(reducePrintState(state, { kind: "manualReprint" })).toEqual({
      stage: "PRINTING",
      attemptsUsed: 0,
    });
  });
});

describe("deliverReceipt", () => {
  it("succeeds on the first attempt and stops there", async () => {
    const report = await deliverReceipt(fakePrinterTransport("succeed"), bytes, { timeoutMs: 200 });
    expect(report).toEqual({ outcome: "OK", attemptsUsed: 1 });
  });

  it("fails honestly after exercising exactly one retry", async () => {
    const report = await deliverReceipt(fakePrinterTransport("throw"), bytes, { timeoutMs: 200 });
    expect(report).toEqual({ outcome: "ERROR", attemptsUsed: 2 });
  });

  it("surfaces TIMEOUT for a hanging transport (both attempts)", async () => {
    const report = await deliverReceipt(fakePrinterTransport("slow", { delayMs: 120 }), bytes, {
      timeoutMs: 20,
    });
    expect(report).toEqual({ outcome: "TIMEOUT", attemptsUsed: 2 });
  });
});
