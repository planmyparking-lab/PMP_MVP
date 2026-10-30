import { describe, expect, it } from "vitest";

import { IST_OFFSET_MINUTES, istClockTime } from "../src/domain/istClock";

/**
 * IST display-time rule: storage stays UTC instants (repo invariant); only the DISPLAY time is
 * shifted (+5:30) and shown without seconds.
 */

describe("istClockTime", () => {
  it("shifts UTC instants by +5:30 for display", () => {
    expect(IST_OFFSET_MINUTES).toBe(330);
    expect(istClockTime(Date.UTC(2026, 9, 25, 10, 30))).toBe("16:00");
    expect(istClockTime(Date.UTC(2026, 9, 25, 19, 0))).toBe("00:30"); // day rollover into IST
    expect(istClockTime(Date.UTC(2026, 9, 25, 0, 5))).toBe("05:35");
  });

  it("degrades to a clearly-broken placeholder on invalid input (never a wrong time)", () => {
    expect(istClockTime(Number.NaN)).toBe("--:--");
  });
});
