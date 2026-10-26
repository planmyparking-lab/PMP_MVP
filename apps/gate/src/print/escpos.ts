/**
 * ESC/POS receipt layout builder (GATE-10 sequence 4.1, the S module `src/print/escpos.ts`).
 *
 * The receipt LAYOUT is standard ESC/POS and library-independent, so the byte builder is testable
 * in CI. What stays device-side (pending OQ-31, the printer model/library choice): the Bluetooth
 * transport, the 5-second timeout, the single retry, and pairing — the builder here only produces
 * bytes; nothing touches radio. QR is emitted with the ESC/POS Kanji-compatible QR command — if a
 * printer model rejects it, the fallback is also builder-provided.
 *
 * Layout (GATE-10 behaviour 2): token code, QR, time, facility name, vehicle class.
 * Receipt contains no personal data; the QR holds identifiers only (GATE-10 security 11).
 */

export type ReceiptInput = {
  facilityName: string;
  shortCode: string;
  /** QR payload as bytes (ASCII), e.g. 'parkos:<facilityId>:<code>:<sessionId>'. */
  qrPayload: string;
  /** Display timestamp for the receipt (IST string, from istDateString). */
  enteredAtDisplay: string;
  vehicleClass: string;
};

// Standard ESC/POS byte commands (subset used by the layout).
const ESC = 0x1b;
const GS = 0x1d;

function text(value: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    bytes.push(value.charCodeAt(i) & 0xff);
  }
  bytes.push(0x0a); // newline (LF)
  return bytes;
}

function centered(value: string): number[] {
  return [ESC, 0x61, 0x01, ...text(value)];
}

function partialCut(): number[] {
  return [GS, 0x56, 0x42, 0x00];
}

/** ESC/POS QR data sequence: model (fn 65) → module size (fn 67) → EC level (fn 69) →
 * store data (fn 80) → print (fn 81), each its own `GS ( k` frame, model 2 raster mode. */
function qrCommand(payload: string): number[] {
  const data: number[] = [];
  for (let i = 0; i < payload.length; i += 1) {
    data.push(payload.charCodeAt(i) & 0xff);
  }
  const pL = (data.length + 3) & 0xff;
  const pH = (data.length + 3) >> 8;
  return [
    // fn 65 (model selection): n = 49|50 → model 1|2, so model 2 is 0x32 here
    // (fn 80/81 use m = 48|49 where model 2 is 0x31 — the two numerations differ per spec).
    GS,
    0x28,
    0x6b,
    0x04,
    0x00,
    0x31,
    0x41,
    0x32,
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x43,
    0x06, // fn 67: module size 6 dots
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x45,
    0x30, // fn 69: EC level L
    GS,
    0x28,
    0x6b,
    pL,
    pH,
    0x31,
    0x50,
    0x31,
    ...data, // fn 80: store, model 2
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x51,
    0x31, // fn 81: print (raster mode)
  ];
}

/** Build the full receipt byte stream: init, alignment, lines, QR (centered), cut. */
export function buildTokenReceipt(input: ReceiptInput): Uint8Array {
  const bytes: number[] = [ESC, 0x40]; // initialize
  bytes.push(...centered(input.facilityName));
  bytes.push(...centered(`Token: ${input.shortCode}`));
  bytes.push(...centered(`Time: ${input.enteredAtDisplay}`));
  bytes.push(...centered(`Class: ${input.vehicleClass}`));
  bytes.push(...qrCommand(input.qrPayload));
  bytes.push(0x0a, 0x0a, 0x0a); // spacing before cut
  bytes.push(...partialCut());
  return new Uint8Array(bytes);
}

/** Same receipt without a QR command, for printers that reject the QR function (bitmap
 * fallback is the transport's job once the model is picked, OQ-31). */
export function buildTokenReceiptWithoutQr(input: ReceiptInput): Uint8Array {
  const bytes: number[] = [ESC, 0x40];
  bytes.push(...centered(input.facilityName));
  bytes.push(...centered(`Token: ${input.shortCode}`));
  bytes.push(...centered(`Time: ${input.enteredAtDisplay}`));
  bytes.push(...centered(`Class: ${input.vehicleClass}`));
  bytes.push(0x0a, 0x0a, 0x0a);
  bytes.push(...partialCut());
  return new Uint8Array(bytes);
}
