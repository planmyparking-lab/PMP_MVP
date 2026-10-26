import { describe, expect, it } from "vitest";

import { buildQrMatrix } from "../src/print/qr";

/**
 * QR matrix builder (GATE-10): the token QR is a pure function of the ASCII payload; non-ASCII
 * or empty payloads fail safe with null (a data bug, never a silent redraw).
 */

describe("buildQrMatrix", () => {
  const payload = "parkos:fac-demo-1:P4RK1:aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa";

  it("encodes an ASCII payload deterministically", () => {
    const first = buildQrMatrix(payload);
    expect(first).not.toBeNull();
    if (first === null) return;
    expect(first.visibleBytes).toBe(payload.length);
    expect(first.moduleCount).toBeGreaterThanOrEqual(21);
    expect(first.modules).toHaveLength(first.moduleCount);
    expect(first.modules[0]).toHaveLength(first.moduleCount);
    // finder pattern anchor is dark in every valid QR
    expect(first.modules[0][0]).toBe(true);
    expect(first.modules[0][first.moduleCount - 1]).toBe(true);
    expect(first.modules[first.moduleCount - 1][0]).toBe(true);

    const second = buildQrMatrix(payload);
    expect(second).toEqual(first);
  });

  it("refuses empty and non-ASCII payloads instead of guessing", () => {
    expect(buildQrMatrix("")).toBeNull();
    expect(buildQrMatrix("कॉफ़ी")).toBeNull();
    expect(buildQrMatrix("café ☕ parkos")).toBeNull();
  });
});
