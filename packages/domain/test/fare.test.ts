import { describe, expect, it } from "vitest";
import { durationMinutes, explainFare, FareError, fare, isFareError } from "../src/index";
import { parseTariff } from "@pmp/contracts";
import type { Tariff } from "@pmp/contracts";
import tariffFixturesJson from "../src/fixtures/tariffs.json";
import fareCasesJson from "../src/fixtures/fareCases.json";
import { TARIFF_IDS } from "../src/fixtures/tariffIds";

/**
 * GATE-03 fare engine tests (docs/team/member-02-nikhil.md D.3).
 * IDs follow T-GATE-03-U1..U8 and T-GATE-03-N1. The 60-case table is the oracle; case F9-4 stays
 * skipped until OQ-20 decides between "tariff at entry" and "tariff at exit" (see the bookkeeping
 * block at the bottom). All money assertions are integer paise.
 */

type FareCase = {
  id: string;
  tariffId: string | null;
  tariff?: Tariff;
  entryAt: string;
  exitAt: string;
  durationMinutes: number | null;
  expectedPaise?: number;
  expectedError?: string;
  vehicleClass?: string;
  skip?: boolean;
  skipReason?: string;
  note?: string;
};

const tariffFixtures = tariffFixturesJson as unknown as Tariff[];
const fareCases = fareCasesJson as unknown as FareCase[];

/**
 * Looked up by the friendly fixture name (e.g. "CAR-A"), not the schema's `id` field: `id` is now
 * a uuid (PR #6 review item 1), so TARIFF_IDS is the name<->uuid mapping kept in sync with
 * tariffs.json.
 */
const tariffs: Record<string, Tariff> = Object.fromEntries(
  Object.entries(TARIFF_IDS).map(([name, id]) => {
    const t = tariffFixtures.find((row) => row.id === id);
    if (!t) throw new Error(`tariffIds.ts and tariffs.json are out of sync for ${name}`);
    return [name, t];
  }),
);

/** Indexed access under noUncheckedIndexedAccess resolves to Tariff | undefined; fixtures are fixed. */
const requireTariff = (id: string): Tariff => {
  const t = tariffs[id];
  if (!t) throw new Error(`missing fixture tariff ${id}`);
  return t;
};

/** Property tests need entry instants inside each fixture tariff's effective set. */
const propertyEntryForTariff: Record<string, string> = {
  [TARIFF_IDS["CAR-B"]]: "2026-12-10T10:00:00+05:30", // effectiveFrom 2026-12-01
};
const entryFor = (t: Tariff): string => propertyEntryForTariff[t.id] ?? propertyEntry;

/** Entry instant used for the property tests, and its January-style exit builder. */
const propertyEntry = "2026-11-10T10:00:00+05:30";
const propertyEntryMs = new Date(propertyEntry).getTime();

/** ISO instant for `entry + minutes`, rendered with a trailing Z (a valid IC-04 instant). */
const exitForMinutes = (entry: string, minutes: number): string =>
  new Date(new Date(entry).getTime() + minutes * 60_000).toISOString();
const exitAfterMinutes = (minutes: number): string => exitForMinutes(propertyEntry, minutes);

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};

describe("fixture validity (precondition for T-GATE-03-U1)", () => {
  it("every tariff fixture passes the IC-04 schema", () => {
    for (const t of tariffFixtures) {
      expect(parseTariff(t).ok, `fixture ${t.id} must be schema-valid`).toBe(true);
    }
  });

  it("the table has 60 rows and exactly one documented pending-decision skip (F9-4, OQ-20)", () => {
    expect(fareCases).toHaveLength(60);
    const skipped = fareCases.filter((c) => c.skip);
    expect(skipped.map((c) => c.id)).toEqual(["F9-4"]);
  });
});

describe("60-case fixture table (T-GATE-03-U1, T-GATE-03-U7)", () => {
  const active = fareCases.filter((c) => !c.skip);

  it.each(active)("case $id", (c) => {
    // The engine's contract is a validated Tariff instance (or null), never an id string.
    const resolvedTariff = c.tariff ?? (c.tariffId ? (tariffs[c.tariffId] ?? null) : null);
    // Transliteration integrity: the engine's rounded-up minutes must match the table column
    // where the column exists (error rows F10-1/F10-4 have no defined duration).
    if (c.durationMinutes !== null) {
      expect(durationMinutes(c.entryAt, c.exitAt)).toBe(c.durationMinutes);
    }

    let caught: unknown;
    try {
      const requestedClass = c.vehicleClass ?? resolvedTariff?.vehicleClass ?? "Car";
      const paise = fare(resolvedTariff, c.entryAt, c.exitAt, requestedClass);
      expect(Number.isSafeInteger(paise)).toBe(true);
      expect(paise).toBe(c.expectedPaise);
      // fare() and explainFare() must agree bit-for-bit (gate side of T-GATE-03-I1).
      expect(explainFare(resolvedTariff, c.entryAt, c.exitAt, requestedClass).farePaise).toBe(
        c.expectedPaise,
      );
    } catch (e) {
      caught = e;
    }

    if (c.expectedError !== undefined) {
      expect(caught, `case ${c.id} must fail with a typed FareError`).toBeInstanceOf(FareError);
      expect(isFareError(caught)).toBe(true);
      expect((caught as FareError).code).toBe(c.expectedError);
    } else {
      expect(caught).toBeUndefined();
    }
  });
});

describe("independent recomputation (T-GATE-03-U2)", () => {
  const hhmm = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(2, 4));

  /**
   * Deliberately different implementation: sequential slab walk, while-loop repeat counting,
   * per-second night-window membership scan, IST date from shifted-Clock arithmetic. No code is
   * shared with src/fare.ts. It recomputes the expected values straight from the documented rules
   * and must agree with the frozen table (the human/spreadsheet sign-off of U2 remains an
   * owner step, evidenced outside CI).
   */
  function referenceFare(t: Tariff, entryAt: string, exitAt: string, vehicleClass: string): number {
    if (t.vehicleClass !== vehicleClass) throw new Error("CLASS_MISMATCH");
    const entry = new Date(entryAt).getTime();
    const exit = new Date(exitAt).getTime();
    if (!(exit >= entry)) throw new Error("INVALID_RANGE");
    const ist = new Date(entry + 330 * 60_000);
    const day = [
      String(ist.getUTCFullYear()),
      String(ist.getUTCMonth() + 1).padStart(2, "0"),
      String(ist.getUTCDate()).padStart(2, "0"),
    ].join("-");
    if (day < t.effectiveFrom || (t.effectiveTo !== undefined && day > t.effectiveTo)) {
      throw new Error("NO_TARIFF");
    }
    const minutes = Math.ceil((exit - entry) / 60_000);
    if (minutes <= t.graceMinutes) return 0;

    let total = 0;
    if (t.model === "PER_ENTRY") {
      return t.flatPaise;
    }
    if (t.model === "FLAT") {
      // FLAT: each started 24 h block prices flatPaise (blocks counted from entry, F7 rows).
      total = Math.ceil(minutes / 1440) * t.flatPaise;
    } else {
      let remain = minutes;
      while (remain > 0) {
        const blockMin = Math.min(1440, remain);
        let price: number | undefined;
        for (const slab of t.slabs) {
          if (slab.upToMinutes !== null && blockMin <= slab.upToMinutes) {
            price = slab.pricePaise;
            break;
          }
        }
        if (price === undefined) {
          const finite = t.slabs.filter(
            (s): s is { upToMinutes: number; pricePaise: number } => s.upToMinutes !== null,
          );
          const last = finite[finite.length - 1];
          const rep = t.repeat;
          if (last === undefined || rep === undefined) throw new Error("unpriceable tariff");
          let covered = last.upToMinutes;
          let units = 0;
          while (covered < blockMin) {
            covered += rep.everyMinutes;
            units += 1;
          }
          price = last.pricePaise + units * rep.pricePaise;
        }
        if (t.dayCapPaise !== undefined) price = Math.min(price, t.dayCapPaise);
        total += price;
        remain -= blockMin;
      }
    }

    if (t.night !== undefined) {
      const from = hhmm(t.night.fromHHMM);
      const to = hhmm(t.night.toHHMM);
      const spansMidnight = to <= from;
      for (let m = entry; m < exit; m += 1000) {
        const minuteOfDay = ((Math.floor((m + 330 * 60_000) / 60_000) % 1440) + 1440) % 1440;
        const inWindow = spansMidnight
          ? minuteOfDay >= from || minuteOfDay < to
          : minuteOfDay >= from && minuteOfDay < to;
        if (inWindow) {
          if (t.night.surchargePaise !== undefined) {
            total += t.night.surchargePaise;
          } else {
            total += Math.round((total * (t.night.multiplierPercent ?? 0)) / 100);
          }
          break; // the surcharge applies once per stay
        }
      }
    }

    if (t.minimumPaise !== undefined) total = Math.max(total, t.minimumPaise);
    return total;
  }

  it("recomputes every priced case from the documented rules and matches the frozen table", () => {
    let compared = 0;
    for (const c of fareCases) {
      if (c.skip || c.expectedError !== undefined || c.expectedPaise === undefined) continue;
      const t = c.tariff ?? tariffs[c.tariffId ?? ""];
      if (!t) throw new Error(`case ${c.id} has no resolvable tariff`);
      const vehicleClass = c.vehicleClass ?? t.vehicleClass;
      expect(referenceFare(t, c.entryAt, c.exitAt, vehicleClass), `case ${c.id}`).toBe(
        c.expectedPaise,
      );
      compared += 1;
    }
    // 53 priced rows (60 total minus 1 OQ-20 skip minus 6 error rows F9-5, F10-1..F10-5).
    expect(compared).toBe(53);
  });
});

describe("properties (T-GATE-03-U3, U4, U5, U6, U8)", () => {
  it(
    "U3: fare(d+1) >= fare(d) for durations 0..5000, one minute at a time",
    { timeout: 120_000 },
    () => {
      for (const tariffId of ["CAR-A", "BIKE-A", "FLAT-A", "NIGHT-A"]) {
        const t = requireTariff(tariffId);
        let previous = fare(t, propertyEntry, propertyEntry, t.vehicleClass);
        expect(previous).toBe(0); // a zero stay prices zero under every fixture model
        for (let d = 1; d <= 5000; d++) {
          const p = fare(t, propertyEntry, exitAfterMinutes(d), t.vehicleClass);
          expect(p >= previous, `${tariffId} d=${d}`).toBe(true);
          previous = p;
        }
      }
    },
  );

  it("U4: random stays up to 50,000 minutes price to non-negative safe integers", () => {
    // seeded PRNG (mulberry32): deterministic, no external dependency
    let seed = 0x9e3779b9;
    const nextUnitInterval = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let x = seed;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    for (const t of tariffFixtures) {
      const entry = entryFor(t);
      for (let i = 0; i < 200; i++) {
        const d = Math.floor(nextUnitInterval() * 50_000);
        const p = fare(t, entry, exitForMinutes(entry, d), t.vehicleClass);
        expect(Number.isSafeInteger(p), `${t.id} d=${d}`).toBe(true);
        expect(p >= 0).toBe(true);
      }
    }
  });

  it("U5: identical instants expressed with Z, +00:00 and +05:30 give identical fares", () => {
    const offsetIso = (ms: number, offset: string): string => {
      const shifted = new Date(ms + (offset === "+05:30" ? 330 : 0) * 60_000);
      const datePart = shifted.toISOString().slice(0, 10);
      const timePart = shifted.toISOString().slice(11, 19);
      return `${datePart}T${timePart}${offset}`;
    };
    for (const d of [0, 15, 16, 60, 61, 180, 181, 500, 900, 1440, 1500, 2000, 5000]) {
      const entryMs = propertyEntryMs;
      const exitMs = entryMs + d * 60_000;
      const inZ = fare(tariffs["CAR-A"], offsetIso(entryMs, "Z"), offsetIso(exitMs, "Z"), "Car");
      const inIst = fare(
        tariffs["CAR-A"],
        offsetIso(entryMs, "+05:30"),
        offsetIso(exitMs, "+05:30"),
        "Car",
      );
      const inUtcOffset = fare(
        tariffs["CAR-A"],
        offsetIso(entryMs, "+00:00"),
        offsetIso(exitMs, "+00:00"),
        "Car",
      );
      expect(inIst).toBe(inZ);
      expect(inUtcOffset).toBe(inZ);
    }
  });

  it("U6: a 30-day stay (43,200 min) computes in under 5 ms (no per-minute loop)", () => {
    // CAR-A-WIDE: CAR-A rules with an open effective set (CAR-A itself ends 2026-11-30).
    const t = tariffs["CAR-A-WIDE"];
    const entry = "2030-01-01T10:00:00+05:30";
    fare(t, entry, exitForMinutes(entry, 43_200), "Car"); // warm-up (JIT + schema)
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      fare(t, entry, exitForMinutes(entry, 43_200), "Car");
      best = Math.min(best, performance.now() - started);
    }
    expect(best).toBeLessThan(5);
  });

  it("U8: a deeply frozen tariff produces the same result twice without throwing", () => {
    const frozen = deepFreeze(structuredClone(tariffs["NIGHT-A"])) as Tariff;
    const a = fare(frozen, propertyEntry, exitAfterMinutes(100), "Car");
    const b = fare(frozen, propertyEntry, exitAfterMinutes(100), "Car");
    expect(a).toBe(b);
    expect(a).toBe(6000); // 100 min -> cumulative band up to 180
  });
});

describe("typed errors (T-GATE-03-U7); failures are FareError, never a silent number", () => {
  it("NO_TARIFF for a null tariff (F10-3)", () => {
    let code: string | undefined;
    try {
      fare(null, propertyEntry, exitAfterMinutes(60), "Car");
    } catch (e) {
      expect(isFareError(e)).toBe(true);
      code = (e as FareError).code;
    }
    expect(code).toBe("NO_TARIFF");
  });

  it("NO_TARIFF when the tariff is not effective on the entry's IST date (F9-5 scenario)", () => {
    let code: string | undefined;
    try {
      fare(tariffs["CAR-A"], "2026-12-01T10:00:00+05:30", "2026-12-01T11:00:00+05:30", "Car");
    } catch (e) {
      code = (e as FareError).code;
    }
    expect(code).toBe("NO_TARIFF"); // CAR-A ends 2026-11-30; 2026-12-01 entries need CAR-B
  });

  it("INVALID_RANGE for exit before entry and for unparseable instants (F10-1, F10-4)", () => {
    expect(() =>
      fare(tariffs["CAR-A"], "2026-11-10T11:00:00+05:30", "2026-11-10T10:00:00+05:30", "Car"),
    ).toThrow(FareError);
    expect(() => fare(tariffs["CAR-A"], "not-a-date", exitAfterMinutes(60), "Car")).toThrow(
      FareError,
    );
    // space-separated "local" strings must not be silently parsed as local time
    expect(() =>
      fare(tariffs["CAR-A"], "2026-11-10 10:00:00", exitAfterMinutes(60), "Car"),
    ).toThrow(FareError);
  });

  it("CLASS_MISMATCH when the vehicle class differs (F10-2)", () => {
    let code: string | undefined;
    try {
      fare(tariffs["CAR-A"], propertyEntry, exitAfterMinutes(60), "Bike");
    } catch (e) {
      code = (e as FareError).code;
    }
    expect(code).toBe("CLASS_MISMATCH");
  });

  it("INVALID_TARIFF when the tariff fails the IC-04 schema (F10-5: reject before computing)", () => {
    const invalid = { ...tariffs["CAR-A"], graceMinutes: -1 };
    let code: string | undefined;
    try {
      fare(invalid as Tariff, propertyEntry, exitAfterMinutes(60), "Car");
    } catch (e) {
      expect(isFareError(e)).toBe(true);
      code = (e as FareError).code;
    }
    expect(code).toBe("INVALID_TARIFF");
  });
});

describe("tariff schema rejections (T-GATE-03-N1 vs parseTariff)", () => {
  const base = requireTariff("CAR-A");
  const rejects = (name: string, input: unknown) =>
    it(name, () => {
      const result = parseTariff(input);
      expect(result.ok).toBe(false);
    });

  rejects("negative slab price", { ...base, slabs: [{ upToMinutes: 60, pricePaise: -5 }] });
  rejects("unsafe integer paise", {
    ...base,
    slabs: [{ upToMinutes: 60, pricePaise: Number.MAX_SAFE_INTEGER + 1 }],
  });
  rejects("unsorted slabs", {
    ...base,
    slabs: [
      { upToMinutes: 180, pricePaise: 6000 },
      { upToMinutes: 60, pricePaise: 3000 },
    ],
  });
  rejects("null (open) slab that is not the last slab", {
    ...base,
    slabs: [
      { upToMinutes: null, pricePaise: 2000 },
      { upToMinutes: 60, pricePaise: 3000 },
    ],
  });
  rejects("open-ended band without repeat (missing repeat for the open band)", {
    ...base,
    slabs: [
      { upToMinutes: 60, pricePaise: 3000 },
      { upToMinutes: null, pricePaise: 2000 },
    ],
    repeat: undefined,
  });
  rejects("no slabs", { ...base, slabs: [] });
  rejects("graceMinutes below zero (F10-5)", { ...base, graceMinutes: -1 });
  rejects("negative day cap", { ...base, dayCapPaise: -1 });
  rejects("negative minimum", { ...base, minimumPaise: -1 });
  rejects("repeat with a non-positive unit length", {
    ...base,
    repeat: { everyMinutes: 0, pricePaise: 100 },
  });
  rejects("night window HHMM out of range", {
    ...base,
    night: { fromHHMM: "2500", toHHMM: "0100" },
  });
  rejects("night window without a surcharge or multiplier", {
    ...base,
    night: { fromHHMM: "2200", toHHMM: "0600" },
  });
  rejects("night window with both multiplier and surcharge", {
    ...base,
    night: { fromHHMM: "2200", toHHMM: "0600", multiplierPercent: 10, surchargePaise: 1000 },
  });
  rejects("effectiveTo before effectiveFrom", { ...base, effectiveTo: "2026-10-31" });
  rejects("non-ISO effective date", { ...base, effectiveFrom: "2026-1-1" });
  rejects("empty vehicleClass", { ...base, vehicleClass: "" });
  rejects("a typo'd key is rejected, not silently stripped (PR #6 review item 2)", {
    ...base,
    dayCapPaisee: 30000,
  });
  rejects("id must be a uuid, not a bare config label", { ...base, id: "CAR-A" });

  it("accepts a null-ended tail when repeat is present", () => {
    const hourlyBase = requireTariff("CAR-A") as Extract<Tariff, { model: "HOURLY_SLABS" }>;
    const tailSlab: { upToMinutes: number | null; pricePaise: number } = {
      upToMinutes: null,
      pricePaise: 2400,
    };
    const twin: Tariff = { ...hourlyBase, slabs: [...hourlyBase.slabs, tailSlab] };
    expect(parseTariff(twin).ok).toBe(true);
    // The null slab only marks the open tail: pricing stays identical to CAR-A because
    // the repeat governs; the null slab's own pricePaise is documentation, not money.
    expect(fare(twin, propertyEntry, exitAfterMinutes(61), "Car")).toBe(6000);
    expect(fare(twin, propertyEntry, exitAfterMinutes(500), "Car")).toBe(
      fare(tariffs["CAR-A"], propertyEntry, exitAfterMinutes(500), "Car"),
    );
  });
});

describe("boundary behaviour beyond the table", () => {
  it("rejects a fare that would exceed the safe integer-paise range", () => {
    const flatTariff = requireTariff("FLAT-A");
    if (flatTariff.model !== "FLAT") throw new Error("FLAT-A fixture must be a flat tariff");
    const expensiveDaily: Tariff = {
      ...flatTariff,
      flatPaise: Number.MAX_SAFE_INTEGER,
    };
    expect(() =>
      fare(expensiveDaily, "2026-11-10T10:00:00+05:30", "2026-11-11T10:01:00+05:30", "Car"),
    ).toThrow(expect.objectContaining({ code: "FARE_OVERFLOW" }));
  });

  it("repeat unit ceiling: 180 -> 6000, 240 -> 8000 (one full unit), 241 -> 10000 (two units)", () => {
    expect(fare(tariffs["CAR-A"], propertyEntry, exitAfterMinutes(180), "Car")).toBe(6000);
    expect(fare(tariffs["CAR-A"], propertyEntry, exitAfterMinutes(240), "Car")).toBe(8000);
    expect(fare(tariffs["CAR-A"], propertyEntry, exitAfterMinutes(241), "Car")).toBe(10000);
  });

  it("FLAT block boundaries: 1439, 1440 and 1441 (F7 covers 1440/1441; 1439 stays one block)", () => {
    expect(fare(tariffs["FLAT-A"], propertyEntry, exitAfterMinutes(1439), "Car")).toBe(2000);
    expect(fare(tariffs["FLAT-A"], propertyEntry, exitAfterMinutes(1440), "Car")).toBe(2000);
    expect(fare(tariffs["FLAT-A"], propertyEntry, exitAfterMinutes(1441), "Car")).toBe(4000);
  });

  it("day cap equality: an uncapped price exactly at the cap is not reduced; one minute more is", () => {
    // BIKE-A uncapped: 1000 + ceil((d-120)/60) * 500; uncapped equals the 10000 cap at d = 1200.
    expect(fare(tariffs["BIKE-A"], propertyEntry, exitAfterMinutes(1140), "Bike")).toBe(9500);
    expect(fare(tariffs["BIKE-A"], propertyEntry, exitAfterMinutes(1200), "Bike")).toBe(10000);
    expect(fare(tariffs["BIKE-A"], propertyEntry, exitAfterMinutes(1201), "Bike")).toBe(10000);
  });

  it("duration rounding: 60 s -> 1 min, 80 s -> 2 min, inverted or garbage -> INVALID_RANGE", () => {
    const entry = "2026-11-10T10:00:00+05:30";
    expect(durationMinutes(entry, "2026-11-10T10:01:00+05:30")).toBe(1);
    expect(durationMinutes(entry, "2026-11-10T10:01:20+05:30")).toBe(2);
    expect(durationMinutes(entry, entry)).toBe(0);
    expect(() => durationMinutes(entry, "2026-11-10T09:59:00+05:30")).toThrow(FareError);
    expect(() => durationMinutes("nope", entry)).toThrow(FareError);
  });

  it("night window at second precision: one second inside the window adds the surcharge", () => {
    // entry 21:45:00, exit 22:00:01 -> 16 min (> grace 15); covers 1 s past 22:00:00
    expect(
      fare(tariffs["NIGHT-A"], "2026-11-10T21:45:00+05:30", "2026-11-10T22:00:01+05:30", "Car"),
    ).toBe(4000);
    // 16 min ending exactly at the window end (06:00:00.000): the stay covers 05:44:00-05:59:59.999,
    // all inside [22:00, 06:00) — that overlaps, so the surcharge applies (window end is
    // exclusive to instants AT 06:00:00, not to the stay running up to it).
    expect(
      fare(tariffs["NIGHT-A"], "2026-11-11T05:44:00+05:30", "2026-11-11T06:00:00+05:30", "Car"),
    ).toBe(4000);
    // no overlap: a 120-min stay ending one second BEFORE 22:00:00.000
    expect(
      fare(tariffs["NIGHT-A"], "2026-11-10T20:00:00+05:30", "2026-11-10T21:59:59+05:30", "Car"),
    ).toBe(6000);
    // 16 min whose final second falls before 06:00: surcharge applies
    expect(
      fare(tariffs["NIGHT-A"], "2026-11-11T05:59:59+05:30", "2026-11-11T06:15:00+05:30", "Car"),
    ).toBe(4000);
    // no overlap: a 30-min stay starting exactly AT the window end (06:00:00.000; F8-5 semantics)
    expect(
      fare(tariffs["NIGHT-A"], "2026-11-11T06:00:00+05:30", "2026-11-11T06:30:00+05:30", "Car"),
    ).toBe(3000);
  });

  it("zero stay inside the night window prices 0 and reports no surcharge", () => {
    const r = explainFare(tariffs["NIGHT-A"], propertyEntry, propertyEntry, "Car");
    expect(r.farePaise).toBe(0);
    expect(r.graceApplied).toBe(true);
    expect(r.nightOverlap).toBe(false);
    expect(r.nightPaise).toBe(0);
  });
});

describe("explainFare() (T-GATE-03 step breakdown for the Console try-it panel)", () => {
  it("blocks is empty for grace-applied results and PER_ENTRY tariffs (no block records)", () => {
    const grace = explainFare(tariffs["CAR-A"], propertyEntry, propertyEntry, "Car");
    expect(grace.graceApplied).toBe(true);
    expect(grace.blocks).toEqual([]);

    const perEntry = explainFare(
      tariffs["TRUCK-A"],
      "2026-11-10T08:00:00+05:30",
      "2026-11-13T08:00:00+05:30",
      "Truck",
    );
    expect(perEntry.farePaise).toBe(perEntry.steps[1]?.paiseAfter ?? 0); // priced once, not per day
    expect(perEntry.blocks).toEqual([]);
    expect(perEntry.steps.find((step) => step.label === "blocks")?.detail).toBe("per entry, once");
  });

  it("a capped, multi-block stay exposes blocks, cap and the build-up (F4-2 shape)", () => {
    const r = explainFare(
      tariffs["CAR-A"],
      "2026-11-10T08:00:00+05:30",
      "2026-11-11T09:00:00+05:30",
      "Car",
    );
    expect(r.farePaise).toBe(33000);
    expect(r.durationMinutes).toBe(1500);
    expect(r.blocks).toEqual([
      { index: 1, minutes: 1440, rawPaise: 48000, cappedPaise: 30000 },
      { index: 2, minutes: 60, rawPaise: 3000, cappedPaise: 3000 },
    ]);
    expect(r.minimumRaised).toBe(false);
    const last = r.steps[r.steps.length - 1];
    expect(last?.paiseAfter).toBe(33000);
  });

  it("reports the count for repeated full blocks in a multi-day breakdown (F4-5)", () => {
    const r = explainFare(
      tariffs["CAR-A"],
      "2026-11-10T08:00:00+05:30",
      "2026-11-13T08:00:00+05:30",
      "Car",
    );

    expect(r.farePaise).toBe(90000);
    expect(r.durationMinutes).toBe(4320);
    expect(r.blocks).toEqual([{ index: 1, minutes: 1440, rawPaise: 48000, cappedPaise: 30000 }]);
    expect(r.steps.find((step) => step.label === "blocks")?.detail).toBe(
      "3 full block(s) at 30000 paise",
    );
    expect(r.steps.find((step) => step.label === "blocks")?.paiseAfter).toBe(90000);
  });

  it("minimum raises the fare only when it is under the minimum (F12-2 shape)", () => {
    const r = explainFare(
      tariffs["MIN-A"],
      "2026-11-10T10:00:00+05:30",
      "2026-11-10T10:11:00+05:30",
      "Car",
    );
    expect(r.minimumRaised).toBe(true);
    expect(r.farePaise).toBe(2000);
  });

  it("night overlap is reported (F8-2 shape)", () => {
    const r = explainFare(
      tariffs["NIGHT-A"],
      "2026-11-10T21:30:00+05:30",
      "2026-11-10T22:30:00+05:30",
      "Car",
    );
    expect(r.nightOverlap).toBe(true);
    expect(r.nightPaise).toBe(1000);
    expect(r.farePaise).toBe(4000);
  });

  it("interim default for night multiplierPercent: percent of the post-cap subtotal, once", () => {
    const mult: Tariff = {
      ...requireTariff("CAR-A"),
      night: { fromHHMM: "2200", toHHMM: "0600", multiplierPercent: 10 },
    };
    expect(parseTariff(mult).ok).toBe(true);
    // 60 min -> 3000 base; overlap -> +10% = 300
    expect(fare(mult, "2026-11-10T22:30:00+05:30", "2026-11-10T23:30:00+05:30", "Car")).toBe(3300);
    expect(fare(mult, "2026-11-10T12:30:00+05:30", "2026-11-10T13:30:00+05:30", "Car")).toBe(3000);
  });
});

describe("pending-decision bookkeeping (kept outside the run until the rule owners decide)", () => {
  it("F9-4 (tariff-at-exit variant) stays skipped, with the OQ-20 reason recorded in the fixture", () => {
    const row = fareCases.find((c) => c.id === "F9-4");
    expect(row?.skip).toBe(true);
    expect(row?.skipReason).toContain("OQ-20");
    // Pin the variant's arithmetic (without the undecided rule): CAR-B prices a 90-minute stay
    // at 7000 paise for a stay that starts on 2026-12-01, so the case can be enabled unchanged
    // if OQ-20 ever flips the rule to "tariff at exit".
    expect(
      fare(tariffs["CAR-B"], "2026-12-01T00:00:00+05:30", "2026-12-01T01:30:00+05:30", "Car"),
    ).toBe(row?.expectedPaise);
  });
});
