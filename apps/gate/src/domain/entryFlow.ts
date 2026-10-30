import { SHORT_CODE_PATTERN, qrPayloadFor, type Token } from "./token";
import { normalizeVehicleNo } from "./plates";
import type { GateZone } from "./suggestZone";
import type { OpenSessionRecord } from "./findOpenSession";

/**
 * Entry-screen state machine (GATE-01 sequence 4.4: `idle -> classChosen -> zoneChosen ->
 * saving -> tokenShown`) and the screen's negative rules as pure logic, so the React screen
 * (app/entry.tsx, device-side) stays a thin wrapper. Mirrors D-table semantics:
 *
 *   T-GATE-01-N1  Confirm tapped twice within 200 ms — one ENTRY only (saving-block AND a
 *                 200 ms debounce; two layers, both documented in the sheet).
 *   T-GATE-01-N2  Duplicate plate already inside — blocking warning phase; no event until the
 *                 guard confirms an Override re-tap.
 *   T-GATE-01-N3  Config never synced — blocking gate state before any entry (no zones = no
 *                 entry; "Setup not synced, connect once").
 *   T-GATE-01-N5  Shift not open — gate sends the guard to the shift-open screen (GATE-06).
 *   T-GATE-01-N4  Write failure — paper-fallback phase (screen navigates to GATE-11 flow); no
 *                 partial event (the write layer is atomic, see src/data/writeEvent.ts).
 *
 * Pure function of context + tap event + injected clock (`nowMs`); no React, no timers, no
 * Date.now. Token generation itself happens in the WRITE EFFECT (screen/action layer) via
 * generateToken + writeEvent; the machine only receives the finished TokenView.
 */

export const CONFIRM_DEBOUNCE_MS = 200;
/** "New vehicle" auto-return (sequence 4.6): token screen resets after 10 s of inactivity. */
export const TOKEN_SCREEN_IDLE_MS = 10_000;

/** Preconditions from the screen's entry path (preconditions 3 + negative rules). */
export type EntryGateResult =
  { ok: true } | { ok: false; gate: "CONFIG_NOT_SYNCED" | "SHIFT_NOT_OPEN" };

export function entryGate(input: {
  configSynced: boolean;
  /** findOpenShift(events, deviceId) from src/domain/shiftTotals.ts. */
  openShift: { openAt: string } | null;
}): EntryGateResult {
  if (!input.configSynced) return { ok: false, gate: "CONFIG_NOT_SYNCED" };
  if (input.openShift === null) return { ok: false, gate: "SHIFT_NOT_OPEN" };
  return { ok: true };
}

export type EntryPhase =
  | "idle"
  | "classChosen"
  | "zoneChosen"
  | "saving"
  | "tokenShown"
  | "duplicateBlocked"
  | "plateInvalid"
  | "paperFallback";

export type EntryContext = {
  phase: EntryPhase;
  classId?: string;
  zoneId?: string;
  vehicleNo?: string;
  /** entry_started_at: first tap (metric `entry_ms` anchor, sequence 4.4/4.7). */
  startedAtIso?: string;
  /** Physical UI taps; text input changes and internal machine transitions are not taps. */
  taps: number;
  /** debounced-at for the double-tap guard (last accepted/ignored Confirm ping). */
  lastConfirmAtMs?: number;
  token?: TokenView;
};

/** In-memory token view exactly per sheet section 7 ("Out: persisted ENTRY event and an
 * in-memory TokenView {shortCode, qrPayload, enteredAt}"). */
export type TokenView = {
  shortCode: string;
  qrPayload: string;
  enteredAt: string;
  sessionId: string;
};

export type EntryTap =
  | { kind: "tappedClass"; classId: string }
  | { kind: "tappedZone"; zoneId: string }
  | { kind: "tappedAddNumber" }
  | { kind: "typedPlate"; raw: string | null }
  | { kind: "tappedConfirm" }
  | { kind: "tappedConfirmWithOverride" }
  | { kind: "writeOk"; token: TokenView }
  | { kind: "writeFailed" }
  | { kind: "reset" };

export type EntryConfig = {
  classes: readonly string[];
  zones: readonly GateZone[];
  /** Open sessions on this device (synced snapshot + local entries) for the plate check. */
  openSessions: readonly OpenSessionRecord[];
  /** Injected clock in ms (fake clock in tests; the screen injects its monotonic-ish source). */
  nowMs(): number;
};

const INITIAL: EntryContext = { phase: "idle", taps: 0 };

function secondValidator(
  ctx: EntryContext,
  tap: EntryTap,
  config: EntryConfig,
): { ctx: EntryContext; accepted: boolean } {
  const nowMs = config.nowMs();
  const base: EntryContext = { ...ctx };
  switch (tap.kind) {
    case "reset":
      return { ctx: { ...INITIAL }, accepted: true };
    case "tappedClass": {
      if (!config.classes.includes(tap.classId)) return { ctx: base, accepted: false };
      // Config snapshot at screen open (edge cases 12): class/zone re-validated on next screen.
      return {
        ctx: {
          ...base,
          phase: "classChosen",
          classId: tap.classId,
          startedAtIso: ctx.startedAtIso ?? new Date(nowMs).toISOString(),
        },
        accepted: true,
      };
    }
    case "tappedZone": {
      if (ctx.phase !== "classChosen" || ctx.classId === undefined) {
        return { ctx: base, accepted: false };
      }
      const zone = config.zones.find((z) => z.id === tap.zoneId);
      const allowed = zone !== undefined && zone.vehicle_class.includes(ctx.classId);
      if (!allowed) {
        return { ctx: base, accepted: false }; // rule 9: zone must allow the class
      }
      return { ctx: { ...base, phase: "zoneChosen", zoneId: tap.zoneId }, accepted: true };
    }
    case "tappedAddNumber":
      return {
        ctx: base,
        accepted: ctx.phase === "classChosen" || ctx.phase === "zoneChosen",
      };
    case "typedPlate": {
      if (tap.raw === null || tap.raw.length === 0) {
        // plate cleared: entry without plate stays legal (plate is optional, rule GATE-01)
        return { ctx: { ...base, vehicleNo: undefined }, accepted: true };
      }
      const normalized = normalizeVehicleNo(tap.raw);
      if (normalized === null) {
        return { ctx: { ...base, phase: "plateInvalid" }, accepted: true };
      }
      return { ctx: { ...base, vehicleNo: normalized }, accepted: true };
    }
    case "tappedConfirm":
    case "tappedConfirmWithOverride": {
      if (ctx.phase === "saving" || ctx.phase === "tokenShown" || ctx.phase === "paperFallback") {
        // saving-block: taps during the write never queue (T-GATE-01-N1 layer 1)
        return { ctx: base, accepted: false };
      }
      if (ctx.phase === "duplicateBlocked") {
        // N2: only the explicit Override re-tap releases the block (a deliberate action after
        // the guard reads the warning, so the plain-confirm debounce does not swallow it); a
        // plain Confirm keeps blocking (re-warning).
        if (tap.kind !== "tappedConfirmWithOverride") {
          return { ctx: { ...base, lastConfirmAtMs: nowMs }, accepted: false };
        }
        // Override releases: the server DUPLICATE_ENTRY detector stays the backstop (rule 9).
        return { ctx: { ...base, phase: "saving", lastConfirmAtMs: nowMs }, accepted: true };
      }
      if (ctx.phase !== "zoneChosen") {
        return { ctx: base, accepted: false };
      }
      if (tap.kind === "tappedConfirmWithOverride") {
        // Override from a non-blocked state is a no-op (nothing to release).
        return { ctx: base, accepted: false };
      }
      const last = ctx.lastConfirmAtMs;
      if (last !== undefined && nowMs - last < CONFIRM_DEBOUNCE_MS) {
        // 200 ms debounce (T-GATE-01-N1 layer 2): inside the window the tap is swallowed
        return { ctx: { ...base, lastConfirmAtMs: nowMs }, accepted: false };
      }
      if (ctx.vehicleNo !== undefined) {
        const duplicate = config.openSessions.some((s) => s.vehicleNo === ctx.vehicleNo);
        if (duplicate) {
          // N2: blocking warning; no event until the Override re-tap.
          return {
            ctx: { ...base, phase: "duplicateBlocked", lastConfirmAtMs: nowMs },
            accepted: true,
          };
        }
      }
      return { ctx: { ...base, phase: "saving", lastConfirmAtMs: nowMs }, accepted: true };
    }
    default:
      return { ctx: base, accepted: false };
  }
}

/**
 * Dispatch one tap. The phase transitions to `tokenShown` only via `writeOk` (from the write
 * effect); `saving` blocks other accepts until the effect resolves either way.
 */
export function reduceEntry(ctx: EntryContext, tap: EntryTap, config: EntryConfig): EntryContext {
  const result = secondValidator(ctx, tap, config);
  const countedTap =
    tap.kind === "tappedClass" ||
    tap.kind === "tappedZone" ||
    tap.kind === "tappedAddNumber" ||
    tap.kind === "tappedConfirm" ||
    tap.kind === "tappedConfirmWithOverride";
  const next = result.accepted && countedTap ? { ...result.ctx, taps: ctx.taps + 1 } : result.ctx;
  if (tap.kind === "writeOk") {
    return { ...next, phase: "tokenShown", token: tap.token };
  }
  if (tap.kind === "writeFailed") {
    // N4: paper-sheet fallback; the entry context is kept for the backfill flow (GATE-11).
    return { ...next, phase: "paperFallback" };
  }
  return next;
}

/** The write effect's inputs (screen/action layer): the sheet's TokenView is exactly what
 * generateToken + qrPayloadFor produce. */
export function tokenViewFor(token: Token, enteredAt: string, facilityId: string): TokenView {
  if (!SHORT_CODE_PATTERN.test(token.shortCode)) {
    throw new Error("tokenViewFor: short code violates the IC-01 Crockford pattern");
  }
  return {
    shortCode: token.shortCode,
    qrPayload: qrPayloadFor(facilityId, token.shortCode, token.sessionId),
    enteredAt,
    sessionId: token.sessionId,
  };
}

export const initialEntryContext = (): EntryContext => ({ ...INITIAL });

/** Token screen auto-return rule: idle for 10 s → back to idle (sequence 4.6). */
export function shouldAutoReturn(ctx: EntryContext, nowMs: number): boolean {
  if (ctx.phase !== "tokenShown") return false;
  const shownAt = ctx.token === undefined ? undefined : Date.parse(ctx.token.enteredAt);
  if (shownAt === undefined || Number.isNaN(shownAt)) return false;
  return nowMs - shownAt >= TOKEN_SCREEN_IDLE_MS;
}
