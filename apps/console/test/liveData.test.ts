import { describe, expect, it } from "vitest";
import { countByIstHour, istDayStart, istHour } from "../src/lib/data/istDay";
import { offlineReason } from "../src/lib/data/reason";
import { readSupabaseEnv } from "../src/lib/supabase/env";

describe("readSupabaseEnv", () => {
  const ok = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co/",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJ.anon.key",
  };

  it("accepts a real-looking https project and trims the trailing slash", () => {
    expect(readSupabaseEnv(ok)).toEqual({
      url: "https://abcd.supabase.co",
      anonKey: "eyJ.anon.key",
    });
  });

  it("treats missing values and .env.example placeholders as not configured", () => {
    expect(readSupabaseEnv({})).toBeNull();
    expect(readSupabaseEnv({ ...ok, NEXT_PUBLIC_SUPABASE_ANON_KEY: "replace-me" })).toBeNull();
    expect(
      readSupabaseEnv({ ...ok, NEXT_PUBLIC_SUPABASE_URL: "https://your-dev-project.supabase.co" }),
    ).toBeNull();
  });

  it("refuses plain http except for a local stack", () => {
    expect(readSupabaseEnv({ ...ok, NEXT_PUBLIC_SUPABASE_URL: "http://evil.example" })).toBeNull();
    expect(readSupabaseEnv({ ...ok, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toEqual({
      url: "http://127.0.0.1:54321",
      anonKey: ok.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
    expect(readSupabaseEnv({ ...ok, NEXT_PUBLIC_SUPABASE_URL: "not a url" })).toBeNull();
  });
});

describe("IST day helpers", () => {
  it("finds IST midnight as a UTC instant", () => {
    // 8 Nov 2026 02:00 IST is 7 Nov 20:30 UTC; the IST day began 7 Nov 18:30 UTC.
    expect(istDayStart("2026-11-07T20:30:00Z")).toBe("2026-11-07T18:30:00.000Z");
    expect(istDayStart("2026-11-07T18:29:59Z")).toBe("2026-11-06T18:30:00.000Z");
  });

  it("buckets instants by IST hour", () => {
    expect(istHour("2026-11-08T03:45:00Z")).toBe(9);
    // 09:15, 09:40 and 10:31 IST.
    const buckets = countByIstHour([
      "2026-11-08T03:45:00Z",
      "2026-11-08T04:10:00+00:00",
      "2026-11-08T05:01:00Z",
    ]);
    expect(buckets).toHaveLength(24);
    expect(buckets[9]).toBe(2);
    expect(buckets[10]).toBe(1);
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("rejects an invalid instant", () => {
    expect(() => istDayStart("yesterday")).toThrow(RangeError);
  });
});

describe("offlineReason", () => {
  it("explains each disconnected state without inventing data", () => {
    expect(offlineReason({ kind: "offline" })).toMatch(/No Supabase project/);
    expect(offlineReason({ kind: "signed-out" })).toMatch(/Sign in/);
    expect(offlineReason({ kind: "denied", email: "a@b.in", detail: "No membership." })).toBe(
      "No membership.",
    );
    expect(
      offlineReason({ kind: "ok", email: "a@b.in", role: "owner", facilities: [], facility: null }),
    ).toMatch(/CLD-03/);
  });
});
