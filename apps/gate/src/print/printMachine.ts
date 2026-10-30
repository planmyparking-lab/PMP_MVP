import type { PrinterTransport } from "./printer";

/**
 * Print state machine (GATE-10 sequence 4.2/4.3, test T-GATE-10-U2; the R rule "print queue with
 * a 5-second timeout and ONE retry; at most one automatic retry; manual Reprint").
 *
 * `reducePrintState` is pure: OK and FAILED are the only terminal states and the automatic retry
 * runs exactly once. The 5-second timing and the transport call live in `deliverReceipt`, which
 * is also testable with a fake transport (succeed / throw / hang → timeout).
 *
 * Printing NEVER precedes the local save and a failure never rolls back an entry — the screen
 * calls this only after writeEvent/writeExit resolved (GATE-10 rule 7), and TokenFullScreen is
 * rendered on FAILED (fallback rule 9).
 */

export type PrintStage = "IDLE" | "PRINTING" | "OK" | "FAILED";

export type PrintMachineState = {
  stage: PrintStage;
  /** Completed attempts (transport answered); 2 max — the original print + the one retry. */
  attemptsUsed: number;
  /** Last attempt's outcome, for the screen's hint line. */
  lastOutcome?: "OK" | "TIMEOUT" | "ERROR";
};

export type PrintMachineAction =
  | { kind: "start" }
  | { kind: "attemptDone"; outcome: "OK" | "TIMEOUT" | "ERROR" }
  | { kind: "manualReprint" };

export const initialPrintState: PrintMachineState = { stage: "IDLE", attemptsUsed: 0 };

const MAX_ATTEMPTS = 2;

export function reducePrintState(
  state: PrintMachineState,
  action: PrintMachineAction,
): PrintMachineState {
  switch (action.kind) {
    case "start":
      return { stage: "PRINTING", attemptsUsed: 0 };
    case "manualReprint":
      // manual reprints are a fresh pair of attempts (the screen shows the reprint button)
      if (state.stage === "PRINTING") return state;
      return { stage: "PRINTING", attemptsUsed: 0 };
    case "attemptDone": {
      if (state.stage !== "PRINTING") return state; // late attempts after OK/FAILED are dropped
      const attemptsUsed = state.attemptsUsed + 1;
      if (action.outcome === "OK") {
        return { stage: "OK", attemptsUsed, lastOutcome: "OK" };
      }
      return attemptsUsed >= MAX_ATTEMPTS
        ? { stage: "FAILED", attemptsUsed, lastOutcome: action.outcome }
        : { stage: "PRINTING", attemptsUsed, lastOutcome: action.outcome };
    }
    default:
      return state;
  }
}

export type DeliveryReport = {
  outcome: "OK" | "TIMEOUT" | "ERROR";
  attemptsUsed: number;
};

const PRINTER_TIMEOUT_MS = 5_000;

/**
 * Drive one receipt through the transport: attempt → on failure the ONE automatic retry → report.
 * A hanging transport resolves via the 5-second timeout (surface TIMEOUT, never a silent pass).
 * Attempt counts are honest: OK with attemptsUsed 2 means the retry saved it (logged via
 * src/lib/log.ts at screen level).
 */
export async function deliverReceipt(
  transport: PrinterTransport,
  bytes: Uint8Array,
  options: { timeoutMs?: number } = {},
): Promise<DeliveryReport> {
  const timeoutMs = options.timeoutMs ?? PRINTER_TIMEOUT_MS;
  const attempt = async (): Promise<"OK" | "TIMEOUT" | "ERROR"> => {
    const run = transport.print(bytes).then(
      () => "OK" as const,
      () => "ERROR" as const,
    );
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timer = new Promise<"TIMEOUT">((resolve) => {
      timerId = setTimeout(() => resolve("TIMEOUT"), timeoutMs);
    });
    const outcome = await Promise.race([run, timer]);
    if (typeof timerId !== "undefined") clearTimeout(timerId);
    return outcome;
  };

  if ((await attempt()) === "OK") return { outcome: "OK", attemptsUsed: 1 };
  const second = await attempt();
  return second === "OK"
    ? { outcome: "OK", attemptsUsed: 2 }
    : { outcome: second, attemptsUsed: 2 };
}
