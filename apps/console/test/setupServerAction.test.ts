import { beforeEach, describe, expect, it, vi } from "vitest";

// CON-01 save action against a recording fake client: the facility comes from the session, invalid input never
// reaches the database, and writes carry the session facility.
const state = vi.hoisted(() => ({
  session: null as unknown,
  calls: [] as unknown[][],
  reads: { zones: [] as unknown[], tariffs: [] as unknown[] },
  writeError: null as unknown,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../src/lib/data/session", () => ({ getConsoleSession: vi.fn(async () => state.session) }));
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    from: (table: string) => {
      state.calls.push(["from", table]);
      let writing = false;
      const q: Record<string, unknown> = {};
      for (const m of ["update", "insert", "select", "eq"]) {
        q[m] = (...args: unknown[]) => {
          state.calls.push([m, table, ...args]);
          if (m === "update" || m === "insert") writing = true;
          return q;
        };
      }
      q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
        Promise.resolve(
          writing
            ? { data: [], error: state.writeError }
            : { data: table === "zones" ? state.reads.zones : state.reads.tariffs, error: null },
        ).then(ok, bad);
      return q;
    },
  })),
}));

import { saveSetup } from "../app/setup/actions";
import { ACTION_IDLE } from "../src/lib/credentialActions";
import { exampleDraft, todayInIst } from "../src/lib/setupDraft";

const FACILITY = "0190f0f0-0000-7000-8000-0000000000f1";
const form = (draft: unknown) => {
  const f = new FormData();
  f.set("draft", typeof draft === "string" ? draft : JSON.stringify(draft));
  // A facility id in the form must be ignored.
  f.set("facility_id", "0190f0f0-0000-7000-8000-0000000000f2");
  return f;
};
const writes = () => state.calls.filter((c) => c[0] === "insert" || c[0] === "update");

beforeEach(() => {
  state.calls = [];
  state.reads = { zones: [], tariffs: [] };
  state.writeError = null;
  state.session = {
    kind: "ok",
    userId: "user-1",
    email: "owner@demo.pmp.test",
    role: "owner",
    facilities: [],
    facility: { id: FACILITY, orgId: "o1", name: "Demo", timezone: "Asia/Kolkata", slotCount: 10 },
  };
});

describe("saveSetup", () => {
  it("writes the facility, zones and tariffs of the session facility, never the form's", async () => {
    const r = await saveSetup(ACTION_IDLE, form(exampleDraft(todayInIst())));
    expect(r).toEqual({
      ok: true,
      message: "Saved: facility details updated, 2 zones added, 2 tariff versions added.",
    });
    const inserted = writes().flatMap((c) =>
      c[0] === "insert" ? (c[2] as { facility_id: string }[]) : [],
    );
    expect(inserted.length).toBe(4);
    expect(inserted.every((row) => row.facility_id === FACILITY)).toBe(true);
    expect(state.calls).toContainEqual(["eq", "facilities", "id", FACILITY]);
  });

  it("refuses signed-out users, guards and malformed or invalid drafts without writing", async () => {
    state.session = { kind: "signedOut" };
    expect((await saveSetup(ACTION_IDLE, form(exampleDraft(todayInIst())))).ok).toBe(false);

    state.session = {
      kind: "ok",
      userId: "u",
      role: "guard",
      facilities: [],
      facility: { id: FACILITY },
    };
    expect((await saveSetup(ACTION_IDLE, form(exampleDraft(todayInIst())))).message).toMatch(
      /owner or manager/,
    );

    beforeEachSession();
    expect((await saveSetup(ACTION_IDLE, form("{not json"))).message).toMatch(/could not be read/);
    const bad = {
      ...exampleDraft(todayInIst()),
      zones: [{ name: "", capacity: "0", vehicleClass: "Car" }],
    };
    expect((await saveSetup(ACTION_IDLE, form(bad))).message).toMatch(/Fix the problems/);
    const past = { ...exampleDraft("2020-01-01") };
    expect((await saveSetup(ACTION_IDLE, form(past))).message).toMatch(/Fix the problems/);
    expect(writes()).toEqual([]);
  });

  it("maps a permission error to a plain message", async () => {
    state.writeError = { code: "42501", message: "denied" };
    const r = await saveSetup(ACTION_IDLE, form(exampleDraft(todayInIst())));
    expect(r).toEqual({
      ok: false,
      message: "Not saved: your account may not change the facility details for this facility.",
    });
  });
});

function beforeEachSession() {
  state.session = {
    kind: "ok",
    userId: "user-1",
    email: "owner@demo.pmp.test",
    role: "owner",
    facilities: [],
    facility: { id: FACILITY, orgId: "o1", name: "Demo", timezone: "Asia/Kolkata", slotCount: 10 },
  };
}
