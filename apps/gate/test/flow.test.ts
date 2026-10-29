import { describe, expect, it } from "vitest";

import type { Tariff } from "@pmp/contracts";

import {
  entryGate,
  initialEntryContext,
  reduceEntry,
  shouldAutoReturn,
  tokenViewFor,
  CONFIRM_DEBOUNCE_MS,
  type EntryConfig,
} from "../src/domain/entryFlow";
import {
  doubleExitCheck,
  exitBundleFor,
  exitGate,
  lostTokenSearch,
  lookupExitSession,
  resolveExitInput,
  resolveFare,
} from "../src/domain/exitFlow";
import type { OpenSessionRecord } from "../src/domain/findOpenSession";
import { exitEventForSession } from "../src/domain/paymentRules";
import tariffFixturesJson from "@pmp/domain/src/fixtures/tariffs.json";
import { fare } from "@pmp/domain";

/**
 * Screen-flow logic tests mirroring member-02 D.1/D.2 rows:
 * T-GATE-01-N1 (double tap), N2 (duplicate plate), N3 (config not synced), N5 (no shift);
 * T-GATE-02-U1/U2/N1-N5 (exit input, unknown code, double exit, wrong facility, missing tariff,
 * clock skew); E3/E4 (lost-token searches, sorted lists).
 */

const NOW = 1764327600000; // fake clock ms base (2026-10-28)
const FACILITY = "fa7a7a7a-7a7a-7a7a-8a7a-7a7a7a7a7a7a";

function entryConfig(overrides: Partial<EntryConfig> = {}): EntryConfig {
  return {
    classes: ["CAR", "BIKE", "TRUCK"],
    zones: [
      { id: "Z1", capacity: 2, vehicle_class: ["CAR"] },
      { id: "Z2", capacity: 5, vehicle_class: ["CAR", "BIKE"] },
    ],
    openSessions: [
      {
        sessionId: "sess-in",
        shortCode: "INSID",
        vehicleClass: "CAR",
        vehicleNo: "UP32AB1234",
        enteredAt: "2026-10-28T03:00:00.000Z",
      },
    ],
    nowMs: () => NOW,
    ...overrides,
  };
}

function happyToZoneChosen(config: EntryConfig) {
  let ctx = initialEntryContext();
  ctx = reduceEntry(ctx, { kind: "tappedClass", classId: "CAR" }, config);
  ctx = reduceEntry(ctx, { kind: "tappedZone", zoneId: "Z1" }, config);
  return ctx;
}

describe("entryGate preconditions (T-GATE-01-N3/N5)", () => {
  it("config never synced → blocking CONFIG_NOT_SYNCED", () => {
    expect(entryGate({ configSynced: false, openShift: { openAt: "x" } })).toEqual({
      ok: false,
      gate: "CONFIG_NOT_SYNCED",
    });
  });

  it("no open shift → redirect gate (T-GATE-06-N3)", () => {
    expect(entryGate({ configSynced: true, openShift: null })).toEqual({
      ok: false,
      gate: "SHIFT_NOT_OPEN",
    });
  });

  it("both preconditions met → ok", () => {
    expect(entryGate({ configSynced: true, openShift: { openAt: "x" } })).toEqual({ ok: true });
  });
});

describe("exitGate preconditions (GATE-06 failure 9: exit routes to open-shift too)", () => {
  it("no open shift → blocking SHIFT_NOT_OPEN (never a fare, never a write)", () => {
    expect(exitGate({ openShift: null })).toEqual({ ok: false, gate: "SHIFT_NOT_OPEN" });
  });

  it("an open shift admits the payment flow", () => {
    expect(exitGate({ openShift: { openAt: "2026-10-25T04:00:00.000Z" } })).toEqual({ ok: true });
  });
});

describe("entry machine (T-GATE-01-N1/N2, GATE-01 territory)", () => {
  it("walks idle → classChosen → zoneChosen with valid taps", () => {
    const config = entryConfig();
    const ctx = happyToZoneChosen(config);
    expect(ctx.phase).toBe("zoneChosen");
    expect(ctx.taps).toBe(2);
  });

  it("rejects a class not in facility config and a zone that disallows the class", () => {
    const config = entryConfig();
    let ctx = reduceEntry(initialEntryContext(), { kind: "tappedClass", classId: "JEEP" }, config);
    expect(ctx.phase).toBe("idle"); // ignored
    ctx = reduceEntry(ctx, { kind: "tappedClass", classId: "CAR" }, config);
    ctx = reduceEntry(ctx, { kind: "tappedZone", zoneId: "Z1" }, config);
    // Z1 allows CAR — now pick a bike zone after choosing bike class: disallowed
    const bike = reduceEntry(
      initialEntryContext(),
      { kind: "tappedClass", classId: "BIKE" },
      config,
    );
    const bikeZone = reduceEntry(bike, { kind: "tappedZone", zoneId: "Z1" }, config);
    expect(bikeZone.phase).toBe("classChosen"); // Z1 allows cars only, so the bike zone tap is ignored
  });

  it("double-tapping Confirm within 200 ms starts the write once (T-GATE-01-N1)", () => {
    const config = entryConfig({ nowMs: () => NOW });
    const ctx = happyToZoneChosen(config);
    const saving = reduceEntry(ctx, { kind: "tappedConfirm" }, config);
    expect(saving.phase).toBe("saving");
    // second tap 50 ms later: inside the debounce window, swallowed
    const still = reduceEntry(
      saving,
      { kind: "tappedConfirm" },
      {
        ...config,
        nowMs: () => NOW + 50,
      },
    );
    expect(still.phase).toBe("saving");
    expect(still.taps).toBe(3); // rejected debounce does not count as a completed action
    // a tap well after the debounce but while saving still goes nowhere
    const later = reduceEntry(
      still,
      { kind: "tappedConfirm" },
      { ...config, nowMs: () => NOW + 400 },
    );
    expect(later.phase).toBe("saving");
    expect(later.taps).toBe(3);
  });

  it("counts accepted button actions only and starts timing at the first valid class tap", () => {
    const config = entryConfig({ nowMs: () => NOW });
    let ctx = initialEntryContext();
    ctx = reduceEntry(ctx, { kind: "tappedClass", classId: "UNKNOWN" }, config);
    ctx = reduceEntry(ctx, { kind: "tappedZone", zoneId: "Z1" }, config);
    expect(ctx.taps).toBe(0);
    expect(ctx.startedAtIso).toBeUndefined();

    ctx = reduceEntry(ctx, { kind: "tappedClass", classId: "CAR" }, config);
    expect(ctx.taps).toBe(1);
    expect(ctx.startedAtIso).toBe(new Date(NOW).toISOString());
    ctx = reduceEntry(ctx, { kind: "tappedZone", zoneId: "NOT_A_ZONE" }, config);
    expect(ctx.taps).toBe(1);

    ctx = reduceEntry(ctx, { kind: "tappedZone", zoneId: "Z1" }, config);
    ctx = reduceEntry(ctx, { kind: "tappedAddNumber" }, config);
    expect(ctx.taps).toBe(3);
    ctx = reduceEntry(ctx, { kind: "typedPlate", raw: "UP 32 AB 1234" }, config);
    expect(ctx.taps).toBe(3);
    ctx = reduceEntry(ctx, { kind: "tappedConfirm" }, config);
    expect(ctx.taps).toBe(4);
  });

  it("duplicate plate blocks the save until the Override re-tap (T-GATE-01-N2)", () => {
    const config = entryConfig();
    let ctx = happyToZoneChosen(config);
    ctx = reduceEntry(ctx, { kind: "typedPlate", raw: "up 32-ab 1234" }, config);
    expect(ctx.vehicleNo).toBe("UP32AB1234"); // normalized (T-GATE-01-U6 style)
    const blocked = reduceEntry(ctx, { kind: "tappedConfirm" }, config);
    expect(blocked.phase).toBe("duplicateBlocked");
    // plain Confirm while blocked: still blocked
    const stillBlocked = reduceEntry(blocked, { kind: "tappedConfirm" }, config);
    expect(stillBlocked.phase).toBe("duplicateBlocked");
    // Override re-tap releases to saving
    const overrideSaving = reduceEntry(blocked, { kind: "tappedConfirmWithOverride" }, config);
    expect(overrideSaving.phase).toBe("saving");
  });

  it("invalid plate input routes to the plateInvalid phase (rule 9)", () => {
    const config = entryConfig();
    const ctx = reduceEntry(happyToZoneChosen(config), { kind: "typedPlate", raw: "ab1" }, config);
    expect(ctx.phase).toBe("plateInvalid");
  });

  it("writeOk moves to tokenShown with the TokenView; writeFailed routes to paper fallback (T-GATE-01-N4)", () => {
    const config = entryConfig();
    const saving = reduceEntry(happyToZoneChosen(config), { kind: "tappedConfirm" }, config);
    const token = tokenViewFor(
      {
        sessionId: "01833333-3333-7333-8333-333333333331",
        shortCode: "ABCDE",
        qrPayload: `parkos:${FACILITY}:ABCDE:01833333-3333-7333-8333-333333333331`,
        regenerations: 0,
      },
      "2026-10-28T04:00:00.000Z",
      FACILITY,
    );
    const shown = reduceEntry(saving, { kind: "writeOk", token }, config);
    expect(shown.phase).toBe("tokenShown");
    expect(shown.token?.shortCode).toBe("ABCDE");
    const failed = reduceEntry(saving, { kind: "writeFailed" }, config);
    expect(failed.phase).toBe("paperFallback");
  });

  it("reset returns to a fresh idle; token screen auto-returns after 10 s", () => {
    const config = entryConfig();
    const ctx = reduceEntry(initialEntryContext(), { kind: "reset" }, config);
    expect(ctx.phase).toBe("idle");
    const token = {
      shortCode: "AAAAA",
      qrPayload: "q",
      enteredAt: "2026-10-28T04:00:00.000Z",
      sessionId: "s",
    };
    const shown: EntryCtxAlias = reduceEntry(
      initialEntryContext(),
      { kind: "writeOk", token },
      config,
    );
    expect(shouldAutoReturn(shown, 0)).toBe(false);
    // enteredAt epoch ms + 10 s → auto return
    expect(shouldAutoReturn(shown, Date.parse(token.enteredAt) + 10_000)).toBe(true);
    expect(shouldAutoReturn(shown, Date.parse(token.enteredAt) + 9_999)).toBe(false);
  });

  it("debounce constant matches the sheet exactly (200 ms)", () => {
    expect(CONFIRM_DEBOUNCE_MS).toBe(200);
  });
});

type EntryCtxAlias = ReturnType<typeof initialEntryContext>;

describe("exit input resolution (T-GATE-02-U1/U2/N3)", () => {
  it("scan: valid, wrong facility, malformed", () => {
    const good = `parkos:${FACILITY}:ABCDE:01833333-3333-7333-8333-333333333331`;
    expect(resolveExitInput({ kind: "scan", payload: good }, FACILITY)).toEqual({
      kind: "ok",
      facilityId: FACILITY,
      shortCode: "ABCDE",
      sessionId: "01833333-3333-7333-8333-333333333331",
    });
    expect(resolveExitInput({ kind: "scan", payload: good }, "other-facility")).toEqual({
      kind: "WRONG_FACILITY",
    });
    expect(resolveExitInput({ kind: "scan", payload: "not-a-payload" }, FACILITY)).toEqual({
      kind: "INVALID",
    });
  });

  it("typed code normalizes Crockford confusables and rejects U (T-GATE-02-U2)", () => {
    expect(resolveExitInput({ kind: "code", typed: "o0il" }, FACILITY).kind).toBe("ok");
    const normalized = resolveExitInput({ kind: "code", typed: "o0il" }, FACILITY);
    if (normalized.kind === "ok") expect(normalized.shortCode).toBe("0011");
    expect(resolveExitInput({ kind: "code", typed: "uuuu" }, FACILITY).kind).toBe("INVALID");
  });

  it("lookup after resolution: scan hits the session id exactly; misses fall back to the code and then to Not found (T-GATE-02-N1)", () => {
    const session: OpenSessionRecord = {
      sessionId: "01833333-3333-7333-8333-333333333331",
      shortCode: "ABCDE",
      vehicleClass: "Car",
      enteredAt: "2026-11-01T02:00:00.000Z",
    };
    const scanned = resolveExitInput(
      { kind: "scan", payload: `parkos:${FACILITY}:ABCDE:01833333-3333-7333-8333-333333333331` },
      FACILITY,
    );
    expect(lookupExitSession(scanned, [session])).toEqual({ kind: "one", session });
    expect(lookupExitSession({ kind: "INVALID" }, [session])).toEqual({ kind: "none" });
    expect(
      lookupExitSession({ kind: "ok", facilityId: FACILITY, shortCode: "VWXYZ" }, [session]),
    ).toEqual({
      kind: "none",
    });
  });
});

describe("double exit + missing tariff + skew (T-GATE-02-N2/N4/N5, D.2)", () => {
  // The frozen GATE-03 fixture tariff (packages/domain/src/fixtures/tariffs.json): slabs
  // ≤60→3000, ≤180→6000, grace 15 — the sheet's T-GATE-02-I2 "CAR-A 90 min → 6000".
  type TariffFix = Tariff;
  const carA = (tariffFixturesJson as TariffFix[]).find((t) => t.id === "CAR-A") as TariffFix;
  const ENTRY = "2026-11-01T02:00:00.000Z"; // IST 07:30, inside CAR-A's effective window
  const session: OpenSessionRecord = {
    sessionId: "01833333-3333-7333-8333-333333333331",
    shortCode: "ABCDE",
    vehicleClass: "Car", // fixture class spelling
    enteredAt: ENTRY,
  };

  it("double-exit check reports the committed exit time (T-GATE-02-N2)", () => {
    const exitEvent = {
      id: "01844444-4444-7444-8444-444444444441",
      type: "EXIT" as const,
      facility_id: "fa777777-7777-7777-8777-777777777777",
      device_id: "dev-1",
      staff_id: "01877777-0000-7000-8000-00000000000a",
      device_time: "2026-10-28T05:00:00.000Z",
      source: "LIVE" as const,
      schema_version: 1,
      session_id: session.sessionId,
      payload: { fare_paise: 6000, exit_method: "CODE" as const },
    };
    const check = doubleExitCheck([exitEvent], session.sessionId);
    expect(check).toEqual({ ok: false, exitedAtIso: "2026-10-28T05:00:00.000Z" });
    expect(doubleExitCheck([exitEvent], "other-session")).toEqual({ ok: true });
  });

  it("prices with the entry-date tariff from the shared engine (T-GATE-02-I2, 6000)", () => {
    const out = resolveFare(session, "2026-11-01T03:30:00.000Z", [carA]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      // Same engine result the screen would get calling fare() directly (parity rule).
      const direct = fare(
        carA,
        session.enteredAt,
        "2026-11-01T03:30:00.000Z",
        session.vehicleClass,
      );
      expect(out.farePaise).toBe(direct);
      expect(out.farePaise).toBe(6000);
      expect(out.skewHint).toBe(false);
      expect(out.tariffId).toBe("CAR-A");
      expect(out.tariffEffectiveFrom).toBe("2026-11-01");
    }
  });

  it("no tariff for the class → WAIVE/CALL_MANAGER, never a silent zero (T-GATE-02-N4)", () => {
    const unknownClass: OpenSessionRecord = { ...session, vehicleClass: "SUV" };
    const out = resolveFare(unknownClass, "2026-11-01T03:30:00.000Z", [carA]);
    expect(out).toEqual({ ok: false, reason: "NO_TARIFF", options: ["WAIVE", "CALL_MANAGER"] });
  });

  it("skewed exit before entry prices the zero-minute stay with the CLOCK_SKEW hint (T-GATE-02-N5)", () => {
    const out = resolveFare(session, "2026-11-01T01:00:00.000Z", [carA]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.farePaise).toBe(0); // 0-minute stay within the 15-minute grace
      expect(out.skewHint).toBe(true);
    }
  });

  it("garbage exit instants are FARE_ERROR, not crashes", () => {
    const out = resolveFare(session, "not-a-time", [carA]);
    expect(out).toEqual({ ok: false, reason: "FARE_ERROR", code: "INVALID_RANGE" });
  });
});

describe("lost-token search (T-GATE-02-E3/E4/N1)", () => {
  const sessions: OpenSessionRecord[] = [
    {
      sessionId: "s1",
      shortCode: "AAAAA",
      vehicleClass: "CAR",
      enteredAt: "2026-10-28T03:00:00.000Z",
    },
    {
      sessionId: "s2",
      shortCode: "BBBBB",
      vehicleClass: "CAR",
      enteredAt: "2026-10-28T02:00:00.000Z",
    },
    {
      sessionId: "s3",
      shortCode: "CCCCC",
      vehicleClass: "CAR",
      enteredAt: "2026-10-28T01:30:00.000Z",
    },
    {
      sessionId: "b1",
      shortCode: "DDDDD",
      vehicleClass: "BIKE",
      enteredAt: "2026-10-28T03:30:00.000Z",
    },
  ];

  it("by plate finds the one match only for normalized plates (T-GATE-02-E3)", () => {
    const withPlate: OpenSessionRecord = {
      ...(sessions[0] as OpenSessionRecord),
      vehicleNo: "MH01CD9999",
    };
    // The screen normalizes before searching; a raw plate with spaces/hyphens must NOT match.
    expect(lostTokenSearch({ kind: "plate", plate: "mh 01 cd 9999" }, [withPlate]).kind).toBe(
      "none",
    );
    const hit = lostTokenSearch({ kind: "plate", plate: "MH01CD9999" }, [withPlate]);
    expect(hit).toEqual({ kind: "one", session: withPlate });
  });

  it("by class + window lists matches sorted by entry time (T-GATE-02-E4)", () => {
    const out = lostTokenSearch(
      {
        kind: "classWindow",
        vehicleClass: "CAR",
        nowIso: "2026-10-28T08:00:00.000Z",
        windowMinutes: 420,
      },
      sessions,
    );
    expect(out.kind).toBe("many");
    if (out.kind === "many") {
      expect(out.sessions.map((s) => s.sessionId)).toEqual(["s3", "s2", "s1"]);
    }
  });
});

describe("exit bundle wiring", () => {
  it("builds the writeExit bundle with the resolved fare", () => {
    const bundle = exitBundleFor(
      {
        sessionId: "s1",
        shortCode: "AAAAA",
        vehicleClass: "CAR",
        enteredAt: "2026-10-28T02:00:00.000Z",
      },
      6000,
      { button: "CASH", method: "CODE" },
    );
    expect(bundle).toEqual({
      sessionId: "s1",
      farePaise: 6000,
      exitMethod: "CODE",
      payment: { mode: "CASH", amountPaise: 6000 },
    });
    expect(exitEventForSession([], "s1")).toBeNull();
  });

  it("refuses non-integer fares", () => {
    expect(() =>
      exitBundleFor(
        { sessionId: "s1", shortCode: "AAAAA", vehicleClass: "CAR", enteredAt: "x" },
        6000.5,
        { button: "CASH", method: "CODE" },
      ),
    ).toThrow();
  });
});
