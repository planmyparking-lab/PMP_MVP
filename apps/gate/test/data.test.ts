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
 * Written against the MERGED SYNC-01 contract (packages/contracts/src/events.ts): every event
 * carries the full envelope (facility/device/staff attribution, source, schema_version) plus its
 * typed payload; session events carry session_id, ZONE_COUNT/SHIFT_* carry session_id: null.
 *
 * Mirrored rows: T-GATE-01-I1/I2/I3, T-GATE-02-I1, T-GATE-04-I1/I2/N3/U2, T-GATE-07-I1,
 * T-GATE-06-I1.
 */

const NOW = "2026-10-25T04:00:00.000Z"; // 09:30 IST — injected fake clock, strict UTC instant
const FACILITY = "fa7a7a7a-7a7a-7a7a-8a7a-7a7a7a7a7a7a";
const STAFF = "018aaaaa-0000-7000-8000-00000000000a";
const DEVICE = "018bbbbb-0000-7000-8000-00000000000b";
const SESSION = "01811111-1111-7111-8111-111111111111";
const ENTRY_EVENT_ID = "01822222-2222-7222-8222-222222222222";
const SESS_A = "01833333-3333-7333-8333-333333333331";
const ZONE_1 = "01855555-5555-7555-8555-555555555501";
const ZONE_2 = "01855555-5555-7555-8555-555555555502";
const SHIFT_ID = "01866666-6666-7666-8666-666666666601";
const TARIFF_ID = "01877777-7777-7777-8777-777777777701";

const ENTRY_PAYLOAD = {
  vehicle_class: "Car",
  zone_id: ZONE_1,
  short_code: "ABCDE",
  vehicle_no: "DL01AB1234",
} as const;

function makeFake(): FakeSync {
  return new FakeSync({
    zones: { [ZONE_1]: { capacity: 5 }, [ZONE_2]: { capacity: 5 } },
    clock: () => new Date(NOW),
  });
}

function makeDeps(fake: FakeSync): WriteDeps {
  let minted = 0;
  return {
    client: fake,
    readEvents: () => fake.listEvents(),
    facilityId: FACILITY,
    staffId: STAFF,
    deviceId: DEVICE,
    now: () => NOW,
    // Deterministic minting: the first id is the shared ENTRY id; later events inside one
    // transaction get distinct UUIDv7 ids (IC-01 event ids are unique).
    generateId: () => {
      minted += 1;
      if (minted === 1) return ENTRY_EVENT_ID;
      return `01822222-2222-7222-8222-${String(minted).padStart(12, "0")}`;
    },
  };
}

/** Seed event built directly (as if synced in): full envelope + payload per IC-01. */
function seededPayment(mode: "CASH" | "UPI", amountPaise: number): Event {
  return {
    id: "01844444-4444-7444-8444-444444444441",
    type: "PAYMENT",
    facility_id: FACILITY,
    device_id: DEVICE,
    staff_id: STAFF,
    device_time: NOW,
    source: "LIVE",
    schema_version: SCHEMA_VERSION,
    session_id: SESS_A,
    payload: { mode, amount_paise: amountPaise, upi_attested: mode === "UPI" },
  };
}

describe("writeEvent gate orchestration (T-GATE-01-I1/I2, N4)", () => {
  it("stamps the IC-01 envelope and stores exactly one event (T-GATE-01-I1 success leg)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    const stored = await writeEvent(deps, {
      type: "ENTRY",
      session_id: SESSION,
      payload: { ...ENTRY_PAYLOAD },
    });
    expect((await fake.listEvents()).length).toBe(1);
    expect(stored.id).toBe(ENTRY_EVENT_ID);
    expect(stored.facility_id).toBe(FACILITY);
    expect(stored.staff_id).toBe(STAFF);
    expect(stored.device_id).toBe(DEVICE);
    expect(stored.device_time).toBe(NOW);
    expect(stored.source).toBe("LIVE");
    expect(stored.schema_version).toBe(SCHEMA_VERSION);
    expect(stored.type).toBe("ENTRY");
    if (stored.type !== "ENTRY") throw new Error("expected ENTRY");
    expect(stored.session_id).toBe(SESSION);
    expect(stored.payload).toEqual({ ...ENTRY_PAYLOAD });
  });

  it("the stored event passes the IC-01 contracts parser (T-GATE-01-I2)", async () => {
    const fake = makeFake();
    await writeEvent(makeDeps(fake), {
      type: "ENTRY",
      session_id: SESSION,
      payload: { ...ENTRY_PAYLOAD },
    });
    const parsed = parseEvent((await fake.listEvents())[0]);
    expect(parsed.ok).toBe(true);
  });

  it("an IC-01-invalid draft is rejected BEFORE the client is called (T-GATE-01-I2 negative)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    await expect(
      writeEvent(deps, {
        type: "PAYMENT",
        session_id: SESSION,
        payload: { mode: "CASH", amount_paise: -5, upi_attested: false },
      }),
    ).rejects.toThrow(/IC-01 validation failed/);
    expect(await fake.listEvents()).toHaveLength(0);
  });

  it("persists a full ZONE_COUNT draft (session-less envelope, T-GATE-08 data path)", async () => {
    const fake = makeFake();
    const stored = await writeEvent(makeDeps(fake), {
      type: "ZONE_COUNT",
      payload: { zone_id: ZONE_1, counted: 4, system_count_at_time: 3 },
    });
    expect(await fake.listEvents()).toHaveLength(1);
    expect(stored.type).toBe("ZONE_COUNT");
    expect(stored.session_id).toBeNull();
    if (stored.type !== "ZONE_COUNT") throw new Error("expected ZONE_COUNT");
    expect(stored.payload).toEqual({ zone_id: ZONE_1, counted: 4, system_count_at_time: 3 });
    expect(parseEvent(stored).ok).toBe(true);
  });

  it("rejects a ZONE_COUNT draft with missing/invalid count fields (no invented baseline)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    await expect(
      writeEvent(deps, {
        type: "ZONE_COUNT",
        payload: { zone_id: "not-a-uuid", counted: -1, system_count_at_time: 0 },
      }),
    ).rejects.toThrow(/IC-01 validation failed/);
    expect(await fake.listEvents()).toHaveLength(0);
  });

  it("a write failure leaves the store fully empty — no partial event (T-GATE-01-I1/N4)", async () => {
    const fake = makeFake();
    fake.failOnEventPosition(0, new Error("disk died"));
    const deps = makeDeps(fake);
    await expect(
      writeEvent(deps, { type: "ENTRY", session_id: SESSION, payload: { ...ENTRY_PAYLOAD } }),
    ).rejects.toThrow("disk died");
    expect(await fake.listEvents()).toHaveLength(0);
  });
});

describe("occupancy view (T-GATE-01-I3)", () => {
  it("a saved entry bumps the zone immediately through the observer", async () => {
    const fake = makeFake();
    const seen: number[] = [];
    // SYNC-04 observe semantics: the current snapshot arrives on subscribe, changes after writes.
    const stop = fake.observeOccupancy(FACILITY, (snapshot) => {
      seen.push(snapshot.zones[ZONE_1]?.count ?? -1);
      expect(snapshot.warnings).toEqual([]);
    });
    fake.attachSessionZone(SESS_A, ZONE_1);
    await writeEvent(makeDeps(fake), {
      type: "ENTRY",
      session_id: SESS_A,
      payload: ENTRY_PAYLOAD,
    });
    stop();
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it("an exit clears the session from occupancy in the same notify cycle", async () => {
    const fake = makeFake();
    let last = -1;
    const stop = fake.observeOccupancy(FACILITY, (snapshot) => {
      last = snapshot.zones[ZONE_1]?.count ?? -1;
    });
    fake.attachSessionZone(SESS_A, ZONE_1);
    const deps = makeDeps(fake);
    await writeEvent(deps, { type: "ENTRY", session_id: SESS_A, payload: ENTRY_PAYLOAD });
    await writeExit(deps, {
      sessionId: SESS_A,
      farePaise: 6000,
      exitMethod: "CODE",
      payment: { mode: "CASH", amountPaise: 6000 },
    });
    stop();
    expect(last).toBe(0);
  });

  it("keeps occupancy non-negative for synced and local sessions without drift warnings", async () => {
    const fake = new FakeSync({
      zones: { [ZONE_1]: { capacity: 5 } },
      openSessions: [{ sessionId: SESS_A, zoneId: ZONE_1 }],
      clock: () => new Date(NOW),
    });
    const snapshots: { count: number; warnings: string[] }[] = [];
    const stop = fake.observeOccupancy(FACILITY, (snapshot) => {
      snapshots.push({
        count: snapshot.zones[ZONE_1]?.count ?? -1,
        warnings: snapshot.warnings,
      });
    });
    await writeEvent(makeDeps(fake), {
      type: "EXIT",
      session_id: SESS_A,
      payload: { fare_paise: 0, exit_method: "CODE" },
    });
    stop();

    expect(snapshots.every(({ count }) => count >= 0)).toBe(true);
    expect(snapshots.at(-1)).toEqual({ count: 0, warnings: [] });
  });

  it("counts a session present in both the synced snapshot and local ENTRY only once", async () => {
    const fake = new FakeSync({
      zones: { [ZONE_1]: { capacity: 5 } },
      openSessions: [{ sessionId: SESS_A, zoneId: ZONE_1 }],
      clock: () => new Date(NOW),
    });
    fake.attachSessionZone(SESS_A, ZONE_1);
    await writeEvent(makeDeps(fake), {
      type: "ENTRY",
      session_id: SESS_A,
      payload: ENTRY_PAYLOAD,
    });
    let observed = -1;
    const stop = fake.observeOccupancy(FACILITY, (snapshot) => {
      observed = snapshot.zones[ZONE_1]?.count ?? -1;
    });
    stop();
    expect(observed).toBe(1);
  });

  it("rejects impossible zone capacities and unknown initial session zones", () => {
    expect(
      () =>
        new FakeSync({
          zones: { [ZONE_1]: { capacity: -1 } },
        }),
    ).toThrow(`FakeSync: invalid capacity for zone ${ZONE_1}`);

    expect(
      () =>
        new FakeSync({
          zones: { [ZONE_1]: { capacity: 5 } },
          openSessions: [{ sessionId: SESS_A, zoneId: ZONE_2 }],
        }),
    ).toThrow(`FakeSync: unknown zone ${ZONE_2}`);
  });
});

describe("writeExit atomic bundle (T-GATE-02-I1, T-GATE-04-N3)", () => {
  it("saves EXIT and PAYMENT in one transaction (T-GATE-02-I1 success leg)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    const events = await writeExit(deps, {
      sessionId: SESS_A,
      farePaise: 6000,
      exitMethod: "CODE",
      payment: { mode: "CASH", amountPaise: 6000 },
    });
    expect(events.map((e) => e.type)).toEqual(["EXIT", "PAYMENT"]);
    expect((await fake.listEvents()).length).toBe(2);
    const [exit, payment] = await fake.listEvents();
    if (exit.type !== "EXIT") throw new Error("expected EXIT");
    expect(exit.session_id).toBe(SESS_A);
    expect(exit.payload.fare_paise).toBe(6000);
    expect(exit.payload.exit_method).toBe("CODE");
    // No tariff audit value unless a uuid tariff id was given (dev fixture ids are not uuids).
    expect(exit.payload.tariff_id).toBeUndefined();
    if (payment.type !== "PAYMENT") throw new Error("expected PAYMENT");
    expect(payment.payload.mode).toBe("CASH");
    expect(payment.payload.amount_paise).toBe(6000);
    expect(payment.payload.upi_attested).toBe(false);
  });

  it("an injected failure between the two events stores NEITHER (T-GATE-02-I1 failure leg)", async () => {
    const fake = makeFake();
    fake.failOnEventPosition(1, new Error("write died between events"));
    const deps = makeDeps(fake);
    await expect(
      writeExit(deps, {
        sessionId: SESS_A,
        farePaise: 6000,
        exitMethod: "CODE",
        payment: { mode: "UPI", amountPaise: 6000 },
      }),
    ).rejects.toThrow("write died between events");
    expect(await fake.listEvents()).toHaveLength(0); // both or neither
  });

  it("UPI received saves the attestation (T-GATE-02-E2 semantics at event level)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    await writeExit(deps, {
      sessionId: SESS_A,
      farePaise: 6000,
      exitMethod: "SCAN",
      payment: { mode: "UPI", amountPaise: 6000 },
    });
    const payment = (await fake.listEvents())[1];
    if (payment.type !== "PAYMENT") throw new Error("expected PAYMENT");
    expect(payment.payload.upi_attested).toBe(true);
    expect(payment.payload.mode).toBe("UPI");
  });

  it("records the tariff audit fields when the resolved tariff id is a uuid (GATE-03 audit)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    await writeExit(deps, {
      sessionId: SESS_A,
      farePaise: 6000,
      exitMethod: "CODE",
      tariffId: TARIFF_ID,
      tariffVersion: 2,
      payment: { mode: "CASH", amountPaise: 6000 },
    });
    const exit = (await fake.listEvents())[0];
    if (exit.type !== "EXIT") throw new Error("expected EXIT");
    expect(exit.payload.tariff_id).toBe(TARIFF_ID);
    expect(exit.payload.tariff_version).toBe(2);
    expect(parseEvent(exit).ok).toBe(true);
  });

  it("second exit attempt for the same session is refused locally (T-GATE-02-N2 write guard)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    await writeExit(deps, {
      sessionId: SESS_A,
      farePaise: 6000,
      exitMethod: "CODE",
      payment: { mode: "CASH", amountPaise: 6000 },
    });
    await expect(
      writeExit(deps, {
        sessionId: SESS_A,
        farePaise: 6000,
        exitMethod: "CODE",
        payment: { mode: "CASH", amountPaise: 6000 },
      }),
    ).rejects.toMatchObject({ reason: "ALREADY_EXITED" });
    expect((await fake.listEvents()).length).toBe(2); // no new events
  });

  it("a second payment for the same session is refused locally (T-GATE-04-I1)", async () => {
    const fake = makeFake();
    // Seed only a PAYMENT (as if the store already held one from a corrected path) with no EXIT.
    await fake.writeTransaction([seededPayment("CASH", 6000)]);
    const deps = makeDeps(fake);
    await expect(
      writeExit(deps, {
        sessionId: SESS_A,
        farePaise: 6000,
        exitMethod: "CODE",
        payment: { mode: "CASH", amountPaise: 6000 },
      }),
    ).rejects.toMatchObject({ reason: "SECOND_PAYMENT" });
    expect((await fake.listEvents()).length).toBe(1); // nothing new
  });

  it("rejects a Cash payment whose amount differs from the fare (T-GATE-04-U2, rule 8)", async () => {
    const fake = makeFake();
    await expect(
      writeExit(makeDeps(fake), {
        sessionId: SESS_A,
        farePaise: 6000,
        exitMethod: "CODE",
        payment: { mode: "CASH", amountPaise: 4000 },
      }),
    ).rejects.toThrow(/AMOUNT_MISMATCH/);
    expect(await fake.listEvents()).toHaveLength(0);
  });

  it("accepts a PASS payment: fare zero, no cash collected, no attestation (SYNC-01 modes)", async () => {
    const fake = makeFake();
    const events = await writeExit(makeDeps(fake), {
      sessionId: SESS_A,
      farePaise: 0,
      exitMethod: "SCAN",
      payment: { mode: "PASS", amountPaise: 0 },
    });
    expect(events.map((e) => e.type)).toEqual(["EXIT", "PAYMENT"]);
    const payment = events[1];
    if (payment.type !== "PAYMENT") throw new Error("expected PAYMENT");
    expect(payment.payload.mode).toBe("PASS");
    expect(payment.payload.amount_paise).toBe(0);
    expect(payment.payload.upi_attested).toBe(false);
  });
});

describe("waive path (T-GATE-04-I2/U3)", () => {
  it("writes EXIT + PAYMENT(WAIVED, 0) + the reason OVERRIDE in one transaction (T-GATE-04-I2)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    const events = await writeExit(
      deps,
      waiveExitBundle({
        sessionId: SESS_A,
        entryEventId: ENTRY_EVENT_ID,
        reasonCode: "OWNER_WAIVER",
        exitMethod: "LOOKUP",
      }),
    );
    // writeExit composition order: EXIT, then the waiver OVERRIDE, then the zero PAYMENT.
    expect(events.map((e) => e.type)).toEqual(["EXIT", "OVERRIDE", "PAYMENT"]);
    expect((await fake.listEvents()).length).toBe(3);
    const overrideEvent = events[1];
    if (overrideEvent.type !== "OVERRIDE") throw new Error("expected OVERRIDE");
    expect(overrideEvent.payload.reason_code).toBe("OWNER_WAIVER");
    expect(overrideEvent.payload.target_event_id).toBe(ENTRY_EVENT_ID);
    const payment = events[2];
    if (payment.type !== "PAYMENT") throw new Error("expected PAYMENT");
    expect(payment.payload.mode).toBe("WAIVED");
    expect(payment.payload.amount_paise).toBe(0);
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
          exitMethod: "LOOKUP",
        }),
      ),
    ).rejects.toMatchObject({ reason: "OVERRIDE_RULES" });
    expect(await fake.listEvents()).toHaveLength(0);
  });
});

describe("writeOverride (T-GATE-07-I1)", () => {
  it("stores reason and target; staff attribution rides the stamped envelope", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    const stored = await writeOverride(deps, {
      sessionId: SESSION,
      targetEventId: ENTRY_EVENT_ID,
      reasonCode: "MISREAD_NUMBER",
    });
    if (stored.type !== "OVERRIDE") throw new Error("expected OVERRIDE");
    expect(stored.payload.reason_code).toBe("MISREAD_NUMBER");
    expect(stored.payload.target_event_id).toBe(ENTRY_EVENT_ID);
    expect(stored.session_id).toBe(SESSION);
    // Deliberate pin since SYNC-01: the sheet requires the override to carry the staff id
    // ("code, staff id, target") — the merged IC-01 envelope provides it on every event.
    expect(stored.staff_id).toBe(STAFF);
    expect(stored.facility_id).toBe(FACILITY);
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
    expect(await fake.listEvents()).toHaveLength(0);
  });
});

describe("shift event persistence boundary (T-GATE-06-I1)", () => {
  it("records SHIFT_OPEN with its payload (session-less envelope)", async () => {
    const fake = makeFake();
    const open = await writeEvent(makeDeps(fake), {
      type: "SHIFT_OPEN",
      payload: { shift_id: SHIFT_ID, opening_float_paise: 50000 },
    });
    expect(open.type).toBe("SHIFT_OPEN");
    expect(open.session_id).toBeNull();
    if (open.type !== "SHIFT_OPEN") throw new Error("expected SHIFT_OPEN");
    expect(open.payload).toEqual({ shift_id: SHIFT_ID, opening_float_paise: 50000 });
    expect(open.facility_id).toBe(FACILITY);
    expect(parseEvent(open).ok).toBe(true);
  });

  it("records SHIFT_CLOSE with the full totals/variance payload", async () => {
    const fake = makeFake();
    const close = await writeEvent(makeDeps(fake), {
      type: "SHIFT_CLOSE",
      payload: {
        shift_id: SHIFT_ID,
        counted_cash_paise: 119500,
        expected_cash_paise: 120000,
        upi_total_declared_paise: 81000,
        upi_attested_sum_paise: 80000,
        variance_cash_paise: -500,
        variance_upi_paise: 1000,
      },
    });
    expect(await fake.listEvents()).toHaveLength(1);
    expect(close.session_id).toBeNull();
    if (close.type !== "SHIFT_CLOSE") throw new Error("expected SHIFT_CLOSE");
    expect(close.payload.counted_cash_paise).toBe(119500);
    expect(close.payload.variance_cash_paise).toBe(-500);
    expect(parseEvent(close).ok).toBe(true);
  });

  it("rejects an incomplete SHIFT_CLOSE instead of inventing totals (IC-01 strictness)", async () => {
    const fake = makeFake();
    const deps = makeDeps(fake);
    await expect(
      // Missing counted/declared/variance fields → the strict payload schema refuses.
      writeEvent(deps, {
        type: "SHIFT_CLOSE",
        payload: {
          shift_id: SHIFT_ID,
          counted_cash_paise: 100,
          expected_cash_paise: 100,
          upi_total_declared_paise: 0,
          upi_attested_sum_paise: 0,
          variance_cash_paise: 0,
        } as never,
      }),
    ).rejects.toThrow(); // variance_upi_paise missing → shape mismatch
    expect(await fake.listEvents()).toHaveLength(0);
  });
});
