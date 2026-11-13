import type { Event } from "@pmp/contracts";
import { describe, expect, it } from "vitest";
import {
  computeOccupancy,
  drift,
  isDriftFlagged,
  zoneCountFromEvent,
  type ClosedSession,
  type OccupancyInput,
  type OccupancyResult,
  type ZoneCountRecord,
} from "../src";

const FACILITY = "00000000-0000-4000-8000-0000000000f1";
const DEVICE = "00000000-0000-4000-8000-0000000000d1";
const STAFF = "00000000-0000-4000-8000-0000000000b1";
const Z1 = "00000000-0000-4000-8000-0000000000c1";
const Z2 = "00000000-0000-4000-8000-0000000000c2";
const zones = [
  { id: Z1, capacity: 5 },
  { id: Z2, capacity: 3 },
];

let seq = 0;
const uid = (prefix: string): string =>
  `018f0000-0000-7000-8000-${prefix}${String(++seq).padStart(12 - prefix.length, "0")}`;
const T = (minute: number, second = 0): string =>
  `2026-10-01T${String(10 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`;

function base(time: string) {
  return {
    facility_id: FACILITY,
    device_id: DEVICE,
    staff_id: STAFF,
    device_time: time,
    source: "LIVE" as const,
    schema_version: 1,
  };
}
function entry(session: string, zone: string, time: string, id = uid("a")): Event {
  return {
    ...base(time),
    id,
    type: "ENTRY",
    session_id: session,
    payload: { vehicle_class: "CAR", zone_id: zone, short_code: "7K2QX" },
  };
}
function exit(session: string, time: string, id = uid("b")): Event {
  return {
    ...base(time),
    id,
    type: "EXIT",
    session_id: session,
    payload: { fare_paise: 1000, exit_method: "SCAN" },
  };
}
function count(
  zone: string,
  counted: number,
  system: number,
  time: string,
  id = uid("c"),
): ZoneCountRecord {
  return { id, zoneId: zone, counted, systemCountAtTime: system, deviceTime: time };
}
function closed(session: string, zone: string, entryTime: string, exitTime: string): ClosedSession {
  return { sessionId: session, zoneId: zone, entryTime, exitTime };
}
const s = (n: number): string => uid(`5${n}`);

function run(partial: Partial<OccupancyInput>): OccupancyResult {
  return computeOccupancy({ zones, openSessions: [], localEvents: [], zoneCounts: [], ...partial });
}
function ok(r: OccupancyResult) {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r;
}

describe("computeOccupancy without a baseline", () => {
  it("is zero for empty input", () => {
    const r = ok(run({}));
    expect(r.zones[Z1]).toEqual({ count: 0, rawCount: 0, capacity: 5, baselineAt: null });
    expect(r.warnings).toEqual([]);
  });

  it("counts open sessions per zone", () => {
    const r = ok(
      run({
        openSessions: [
          { sessionId: s(1), zoneId: Z1, entryTime: T(1) },
          { sessionId: s(2), zoneId: Z1, entryTime: T(2) },
          { sessionId: s(3), zoneId: Z2, entryTime: T(3) },
        ],
      }),
    );
    expect([r.zones[Z1]!.count, r.zones[Z2]!.count]).toEqual([2, 1]);
  });

  it("adds unsynced local entries and removes local exits", () => {
    const a = s(1);
    const b = s(2);
    const r = ok(
      run({
        openSessions: [{ sessionId: a, zoneId: Z1, entryTime: T(1) }],
        localEvents: [entry(b, Z1, T(5)), exit(a, T(6))],
      }),
    );
    expect(r.zones[Z1]!.count).toBe(1);
  });

  it("does not count an entry twice when it is in open_sessions and in the local store", () => {
    const a = s(1);
    const r = ok(
      run({
        openSessions: [{ sessionId: a, zoneId: Z1, entryTime: T(1) }],
        localEvents: [entry(a, Z1, T(1))],
      }),
    );
    expect(r.zones[Z1]!.count).toBe(1);
  });

  it("does not count the same event twice", () => {
    const e = entry(s(1), Z1, T(1));
    expect(ok(run({ localEvents: [e, e, { ...e }] })).zones[Z1]!.count).toBe(1);
  });

  it("an entry and exit that both happened locally cancel out", () => {
    const a = s(1);
    expect(ok(run({ localEvents: [entry(a, Z1, T(1)), exit(a, T(2))] })).zones[Z1]!.count).toBe(0);
  });

  it("two exits for one session remove one vehicle (duplicate exit)", () => {
    const a = s(1);
    const b = s(2);
    const r = ok(
      run({ localEvents: [entry(a, Z1, T(1)), entry(b, Z1, T(2)), exit(a, T(3)), exit(a, T(4))] }),
    );
    expect(r.zones[Z1]!.count).toBe(1);
  });

  it("an exit for an unknown session does not decrement and raises ORPHAN_EXIT", () => {
    const orphan = exit(s(9), T(3));
    const r = ok(
      run({
        openSessions: [{ sessionId: s(1), zoneId: Z1, entryTime: T(1) }],
        localEvents: [orphan],
      }),
    );
    expect(r.zones[Z1]!.count).toBe(1);
    expect(r.warnings).toEqual([{ zoneId: null, kind: "ORPHAN_EXIT", ref: orphan.id }]);
  });

  it("ignores PAYMENT and other event types", () => {
    const pay: Event = {
      ...base(T(2)),
      id: uid("d"),
      type: "PAYMENT",
      session_id: s(1),
      payload: { mode: "CASH", amount_paise: 100, upi_attested: false },
    };
    expect(ok(run({ localEvents: [pay] })).zones[Z1]!.count).toBe(0);
  });

  it("warns when a zone is over capacity but still reports the count", () => {
    const open = Array.from({ length: 4 }, (_, i) => ({
      sessionId: s(i + 1),
      zoneId: Z2,
      entryTime: T(i),
    }));
    const r = ok(run({ openSessions: open }));
    expect(r.zones[Z2]!.count).toBe(4);
    expect(r.warnings).toEqual([{ zoneId: Z2, kind: "OVER_CAPACITY" }]);
  });
});

describe("computeOccupancy with a ZONE_COUNT baseline", () => {
  it("uses the physical count, then applies later entries and exits", () => {
    const old = s(1);
    const r = ok(
      run({
        zoneCounts: [count(Z1, 4, 3, T(10))],
        openSessions: [{ sessionId: old, zoneId: Z1, entryTime: T(1) }],
        localEvents: [entry(s(2), Z1, T(12)), entry(s(3), Z1, T(13)), exit(old, T(14))],
      }),
    );
    expect(r.zones[Z1]).toMatchObject({ count: 5, baselineAt: T(10) });
  });

  it("ignores events at or before the baseline (they are already in the physical count)", () => {
    const a = s(1);
    const r = ok(
      run({
        zoneCounts: [count(Z1, 2, 2, T(10))],
        localEvents: [entry(a, Z1, T(5)), exit(a, T(8)), entry(s(2), Z1, T(10))],
      }),
    );
    expect(r.zones[Z1]!.count).toBe(2);
  });

  it("uses the latest baseline when there are several", () => {
    const r = ok(
      run({ zoneCounts: [count(Z1, 9, 9, T(5)), count(Z1, 1, 1, T(20)), count(Z1, 7, 7, T(10))] }),
    );
    expect(r.zones[Z1]).toMatchObject({ count: 1, baselineAt: T(20) });
  });

  it("an entry and exit after the baseline cancel out", () => {
    const a = s(1);
    expect(
      ok(
        run({
          zoneCounts: [count(Z1, 3, 3, T(1))],
          localEvents: [entry(a, Z1, T(5)), exit(a, T(6))],
        }),
      ).zones[Z1]!.count,
    ).toBe(3);
  });

  it("clamps a negative count at 0 and warns instead of hiding it", () => {
    const a = s(1);
    const r = ok(
      run({
        zoneCounts: [count(Z1, 0, 0, T(1))],
        openSessions: [{ sessionId: a, zoneId: Z1, entryTime: T(0) }],
        localEvents: [exit(a, T(5))],
      }),
    );
    expect(r.zones[Z1]).toMatchObject({ count: 0, rawCount: -1 });
    expect(r.warnings).toContainEqual({ zoneId: Z1, kind: "NEGATIVE" });
  });

  it("reports a stale baseline only when a clock is supplied", () => {
    const input = { zoneCounts: [count(Z1, 1, 1, T(0))] };
    expect(ok(run(input)).warnings).toEqual([]);
    expect(ok(run({ ...input, now: "2026-10-03T10:00:00.000Z" })).warnings).toEqual([
      { zoneId: Z1, kind: "STALE_BASELINE" },
    ]);
    expect(ok(run({ ...input, now: T(30) })).warnings).toEqual([]);
  });

  it("keeps zones independent", () => {
    const r = ok(
      run({
        zoneCounts: [count(Z1, 3, 3, T(1))],
        openSessions: [{ sessionId: s(1), zoneId: Z2, entryTime: T(2) }],
      }),
    );
    expect([r.zones[Z1]!.count, r.zones[Z2]!.count]).toEqual([3, 1]);
  });
});

describe("cross-device exits (closedSessions, SYNC-03 stub, Akanksha's finding)", () => {
  it("subtracts a session the baseline counted even once it is gone from the open_sessions snapshot", () => {
    // 0005_open_sessions.sql deletes the row on EXIT, so after a refresh the session leaves no local trace at all.
    const old = s(1);
    const r = ok(
      run({
        zoneCounts: [count(Z1, 3, 3, T(1))],
        openSessions: [], // already refreshed: the row for `old` is gone
        closedSessions: [closed(old, Z1, T(0), T(5))], // entered before the baseline, exited after it
      }),
    );
    expect(r.zones[Z1]!.count).toBe(2);
  });

  it("a session that entered and exited entirely after the baseline, on other devices, nets to zero", () => {
    const r = ok(
      run({
        zoneCounts: [count(Z1, 3, 3, T(1))],
        closedSessions: [closed(s(1), Z1, T(5), T(6))], // both after the baseline
      }),
    );
    expect(r.zones[Z1]!.count).toBe(3);
  });

  it("does not double-subtract a session reported both locally and through closedSessions", () => {
    const a = s(1);
    const r = ok(
      run({
        zoneCounts: [count(Z1, 3, 3, T(1))],
        openSessions: [{ sessionId: a, zoneId: Z1, entryTime: T(0) }],
        localEvents: [exit(a, T(5))],
        closedSessions: [closed(a, Z1, T(0), T(5))],
      }),
    );
    expect(r.zones[Z1]!.count).toBe(2); // one subtraction, not two
  });

  it("without a baseline, a closed session is not counted as open even with no local EXIT event", () => {
    const a = s(1);
    const r = ok(
      run({
        openSessions: [{ sessionId: a, zoneId: Z1, entryTime: T(1) }],
        closedSessions: [closed(a, Z1, T(1), T(2))],
      }),
    );
    expect(r.zones[Z1]!.count).toBe(0);
  });

  it(
    "a local EXIT for a session unknown from open_sessions still raises ORPHAN_EXIT, but closedSessions still " +
      "corrects the count (the case the README's old claim did not cover)",
    () => {
      const remote = s(1);
      const localExit = exit(remote, T(5));
      const r = ok(
        run({
          zoneCounts: [count(Z1, 3, 3, T(1))],
          localEvents: [localExit], // this device never saw the ENTRY, so `remote` is not in `entries`
          closedSessions: [closed(remote, Z1, T(0), T(5))],
        }),
      );
      expect(r.zones[Z1]!.count).toBe(2);
      expect(r.warnings).toEqual([{ zoneId: null, kind: "ORPHAN_EXIT", ref: localExit.id }]);
    },
  );

  it("a future-dated closedSessions exitTime is ignored with a warning, not trusted", () => {
    const a = s(1);
    const r = ok(
      run({
        zoneCounts: [count(Z1, 3, 3, T(1))],
        closedSessions: [closed(a, Z1, T(0), T(600))],
        now: T(3),
      }),
    );
    expect(r.zones[Z1]!.count).toBe(3);
    expect(r.warnings).toEqual([{ zoneId: Z1, kind: "FUTURE_EVENT_IGNORED", ref: a }]);
  });

  it("a zone mentioned only by closedSessions still needs zone config", () => {
    const unknown = "00000000-0000-4000-8000-0000000000ee";
    const r = run({ closedSessions: [closed(s(1), unknown, T(0), T(1))] });
    expect(r).toEqual({ ok: false, error: "MISSING_ZONE_CONFIG", zoneIds: [unknown] });
  });

  it("a session entered locally after the baseline and closed only through closedSessions is still subtracted", () => {
    // Akanksha's finding: the first fix only subtracted a closedSessions exit when entryTime <= baselineTime, so a
    // session entered locally AFTER the baseline (added to `entered`) but exited only on another device was never
    // subtracted — it stayed counted forever, not just until the next sync.
    const a = s(1);
    const r = ok(
      run({
        zoneCounts: [count(Z1, 3, 3, T(1))],
        localEvents: [entry(a, Z1, T(5))],
        closedSessions: [closed(a, Z1, T(5), T(6))],
      }),
    );
    expect(r.zones[Z1]!.count).toBe(3); // entered after baseline (+1), closed after baseline (-1): net 0
  });

  it("the earliest exit wins: a closedSessions exit cannot re-subtract a session that already exited before the baseline", () => {
    // Akanksha's finding: a session with both a local exit before the baseline and a (stale or duplicate) later
    // closedSessions exit must use the EARLIEST of the two, not treat the closedSessions one as an independent,
    // un-deduplicated signal.
    const a = s(1);
    const r = ok(
      run({
        zoneCounts: [count(Z1, 3, 3, T(10))],
        openSessions: [{ sessionId: a, zoneId: Z1, entryTime: T(0) }],
        localEvents: [exit(a, T(5))], // exited well before the baseline: never part of baseline.counted
        closedSessions: [closed(a, Z1, T(0), T(20))], // a later, inconsistent report of the same session
      }),
    );
    expect(r.zones[Z1]!.count).toBe(3); // unaffected: the real (earliest) exit was before the baseline
  });

  it("entry and exit exactly at the baseline boundary are not counted as after it (closedSessions)", () => {
    const a = s(1);
    const r = ok(
      run({
        zoneCounts: [count(Z1, 3, 3, T(10))],
        closedSessions: [closed(a, Z1, T(10), T(10))], // both exactly at the baseline, not strictly after
      }),
    );
    expect(r.zones[Z1]!.count).toBe(3);
  });

  it("duplicate closedSessions rows for the same session do not double-subtract", () => {
    const a = s(1);
    const r = ok(
      run({
        zoneCounts: [count(Z1, 3, 3, T(1))],
        closedSessions: [closed(a, Z1, T(0), T(5)), closed(a, Z1, T(0), T(6))],
      }),
    );
    expect(r.zones[Z1]!.count).toBe(2); // one subtraction, not two, however many records report it
  });

  it("zone isolation: a known session's zone always wins over a disagreeing closedSessions.zoneId", () => {
    const a = s(1);
    const r = ok(
      run({
        zoneCounts: [count(Z1, 3, 3, T(1)), count(Z2, 1, 1, T(1))],
        openSessions: [{ sessionId: a, zoneId: Z1, entryTime: T(0) }], // the real, known zone is Z1
        closedSessions: [closed(a, Z2, T(0), T(5))], // disagrees: claims Z2
      }),
    );
    // Subtracted from Z1 (the zone this device actually knows the session belongs to), not Z2.
    expect(r.zones[Z1]!.count).toBe(2);
    expect(r.zones[Z2]!.count).toBe(1);
  });
});

describe("computeOccupancy clock and config rules", () => {
  it("ignores events more than 5 minutes ahead of the receiving clock and says so", () => {
    const future = entry(s(1), Z1, T(10));
    const fine = entry(s(2), Z1, T(4));
    const r = ok(run({ localEvents: [future, fine], now: T(3) }));
    expect(r.zones[Z1]!.count).toBe(1);
    expect(r.warnings).toEqual([{ zoneId: Z1, kind: "FUTURE_EVENT_IGNORED", ref: future.id }]);
  });

  it("accepts an event up to exactly 5 minutes ahead", () => {
    expect(ok(run({ localEvents: [entry(s(1), Z1, T(8))], now: T(3) })).zones[Z1]!.count).toBe(1);
  });

  it("drops a malformed device_time instead of silently treating NaN comparisons as valid (review follow-up)", () => {
    // Date.parse('not-a-real-date') is NaN, and every comparison against NaN is false — unguarded, this would
    // neither be flagged future nor used, just silently absorbed as if the event were fine.
    const bad = { ...entry(s(1), Z1, T(1)), device_time: "not-a-real-date" };
    const r = ok(run({ localEvents: [bad] }));
    expect(r.zones[Z1]!.count).toBe(0);
    expect(r.warnings).toEqual([{ zoneId: Z1, kind: "FUTURE_EVENT_IGNORED", ref: bad.id }]);
  });

  it("drops a malformed closedSessions entryTime, not only exitTime", () => {
    const a = s(1);
    const r = ok(
      run({
        zoneCounts: [count(Z1, 3, 3, T(1))],
        closedSessions: [closed(a, Z1, "not-a-real-date", T(5))],
      }),
    );
    expect(r.zones[Z1]!.count).toBe(3);
    expect(r.warnings).toEqual([{ zoneId: Z1, kind: "FUTURE_EVENT_IGNORED", ref: a }]);
  });

  it("a future-dated ZONE_COUNT does not become the baseline (Nikhil's finding)", () => {
    const past = count(Z1, 3, 3, T(1));
    const future = count(Z1, 9, 9, T(600)); // minutes, far beyond the 5-minute tolerance
    const r = ok(run({ zoneCounts: [past, future], now: T(3) }));
    expect(r.zones[Z1]).toMatchObject({ count: 3, baselineAt: T(1) });
    expect(r.warnings).toEqual([{ zoneId: Z1, kind: "FUTURE_EVENT_IGNORED", ref: future.id }]);
  });

  it("a future baseline cannot suppress STALE_BASELINE or silently absorb later entries", () => {
    // Without the fix, the future count would become the baseline, now - t would go negative (no STALE_BASELINE),
    // and this later entry (after the real, past baseline) would be read as "before" the (wrongly future) baseline.
    const future = count(Z1, 0, 0, "2026-10-05T00:00:00.000Z");
    const r = ok(
      run({
        zoneCounts: [future],
        openSessions: [{ sessionId: s(1), zoneId: Z1, entryTime: T(1) }],
        now: T(3),
      }),
    );
    expect(r.zones[Z1]).toMatchObject({ count: 1, baselineAt: null });
    expect(r.warnings).toEqual([{ zoneId: Z1, kind: "FUTURE_EVENT_IGNORED", ref: future.id }]);
  });

  it("a future-dated open_sessions entryTime is ignored with a warning, not trusted", () => {
    const a = s(1);
    const r = ok(
      run({ openSessions: [{ sessionId: a, zoneId: Z1, entryTime: T(10) }], now: T(3) }),
    );
    expect(r.zones[Z1]!.count).toBe(0);
    expect(r.warnings).toEqual([{ zoneId: Z1, kind: "FUTURE_EVENT_IGNORED", ref: a }]);
  });

  it("returns an explicit error, not zeros, when a zone is not configured", () => {
    const unknown = "00000000-0000-4000-8000-0000000000ee";
    const r = run({ openSessions: [{ sessionId: s(1), zoneId: unknown, entryTime: T(1) }] });
    expect(r).toEqual({ ok: false, error: "MISSING_ZONE_CONFIG", zoneIds: [unknown] });
    expect(run({ zones: [], zoneCounts: [count(Z1, 1, 1, T(1))] })).toMatchObject({
      ok: false,
      zoneIds: [Z1],
    });
  });
});

describe("drift", () => {
  it("is counted minus system count of the latest count", () => {
    const history = [count(Z1, 10, 10, T(1)), count(Z1, 12, 9, T(5)), count(Z2, 1, 5, T(9))];
    expect(drift(history, Z1)).toBe(3);
    expect(drift(history, Z2)).toBe(-4);
    expect(drift(history, "none")).toBeNull();
  });

  it("ignores a future-dated count when now is given (Nikhil's finding)", () => {
    const history = [count(Z1, 10, 10, T(1)), count(Z1, 99, 1, T(600))];
    expect(drift(history, Z1, T(3))).toBe(0); // the far-future count is dropped; T(1) (10-10=0) is latest
    expect(drift(history, Z1)).toBe(98); // without `now`, nothing is filtered (same as before this fix)
  });

  it("accepts a count up to exactly 5 minutes ahead (the same boundary computeOccupancy uses)", () => {
    const history = [count(Z1, 10, 10, T(1)), count(Z1, 5, 5, T(8))]; // T(8) is exactly 5 minutes after T(3)
    expect(drift(history, Z1, T(3))).toBe(0); // T(8) is accepted and becomes latest (5-5=0)
  });

  it("drops a malformed deviceTime instead of letting it get stuck as latest forever (review follow-up)", () => {
    // Every comparison against NaN is false, so an unguarded malformed first record would never be displaced by
    // any later, valid one — this must be dropped outright, `now` or not.
    const malformed = { ...count(Z1, 999, 1, "not-a-real-date") };
    const valid = count(Z1, 10, 10, T(5));
    expect(drift([malformed, valid], Z1)).toBe(0);
    expect(drift([malformed, valid], Z1, T(10))).toBe(0);
    expect(drift([malformed], Z1)).toBeNull();
  });
  it("flags more than 3% of the system count", () => {
    expect(isDriftFlagged(103, 100)).toBe(false);
    expect(isDriftFlagged(104, 100)).toBe(true);
    expect(isDriftFlagged(96, 100)).toBe(true);
    expect(isDriftFlagged(0, 0)).toBe(false);
    expect(isDriftFlagged(1, 0)).toBe(true);
  });
  it("zoneCountFromEvent converts ZONE_COUNT events only", () => {
    const e: Event = {
      ...base(T(1)),
      id: uid("e"),
      type: "ZONE_COUNT",
      session_id: null,
      payload: { zone_id: Z1, counted: 4, system_count_at_time: 3 },
    };
    expect(zoneCountFromEvent(e)).toEqual({
      id: e.id,
      zoneId: Z1,
      counted: 4,
      systemCountAtTime: 3,
      deviceTime: T(1),
    });
    expect(zoneCountFromEvent(entry(s(1), Z1, T(1)))).toBeNull();
  });
});

// ---- randomized properties (seeded, so failures are reproducible) -------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(items: T[], rnd: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Random day: vehicles enter and leave over time; returns events plus the oracle count per zone after each step. */
function randomDay(rnd: () => number, steps: number) {
  const events: Event[] = [];
  const open = new Map<string, string>(); // session -> zone
  const oracle: Record<string, number>[] = [];
  let minute = 0;
  for (let i = 0; i < steps; i++) {
    minute += 1;
    if (open.size > 0 && rnd() < 0.45) {
      const sessions = [...open.keys()];
      const sess = sessions[Math.floor(rnd() * sessions.length)]!;
      events.push(exit(sess, T(minute)));
      open.delete(sess);
    } else {
      const sess = uid("f");
      const zone = rnd() < 0.5 ? Z1 : Z2;
      events.push(entry(sess, zone, T(minute)));
      open.set(sess, zone);
    }
    const snap: Record<string, number> = { [Z1]: 0, [Z2]: 0 };
    for (const z of open.values()) snap[z] = (snap[z] ?? 0) + 1;
    oracle.push(snap);
  }
  return { events, oracle };
}

describe("computeOccupancy properties", () => {
  it("matches the oracle at every checkpoint when all events are local (no baseline)", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = mulberry32(seed);
      const { events, oracle } = randomDay(rnd, 60);
      for (let k = 1; k <= events.length; k++) {
        const r = ok(run({ localEvents: events.slice(0, k) }));
        expect([r.zones[Z1]!.rawCount, r.zones[Z2]!.rawCount]).toEqual([
          oracle[k - 1]![Z1],
          oracle[k - 1]![Z2],
        ]);
      }
    }
  });

  it("matches the oracle after a baseline taken at any checkpoint (physical count = oracle)", () => {
    for (let seed = 100; seed < 130; seed++) {
      const rnd = mulberry32(seed);
      const { events, oracle } = randomDay(rnd, 50);
      const cut = 5 + Math.floor(rnd() * 40);
      // The physical count is taken just after event `cut` (second 30 of its minute).
      const counts = [
        count(Z1, oracle[cut - 1]![Z1]!, 0, T(cut, 30)),
        count(Z2, oracle[cut - 1]![Z2]!, 0, T(cut, 30)),
      ];
      const r = ok(run({ localEvents: events, zoneCounts: counts }));
      const last = oracle[events.length - 1]!;
      expect([r.zones[Z1]!.rawCount, r.zones[Z2]!.rawCount]).toEqual([last[Z1], last[Z2]]);
    }
  });

  it("is independent of the order of its inputs", () => {
    for (let seed = 200; seed < 230; seed++) {
      const rnd = mulberry32(seed);
      const { events } = randomDay(rnd, 40);
      const counts = [
        count(Z1, 2, 2, T(10, 30)),
        count(Z1, 3, 3, T(20, 30)),
        count(Z2, 1, 1, T(15, 30)),
      ];
      const expected = run({ localEvents: events, zoneCounts: counts });
      const shuffled = run({ localEvents: shuffle(events, rnd), zoneCounts: shuffle(counts, rnd) });
      expect(shuffled).toEqual(expected);
    }
  });

  it("is unchanged when every event is delivered twice", () => {
    for (let seed = 300; seed < 320; seed++) {
      const rnd = mulberry32(seed);
      const { events } = randomDay(rnd, 40);
      expect(run({ localEvents: [...events, ...events] })).toEqual(run({ localEvents: events }));
    }
  });

  it("never reports a negative displayed count, whatever the input", () => {
    for (let seed = 400; seed < 440; seed++) {
      const rnd = mulberry32(seed);
      const { events } = randomDay(rnd, 40);
      // Drop a random subset of entries so exits are orphaned or baselines too low.
      const partial = events.filter((e) => !(e.type === "ENTRY" && rnd() < 0.5));
      const r = ok(
        run({
          localEvents: partial,
          zoneCounts: [count(Z1, 0, 0, T(2, 30)), count(Z2, 0, 0, T(2, 30))],
        }),
      );
      for (const z of [Z1, Z2]) expect(r.zones[z]!.count).toBeGreaterThanOrEqual(0);
    }
  });
});
