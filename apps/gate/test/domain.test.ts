import { describe, expect, it } from "vitest";
import { REASON_CODES, parseTariff } from "@pmp/contracts";
import type { Tariff } from "@pmp/contracts";
import { FareError } from "@pmp/domain";
import { TARIFF_IDS } from "@pmp/domain/src/fixtures/tariffIds";
import {
  SHORT_CODE_PATTERN,
  defaultUuidV7,
  generateToken,
  normalizeShortCode,
  qrPayloadFor,
} from "../src/domain/token";
import { normalizeVehicleNo } from "../src/domain/plates";
import { suggestZone } from "../src/domain/suggestZone";
import type { GateZone } from "../src/domain/suggestZone";
import { parseQrPayload } from "../src/domain/payload";
import { tariffFor } from "../src/domain/tariffFor";
import { isPassListStale, lookupPass } from "../src/domain/pass";
import type { PassRow } from "../src/domain/pass";
import { isWithinCorrectionWindow, validateOverrideInput } from "../src/domain/override";

/**
 * Pure domain helpers of the gate app:
 *   GATE-01 token + zone suggestion + plate normalization (D.1, T-GATE-01-U1..U6)
 *   GATE-02 payload parsing and effective tariff selection (D.2, T-GATE-02-U1/U2/U4)
 *   GATE-05 pass lookup states (D.5, T-GATE-05-U1/U2)
 *   GATE-07 reason-code validation and the 2-minute correction window (D.7, T-GATE-07-U1)
 * Screen flows, writeEvent and the sync client are separate (blocked) work — see the session report.
 */

const FACILITY_ID = "a1111111-2222-3333-4444-555555555555"; // 36 chars, per the (R) payload regex
const SESSION_ID = "01912345-6789-7abc-8def-0123456789ab";

/* --------------------------------------------------------------- GATE-01: token */

describe("GATE-01 tokens (T-GATE-01-U1/U2/U3)", () => {
  it("U1: 10,000 generated tokens use the Crockford short-code alphabet and QR payload shape", () => {
    const open = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const token = generateToken(open, FACILITY_ID);
      expect(SHORT_CODE_PATTERN.test(token.shortCode)).toBe(true);
      expect(token.qrPayload).toBe(`parkos:${FACILITY_ID}:${token.shortCode}:${token.sessionId}`);
      open.add(token.shortCode);
    }
  });

  it("U2: tokens never reuse an open short code; the regeneration counter is returned", () => {
    // Seeded open set: 1,000 codes drawn from the same alphabet.
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let seed = 1234;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * n);
    };
    const open = new Set<string>();
    while (open.size < 1000) {
      let code = "";
      for (let i = 0; i < 5; i++) code += alphabet[rand(alphabet.length)];
      open.add(code);
    }
    for (let i = 0; i < 1_000; i++) {
      const token = generateToken(open, FACILITY_ID);
      expect(open.has(token.shortCode)).toBe(false);
      expect(token.regenerations).toBeGreaterThanOrEqual(0);
    }
  });

  it("U3: QR payload equals parkos:<facility>:<code>:<session> exactly for known ids", () => {
    expect(qrPayloadFor("f-1", "AX7K2", SESSION_ID)).toBe(`parkos:f-1:AX7K2:${SESSION_ID}`);
    const token = generateToken(new Set(), FACILITY_ID, () => SESSION_ID);
    expect(token.sessionId).toBe(SESSION_ID);
    expect(token.qrPayload).toBe(`parkos:${FACILITY_ID}:${token.shortCode}:${SESSION_ID}`);
  });

  it("a default UUIDv7 id is well-formed (version nibble 7, variant 10)", () => {
    const id = defaultUuidV7();
    expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(defaultUuidV7()).not.toBe(id); // ids differ
  });

  it("short code normalization rejects U and maps I/L/O (shared with the exit screen)", () => {
    expect(normalizeShortCode("o0il")).toBe("0011");
    expect(normalizeShortCode("abcde")).toBe("ABCDE");
    expect(normalizeShortCode("i")).toBe("1");
    expect(normalizeShortCode("l")).toBe("1");
    expect(normalizeShortCode("o")).toBe("0");
    expect(normalizeShortCode("u")).toBeNull();
    expect(normalizeShortCode("XuX")).toBeNull();
    expect(normalizeShortCode("A B")).toBeNull();
    expect(normalizeShortCode("Z-9")).toBeNull();
    // A normalized code satisfies the sheet's pattern when it has the right length.
    expect(SHORT_CODE_PATTERN.test(normalizeShortCode("ax7k2") ?? "")).toBe(true);
  });
});

/* --------------------------------------------------------------- GATE-01: zones and plates */

const ZONES: GateZone[] = [
  { id: "Z1", vehicle_class: ["Car"], capacity: 2 },
  { id: "Z2", vehicle_class: ["Car", "Bike"], capacity: 5 },
];

describe("GATE-01 zone suggestion (T-GATE-01-U4/U5, OQ-28)", () => {
  it("U4: car gets Z2 when Z1 is full, Z1 when a space is free; bike gets Z2", () => {
    expect(suggestZone("Car", { Z1: 2, Z2: 0 }, ZONES)).toEqual({ zoneId: "Z2", full: false });
    expect(suggestZone("Car", { Z1: 1, Z2: 0 }, ZONES)).toEqual({ zoneId: "Z1", full: false });
    expect(suggestZone("Bike", { Z1: 0, Z2: 0 }, ZONES)).toEqual({ zoneId: "Z2", full: false });
  });

  it("U5: when every allowed zone is full, the first allowed zone comes back with full=true", () => {
    expect(suggestZone("Car", { Z1: 2, Z2: 5 }, ZONES)).toEqual({ zoneId: "Z1", full: true });
    expect(suggestZone("Bike", { Z1: 2, Z2: 5 }, ZONES)).toEqual({ zoneId: "Z2", full: true });
  });

  it("missing occupancy entries count as 0; occupancy at exactly capacity is full", () => {
    expect(suggestZone("Car", {}, ZONES)).toEqual({ zoneId: "Z1", full: false });
    expect(suggestZone("Car", { Z1: 2, Z2: 4 }, ZONES)).toEqual({ zoneId: "Z2", full: false });
    expect(suggestZone("Car", { Z1: 2, Z2: 5 }, ZONES)).toEqual({ zoneId: "Z1", full: true });
  });

  it("no zone allows the class -> null (screen shows the OQ-28 warn-and-override path)", () => {
    expect(suggestZone("Truck", { Z1: 0, Z2: 0 }, ZONES)).toBeNull();
    expect(suggestZone("Car", { Z1: 1, Z2: 0 }, [])).toBeNull();
  });

  it("rejects impossible negative or fractional capacity and occupancy inputs", () => {
    expect(() => suggestZone("Car", { Z1: -1 }, ZONES)).toThrow(
      "suggestZone: invalid occupancy for zone Z1",
    );
    expect(() => suggestZone("Car", { Z1: 1.5 }, ZONES)).toThrow(
      "suggestZone: invalid occupancy for zone Z1",
    );
    expect(() =>
      suggestZone("Car", {}, [{ id: "Z1", vehicle_class: ["Car"], capacity: -1 }]),
    ).toThrow("suggestZone: invalid capacity for zone Z1");
  });

  it("treats valid over-capacity occupancy as full so override remains available", () => {
    expect(suggestZone("Car", { Z1: 3, Z2: 6 }, ZONES)).toEqual({ zoneId: "Z1", full: true });
  });
});

describe("GATE-01 plate normalization (T-GATE-01-U6, rule 9)", () => {
  it("U6: spaces and hyphens are stripped, output is uppercase, short plates are rejected", () => {
    expect(normalizeVehicleNo("up 32-AB 1234")).toBe("UP32AB1234");
    expect(normalizeVehicleNo("UP32AB1234")).toBe("UP32AB1234");
    expect(normalizeVehicleNo("ab1")).toBeNull();
  });

  it("lengths beyond 12, punctuation and weird spacing are rejected or cleaned", () => {
    expect(normalizeVehicleNo("UP-32-AB-1234")).toBe("UP32AB1234");
    expect(normalizeVehicleNo("UP32AB1234ABCD")).toBeNull(); // 13 chars
    expect(normalizeVehicleNo("UP32.AB")).toBeNull();
    expect(normalizeVehicleNo("")).toBeNull();
    expect(normalizeVehicleNo("    ")).toBeNull();
    expect(normalizeVehicleNo("ab01")).toBe("AB01"); // exactly 4 is accepted
  });
});

/* --------------------------------------------------------------- GATE-02: payload and tariff */

describe("GATE-02 QR payload parsing (T-GATE-02-U1, N3)", () => {
  const validPayload = `parkos:${FACILITY_ID}:AX7K2:${SESSION_ID}`;

  it("a well-formed facility payload parses into its three parts", () => {
    expect(parseQrPayload(validPayload, FACILITY_ID)).toEqual({
      ok: true,
      facilityId: FACILITY_ID,
      shortCode: "AX7K2",
      sessionId: SESSION_ID,
    });
  });

  it("a payload from another facility is WRONG_FACILITY; without a filter it still parses", () => {
    expect(parseQrPayload(validPayload, "other-facility")).toEqual({
      ok: false,
      reason: "WRONG_FACILITY",
    });
    expect(parseQrPayload(validPayload).ok).toBe(true);
  });

  it("malformed payloads are INVALID (lowercase code, wrong length, junk, wrong prefix)", () => {
    for (const bad of [
      "",
      "junk",
      "parkos:AX7K2:",
      `parkos:${FACILITY_ID}:ax7k2:${SESSION_ID}`, // lower-case code not allowed by the (R) pattern
      `parkos:${FACILITY_ID.toUpperCase()}:AX7K2:${SESSION_ID}`, // uppercase facility id
      `parkos:${FACILITY_ID}:AX7K2X:${SESSION_ID}`, // 6-char code
      `parkos:${FACILITY_ID}:AX7K2:not-a-uuid`,
      `parko:${FACILITY_ID}:AX7K2:${SESSION_ID}`,
    ]) {
      expect(parseQrPayload(bad, FACILITY_ID), `payload ${JSON.stringify(bad)}`).toEqual({
        ok: false,
        reason: "INVALID",
      });
    }
    expect(parseQrPayload(undefined as unknown as string)).toEqual({
      ok: false,
      reason: "INVALID",
    });
  });
});

/** Validates a test tariff through the shared schema and unwraps it (or fails the test run). */
function mustTariff(input: unknown): Tariff {
  const result = parseTariff(input);
  if (!result.ok) throw new Error(`test tariff invalid: ${JSON.stringify(result.issues[0])}`);
  return result.value;
}

const carA = mustTariff({
  id: TARIFF_IDS["CAR-A"],
  facilityId: FACILITY_ID,
  vehicleClass: "Car",
  effectiveFrom: "2026-11-01",
  effectiveTo: "2026-11-30",
  graceMinutes: 15,
  model: "HOURLY_SLABS",
  slabs: [
    { upToMinutes: 60, pricePaise: 3000 },
    { upToMinutes: 180, pricePaise: 6000 },
  ],
  repeat: { everyMinutes: 60, pricePaise: 2000 },
  dayCapPaise: 30000,
});
const carB = mustTariff({
  id: TARIFF_IDS["CAR-B"],
  facilityId: FACILITY_ID,
  vehicleClass: "Car",
  effectiveFrom: "2026-12-01",
  graceMinutes: 15,
  model: "HOURLY_SLABS",
  slabs: [
    { upToMinutes: 60, pricePaise: 4000 },
    { upToMinutes: 180, pricePaise: 7000 },
  ],
  repeat: { everyMinutes: 60, pricePaise: 2500 },
  dayCapPaise: 35000,
});

describe("GATE-02 effective tariff selection (T-GATE-02-U4, OQ-20 default)", () => {
  const tariffs: Tariff[] = [carA, carB];

  it("selects by the session's entry IST date (tariff at entry, the OQ-20 default)", () => {
    // A stay entered 2026-11-30 that exits on 2026-12-01 still uses CAR-A (F9-1).
    expect(tariffFor(tariffs, "Car", "2026-11-30T23:00:00+05:30")?.id).toBe(TARIFF_IDS["CAR-A"]);
    expect(tariffFor(tariffs, "Car", "2026-12-01T00:00:00+05:30")?.id).toBe(TARIFF_IDS["CAR-B"]);
    expect(tariffFor(tariffs, "Car", "2026-11-10T10:00:00+05:30")?.id).toBe(TARIFF_IDS["CAR-A"]);
  });

  it("no effective tariff -> null (screen: 'No tariff for this class')", () => {
    expect(tariffFor(tariffs, "Car", "2026-10-31T10:00:00+05:30")).toBeNull();
    expect(tariffFor(tariffs, "Bike", "2026-11-10T10:00:00+05:30")).toBeNull();
    expect(tariffFor([], "Car", "2026-11-10T10:00:00+05:30")).toBeNull();
  });

  it("the first list entry wins when two windows overlap (documented interim)", () => {
    const CAR_WIDE_ID = "0192f0a0-0000-7000-9000-00000000a009";
    const openEnded = mustTariff({ ...carA, id: CAR_WIDE_ID, effectiveTo: undefined });
    const mixed = [openEnded, ...tariffs];
    expect(tariffFor(mixed, "Car", "2026-11-10T10:00:00+05:30")?.id).toBe(CAR_WIDE_ID);
  });

  it("an unparseable instant throws the shared INVALID_RANGE FareError", () => {
    expect(() => tariffFor(tariffs, "Car", "not-a-date")).toThrow(FareError);
    expect(() => tariffFor(tariffs, "Car", "2026-11-10 10:00:00")).toThrow(FareError);
  });
});

/* --------------------------------------------------------------- GATE-05: pass lookup */

const NOW = "2026-11-10T10:00:00+05:30"; // IST day 2026-11-10

const passRows: PassRow[] = [
  { id: "p1", facility_id: FACILITY_ID, vehicle_no: "UP32AB1111", valid_to: "2026-12-31", dues: 0 },
  { id: "p2", facility_id: FACILITY_ID, vehicle_no: "UP32AB2222", valid_to: "2026-11-10", dues: 0 }, // expires today
  { id: "p3", facility_id: FACILITY_ID, vehicle_no: "UP32AB3333", valid_to: "2026-11-09", dues: 0 },
  {
    id: "p4",
    facility_id: FACILITY_ID,
    vehicle_no: "UP32AB4444",
    valid_to: "2026-11-10",
    dues: 5000,
  },
];

describe("GATE-05 pass lookup (T-GATE-05-U1/U2)", () => {
  it("U1: valid, expires-today, expired and dues>0 map to VALID, VALID, EXPIRED, DUES", () => {
    expect(lookupPass("UP32AB1111", passRows, NOW).state).toBe("VALID");
    expect(lookupPass("UP32AB2222", passRows, NOW).state).toBe("VALID");
    expect(lookupPass("UP32AB3333", passRows, NOW).state).toBe("EXPIRED");
    expect(lookupPass("UP32AB4444", passRows, NOW).state).toBe("DUES");
  });

  it("U2: duplicate rows for one plate resolve to the later valid_to", () => {
    const duplicates: PassRow[] = [
      {
        id: "d1",
        facility_id: FACILITY_ID,
        vehicle_no: "UP 32 AB 5555",
        valid_to: "2026-11-09",
        dues: 0,
      },
      {
        id: "d2",
        facility_id: FACILITY_ID,
        vehicle_no: "up32ab5555",
        valid_to: "2026-12-31",
        dues: 0,
      },
    ];
    const result = lookupPass("up32ab5555", duplicates, NOW);
    expect(result.state).toBe("VALID");
    expect(result.pass?.id).toBe("d2");
  });

  it("NOT_FOUND for unknown, malformed and QR-like input (pass QR contract pending)", () => {
    expect(lookupPass("UP32AB9999", passRows, NOW).state).toBe("NOT_FOUND");
    expect(lookupPass("ab1", passRows, NOW).state).toBe("NOT_FOUND");
    expect(lookupPass("", passRows, NOW).state).toBe("NOT_FOUND");
    expect(lookupPass("parkos-pass:fac-demo-1:p1", passRows, NOW).state).toBe("NOT_FOUND");
    expect(lookupPass("UP32AB1111", passRows, NOW).pass?.id).toBe("p1");
  });

  it("malformed valid_to fails closed to EXPIRED (documented interim data rule)", () => {
    const bad: PassRow[] = [
      { id: "b1", facility_id: FACILITY_ID, vehicle_no: "UP32AB7777", valid_to: "soon", dues: 0 },
    ];
    expect(lookupPass("UP32AB7777", bad, NOW)).toEqual({
      state: "EXPIRED",
      pass: bad[0],
    });
  });

  it("an unparseable 'now' throws (device_time contract violation)", () => {
    expect(() => lookupPass("UP32AB1111", passRows, "yesterday")).toThrow();
  });
});

describe("GATE-05 pass list staleness (T-GATE-05-N3)", () => {
  const SYNCED_AT = "2026-11-10T06:00:00Z";
  const DAY_MS = 24 * 60 * 60_000;

  it("never synced is stale", () => {
    expect(isPassListStale(null, Date.parse(SYNCED_AT))).toBe(true);
  });

  it("exactly 24h since sync is not yet stale; one ms over is", () => {
    const syncedMs = Date.parse(SYNCED_AT);
    expect(isPassListStale(SYNCED_AT, syncedMs + DAY_MS)).toBe(false);
    expect(isPassListStale(SYNCED_AT, syncedMs + DAY_MS + 1)).toBe(true);
  });

  it("a corrupt lastSyncAt timestamp fails closed (stale)", () => {
    expect(isPassListStale("not-a-date", Date.parse(SYNCED_AT))).toBe(true);
  });
});

/* --------------------------------------------------------------- GATE-07: overrides */

describe("GATE-07 override validation (T-GATE-07-U1)", () => {
  it("every fixed reason code except OTHER is accepted without a note", () => {
    for (const code of REASON_CODES) {
      if (code === "OTHER") continue; // OTHER requires its note; covered below
      expect(validateOverrideInput({ reasonCode: code }).ok, `code ${code}`).toBe(true);
    }
  });

  it("OTHER requires a note of 5 to 200 characters (trimmed)", () => {
    expect(validateOverrideInput({ reasonCode: "OTHER" })).toEqual({
      ok: false,
      issue: "NOTE_LENGTH",
    });
    expect(validateOverrideInput({ reasonCode: "OTHER", note: "" })).toEqual({
      ok: false,
      issue: "NOTE_LENGTH",
    });
    expect(validateOverrideInput({ reasonCode: "OTHER", note: "hi" })).toEqual({
      ok: false,
      issue: "NOTE_LENGTH",
    });
    expect(validateOverrideInput({ reasonCode: "OTHER", note: "     " })).toEqual({
      ok: false,
      issue: "NOTE_LENGTH",
    });
    expect(validateOverrideInput({ reasonCode: "OTHER", note: "Sorry!" }).ok).toBe(true); // 6
    expect(validateOverrideInput({ reasonCode: "OTHER", note: "00000" }).ok).toBe(true); // exactly 5
    expect(validateOverrideInput({ reasonCode: "OTHER", note: "0000" })).toEqual({
      ok: false,
      issue: "NOTE_LENGTH",
    }); // 4
    expect(validateOverrideInput({ reasonCode: "OTHER", note: "a".repeat(200) }).ok).toBe(true); // exactly 200
    expect(validateOverrideInput({ reasonCode: "OTHER", note: "a".repeat(201) })).toEqual({
      ok: false,
      issue: "NOTE_LENGTH",
    }); // 201
  });

  it("unknown reason codes are rejected", () => {
    expect(validateOverrideInput({ reasonCode: "NOPE" })).toEqual({
      ok: false,
      issue: "UNKNOWN_REASON_CODE",
    });
    expect(validateOverrideInput({ reasonCode: "" })).toEqual({
      ok: false,
      issue: "UNKNOWN_REASON_CODE",
    });
    expect(validateOverrideInput({ reasonCode: "other" })).toEqual({
      ok: false,
      issue: "UNKNOWN_REASON_CODE",
    }); // codes are uppercase only
  });

  it("notes on other codes stay optional text", () => {
    expect(validateOverrideInput({ reasonCode: "LOST_TOKEN", note: "token torn" }).ok).toBe(true);
    expect(validateOverrideInput({ reasonCode: "WRONG_CLASS" }).ok).toBe(true);
  });
});

describe("GATE-07 two-minute correction window (sequence 4)", () => {
  const entry = "2026-11-10T10:00:00+05:30";
  it("is inclusive at exactly 2 minutes and closed afterwards", () => {
    expect(isWithinCorrectionWindow(entry, "2026-11-10T10:02:00+05:30")).toBe(true);
    expect(isWithinCorrectionWindow(entry, "2026-11-10T10:02:00.001+05:30")).toBe(false);
    expect(isWithinCorrectionWindow(entry, "2026-11-10T10:01:59.999+05:30")).toBe(true);
    expect(isWithinCorrectionWindow(entry, "2026-11-10T10:30:00+05:30")).toBe(false);
  });

  it("a before-entry clock or garbage input fails closed", () => {
    expect(isWithinCorrectionWindow(entry, "2026-11-10T09:00:00+05:30")).toBe(false);
    expect(isWithinCorrectionWindow(entry, "not-a-date")).toBe(false);
    expect(isWithinCorrectionWindow("nope", entry)).toBe(false);
  });
});
