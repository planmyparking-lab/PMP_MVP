import { describe, expect, it } from "vitest";

import { buildDiagnosticsBlob, entryTimingLine, exitTimingLine } from "../src/lib/diag";
import { addLogLine, recentLogLines, resetLogForTests } from "../src/lib/log";

describe("safe timing diagnostics", () => {
  it("emits entry duration, save duration, and short-code regeneration count", () => {
    resetLogForTests();
    addLogLine(entryTimingLine(18.4, 4.6, 2, 4), "2026-10-26T00:00:00Z");
    expect(recentLogLines(1)[0]?.line).toBe(
      "entry_ms=18 entry_taps=4 entry_save_ms=5 short_code_regenerations=2",
    );
  });

  it("emits exit duration and save duration without session or payment identifiers", () => {
    resetLogForTests();
    addLogLine(exitTimingLine(2300.3, 12.8, "UPI"), "2026-10-26T00:00:00Z");
    expect(recentLogLines(1)[0]?.line).toBe("exit_ms=2300 exit_save_ms=13 outcome=UPI");
    expect(exitTimingLine(500, 10, "WAIVED")).toBe("exit_ms=500 exit_save_ms=10 outcome=WAIVED");
  });

  it("includes the active zone safety-limit mode in the support diagnostics blob", () => {
    const blob = JSON.parse(
      buildDiagnosticsBlob({
        appVersion: "1.0.0",
        schemaVersion: 1,
        deviceId: "device",
        facilityId: "facility",
        configSource: "test",
        currentShiftOpenedAt: null,
        lastSyncAt: null,
        queueDepth: 0,
        oldestUnsyncedAgeMs: 0,
        online: false,
        quarantinedCount: 0,
        syncBlocked: false,
        generatedAt: "2026-10-26T00:00:00Z",
      }),
    ) as { safetyLimitMode: string };
    expect(blob.safetyLimitMode).toBe("ABSOLUTE_PLUS_50");
  });

  it("exports only the latest 100 scrubbed log lines, oldest first", () => {
    resetLogForTests();
    for (let index = 1; index <= 105; index += 1) {
      const line =
        index === 6
          ? "diagnostic password=fake-secret token=parkos:fac-demo-1:P4RK1:aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa"
          : `diagnostic ${index}`;
      addLogLine(line, "2026-10-26T00:00:00Z");
    }
    const blob = JSON.parse(
      buildDiagnosticsBlob({
        appVersion: "1.0.0",
        schemaVersion: 1,
        deviceId: "device",
        facilityId: "facility",
        configSource: "test",
        currentShiftOpenedAt: null,
        lastSyncAt: null,
        queueDepth: 0,
        oldestUnsyncedAgeMs: 0,
        online: false,
        quarantinedCount: 0,
        syncBlocked: false,
        generatedAt: "2026-10-26T00:00:00Z",
      }),
    ) as { logs: { line: string }[] };

    expect(blob.logs).toHaveLength(100);
    expect(blob.logs[0]?.line).toBe("diagnostic password=[redacted] token=[qr-token-payload]");
    expect(blob.logs[99]?.line).toBe("diagnostic 105");
  });
});
