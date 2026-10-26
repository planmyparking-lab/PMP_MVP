import { fare, FareError, parseInstant } from "@pmp/domain";
import type { Event, Tariff } from "@pmp/contracts";

import { normalizeShortCode } from "./token";
import { parseQrPayload } from "./payload";
import { tariffFor } from "./tariffFor";
import {
  findSessionByPlate,
  findSessionByShortCode,
  findSessionsByClassWindow,
  DEFAULT_WINDOW_MINUTES,
  type FindOutcome,
  type OpenSessionRecord,
} from "./findOpenSession";
import { exitEventForSession } from "./paymentRules";

/**
 * Exit-screen flow logic (GATE-02 sequences 4.2-4.7, tests T-GATE-02-U1/U2/U3/N1-N5, E3/E4),
 * as pure functions so `app/exit.tsx` stays a thin device wrapper:
 *
 *   resolveExitInput   — scan payload / typed code handling (`WRONG_FACILITY`, `INVALID`).
 *   doubleExitCheck    — a session already exited locally is blocked BEFORE the fare shows
 *                        (sequence 4.6; "Already exited at HH:MM", T-GATE-02-N2).
 *   resolveFare        — tariff at the session's ENTRY instant (OQ-20 default) via tariffFor,
 *                        then the shared fare engine; missing tariff → waiver/manager options
 *                        (T-GATE-02-N4); clock skew (exit before entry) → price at entry time
 *                        + CLOCK_SKEW hint (rule 8, T-GATE-02-N5); CLASS_MISMATCH/other fare
 *                        errors surface typed, never silent-zeroed.
 *   lostTokenSearch    — by plate, or class+window (default 360 min for lost-token, T-E3/E4).
 *   exitBundleFor      — the writeExit bundle per payment button (GATE-04 mapping).
 */

export type ResolvedExitInput =
  | { kind: "ok"; facilityId: string; shortCode: string; sessionId?: string }
  | { kind: "INVALID" }
  | { kind: "WRONG_FACILITY" };
export type { FindOutcome };

/**
 * The open-session lookup after a resolved input: a scan carries the session id (exact id hit
 * wins), otherwise the code path does an exact short-code match. `none` is the "Not found"
 * screen with the lost-token option (T-GATE-02-N1); a duplicate code (corrupt data) is `many`.
 */
export function lookupExitSession(
  resolved: ResolvedExitInput,
  openSessions: readonly OpenSessionRecord[],
): FindOutcome {
  if (resolved.kind !== "ok") return { kind: "none" };
  if (resolved.sessionId !== undefined) {
    const byId = openSessions.filter((s) => s.sessionId === resolved.sessionId);
    if (byId.length > 0)
      return byId.length === 1
        ? { kind: "one", session: byId[0] as OpenSessionRecord }
        : { kind: "many", sessions: byId };
  }
  return findSessionByShortCode(resolved.shortCode, openSessions);
}

export function resolveExitInput(
  input: { kind: "scan"; payload: string } | { kind: "code"; typed: string },
  deviceFacilityId: string,
): ResolvedExitInput {
  if (input.kind === "scan") {
    const parsed = parseQrPayload(input.payload, deviceFacilityId);
    if (!parsed.ok) return { kind: parsed.reason };
    return {
      kind: "ok",
      facilityId: parsed.facilityId,
      shortCode: parsed.shortCode,
      sessionId: parsed.sessionId,
    };
  }
  const normalized = normalizeShortCode(input.typed);
  if (normalized === null) return { kind: "INVALID" }; // U rejected; case-insensitive (rule 8)
  return { kind: "ok", facilityId: deviceFacilityId, shortCode: normalized };
}

export type DoubleExitCheck = { ok: true } | { ok: false; exitedAtIso: string };

/** T-GATE-02-N2: local EXIT events checked before showing the fare (sequence 4.6). */
export function doubleExitCheck(
  committedEvents: readonly Event[],
  sessionId: string,
): DoubleExitCheck {
  const exitEvent = exitEventForSession(committedEvents, sessionId);
  return exitEvent === null ? { ok: true } : { ok: false, exitedAtIso: exitEvent.device_time };
}

export type FareResolution =
  | {
      ok: true;
      farePaise: number;
      tariffId: string;
      /** ISO date the chosen tariff became effective (recorded on the EXIT payload when it
       * lands; the EXIT event envelope cannot carry it yet). */
      tariffEffectiveFrom: string;
      skewHint: boolean;
    }
  | { ok: false; reason: "NO_TARIFF"; options: ("WAIVE" | "CALL_MANAGER")[] }
  | { ok: false; reason: "FARE_ERROR"; code: string };

/**
 * Fare for a resolved session. Selection uses the tariff effective at the session's ENTRY
 * instant (OQ-20 default; tariffFor's doc pins the rule). On skewed clocks (exit before entry)
 * the sheet's rule 8 applies: re-price at the entry instant (zero-minute stay → grace-driven
 * fare) and flag CLOCK_SKEW. NO_TARIFF never becomes zero: the screen shows "No tariff for this
 * class" with Waive/manager options (T-GATE-02-N4). Every fare-engine error surfaces typed.
 */
export function resolveFare(
  session: OpenSessionRecord,
  exitAtIso: string,
  facilityTariffs: readonly Tariff[],
): FareResolution {
  const tariff = tariffFor(facilityTariffs, session.vehicleClass, session.enteredAt);
  if (tariff === null) {
    return { ok: false, reason: "NO_TARIFF", options: ["WAIVE", "CALL_MANAGER"] };
  }
  const exit = parseInstant(exitAtIso);
  const entry = parseInstant(session.enteredAt);
  if (exit === null || entry === null) {
    // Unparseable instants are data errors, NOT clock skew: fail closed (typed, never silent).
    return { ok: false, reason: "FARE_ERROR", code: "INVALID_RANGE" };
  }
  if (exit < entry) {
    // clock skew: price the zero-minute stay at the entry instant + hint (rule 8)
    try {
      const paise = fare(tariff, session.enteredAt, session.enteredAt, session.vehicleClass);
      return {
        ok: true,
        farePaise: paise,
        tariffId: tariff.id,
        tariffEffectiveFrom: tariff.effectiveFrom,
        skewHint: true,
      };
    } catch (error) {
      if (error instanceof FareError) return { ok: false, reason: "FARE_ERROR", code: error.code };
      return { ok: false, reason: "FARE_ERROR", code: "UNKNOWN" };
    }
  }
  try {
    const paise = fare(tariff, session.enteredAt, exitAtIso, session.vehicleClass);
    return {
      ok: true,
      farePaise: paise,
      tariffId: tariff.id,
      tariffEffectiveFrom: tariff.effectiveFrom,
      skewHint: false,
    };
  } catch (error) {
    if (error instanceof FareError) return { ok: false, reason: "FARE_ERROR", code: error.code };
    return { ok: false, reason: "FARE_ERROR", code: "UNKNOWN" };
  }
}

/** Lost-token path (expected behaviour: search by plate, or class + entry-time window). */
export function lostTokenSearch(
  mode:
    | { kind: "plate"; plate: string }
    | { kind: "classWindow"; vehicleClass: string; nowIso: string; windowMinutes?: number },
  openSessions: readonly OpenSessionRecord[],
): FindOutcome {
  if (mode.kind === "plate") return findSessionByPlate(mode.plate, openSessions);
  return findSessionsByClassWindow(
    mode.vehicleClass,
    openSessions,
    mode.nowIso,
    mode.windowMinutes ?? DEFAULT_WINDOW_MINUTES,
  );
}

/**
 * The writeExit bundle for the resolved fare and chosen payment button (the GATE-04 mapping
 * happens in paymentRules; this only wires the resolved numbers in — the fare is REQUIRED, so a
 * caller who skipped resolveFare cannot accidentally write a zero-amount Cash payment).
 */
export function exitBundleFor(
  session: OpenSessionRecord,
  farePaise: number,
  button: "CASH" | "UPI",
): {
  sessionId: string;
  farePaise: number;
  payment: { mode: "CASH" | "UPI"; amountPaise: number };
} {
  if (!Number.isSafeInteger(farePaise) || farePaise < 0) {
    throw new Error("exitBundleFor: farePaise must be a non-negative integer");
  }
  return {
    sessionId: session.sessionId,
    farePaise,
    payment: { mode: button, amountPaise: farePaise },
  };
}

export type ExitGate = { ok: true } | { ok: false; gate: "SHIFT_NOT_OPEN" };

/**
 * GATE-06 failure 9 ("No open shift: entry and exit route to open-shift") — the EXIT screen must
 * block with the routing card exactly like entry's gate (entryFlow.entryGate). A session closed
 * outside any shift window would lose its totals/reconciliation row, so a missing open shift
 * stops the whole payment flow before the fare is even computed. The caller passes the
 * findOpenShift(events, deviceId) result; the screen renders `exit.noOpenShift` + the route
 * button (exit.shiftNotOpen text lives on the entry side by design).
 */
export function exitGate(input: {
  /** findOpenShift(events, deviceId) from src/domain/shiftTotals.ts; null before the first sync. */
  openShift: { openAt: string } | null;
}): ExitGate {
  if (input.openShift === null) return { ok: false, gate: "SHIFT_NOT_OPEN" };
  return { ok: true };
}
