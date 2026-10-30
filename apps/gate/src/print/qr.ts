import qrcode from "qrcode-generator";

/**
 * Pure QR module-matrix builder for on-screen token display (GATE-01 token screen, GATE-10
 * TokenFullScreen). A native/svg renderer is NOT on the approved native-module list, so the
 * screen renders the matrix as a View grid; the matrix itself is built here where vitest can
 * pin it (the QR payload that goes IN is exactly `qrPayloadFor`'s output, GATE-01 rule 8).
 *
 * The ESC/POS printer QR (src/print/escpos.ts) is a separate, byte-level path: a receipt does
 * not depend on this module and vice versa. `qrcode-generator` is a dependency-free pure-JS
 * library (choice documented in the gate README alongside the printer-library note: prototype
 * usable, license MIT, maintenance healthy; revisit when the device build lands).
 */

export type QrMatrix = {
  /** n x n boolean grid; size printed with the payload. */
  modules: boolean[][];
  moduleCount: number;
  visibleBytes: number;
};

export type QrErrorCorrection = "L" | "M" | "Q" | "H";

/** Build the dark/light matrix for a payload; null when the payload cannot encode (fail-safe). */
export function buildQrMatrix(
  payload: string,
  options: { errorCorrection?: QrErrorCorrection } = {},
): QrMatrix | null {
  if (typeof payload !== "string" || payload.length === 0) return null;
  if (!/^[\x20-\x7e]*$/.test(payload)) {
    // The device's QR payloads are ASCII (`parkos:...`); anything else is a data bug, not a QR.
    return null;
  }
  try {
    // typeNumber 0 = auto-size; error correction M (default): balanced damage tolerance.
    const ec = options.errorCorrection ?? "M";
    const qr = qrcode(0, ec);
    qr.addData(payload);
    qr.make();
    const moduleCount = qr.getModuleCount();
    const modules: boolean[][] = [];
    for (let row = 0; row < moduleCount; row += 1) {
      const line: boolean[] = [];
      for (let col = 0; col < moduleCount; col += 1) {
        line.push(qr.isDark(row, col));
      }
      modules.push(line);
    }
    return { modules, moduleCount, visibleBytes: payload.length };
  } catch {
    return null;
  }
}
