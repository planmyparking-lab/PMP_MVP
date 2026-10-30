import { describe, expect, it } from "vitest";

import {
  buildTokenReceipt,
  buildTokenReceiptWithoutQr,
  type ReceiptInput,
} from "../src/print/escpos";

/**
 * Receipt layout tests (GATE-10 sequence 4.1: `src/print/escpos.ts` receipt layout builder).
 * The byte LAYOUT is the testable core; the Bluetooth transport, 5 s timeout and single retry
 * are the device-side part pending OQ-31 (printer model / library choice).
 */

const PAYLOAD =
  "parkos:fa7a7a7a-7a7a-7a7a-8a7a-7a7a7a7a7a7a:ABCDE:01833333-3333-7333-8333-333333333331";

const INPUT: ReceiptInput = {
  facilityName: "Metro Parking",
  shortCode: "ABCDE",
  qrPayload: PAYLOAD,
  enteredAtDisplay: "2026-11-01 07:30 IST",
  vehicleClass: "Car",
};

/** Bytes as a Latin-1 string, so text lines can be asserted content-wise. */
function asString(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

/** Index of the first occurrence of a byte sub-sequence, or -1. */
function indexOfSeq(bytes: Uint8Array, seq: number[]): number {
  outer: for (let i = 0; i <= bytes.length - seq.length; i += 1) {
    for (let j = 0; j < seq.length; j += 1) {
      if (bytes[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

describe("escpos receipt layout (GATE-10 seq 4.1)", () => {
  it("starts with ESC/POS initialize and contains the documented text lines", () => {
    const bytes = buildTokenReceipt(INPUT);
    expect([bytes[0], bytes[1]]).toEqual([0x1b, 0x40]); // ESC @ initialize
    const text = asString(bytes);
    expect(text).toContain("Metro Parking\n");
    expect(text).toContain("Token: ABCDE\n");
    expect(text).toContain("Time: 2026-11-01 07:30 IST\n");
    expect(text).toContain("Class: Car\n");
  });

  it("emits the five GS ( k QR frames in the spec order with model 2 consistently", () => {
    const bytes = buildTokenReceipt(INPUT);
    const payload = Array.from(PAYLOAD, (c) => c.charCodeAt(0) & 0xff);
    const pL = (payload.length + 3) & 0xff;
    const pH = (payload.length + 3) >> 8;
    const frames = [
      [0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32], // fn 65: model 2
      [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06], // fn 67: module size 6
      [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30], // fn 69: EC level L
      [0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x31, ...payload], // fn 80: store
      [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x31], // fn 81: print
    ];
    let cursor = 0;
    for (const frame of frames) {
      const at = indexOfSeq(bytes, frame);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeGreaterThanOrEqual(cursor);
      cursor = at + frame.length;
    }
    // exactly five occurrences of the GS ( k opaque-command header
    let hits = 0;
    let from = 0;
    while (indexOfSeq(bytes.slice(from), [0x1d, 0x28, 0x6b]) >= 0) {
      hits += 1;
      from += indexOfSeq(bytes.slice(from), [0x1d, 0x28, 0x6b]) + 3;
    }
    expect(hits).toBe(5);
  });

  it("ends with a partial cut", () => {
    const bytes = buildTokenReceipt(INPUT);
    const cut = [0x1d, 0x56, 0x42, 0x00];
    expect(Array.from(bytes.slice(bytes.length - cut.length))).toEqual(cut);
  });

  it("the QR-free fallback keeps the layout but drops every GS ( k frame", () => {
    const bytes = buildTokenReceiptWithoutQr(INPUT);
    const text = asString(bytes);
    expect(text).toContain("Token: ABCDE\n");
    expect(indexOfSeq(bytes, [0x1d, 0x28, 0x6b])).toBe(-1);
    expect([bytes[0], bytes[1]]).toEqual([0x1b, 0x40]);
    const cut = [0x1d, 0x56, 0x42, 0x00];
    expect(Array.from(bytes.slice(bytes.length - cut.length))).toEqual(cut);
  });
});
