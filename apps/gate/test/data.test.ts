import { describe, expect, it } from "vitest";

import { parseEvent, type Event } from "@pmp/contracts";
import { FakeSync } from "../src/data/fakeSync";
import {
  SCHEMA_VERSION,
  waiveExitBundle,
  writeEvent,
  writeExit,
  writeOverride,
  type WriteDeps,
} from "../src/data/writeEvent";

/**
 * Gate data layer tests against `FakeSync` (the sheets' sanctioned IC-02 test double, D.15 /
 * member-01 IC-02 "fake and real implementations pass the same test suite").
 *
 * Mirrored rows: T-GATE-01-I1/I2/I3, T-GATE-02-I1, T-GATE-04-I1/I2/N3/U3, T-GATE-07-I1,
 * T-GATE-06-I1 (envelope level — SHIFT payloads are pending IC-01).
 */

const NOW = "2026-10-25T04:00:00.000Z"; // 09:30 IST — injected fake clock, strict UTC instant
const FACILITY = "fa7a7a7a-7a7a-7a7a-8a7a-7a7a7a7a7a7a";
const DEVICE = "dev-1";
const SESSION = "01811111-1111-7111-8111-111111111111";
const ENTRY_EVENT_ID = "01822222-2222-7222-8222-222222222222";
const SESS_A = "01833333-3333-7333-8333-333333333331";

function makeFake(): FakeSync {
  return new FakeSync({
    zones: { Z1: { capacity: 5 }, Z2: { capacity: 5 } },
    clock: () => new Date(NOW),
  });
}

function makeDeps(fake: FakeSync): WriteDeps {
  return {
    client: fake,
    readEvents: () => [...fake.listEvents()],
    deviceId: DEVICE,
    now: () => NOW,
    generateId: () => (ENTRY_EVENT_ID.startsWith("01822222") ? ENTRY_EVENT_ID : ENTRY_EVENT_ID),
  };
}

describe("writeEvent gate orchestration (T-GATE-01-I1/I2, N4)", () => {
  it("stamps the IC-01 envelope and stores exactly one event (T-GATE-01-I1 success leg)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    const stored = await writeEvent(deps, { type: "ENTRY", session_id: SESSION });
    expect(fake.listEvents().length).toBe(1);
    expect(stored.id).toBe(ENTRY_EVENT_ID);
    expect(stored.device_id).toBe(DEVICE);
    expect(stored.device_time).toBe(NOW);
    expect(stored.schema_version).toBe(SCHEMA_VERSION);
    expect(stored.type).toBe("ENTRY");
    if (stored.type !== "ENTRY") throw new Error("expected ENTRY");
    expect(stored.session_id).toBe(SESSION);
  });

  it("the stored event passes the IC-01 contracts parser (T-GATE-01-I2)", async () => {
    const fake = makeFake();
    await writeEvent(makeDeps(fake), { type: "ENTRY", session_id: SESSION });
    const parsed = parseEvent(fake.listEvents()[0]);
    expect(parsed.ok).toBe(true);
  });

  it("an IC-01-invalid draft is rejected BEFORE the client is called (T-GATE-01-I2 negative)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    await expect(
      writeEvent(deps, {
        type: "PAYMENT",
        session_id: SESSION,
        amount_paise: -5,
        mode: "CASH",
        upi_attested: false,
      }),
    ).rejects.toThrow(/IC-01 validation failed/);
    expect(fake.listEvents()).toHaveLength(0);
  });

  it("does not persist an empty ZONE_COUNT event without the required count payload", async () => {
    const fake = makeFake();
    await expect(writeEvent(makeDeps(fake), { type: "ZONE_COUNT" })).rejects.toThrow(
      "ZONE_COUNT cannot be written until IC-01 supports its zone and count fields",
    );
    expect(fake.listEvents()).toHaveLength(0);
  });

  it("a write failure leaves the store fully empty — no partial event (T-GATE-01-I1/N4)", async () => {
    const fake = makeFake();
    fake.failOnEventPosition(0, new Error("disk died"));
    const deps = makeDeps(fake);
    await expect(writeEvent(deps, { type: "ENTRY", session_id: SESSION })).rejects.toThrow(
      "disk died",
    );
    expect(fake.listEvents()).toHaveLength(0);
  });
});

describe("occupancy view (T-GATE-01-I3)", () => {
  it("a saved entry bumps the zone immediately through the observer", async () => {
    const fake = makeFake();
    const seen: number[] = [];
    // SYNC-04 observe semantics: the current snapshot arrives on subscribe, changes after writes.
    const stop = fake.observeOccupancy(FACILITY, (snapshot) => {
      seen.push(snapshot.zones["Z1"]?.count ?? -1);
      expect(snapshot.warnings).toEqual([]);
    });
    fake.attachSessionZone(SESS_A, "Z1");
    await writeEvent(makeDeps(fake), { type: "ENTRY", session_id: SESS_A });
    stop();
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it("an exit clears the session from occupancy in the same notify cycle", async () => {
    const fake = makeFake();
    const snapshotA = { last: 0 as number, initial: 0 as number };
    const stop = fake.observeOccupancy(FACILITY, (snapshot) => {
      snapshotA.initial = 0;
      snapshotA.last = snapshot.zones["Z1"]?.count ?? -1;
    });
    fake.attachSessionZone(SESS_A, "Z1");
    const deps = makeDeps(fake);
    await writeEvent(deps, { type: "ENTRY", session_id: SESS_A });
    await writeExit(deps, {
      sessionId: SESS_A,
      farePaise: 6000,
      payment: { mode: "CASH", amountPaise: 6000 },
    });
    stop();
    expect(snapshotA.last).toBe(0);
  });

  it("keeps occupancy non-negative for synced and local sessions without drift warnings", async () => {
    const fake = new FakeSync({
      zones: { Z1: { capacity: 5 } },
      openSessions: [{ sessionId: SESS_A, zoneId: "Z1" }],
      clock: () => new Date(NOW),
    });
    const snapshots: { count: number; warnings: string[] }[] = [];
    const stop = fake.observeOccupancy(FACILITY, (snapshot) => {
      snapshots.push({
        count: snapshot.zones["Z1"]?.count ?? -1,
        warnings: snapshot.warnings,
      });
    });
    await writeEvent(makeDeps(fake), { type: "EXIT", session_id: SESS_A });
    stop();

    expect(snapshots.every(({ count }) => count >= 0)).toBe(true);
    expect(snapshots.at(-1)).toEqual({ count: 0, warnings: [] });
  });

  it("counts a session present in both the synced snapshot and local ENTRY only once", async () => {
    const fake = new FakeSync({
      zones: { Z1: { capacity: 5 } },
      openSessions: [{ sessionId: SESS_A, zoneId: "Z1" }],
      clock: () => new Date(NOW),
    });
    fake.attachSessionZone(SESS_A, "Z1");
    await writeEvent(makeDeps(fake), { type: "ENTRY", session_id: SESS_A });
    let observed = -1;
    const stop = fake.observeOccupancy(FACILITY, (snapshot) => {
      observed = snapshot.zones["Z1"]?.count ?? -1;
    });
    stop();
    expect(observed).toBe(1);
  });

  it("rejects impossible zone capacities and unknown initial session zones", () => {
    expect(
      () =>
        new FakeSync({
          zones: { Z1: { capacity: -1 } },
        }),
    ).toThrow("FakeSync: invalid capacity for zone Z1");

    expect(
      () =>
        new FakeSync({
          zones: { Z1: { capacity: 5 } },
          openSessions: [{ sessionId: SESS_A, zoneId: "UNKNOWN" }],
        }),
    ).toThrow("FakeSync: unknown zone UNKNOWN");
  });
});

describe("writeExit atomic bundle (T-GATE-02-I1, T-GATE-04-N3)", () => {
  it("saves EXIT and PAYMENT in one transaction (T-GATE-02-I1 success leg)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    const events = await writeExit(deps, {
      sessionId: SESS_A,
      farePaise: 6000,
      payment: { mode: "CASH", amountPaise: 6000 },
    });
    expect(events.map((e) => e.type)).toEqual(["EXIT", "PAYMENT"]);
    expect(fake.listEvents().length).toBe(2);
    const payment = fake.listEvents()[1];
    if (payment.type !== "PAYMENT") throw new Error("expected PAYMENT");
    expect(payment.mode).toBe("CASH");
    expect(payment.amount_paise).toBe(6000);
    expect(payment.upi_attested).toBe(false);
  });

  it("an injected failure between the two events stores NEITHER (T-GATE-02-I1 failure leg)", async () => {
    const fake = makeFake();
    fake.failOnEventPosition(1, new Error("write died between events"));
    const deps = makeDeps(fake);
    await expect(
      writeExit(deps, {
        sessionId: SESS_A,
        farePaise: 6000,
        payment: { mode: "UPI", amountPaise: 6000 },
      }),
    ).rejects.toThrow("write died between events");
    expect(fake.listEvents()).toHaveLength(0); // both or neither
  });

  it("UPI received saves the attestation (T-GATE-02-E2 semantics at event level)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    await writeExit(deps, {
      sessionId: SESS_A,
      farePaise: 6000,
      payment: { mode: "UPI", amountPaise: 6000 },
    });
    const events = fake.listEvents();
    const payment = events[1];
    if (payment.type !== "PAYMENT") throw new Error("expected PAYMENT");
    expect(payment.upi_attested).toBe(true);
    expect(payment.mode).toBe("UPI");
  });

  it("second exit attempt for the same session is refused locally (T-GATE-02-N2 write guard)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    await writeExit(deps, {
      sessionId: SESS_A,
      farePaise: 6000,
      payment: { mode: "CASH", amountPaise: 6000 },
    });
    await expect(
      writeExit(deps, {
        sessionId: SESS_A,
        farePaise: 6000,
        payment: { mode: "CASH", amountPaise: 6000 },
      }),
    ).rejects.toMatchObject({ reason: "ALREADY_EXITED" });
    expect(fake.listEvents().length).toBe(2); // no new events
  });

  it("a second payment for the same session is refused locally (T-GATE-04-I1)", async () => {
    const fake = makeFake();
    // Seed only a PAYMENT (as if the store already held one from a corrected path) with no EXIT.
    const prior: Event = {
      id: "01844444-4444-7444-8444-444444444441",
      type: "PAYMENT",
      device_id: DEVICE,
      device_time: NOW,
      schema_version: SCHEMA_VERSION,
      session_id: SESS_A,
      amount_paise: 6000,
      mode: "CASH",
      upi_attested: false,
    };
    await fake.writeTransaction([prior]);
    const deps = makeDeps(fake);
    await expect(
      writeExit(deps, {
        sessionId: SESS_A,
        farePaise: 6000,
        payment: { mode: "CASH", amountPaise: 6000 },
      }),
    ).rejects.toMatchObject({ reason: "SECOND_PAYMENT" });
    expect(fake.listEvents().length).toBe(1); // nothing new
  });

  it("rejects a Cash payment whose amount differs from the fare (T-GATE-04-U2, rule 8)", async () => {
    const fake = makeFake();
    await expect(
      writeExit(makeDeps(fake), {
        sessionId: SESS_A,
        farePaise: 6000,
        payment: { mode: "CASH", amountPaise: 4000 },
      }),
    ).rejects.toThrow(/AMOUNT_MISMATCH/);
    expect(fake.listEvents()).toHaveLength(0);
  });

  it("refuses a PASS-mode payment until IC-01 enumerates it (contracts gap, owner Afzal)", async () => {
    const fake = makeFake();
    await expect(
      writeExit(makeDeps(fake), {
        sessionId: SESS_A,
        farePaise: 0,
        payment: { mode: "PASS", amountPaise: 0 },
      }),
    ).rejects.toMatchObject({ reason: "UNSUPPORTED_PAYMENT_MODE" });
    expect(fake.listEvents()).toHaveLength(0);
  });
});

describe("waive path (T-GATE-04-I2/U3)", () => {
  it("writes EXIT and the reason OVERRIDE in one transaction (T-GATE-04-I2)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    const events = await writeExit(
      deps,
      waiveExitBundle({
        sessionId: SESS_A,
        entryEventId: ENTRY_EVENT_ID,
        reasonCode: "OWNER_WAIVER",
      }),
    );
    expect(events.map((e) => e.type)).toEqual(["EXIT", "OVERRIDE"]);
    const overrideEvent = events[1];
    if (overrideEvent.type !== "OVERRIDE") throw new Error("expected OVERRIDE");
    expect(overrideEvent.reason_code).toBe("OWNER_WAIVER");
    expect(overrideEvent.target_event_id).toBe(ENTRY_EVENT_ID);
    // The PAYMENT(mode 'WAIVED', 0) event is pending support in the IC-01 mode enum.
    expect(events.map((e) => e.type)).not.toContain("PAYMENT");
  });

  it("waive with OTHER and no note is rejected (T-GATE-04-U3)", async () => {
    const fake = makeFake();
    await expect(
      writeExit(
        makeDeps(fake),
        waiveExitBundle({
          sessionId: SESS_A,
          entryEventId: ENTRY_EVENT_ID,
          reasonCode: "OTHER",
        }),
      ),
    ).rejects.toMatchObject({ reason: "OVERRIDE_RULES" });
    expect(fake.listEvents()).toHaveLength(0);
  });
});

describe("writeOverride (T-GATE-07-I1)", () => {
  it("stores reason code and target; attribution fields are not part of the current envelope", async () => {
    const fake = makeFake();
    await writeEvent(makeDeps(fake), { type: "ENTRY", session_id: SESSION });
    const stored = await writeOverride(makeDeps(fake), {
      sessionId: SESSION,
      targetEventId: ENTRY_EVENT_ID,
      reasonCode: "MISREAD_NUMBER",
    });
    if (stored.type !== "OVERRIDE") throw new Error("expected OVERRIDE");
    expect(stored.reason_code).toBe("MISREAD_NUMBER");
    expect(stored.target_event_id).toBe(ENTRY_EVENT_ID);
    expect(stored.session_id).toBe(SESSION);
    // Deliberate pin: the sheet requires the override to carry staff id (T-GATE-07-I1 keeps
    // "code, staff id, target"); IC-01 has no staff_id field yet, so the event cannot carry it.
    expect("staff_id" in stored).toBe(false);
  });

  it("rejects an unknown reason code before any write", async () => {
    const fake = makeFake();
    await expect(
      writeOverride(makeDeps(fake), {
        sessionId: SESSION,
        targetEventId: ENTRY_EVENT_ID,
        reasonCode: "MADE_UP_CODE" as never,
      }),
    ).rejects.toMatchObject({ reason: "OVERRIDE_RULES" });
    expect(fake.listEvents()).toHaveLength(0);
  });
});

describe("shift event persistence boundary (T-GATE-06-I1)", () => {
  it("records SHIFT_OPEN but refuses to close without persisted shift totals", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    const open = await writeEvent(deps, { type: "SHIFT_OPEN" });
    expect(open.type).toBe("SHIFT_OPEN");
    await expect(writeEvent(deps, { type: "SHIFT_CLOSE" })).rejects.toThrow(
      "SHIFT_CLOSE cannot be written until IC-01 supports its shift totals and variance fields",
    );
    const stored = fake.listEvents();
    expect(stored.map((e) => e.type)).toEqual(["SHIFT_OPEN"]);
    // SHIFT_OPEN's float is not in the current IC-01 event shape.
    expect(Object.keys(open)).toEqual(
      expect.arrayContaining(["id", "type", "device_id", "device_time", "schema_version"]),
    );
    expect("float_paise" in open).toBe(false);
  });
});
