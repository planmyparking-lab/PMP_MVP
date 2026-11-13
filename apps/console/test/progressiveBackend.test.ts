import { describe, expect, it } from "vitest";
import { mapHeartbeats, mapKpiToday } from "../src/lib/data/backendMaps";
import { localDate } from "../src/lib/data/localDay";
import { classify, isDatabaseUnreachable, probeResult } from "../src/lib/data/probe";
import { checkHealth } from "../src/lib/health";
import { deviceHealthFromHeartbeat } from "../src/lib/heartbeatHealth";
import { checkReview, reviewInsertError } from "../src/lib/shiftReview";
import type { ShiftRow } from "../src/lib/shifts";

describe("probe: absent vs denied vs error", () => {
  it("classifies PostgREST and Postgres codes seen on the local stack", () => {
    expect(classify({ code: "PGRST205", message: "Could not find the table" })).toBe("absent");
    expect(classify({ code: "42P01", message: "relation does not exist" })).toBe("absent");
    expect(classify({ code: "42501", message: "permission denied" })).toBe("denied");
    expect(classify({ code: "PGRST000", message: "db down" })).toBe("error");
    expect(classify({ message: "network" })).toBe("error");
  });

  it("maps a successful read and turns a bad shape into an error, never data", () => {
    expect(probeResult("t", { data: [1, 2], error: null }, (d) => d.length)).toEqual({
      state: "ok",
      data: 2,
    });
    expect(
      probeResult("t", { data: null, error: { code: "PGRST205", message: "x" } }, () => 0),
    ).toEqual({ state: "absent" });
    const bad = probeResult("t", { data: [1], error: null }, () => {
      throw new Error("unexpected column");
    });
    expect(bad).toEqual({ state: "error", error: "t: unexpected column" });
  });

  it("treats only connection codes as the database being unreachable", () => {
    expect(isDatabaseUnreachable({ code: "PGRST001", message: "" })).toBe(true);
    expect(isDatabaseUnreachable({ code: "42501", message: "" })).toBe(false);
    expect(isDatabaseUnreachable(null)).toBe(false);
  });
});

describe("localDate: 'today' in the facility's own time zone", () => {
  it("follows the zone, not UTC", () => {
    // 20:00 UTC on 8 Nov is already 9 Nov in India.
    expect(localDate("2026-11-08T20:00:00Z", "Asia/Kolkata")).toBe("2026-11-09");
    expect(localDate("2026-11-08T20:00:00Z", "UTC")).toBe("2026-11-08");
  });
  it("returns null for an invalid zone or instant instead of guessing", () => {
    expect(localDate("2026-11-08T20:00:00Z", "Asia/Kolkatta")).toBeNull();
    expect(localDate("yesterday", "Asia/Kolkata")).toBeNull();
  });
});

describe("mapKpiToday (v_daily_kpis + v_hourly)", () => {
  const day = {
    local_date: "2026-11-09",
    vehicles: 312,
    cash_paise: 812000,
    upi_paise: 455000,
    pass_paise: 20000,
    declared_total_paise: 1287000,
    overrides: 4,
    overrides_per_100: 1.28,
    avg_stay_minutes: 104.86,
    orphan_exits: 1,
  };
  it("combines the day row with the hourly rows", () => {
    const k = mapKpiToday(
      "2026-11-09",
      [day],
      [
        { local_date: "2026-11-09", hour: 9, entries: 20, exits: 5 },
        { local_date: "2026-11-09", hour: 10, entries: 30, exits: 25 },
      ],
    );
    expect(k).toMatchObject({
      vehicles: 312,
      exits: 30,
      cashPaise: 812000,
      declaredTotalPaise: 1287000,
    });
    expect(k.entriesByHour[9]).toBe(20);
    expect(k.entriesByHour).toHaveLength(24);
  });
  it("reads a day with no row as zero, not unknown (the view emits no row for an empty day)", () => {
    const k = mapKpiToday("2026-11-09", [], []);
    expect(k).toMatchObject({ vehicles: 0, exits: 0, cashPaise: 0, overridesPer100: null });
  });
  it("rejects a renamed or retyped column instead of showing a wrong number", () => {
    expect(() => mapKpiToday("2026-11-09", [{ ...day, cash_paise: "812000" }], [])).toThrow();
    const renamed: Record<string, unknown> = { ...day, upi_attested_paise: 1 };
    delete renamed.upi_paise;
    expect(() => mapKpiToday("2026-11-09", [renamed], [])).toThrow();
  });
});

describe("device health from heartbeats", () => {
  const NOW = "2026-11-09T10:00:00Z";
  const hb = (over: Record<string, unknown> = {}) =>
    mapHeartbeats([
      {
        device_id: "d1",
        received_at: "2026-11-09T09:58:00Z",
        queue_depth: 3,
        oldest_unsynced_age_s: 120,
        app_version: "1.0.0",
        schema_version: 1,
        battery_pct: 80,
        ...over,
      },
    ])[0];

  it("is healthy with a fresh heartbeat and a small queue", () => {
    expect(deviceHealthFromHeartbeat(hb(), NOW)).toEqual({
      status: "green",
      heartbeatAgeMinutes: 2,
      queueDepth: 3,
      oldestUnsyncedMinutes: 2,
    });
  });
  it("is critical when the heartbeat is stale or the queue is large", () => {
    expect(deviceHealthFromHeartbeat(hb({ received_at: "2026-11-09T09:00:00Z" }), NOW).status).toBe(
      "red",
    );
    expect(deviceHealthFromHeartbeat(hb({ queue_depth: 250 }), NOW).status).toBe("red");
  });
  it("treats a phone that never reported as critical (opening hours unknown, OQ-47)", () => {
    expect(deviceHealthFromHeartbeat(undefined, NOW)).toMatchObject({
      status: "red",
      heartbeatAgeMinutes: null,
    });
  });
  it("accepts a missing battery reading (OQ-29)", () => {
    expect(hb({ battery_pct: null })?.batteryPct).toBeNull();
  });
});

describe("shift sign-off rules (CON-06)", () => {
  const SHIFT = "0190f0f0-0000-4000-8000-000000000001";
  const close = (cash = 0, upi = 0): ShiftRow["close"] => ({
    countedCashPaise: 1000,
    expectedCashPaise: 1000 - cash,
    upiDeclaredPaise: 0,
    upiAttestedPaise: 0,
    varianceCashPaise: cash,
    varianceUpiPaise: upi,
    reason: null,
  });

  it("approves a clean closed shift without a note", () => {
    expect(checkReview({ shift_id: SHIFT, status: "approved", note: "" }, close())).toEqual({
      ok: true,
      input: { shift_id: SHIFT, status: "approved", note: "" },
    });
  });
  it("refuses an open shift", () => {
    expect(checkReview({ shift_id: SHIFT, status: "approved" }, null)).toEqual({
      ok: false,
      error: "Only a closed shift can be reviewed.",
    });
  });
  it("needs a note for a flag and for any variance (OQ-22 threshold undecided)", () => {
    expect(checkReview({ shift_id: SHIFT, status: "flagged", note: "  " }, close()).ok).toBe(false);
    expect(checkReview({ shift_id: SHIFT, status: "approved" }, close(-500)).ok).toBe(false);
    expect(checkReview({ shift_id: SHIFT, status: "approved" }, close(0, 250)).ok).toBe(false);
    expect(
      checkReview({ shift_id: SHIFT, status: "approved", note: "Counted twice, ok" }, close(-500))
        .ok,
    ).toBe(true);
  });
  it("rejects a forged status, a bad id and an over-long note", () => {
    expect(checkReview({ shift_id: SHIFT, status: "deleted" }, close()).ok).toBe(false);
    expect(checkReview({ shift_id: "not-a-uuid", status: "approved" }, close()).ok).toBe(false);
    expect(
      checkReview({ shift_id: SHIFT, status: "approved", note: "x".repeat(501) }, close()).ok,
    ).toBe(false);
  });
  it("explains database refusals without echoing the database message", () => {
    expect(reviewInsertError("23505")).toMatch(/already recorded/);
    expect(reviewInsertError("42501")).toMatch(/row-level security/);
    expect(reviewInsertError("PGRST205")).toMatch(/not deployed/);
    expect(reviewInsertError("XX000")).toBe(
      "The review could not be saved. Try again in a moment.",
    );
  });
});

describe("health check (CLD-10)", () => {
  it("is 503 unconfigured without a Supabase project", async () => {
    expect(await checkHealth(null)).toEqual({ status: 503, body: { status: "unconfigured" } });
  });
  it("is 200 when the database answers, even with a permission error for anon", async () => {
    expect(await checkHealth(async () => ({ error: null, status: 200 }))).toMatchObject({
      status: 200,
    });
    expect(
      await checkHealth(async () => ({ error: { code: "42501", message: "denied" }, status: 401 })),
    ).toMatchObject({ status: 200 });
  });
  it("is 503 when the database cannot be reached or the request fails", async () => {
    expect(
      await checkHealth(async () => ({ error: { code: "PGRST001", message: "" }, status: 503 })),
    ).toEqual({ status: 503, body: { status: "unavailable" } });
    expect(
      await checkHealth(async () => {
        throw new Error("fetch failed");
      }),
    ).toEqual({ status: 503, body: { status: "unavailable" } });
  });
});
