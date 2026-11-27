import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// proxy.ts is the Console's auth gate. The Supabase client is replaced by a fake that reports a fixed user, so each
// case checks only what the proxy decides: let the request through, redirect it, or refuse it.
const state = vi.hoisted(() => ({
  configured: true,
  user: null as { id: string } | null,
  throws: false,
}));

vi.mock("../src/lib/supabase/env", () => ({
  readSupabaseEnv: () => (state.configured ? { url: "http://sb.test", anonKey: "anon" } : null),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => {
        if (state.throws) throw new Error("fetch failed");
        return { data: { user: state.user } };
      },
    },
  }),
}));

import { proxy } from "../proxy";

const BASE = "http://localhost:3000";
const call = (path: string) => proxy(new NextRequest(`${BASE}${path}`));
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";
const target = (res: Response) => {
  const loc = res.headers.get("location");
  return loc ? new URL(loc).pathname + new URL(loc).search : null;
};

beforeEach(() => {
  state.configured = true;
  state.user = null;
  state.throws = false;
});

describe("proxy: signed out", () => {
  it("lets a visitor load the landing page at / and /welcome", async () => {
    expect(passes(await call("/"))).toBe(true);
    expect(passes(await call("/welcome"))).toBe(true);
  });

  it("sends a protected page to the landing page and remembers where they were going", async () => {
    const res = await call("/shifts");
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/?next=%2Fshifts");
  });

  it("keeps the query string of the requested page", async () => {
    expect(target(await call("/reports?type=daily"))).toBe("/?next=%2Freports%3Ftype%3Ddaily");
  });

  it("still answers 401 for API routes and lets the health check and report route through", async () => {
    const api = await call("/api/anything");
    expect(api.status).toBe(401);
    expect(passes(await call("/api/health"))).toBe(true);
    expect(passes(await call("/api/reports/daily"))).toBe(true);
  });

  it("lets /login load (it redirects to the landing page itself when Supabase is configured)", async () => {
    expect(passes(await call("/login"))).toBe(true);
  });

  it("treats an unreachable Supabase as signed out: landing page yes, protected pages no", async () => {
    state.throws = true;
    expect(passes(await call("/"))).toBe(true);
    expect(target(await call("/occupancy"))).toBe("/?next=%2Foccupancy");
  });
});

describe("proxy: signed in", () => {
  beforeEach(() => {
    state.user = { id: "u1" };
  });

  it("lets a signed-in user reach the Dashboard at /, other pages and /welcome", async () => {
    expect(passes(await call("/"))).toBe(true);
    expect(passes(await call("/shifts"))).toBe(true);
    expect(passes(await call("/welcome"))).toBe(true);
  });

  it("sends /login back to the page they asked for, or to /", async () => {
    expect(target(await call("/login?next=/shifts"))).toBe("/shifts");
    expect(target(await call("/login"))).toBe("/");
  });

  it("never follows an off-site next= after sign in", async () => {
    expect(target(await call("/login?next=//evil.example"))).toBe("/");
    expect(target(await call("/login?next=https://evil.example"))).toBe("/");
  });
});

describe("proxy: Supabase not configured", () => {
  it("runs disconnected and lets every page through", async () => {
    state.configured = false;
    expect(passes(await call("/shifts"))).toBe(true);
    expect(passes(await call("/"))).toBe(true);
  });
});
