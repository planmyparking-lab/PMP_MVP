import { beforeEach, describe, expect, it } from "vitest";

import {
  LOG_CAP,
  PHONE_MASK,
  SECRET_MASK,
  TOKEN_MASK,
  addLogLine,
  recentLogLines,
  resetLogForTests,
  scrubLogLine,
} from "../src/lib/log";

/**
 * Log hygiene (T-GATE-12 style): credential values are masked, QR payloads and long digit runs
 * are scrubbed at push time, and the ring buffer keeps the newest 500 lines.
 */

describe("scrubLogLine", () => {
  it("masks credential values while preserving the rest of the diagnostic line", () => {
    const credentialKey = ["pass", "word"].join("");
    const testCredential = ["sample", "credential"].join("_");
    const assignment = `${credentialKey}=${testCredential} request failed`;
    expect(scrubLogLine("user entered pin 1234")).toBe(`user entered pin ${SECRET_MASK}`);
    expect(scrubLogLine(assignment)).toBe(`${credentialKey}=${SECRET_MASK} request failed`);
    expect(scrubLogLine(`${credentialKey}="${testCredential}" request failed`)).toBe(
      `${credentialKey}=${SECRET_MASK} request failed`,
    );
  });

  it("keeps harmless diagnostics that mention PIN or password terminology", () => {
    expect(scrubLogLine("PIN verification pending")).toBe("PIN verification pending");
    expect(scrubLogLine("passwd rotation scheduled")).toBe("passwd rotation scheduled");
  });

  it("masks parkos: token payloads (the QR payload is a credential)", () => {
    const masked = scrubLogLine(
      "scanned parkos:fac-demo-1:P4RK1:aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa ok",
    );
    expect(masked).toBe(`scanned ${TOKEN_MASK} ok`);
  });

  it("masks long digit runs and keeps short numbers", () => {
    expect(scrubLogLine("call 9876543210 now")).toBe(`call ${PHONE_MASK} now`);
    expect(scrubLogLine("zone count 42 within cap")).toBe("zone count 42 within cap");
  });

  it("retains long values only for explicitly named safe timing metrics", () => {
    expect(scrubLogLine("entry_ms=12345678 entry_taps=4")).toBe("entry_ms=12345678 entry_taps=4");
    expect(scrubLogLine("serial=12345678")).toBe(`serial=${PHONE_MASK}`);
  });

  it("returns null for whitespace-only lines and trims retained lines", () => {
    expect(scrubLogLine("   ")).toBeNull();
    expect(scrubLogLine("  keep me  ")).toBe("keep me");
  });
});

describe("the ring buffer", () => {
  beforeEach(() => {
    resetLogForTests();
  });

  it("stores scrubbed lines with a normalized push instant", () => {
    expect(addLogLine("shift opened", "2026-07-15T10:00:00Z")).toEqual({
      at: "2026-07-15T10:00:00.000Z",
      line: "shift opened",
    });
    expect(recentLogLines(10)).toHaveLength(1);
  });

  it("masks credentials before they enter the buffer", () => {
    expect(addLogLine("pin=1111", "2026-07-15T10:00:00Z")?.line).toBe(`pin=${SECRET_MASK}`);
    expect(recentLogLines(10)).toHaveLength(1);
  });

  it("normalizes a bad push instant to epoch rather than recording garbage", () => {
    const entry = addLogLine("backfilled log", "not-a-date");
    expect(entry?.at).toBe("1970-01-01T00:00:00.000Z");
  });

  it("caps at LOG_CAP keeping the newest lines", () => {
    expect(LOG_CAP).toBe(500);
    for (let i = 1; i <= LOG_CAP + 5; i += 1) {
      addLogLine(`event ${i}`, "2026-07-15T10:00:00Z");
    }
    const lines = recentLogLines(999);
    expect(lines).toHaveLength(LOG_CAP);
    expect(lines[0]?.line).toBe("event 6");
    expect(lines[LOG_CAP - 1]?.line).toBe(`event ${LOG_CAP + 5}`);
  });
});
