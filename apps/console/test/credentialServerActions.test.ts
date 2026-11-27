import { beforeEach, describe, expect, it, vi } from "vitest";

// Server actions run against a recording fake of the Supabase client and a fixed session (review of #51: the facility
// must come from the session, and an update that changed nothing must be reported as such).
const state = vi.hoisted(() => ({
  session: null as unknown,
  calls: [] as unknown[][],
  result: { data: null as unknown, error: null as unknown },
  single: { data: null as unknown, error: null as unknown },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../src/lib/data/session", () => ({ getConsoleSession: vi.fn(async () => state.session) }));
vi.mock("../src/lib/supabase/server", () => ({
  // The client itself must not be awaitable (it is awaited once); only the query builder is.
  createSupabaseServerClient: vi.fn(async () => {
    const q: Record<string, unknown> = {};
    for (const m of ["update", "insert", "select", "eq", "is"]) {
      q[m] = (...args: unknown[]) => {
        state.calls.push([m, ...args]);
        return q;
      };
    }
    q.maybeSingle = async () => {
      state.calls.push(["maybeSingle"]);
      return state.single;
    };
    q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
      Promise.resolve(state.result).then(ok, bad);
    return {
      from: (table: string) => {
        state.calls.push(["from", table]);
        return q;
      },
    };
  }),
}));

import { revalidatePath } from "next/cache";
import { addConflictNote } from "../app/conflicts/actions";
import { deactivateGuard, revokeDevice } from "../app/devices/actions";
import { ACTION_IDLE, credentialUpdateError, nothingChanged } from "../src/lib/credentialActions";

const SESSION_FACILITY = "0190f0f0-0000-7000-8000-0000000000f1";
const OTHER_FACILITY = "0190f0f0-0000-7000-8000-0000000000f2";
const STAFF = "0190f0f0-0000-7000-8000-0000000000a1";
const DEVICE = "0190f0f0-0000-7000-8000-0000000000d1";
const CONFLICT = "0190f0f0-0000-7000-8000-0000000000c1";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const eqCalls = () => state.calls.filter((c) => c[0] === "eq");

beforeEach(() => {
  state.session = {
    kind: "ok",
    userId: "user-1",
    email: "owner@demo.pmp.test",
    role: "owner",
    facilities: [],
    facility: {
      id: SESSION_FACILITY,
      orgId: "o1",
      name: "Demo",
      timezone: "Asia/Kolkata",
      slotCount: 10,
    },
  };
  state.calls = [];
  state.result = { data: [{ id: "x" }], error: null };
  state.single = { data: { id: CONFLICT }, error: null };
  vi.mocked(revalidatePath).mockClear();
});

describe("deactivateGuard", () => {
  it("scopes the update to the session's facility, never to one sent in the form", async () => {
    const r = await deactivateGuard(
      ACTION_IDLE,
      form({ staff_id: STAFF, facility_id: OTHER_FACILITY }),
    );
    expect(r.ok).toBe(true);
    expect(state.calls).toContainEqual(["from", "staff"]);
    expect(state.calls).toContainEqual(["update", { active: false }]);
    expect(eqCalls()).toContainEqual(["eq", "facility_id", SESSION_FACILITY]);
    expect(JSON.stringify(state.calls)).not.toContain(OTHER_FACILITY);
    expect(revalidatePath).toHaveBeenCalledWith("/devices");
  });

  it("reports an update that changed no row, and does not refresh the page", async () => {
    state.result = { data: [], error: null };
    const r = await deactivateGuard(ACTION_IDLE, form({ staff_id: STAFF }));
    expect(r).toEqual({ ok: false, message: nothingChanged("guard") });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("maps a database refusal without echoing it", async () => {
    state.result = {
      data: null,
      error: { code: "42501", message: "permission denied for table staff" },
    };
    const r = await deactivateGuard(ACTION_IDLE, form({ staff_id: STAFF }));
    expect(r).toEqual({ ok: false, message: credentialUpdateError("42501") });
  });

  it("does not touch the database for a malformed id or without a session", async () => {
    expect((await deactivateGuard(ACTION_IDLE, form({ staff_id: "nope" }))).ok).toBe(false);
    state.session = { kind: "signed-out" };
    expect((await deactivateGuard(ACTION_IDLE, form({ staff_id: STAFF }))).ok).toBe(false);
    expect(state.calls).toEqual([]);
  });
});

describe("revokeDevice", () => {
  it("revokes only a not-yet-revoked phone of the session's facility", async () => {
    const r = await revokeDevice(
      ACTION_IDLE,
      form({ device_id: DEVICE, facility_id: OTHER_FACILITY }),
    );
    expect(r.ok).toBe(true);
    const update = state.calls.find((c) => c[0] === "update");
    expect(Object.keys(update?.[1] as object)).toEqual(["revoked_at"]);
    expect(eqCalls()).toContainEqual(["eq", "facility_id", SESSION_FACILITY]);
    expect(state.calls).toContainEqual(["is", "revoked_at", null]);
    expect(JSON.stringify(state.calls)).not.toContain(OTHER_FACILITY);
  });

  it("reports a phone that was already revoked", async () => {
    state.result = { data: [], error: null };
    expect(await revokeDevice(ACTION_IDLE, form({ device_id: DEVICE }))).toEqual({
      ok: false,
      message: nothingChanged("phone"),
    });
  });
});

describe("addConflictNote", () => {
  it("writes the note as the signed-in user, after checking the conflict is in the session's facility", async () => {
    const r = await addConflictNote(
      ACTION_IDLE,
      form({ conflict_id: CONFLICT, note: " Checked " }),
    );
    expect(r.ok).toBe(true);
    expect(eqCalls()).toContainEqual(["eq", "facility_id", SESSION_FACILITY]);
    expect(state.calls).toContainEqual([
      "insert",
      { conflict_id: CONFLICT, action: "ADD_NOTE", note: "Checked", resolved_by: "user-1" },
    ]);
  });

  it("refuses a conflict of another facility without inserting", async () => {
    state.single = { data: null, error: null };
    const r = await addConflictNote(ACTION_IDLE, form({ conflict_id: CONFLICT, note: "x" }));
    expect(r).toEqual({ ok: false, message: "This conflict is not in the selected facility." });
    expect(state.calls.some((c) => c[0] === "insert")).toBe(false);
  });
});
