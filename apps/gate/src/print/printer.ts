/**
 * Printer transport port (GATE-10 sequence 4.5, OQ-31).
 *
 * The REAL Bluetooth ESC/POS transport depends on the printer-model decision (open-questions
 * register OQ-31: library choice pinned to a real device; the sheet requires the choice to be
 * documented with its maintenance status). Until that decision, nothing in the app touches
 * Bluetooth — a missing transport is a fail-safe (failed print → TokenFullScreen), never a
 * fake success. `FakePrinterTransport` exists ONLY to exercise the state machine and the
 * fallback path in the dev shell and on the printer screen, labeled as a test double there.
 */

export type PrinterTransport = {
  /** Readable name for the status/log line (e.g. "FakePrinter(dev)"). */
  readonly name: string;
  /** Print the ESC/POS bytes; resolves on success, rejects on transport error. A hang surfaces
   * as the deliverReceipt timeout (5 s), not a thrown error. */
  print(bytes: Uint8Array): Promise<void>;
};

/** Demo transport for the print-state machine + TokenFullScreen fallback wiring. */
export function fakePrinterTransport(
  behavior: "succeed" | "slow" | "throw",
  options: { delayMs?: number } = {},
): PrinterTransport {
  return {
    name: "FakePrinter(dev)",
    async print() {
      if (options.delayMs !== undefined && behavior !== "throw") {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (behavior === "throw") throw new Error("FakePrinter: simulated print failure");
    },
  };
}
