import { describe, expect, it } from "vitest";
import {
  findOverstays,
  isOverstay,
  sessionAgeMinutes,
  validateOverstayMinutes,
} from "../src/lib/overstay";

const NOW = "2026-10-30T10:00:00Z";
const at = (minutesAgo: number) => new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString();

describe("T-CON-09-U1 threshold validation", () => {
  it("rejects 0 and 29, accepts 30 and 240", () => {
    for (const m of [0, 29]) expect(validateOverstayMinutes(m).ok).toBe(false);
    for (const m of [30, 240]) expect(validateOverstayMinutes(m)).toEqual({ ok: true, minutes: m });
  });
});

describe("overstay evaluation", () => {
  it("selects sessions of 239, 240 and 241 minutes at a 240 threshold: 240 and over (T-CLD-07-U1)", () => {
    const sessions = [
      { sessionId: "a", entryTime: at(239) },
      { sessionId: "b", entryTime: at(240) },
      { sessionId: "c", entryTime: at(241) },
    ];
    expect(findOverstays(sessions, NOW, 240).map((r) => r.sessionId)).toEqual(["c", "b"]);
  });

  it("rounds age down to whole minutes", () => {
    expect(sessionAgeMinutes("2026-10-30T05:59:30Z", NOW)).toBe(240);
    expect(sessionAgeMinutes("2026-10-30T06:00:30Z", NOW)).toBe(239);
  });

  it("leaves pass sessions out", () => {
    const sessions = [
      { sessionId: "pass", entryTime: at(600), passId: "0190a000-0000-7000-8000-000000000001" },
      { sessionId: "paid", entryTime: at(600), passId: null },
    ];
    expect(findOverstays(sessions, NOW, 240).map((r) => r.sessionId)).toEqual(["paid"]);
  });

  it("never gives a negative age when the clock is behind the entry", () => {
    expect(sessionAgeMinutes("2026-10-30T10:30:00Z", NOW)).toBe(0);
  });

  it("handles offsets and rejects text that is not an instant", () => {
    expect(sessionAgeMinutes("2026-10-30T14:30:00+05:30", NOW)).toBe(60);
    expect(() => sessionAgeMinutes("yesterday", NOW)).toThrow(RangeError);
    expect(() => sessionAgeMinutes("2026-10-30 10:00:00", NOW)).toThrow(RangeError);
  });

  it("refuses an invalid threshold instead of flagging everything", () => {
    expect(() => isOverstay(500, 10)).toThrow(RangeError);
    expect(isOverstay(29, 30)).toBe(false);
    expect(isOverstay(30, 30)).toBe(true);
  });

  it("returns nothing for no sessions", () => {
    expect(findOverstays([], NOW, 240)).toEqual([]);
  });
});
