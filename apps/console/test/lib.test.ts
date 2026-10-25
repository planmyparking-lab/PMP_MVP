import { describe, expect, it } from "vitest";
import { overridesPer100 } from "../src/lib/kpi";
import { occupancyView } from "../src/lib/occupancyBand";
import { MIN_OVERSTAY_MINUTES, validateOverstayMinutes } from "../src/lib/overstay";
import { sanitizeRedirect } from "../src/lib/safeRedirect";

describe("T-CON-03-U1 redirect sanitizer", () => {
  it("accepts a same-origin path", () => {
    expect(sanitizeRedirect("/dash")).toBe("/dash");
    expect(sanitizeRedirect("/f/123/shifts?x=1")).toBe("/f/123/shifts?x=1");
  });
  it("rejects absolute and protocol-relative URLs", () => {
    expect(sanitizeRedirect("https://evil.com")).toBe("/");
    expect(sanitizeRedirect("//evil.com")).toBe("/");
  });
  it("rejects backslash, control-character, scheme and non-string input", () => {
    expect(sanitizeRedirect("/\\evil.com")).toBe("/");
    expect(sanitizeRedirect("/a\\b")).toBe("/");
    expect(sanitizeRedirect("/a\nb")).toBe("/");
    expect(sanitizeRedirect("javascript:alert(1)")).toBe("/");
    expect(sanitizeRedirect("dash")).toBe("/");
    expect(sanitizeRedirect(undefined)).toBe("/");
    expect(sanitizeRedirect(null)).toBe("/");
  });
  it("uses the supplied fallback", () => {
    expect(sanitizeRedirect("//evil.com", "/login")).toBe("/login");
  });
  it("rejects tab, newline and carriage return, which browsers strip from URLs", () => {
    // "/\t/evil.com" becomes "//evil.com" once a browser removes the tab.
    expect(sanitizeRedirect("/\t/evil.com")).toBe("/");
    expect(sanitizeRedirect("/\n/evil.com")).toBe("/");
    expect(sanitizeRedirect("/\r/evil.com")).toBe("/");
    expect(sanitizeRedirect("/dash\t")).toBe("/");
    expect(sanitizeRedirect("\t//evil.com")).toBe("/");
  });
  it("rejects leading whitespace and an encoded absolute URL", () => {
    expect(sanitizeRedirect(" /dash")).toBe("/");
    expect(sanitizeRedirect(" //evil.com")).toBe("/");
    expect(sanitizeRedirect("%2F%2Fevil.com")).toBe("/");
    expect(sanitizeRedirect("https%3A%2F%2Fevil.com")).toBe("/");
  });
  it("keeps a percent-encoded path as an undecoded same-origin path", () => {
    // Still a path, so it stays on this origin. Callers must not decode it before redirecting.
    expect(sanitizeRedirect("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
    expect(sanitizeRedirect("/%5Cevil.com")).toBe("/%5Cevil.com");
    expect(sanitizeRedirect("/f/a%20b")).toBe("/f/a%20b");
  });
});

describe("T-CON-04-U1 occupancy band", () => {
  const band = (percent: number) => occupancyView(percent, 100);
  it("classifies 0, 69, 70, 90, 91 and 100 percent", () => {
    expect(band(0).band).toBe("low");
    expect(band(69).band).toBe("low");
    expect(band(70).band).toBe("medium");
    expect(band(90).band).toBe("medium");
    expect(band(91).band).toBe("high");
    expect(band(100).band).toBe("high");
    expect(band(100).overCapacity).toBe(false);
  });
  it("flags 105 percent as over capacity and caps the displayed count", () => {
    const v = band(105);
    expect(v.band).toBe("high");
    expect(v.overCapacity).toBe(true);
    expect(v.displayed).toBe(100);
  });
  it("never displays a negative count", () => {
    expect(occupancyView(-3, 100).displayed).toBe(0);
  });
  it("rejects invalid capacity or counts", () => {
    expect(() => occupancyView(1, 0)).toThrow(RangeError);
    expect(() => occupancyView(1, 2.5)).toThrow(RangeError);
    expect(() => occupancyView(1.5, 10)).toThrow(RangeError);
  });
});

describe("T-CON-05-U1 overrides per 100", () => {
  it("shows 0, not NaN, when there are no entries", () => {
    expect(overridesPer100(0, 0)).toBe(0);
    expect(overridesPer100(3, 0)).toBe(0);
  });
  it("uses entries as the denominator", () => {
    expect(overridesPer100(5, 250)).toBe(2);
    expect(overridesPer100(0, 250)).toBe(0);
  });
  it("rejects negative or fractional counts", () => {
    expect(() => overridesPer100(-1, 10)).toThrow(RangeError);
    expect(() => overridesPer100(1, 2.5)).toThrow(RangeError);
  });
});

describe("T-CON-09-U1 overstay threshold", () => {
  it("rejects 0 and 29, accepts 30 and 240", () => {
    expect(validateOverstayMinutes(0).ok).toBe(false);
    expect(validateOverstayMinutes(29).ok).toBe(false);
    expect(validateOverstayMinutes(MIN_OVERSTAY_MINUTES)).toEqual({ ok: true, minutes: 30 });
    expect(validateOverstayMinutes(240)).toEqual({ ok: true, minutes: 240 });
  });
  it("rejects fractions and non-numbers", () => {
    expect(validateOverstayMinutes(45.5).ok).toBe(false);
    expect(validateOverstayMinutes("60").ok).toBe(false);
    expect(validateOverstayMinutes(NaN).ok).toBe(false);
  });
});
