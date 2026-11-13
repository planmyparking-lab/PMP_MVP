// CON-11 demo seed generator. Deterministic: the same SEED always gives byte-identical SQL and oracle numbers.
//
//   node supabase/seed/generate.mjs --sql      SQL on stdout (normally piped to psql by scripts/seed-demo.mjs)
//   node supabase/seed/generate.mjs --oracle   ORACLE.md on stdout
//
// Everything here is synthetic: three made-up facilities, fake staff names, plates that start with "XX-" (not an
// Indian state code), demo logins on the reserved .test domain. Nothing in this file may ever be copied to production.
//
// Time model. Events are generated for 37 fixed IST calendar days (DATASET_START .. +36). When the SQL runs it moves
// the whole data set forward or back by a WHOLE number of weeks, so that "today" lands on one of the last seven
// dataset days. Weekday and weekend patterns therefore stay on the right weekdays, the last 30 days before today are
// always full, and today is partly filled: an event is inserted only if it was received before now(). Sessions whose
// exit is still in the future simply stay open, like a real afternoon.
//
// Fares follow the tariff rule JSON (IC-04) and are cross-checked against @pmp/domain fare() in
// apps/console/test/demoSeed.test.ts.
import { pbkdf2Sync } from "node:crypto";

export const SEED = 0x504d50; // "PMP"
export const DATASET_START = "2026-10-07"; // IST date of dataset day 0 (a Wednesday)
export const DATASET_DAYS = 37;
/** Dataset days that are present and complete whatever weekday the seed is run on (see ORACLE.md). */
export const STABLE_DAYS = { from: 6, to: 29 };
export const TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MIN = 330;
const DAY = 1440;
/** Dataset day 0 at 00:00 IST, in UTC milliseconds. */
export const BASE_MS = Date.parse(`${DATASET_START}T00:00:00Z`) - IST_OFFSET_MIN * 60_000;

/** Demo logins. Local stack only; the password is public on purpose. */
export const DEMO_PASSWORD = "Demo-Parking-2026";
export const DEMO_USERS = [
  { key: "owner", email: "owner@demo.pmp.test", role: "owner", facility: null },
  {
    key: "manager",
    email: "hospital.manager@demo.pmp.test",
    role: "manager",
    facility: "hospital",
  },
];

// ---- deterministic helpers -----------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const next = mulberry32(seed);
  const rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // inclusive
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted(weights) {
      const total = weights.reduce((s, w) => s + w, 0);
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    hex: (n) => {
      let s = "";
      for (let i = 0; i < n; i++) s += Math.floor(next() * 16).toString(16);
      return s;
    },
  };
  return rng;
}

/** UUIDv7 layout (48-bit ms timestamp, version 7, variant 10) with deterministic random bits. */
function uuid7(ms, rng) {
  const ts = Math.floor(ms).toString(16).padStart(12, "0");
  const variant = (8 + rng.int(0, 3)).toString(16);
  return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-7${rng.hex(3)}-${variant}${rng.hex(3)}-${rng.hex(12)}`;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 5-character Crockford base32 short code; a bijective scramble of the counter, so codes never repeat. */
function shortCode(n) {
  let v = (n * 7_368_787 + 1_234_567) % 33_554_432; // 7368787 is odd, so this is a permutation of 0..32^5-1
  let s = "";
  for (let i = 0; i < 5; i++) {
    s = CROCKFORD[v % 32] + s;
    v = Math.floor(v / 32);
  }
  return s;
}

const pad = (n, w) => String(n).padStart(w, "0");
const minuteToMs = (m) => BASE_MS + m * 60_000;
/** Dataset day index of an absolute dataset minute (IST calendar day). */
const dayOf = (m) => Math.floor(m / DAY);
export function datasetDate(day) {
  return new Date(Date.parse(`${DATASET_START}T00:00:00Z`) + day * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
const weekdayOf = (day) => new Date(Date.parse(`${datasetDate(day)}T00:00:00Z`)).getUTCDay(); // 0 = Sunday

// ---- facilities ----------------------------------------------------------------------------------------------

const hours = (spec) => Array.from({ length: 24 }, (_, h) => spec[h] ?? 0);

/** Fixed reference data. Vehicle classes follow packages/domain fixtures ("Car", "Bike"). */
export const FACILITIES = [
  {
    key: "mall",
    code: "MA",
    name: "Demo Mall (synthetic)",
    zones: [
      { key: "car", name: "Basement B1 cars", capacity: 220, vehicleClass: "Car" },
      { key: "bike", name: "Two-wheeler deck", capacity: 120, vehicleClass: "Bike" },
    ],
    tariffs: {
      Car: {
        model: "HOURLY_SLABS",
        graceMinutes: 15,
        slabs: [
          { upToMinutes: 60, pricePaise: 4000 },
          { upToMinutes: 180, pricePaise: 8000 },
        ],
        repeat: { everyMinutes: 60, pricePaise: 3000 },
        dayCapPaise: 30000,
      },
      Bike: {
        model: "HOURLY_SLABS",
        graceMinutes: 15,
        slabs: [{ upToMinutes: 120, pricePaise: 2000 }],
        repeat: { everyMinutes: 60, pricePaise: 1000 },
        dayCapPaise: 10000,
      },
    },
    carShare: 0.65,
    // vehicles per day by weekday, Sunday first: weekend peaks
    daily: [190, 95, 90, 95, 105, 150, 210],
    weekdayHours: hours({
      10: 2,
      11: 3,
      12: 5,
      13: 6,
      14: 5,
      15: 5,
      16: 6,
      17: 8,
      18: 10,
      19: 11,
      20: 9,
      21: 5,
      22: 1,
    }),
    weekendHours: hours({
      10: 4,
      11: 6,
      12: 9,
      13: 11,
      14: 10,
      15: 9,
      16: 9,
      17: 10,
      18: 11,
      19: 10,
      20: 8,
      21: 4,
      22: 1,
    }),
    stay: (rng) =>
      rng.chance(0.08) ? rng.int(3, 14) : Math.round(45 + rng.next() * rng.next() * 300),
    staff: ["Kavya Demo-Rao", "Imran Demo-Shaikh", "Lata Demo-Pillai", "Sunil Demo-Gowda"],
    formerStaff: "Rohit Demo-Former",
  },
  {
    key: "market",
    code: "MK",
    name: "Demo Market (synthetic)",
    zones: [
      { key: "car", name: "Street lot cars", capacity: 60, vehicleClass: "Car" },
      { key: "bike", name: "Two-wheeler lane", capacity: 140, vehicleClass: "Bike" },
    ],
    tariffs: {
      Car: {
        model: "HOURLY_SLABS",
        graceMinutes: 10,
        slabs: [{ upToMinutes: 60, pricePaise: 3000 }],
        repeat: { everyMinutes: 60, pricePaise: 2000 },
        dayCapPaise: 20000,
      },
      Bike: { model: "PER_ENTRY", graceMinutes: 5, flatPaise: 1000 },
    },
    carShare: 0.35,
    daily: [80, 140, 135, 140, 145, 160, 175],
    weekdayHours: hours({
      8: 2,
      9: 5,
      10: 9,
      11: 10,
      12: 7,
      13: 5,
      14: 4,
      15: 5,
      16: 7,
      17: 10,
      18: 11,
      19: 9,
      20: 5,
      21: 1,
    }),
    weekendHours: hours({
      9: 6,
      10: 9,
      11: 10,
      12: 10,
      13: 9,
      14: 8,
      15: 8,
      16: 9,
      17: 10,
      18: 10,
      19: 8,
      20: 4,
    }),
    stay: (rng) =>
      rng.chance(0.1) ? rng.int(2, 9) : Math.round(15 + rng.next() * rng.next() * 150),
    staff: ["Pooja Demo-Nair", "Arjun Demo-Verma", "Farah Demo-Khan", "Manoj Demo-Das"],
    formerStaff: null,
  },
  {
    key: "hospital",
    code: "HS",
    name: "Demo Hospital (synthetic)",
    zones: [
      { key: "car", name: "Visitor cars", capacity: 120, vehicleClass: "Car" },
      { key: "bike", name: "Visitor two-wheelers", capacity: 80, vehicleClass: "Bike" },
    ],
    tariffs: {
      Car: { model: "FLAT", graceMinutes: 30, flatPaise: 5000 },
      Bike: { model: "FLAT", graceMinutes: 30, flatPaise: 2000 },
    },
    carShare: 0.55,
    daily: [60, 115, 105, 105, 105, 100, 80],
    weekdayHours: hours({
      0: 1,
      1: 1,
      2: 1,
      3: 1,
      4: 1,
      5: 1,
      6: 2,
      7: 4,
      8: 9,
      9: 12,
      10: 12,
      11: 11,
      12: 8,
      13: 6,
      14: 6,
      15: 6,
      16: 7,
      17: 7,
      18: 6,
      19: 5,
      20: 4,
      21: 3,
      22: 2,
      23: 1,
    }),
    weekendHours: hours({
      0: 1,
      1: 1,
      2: 1,
      3: 1,
      4: 1,
      5: 1,
      6: 1,
      7: 2,
      8: 4,
      9: 6,
      10: 7,
      11: 7,
      12: 6,
      13: 5,
      14: 5,
      15: 6,
      16: 7,
      17: 7,
      18: 6,
      19: 5,
      20: 4,
      21: 3,
      22: 2,
      23: 1,
    }),
    stay: (rng) =>
      rng.chance(0.05)
        ? rng.int(5, 29)
        : rng.chance(0.02)
          ? rng.int(18 * 60, 30 * 60)
          : Math.round(30 + rng.next() * rng.next() * 420),
    staff: ["Neha Demo-Joshi", "Vikram Demo-Singh", "Anita Demo-Fernandes", "Karan Demo-Mehta"],
    formerStaff: null,
  },
];

/** Fixed demo PINs, documented here only (CON-11). Never reuse them anywhere real. */
const STAFF_PINS = ["1111", "2222", "3333", "4444", "5555"];
const PIN_ITERATIONS = 100_000;

// ---- fare (IC-04 subset used by the demo tariffs: no night window, no minimum) --------------------------------

function priceBlock(t, minutes) {
  if (t.model === "FLAT") return t.flatPaise;
  for (const s of t.slabs)
    if (s.upToMinutes !== null && minutes <= s.upToMinutes) return s.pricePaise;
  const last = t.slabs[t.slabs.length - 1];
  return (
    last.pricePaise +
    Math.ceil((minutes - last.upToMinutes) / t.repeat.everyMinutes) * t.repeat.pricePaise
  );
}

/** Fare in integer paise for a stay of whole `minutes` (cross-checked against @pmp/domain fare() in the console tests). */
export function fareFor(t, minutes) {
  if (minutes <= t.graceMinutes) return 0;
  if (t.model === "PER_ENTRY") return t.flatPaise;
  const cap = (raw) => (t.dayCapPaise === undefined ? raw : Math.min(raw, t.dayCapPaise));
  const full = Math.floor(minutes / DAY);
  const rem = minutes % DAY;
  let total = full > 0 ? cap(priceBlock(t, DAY)) * full : 0;
  if (rem > 0) total += cap(priceBlock(t, rem));
  return total;
}

// ---- generation ----------------------------------------------------------------------------------------------

const TYPE_ORDER = {
  SHIFT_CLOSE: 0,
  SHIFT_OPEN: 1,
  ENTRY: 2,
  EXIT: 3,
  OVERRIDE: 4,
  PAYMENT: 5,
  ZONE_COUNT: 6,
};
const DAY_SHIFT = { start: 8 * 60, end: 20 * 60 };
const FIXTURE_DAYS = { duplicateExit: 24, orphanExit: 25, badShift: 26 };
/** Cash missing at the close of the bad-variance shift (₹500). */
const SHORTAGE_PAISE = 50000;
/** Entries that never exit. Placed early enough that they are over any threshold up to 14 hours, whenever run. */
const STUCK_ENTRIES = [
  { day: 28, minute: 18 * 60, plate: true },
  { day: 28, minute: 21 * 60 + 30, plate: true },
  { day: 29, minute: 10 * 60, plate: false },
];

export function generate(seed = SEED) {
  const rng = makeRng(seed);
  const idAt = (m) => uuid7(minuteToMs(m) + rng.int(0, 59_999), rng);
  const refId = () => uuid7(BASE_MS - 30 * 86_400_000, rng);

  const org = { id: refId(), name: "Demo Parking Co (synthetic)" };
  const users = DEMO_USERS.map((u) => ({ ...u, id: refId() }));
  const facilities = [];
  const events = [];
  const fixtures = [];
  let codeCounter = 1;

  const push = (e) => events.push({ ...e, order: events.length });

  for (const spec of FACILITIES) {
    // Built in this order on purpose: the ids come from the shared random stream, so reordering changes every id.
    const facilityId = refId();
    const zones = spec.zones.map((z) => ({ ...z, id: refId() }));
    const zoneByClass = Object.fromEntries(zones.map((z) => [z.vehicleClass, z]));
    const tariffs = Object.fromEntries(
      Object.entries(spec.tariffs).map(([cls, rule]) => {
        const id = refId();
        return [
          cls,
          {
            id,
            rule: { id, facilityId, vehicleClass: cls, effectiveFrom: "2026-01-01", ...rule },
          },
        ];
      }),
    );
    const staffNames = [...spec.staff, ...(spec.formerStaff ? [spec.formerStaff] : [])];
    const staff = staffNames.map((name, i) => {
      const salt = rng.hex(32);
      const hash = pbkdf2Sync(STAFF_PINS[i], salt, PIN_ITERATIONS, 32, "sha256").toString("hex");
      return {
        id: refId(),
        name,
        active: name !== spec.formerStaff,
        pinSalt: salt,
        pinHash: `pbkdf2-sha256$${PIN_ITERATIONS}$${hash}`,
      };
    });
    // 0 entry guard day, 1 entry guard night, 2 cashier day, 3 cashier night
    const [entryDay, entryNight, cashDay, cashNight] = staff;
    const devices = [
      { id: refId(), name: "Entry gate phone", revoked: false },
      { id: refId(), name: "Exit gate phone", revoked: false },
      ...(spec.key === "mall"
        ? [{ id: refId(), name: "Spare phone (revoked)", revoked: true }]
        : []),
    ];
    const [entryDevice, exitDevice] = devices;
    const passes = [1, 2, 3, 4, 5, 6].map((n) => ({
      id: refId(),
      vehicleNo: `XX-${spec.code}-P${pad(n, 3)}`,
      validTo: n === 5 ? "2026-09-30" : "2027-03-31", // P005 expired before the data set starts
      dues: n === 6 ? 50000 : 0,
      vehicleClass: n % 3 === 0 ? "Bike" : "Car",
    }));
    const f = {
      spec,
      id: facilityId,
      slotCount: spec.zones.reduce((sum, z) => sum + z.capacity, 0),
      zones,
      zoneByClass,
      tariffs,
      staff,
      devices,
      passes,
    };
    facilities.push(f);

    const isDay = (m) => {
      const t = ((m % DAY) + DAY) % DAY;
      return t >= DAY_SHIFT.start && t < DAY_SHIFT.end;
    };
    const entryStaff = (m) => (isDay(m) ? entryDay : entryNight);
    const cashStaff = (m) => (isDay(m) ? cashDay : cashNight);

    let plateCounter = 1;
    const sessions = [];

    const addSession = ({ entryAt, stay, vehicleClass, plate, pass, exitMethod, extra }) => {
      const sessionId = idAt(entryAt);
      const zone = f.zoneByClass[vehicleClass];
      const tariff = f.tariffs[vehicleClass];
      const entry = {
        facility: f.id,
        device: entryDevice.id,
        staff: entryStaff(entryAt).id,
        type: "ENTRY",
        session: sessionId,
        minute: entryAt,
        id: idAt(entryAt),
        payload: {
          vehicle_class: vehicleClass,
          zone_id: zone.id,
          short_code: shortCode(codeCounter++),
          ...(plate ? { vehicle_no: plate } : {}),
          ...(pass ? { pass_id: pass.id } : {}),
        },
      };
      push(entry);
      const s = {
        sessionId,
        entryAt,
        exitAt: stay === null ? null : entryAt + stay,
        zone,
        plate,
        pass,
        entry,
      };
      sessions.push(s);
      if (stay === null) return s;

      const exitAt = entryAt + stay;
      const fare = pass ? 0 : fareFor(tariff.rule, stay);
      const exit = {
        facility: f.id,
        device: exitDevice.id,
        staff: cashStaff(exitAt).id,
        type: "EXIT",
        session: sessionId,
        minute: exitAt,
        id: idAt(exitAt),
        payload: {
          fare_paise: fare,
          exit_method: exitMethod,
          tariff_id: tariff.id,
          tariff_version: 1,
        },
      };
      push(exit);
      s.exit = exit;
      s.fare = fare;
      extra?.(s);
      return s;
    };

    const pay = (s, at, mode, amount) =>
      push({
        facility: f.id,
        device: exitDevice.id,
        staff: cashStaff(at).id,
        type: "PAYMENT",
        session: s.sessionId,
        minute: at,
        id: idAt(at),
        payload: { mode, amount_paise: amount, upi_attested: mode === "UPI" },
      });

    const override = (s, at, reason, note, change) =>
      push({
        facility: f.id,
        device: exitDevice.id,
        staff: cashStaff(at).id,
        type: "OVERRIDE",
        session: s.sessionId,
        minute: at,
        id: idAt(at),
        payload: {
          target_event_id: s.exit.id,
          reason_code: reason,
          ...(note ? { note } : {}),
          ...(change ? { change } : {}),
        },
      });

    const settle = (s) => {
      if (s.pass) return pay(s, s.exitAt, "PASS", 0);
      const roll = rng.next();
      if (s.fare > 0 && roll < 0.006) {
        override(s, s.exitAt + 1, "OWNER_WAIVER", "Waived by owner (demo)", { fare_paise: 0 });
        return pay(s, s.exitAt + 2, "WAIVED", 0);
      }
      if (s.fare > 0 && roll < 0.01) {
        override(s, s.exitAt + 1, "STAFF_VEHICLE", "Staff vehicle (demo)", { fare_paise: 0 });
        return pay(s, s.exitAt + 2, "WAIVED", 0);
      }
      if (roll < 0.016)
        override(s, s.exitAt + 1, "MISREAD_NUMBER", "Plate corrected at exit (demo)");
      else if (roll < 0.02) override(s, s.exitAt + 1, "OTHER", "Barrier stuck, manual exit (demo)");
      if (s.fare === 0) return undefined; // grace stay: nothing to collect
      const at = s.exitAt + (roll < 0.02 ? 2 : 0);
      return pay(s, at, rng.chance(0.55) ? "CASH" : "UPI", s.fare);
    };

    // Regular traffic
    for (let day = 0; day < DATASET_DAYS; day++) {
      const wd = weekdayOf(day);
      const weekend = wd === 0 || wd === 6;
      const curve = weekend ? spec.weekendHours : spec.weekdayHours;
      const count = Math.round(spec.daily[wd] * (0.9 + rng.next() * 0.2));
      const arrivals = Array.from(
        { length: count },
        () => day * DAY + rng.weighted(curve) * 60 + rng.int(0, 59),
      ).sort((a, b) => a - b);
      for (const entryAt of arrivals) {
        const vehicleClass = rng.chance(spec.carShare) ? "Car" : "Bike";
        const plate = rng.chance(0.7) ? `XX-${spec.code}-${pad(plateCounter++, 4)}` : null;
        const roll = rng.next();
        const lostToken = roll < 0.004;
        const exitMethod = lostToken
          ? "LOOKUP"
          : roll < 0.8
            ? "SCAN"
            : roll < 0.95
              ? "CODE"
              : "LOOKUP";
        addSession({
          entryAt,
          stay: spec.stay(rng),
          vehicleClass,
          plate,
          pass: null,
          exitMethod,
          extra: (s) => {
            if (lostToken) {
              override(s, s.exitAt + 1, "LOST_TOKEN", "Token lost, found by plate lookup (demo)");
              if (s.fare > 0) pay(s, s.exitAt + 2, rng.chance(0.55) ? "CASH" : "UPI", s.fare);
            } else settle(s);
          },
        });
      }
      // Pass holders: at most one visit a day, always leave the same day, so a plate is never open twice.
      for (const pass of f.passes) {
        if (pass.validTo < datasetDate(day) || weekend || !rng.chance(0.7)) continue;
        const entryAt = day * DAY + rng.int(8 * 60, 11 * 60);
        const stay = rng.int(2 * 60, Math.min(9 * 60, DAY - (entryAt % DAY) - 30));
        addSession({
          entryAt,
          stay,
          vehicleClass: pass.vehicleClass,
          plate: pass.vehicleNo,
          pass,
          exitMethod: "SCAN",
          extra: settle,
        });
      }
    }

    // Fixture: duplicate exit (a second phone also exits the same session two minutes later)
    {
      const at = FIXTURE_DAYS.duplicateExit * DAY + 11 * 60;
      const s = addSession({
        entryAt: at,
        stay: 125,
        vehicleClass: "Car",
        plate: `XX-${spec.code}-D001`,
        pass: null,
        exitMethod: "SCAN",
        extra: (x) => pay(x, x.exitAt, "CASH", x.fare),
      });
      const dup = {
        facility: f.id,
        device: entryDevice.id,
        staff: entryDay.id,
        type: "EXIT",
        session: s.sessionId,
        minute: s.exitAt + 2,
        id: idAt(s.exitAt + 2),
        payload: { ...s.exit.payload, exit_method: "CODE" },
      };
      push(dup);
      fixtures.push({
        facility: spec.key,
        kind: "DUPLICATE_EXIT",
        session: s.sessionId,
        events: [s.exit.id, dup.id],
        date: datasetDate(FIXTURE_DAYS.duplicateExit),
      });
    }
    // Fixture: orphan exit (no ENTRY was ever recorded for this session)
    {
      const at = FIXTURE_DAYS.orphanExit * DAY + 15 * 60 + 20;
      const sessionId = idAt(at);
      const ghost = { sessionId, exitAt: at };
      ghost.exit = {
        facility: f.id,
        device: exitDevice.id,
        staff: cashStaff(at).id,
        type: "EXIT",
        session: sessionId,
        minute: at,
        id: idAt(at),
        payload: {
          fare_paise: f.tariffs.Car.rule.model === "FLAT" ? f.tariffs.Car.rule.flatPaise : 6000,
          exit_method: "LOOKUP",
          tariff_id: f.tariffs.Car.id,
          tariff_version: 1,
        },
      };
      push(ghost.exit);
      pay(ghost, at, "CASH", ghost.exit.payload.fare_paise);
      fixtures.push({
        facility: spec.key,
        kind: "ORPHAN_EXIT",
        session: sessionId,
        events: [ghost.exit.id],
        date: datasetDate(FIXTURE_DAYS.orphanExit),
      });
    }
    // Fixture: open sessions over the overstay threshold
    STUCK_ENTRIES.forEach((st, i) => {
      const s = addSession({
        entryAt: st.day * DAY + st.minute,
        stay: null,
        vehicleClass: i === 2 ? "Bike" : "Car",
        plate: st.plate ? `XX-${spec.code}-S${pad(i + 1, 3)}` : null,
        pass: null,
        exitMethod: "SCAN",
      });
      fixtures.push({
        facility: spec.key,
        kind: "OPEN_OVER_THRESHOLD",
        session: s.sessionId,
        events: [s.entry.id],
        date: datasetDate(st.day),
      });
    });

    // Shifts of the exit (cash) phone: day 08:00-20:00, night 20:00-08:00. Cash and UPI are summed from PAYMENTs.
    for (let k = -1; k < DATASET_DAYS; k++) {
      for (const night of [false, true]) {
        if (k === -1 && !night) continue;
        const start = k * DAY + (night ? DAY_SHIFT.end : DAY_SHIFT.start);
        const end = start + 12 * 60;
        const openAt = Math.max(start, 0);
        const cashier = night ? cashNight : cashDay;
        const shiftId = idAt(openAt);
        const float = night ? 100000 : 200000;
        push({
          facility: f.id,
          device: exitDevice.id,
          staff: cashier.id,
          type: "SHIFT_OPEN",
          session: null,
          minute: openAt,
          id: idAt(openAt),
          payload: { shift_id: shiftId, opening_float_paise: float },
        });
        let cash = 0;
        let upi = 0;
        for (const e of events) {
          if (e.facility !== f.id || e.type !== "PAYMENT" || e.minute < start || e.minute >= end)
            continue;
          if (e.payload.mode === "CASH") cash += e.payload.amount_paise;
          if (e.payload.mode === "UPI") upi += e.payload.amount_paise;
        }
        const bad = !night && k === FIXTURE_DAYS.badShift;
        const counted = bad ? Math.max(0, cash - SHORTAGE_PAISE) : cash;
        const close = {
          facility: f.id,
          device: exitDevice.id,
          staff: cashier.id,
          type: "SHIFT_CLOSE",
          session: null,
          minute: end,
          id: idAt(end),
          payload: {
            shift_id: shiftId,
            counted_cash_paise: counted,
            expected_cash_paise: cash, // cash collected in the shift; the opening float is not included
            upi_total_declared_paise: upi,
            upi_attested_sum_paise: upi,
            variance_cash_paise: counted - cash, // counted minus expected; the sign convention is still open (contracts)
            variance_upi_paise: 0,
            ...(bad ? { reason: "Cash short at handover (demo fixture)" } : {}),
          },
        };
        push(close);
        if (bad)
          fixtures.push({
            facility: spec.key,
            kind: "BAD_SHIFT_VARIANCE",
            session: null,
            shift: shiftId,
            events: [close.id],
            date: datasetDate(k),
            variance: counted - cash,
          });
      }
    }

    // Daily zone count at 15:00 by the entry guard: system count is the generated occupancy, counted is usually equal.
    for (let day = 0; day < DATASET_DAYS; day++) {
      const at = day * DAY + 15 * 60;
      for (const zone of f.zones) {
        const inside = sessions.filter(
          (s) => s.zone === zone && s.entryAt <= at && (s.exitAt === null || s.exitAt > at),
        ).length;
        const counted = rng.chance(0.15)
          ? Math.max(0, inside + rng.pick([-3, -2, -1, 1, 2]))
          : inside;
        push({
          facility: f.id,
          device: entryDevice.id,
          staff: entryStaff(at).id,
          type: "ZONE_COUNT",
          session: null,
          minute: at,
          id: idAt(at),
          payload: { zone_id: zone.id, counted, system_count_at_time: inside },
        });
      }
    }
  }

  // Chronological insert order (the triggers rely on ENTRY before EXIT), stable within one minute.
  events.sort(
    (a, b) => a.minute - b.minute || TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.order - b.order,
  );
  for (const e of events) e.delayS = 2 + Math.floor(rng.next() * 38); // phone to cloud delay, seconds
  return { org, users, facilities, events, fixtures };
}

// ---- oracle --------------------------------------------------------------------------------------------------

/** Per facility and dataset day: vehicles (ENTRY), exits, overrides, payments by mode (by IST day of the event). */
export function oracle(data) {
  const byFacility = new Map();
  for (const f of data.facilities) {
    const days = Array.from({ length: DATASET_DAYS }, (_, d) => ({
      day: d,
      date: datasetDate(d),
      vehicles: 0,
      exits: 0,
      overrides: 0,
      cash: 0,
      upi: 0,
      pass: 0,
      waived: 0,
      revenue: 0,
    }));
    byFacility.set(f.id, { facility: f, days });
  }
  for (const e of data.events) {
    const d = byFacility.get(e.facility).days[dayOf(e.minute)];
    if (!d) continue;
    if (e.type === "ENTRY") d.vehicles++;
    else if (e.type === "EXIT") d.exits++;
    else if (e.type === "OVERRIDE") d.overrides++;
    else if (e.type === "PAYMENT") {
      const key = { CASH: "cash", UPI: "upi", PASS: "pass", WAIVED: "waived" }[e.payload.mode];
      d[key] += e.payload.amount_paise;
      d.revenue += e.payload.amount_paise;
    }
  }
  return [...byFacility.values()].map(({ facility, days }) => {
    const stable = days.filter((d) => d.day >= STABLE_DAYS.from && d.day <= STABLE_DAYS.to);
    const sum = (k) => stable.reduce((s, d) => s + d[k], 0);
    return {
      key: facility.spec.key,
      name: facility.spec.name,
      id: facility.id,
      days,
      stable: {
        vehicles: sum("vehicles"),
        exits: sum("exits"),
        overrides: sum("overrides"),
        cash: sum("cash"),
        upi: sum("upi"),
        revenue: sum("revenue"),
      },
    };
  });
}

const rupees = (p) =>
  `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function oracleMarkdown(data) {
  const o = oracle(data);
  const L = [];
  L.push("# Demo seed oracle (CON-11)");
  L.push("");
  L.push(
    "Generated by `node supabase/seed/generate.mjs --oracle`. Do not edit by hand: change the generator and regenerate.",
  );
  L.push(`Seed \`${SEED}\`. All amounts are integer paise; rupees are shown for reading only.`);
  L.push("");
  L.push("## How dates work");
  L.push("");
  L.push(
    `The generator writes ${DATASET_DAYS} fixed IST days, ${datasetDate(0)} to ${datasetDate(DATASET_DAYS - 1)}. When the seed runs, the whole`,
  );
  L.push(
    "data set moves by a whole number of weeks so that today is one of the last seven dataset days. Events received after",
  );
  L.push(
    "the moment of the run are left out, so today is only partly filled and its numbers depend on the time of the run.",
  );
  L.push("");
  L.push(
    "The shift is stored in the demo organisation: `organizations.created_at` is dataset day 0 after the shift. So the",
  );
  L.push("dataset date of any event is its IST date minus that shift (see the query below).");
  L.push("");
  L.push(
    `Dataset days ${STABLE_DAYS.from} to ${STABLE_DAYS.to} (${datasetDate(STABLE_DAYS.from)} to ${datasetDate(STABLE_DAYS.to)}) are present and complete on`,
  );
  L.push(
    "every run, whatever the weekday. The oracle totals use that window. `pnpm seed:demo` checks them after loading.",
  );
  L.push("");
  L.push(`## Totals, dataset days ${STABLE_DAYS.from} to ${STABLE_DAYS.to}`);
  L.push("");
  L.push(
    "| Facility | Vehicles (ENTRY) | Exits | Overrides | Cash | UPI | Revenue (paise) | Revenue |",
  );
  L.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const f of o) {
    const s = f.stable;
    L.push(
      `| ${f.name} | ${s.vehicles} | ${s.exits} | ${s.overrides} | ${s.cash} | ${s.upi} | ${s.revenue} | ${rupees(s.revenue)} |`,
    );
  }
  L.push("");
  L.push(
    "Revenue is the sum of PAYMENT `amount_paise` (PASS and WAIVED payments are 0). Days are IST calendar days of `device_time`.",
  );
  L.push("");
  L.push("## Edge fixtures (every facility)");
  L.push("");
  L.push("| Facility | Fixture | Dataset date | Expected result |");
  L.push("| --- | --- | --- | --- |");
  const expect = {
    DUPLICATE_EXIT: "one OPEN `sync_conflicts` row of type DUPLICATE_EXIT with both exit ids",
    ORPHAN_EXIT: "one OPEN `sync_conflicts` row of type ORPHAN_EXIT",
    OPEN_OVER_THRESHOLD: "row in `open_sessions`, over a 240-minute threshold on every run",
    BAD_SHIFT_VARIANCE: "day-shift SHIFT_CLOSE with a reason and `variance_cash_paise` =",
  };
  for (const x of data.fixtures) {
    const tail = x.kind === "BAD_SHIFT_VARIANCE" ? ` ${x.variance}` : "";
    L.push(`| ${x.facility} | ${x.kind} | ${x.date} | ${expect[x.kind]}${tail} |`);
  }
  L.push("");
  L.push(
    "No other conflict types are expected: plates never overlap (no DUPLICATE_ENTRY) and no event is dated ahead of",
  );
  L.push("its receipt (no CLOCK_SKEW).");
  L.push("");
  L.push("## Reproduce with SQL");
  L.push("");
  L.push("```sql");
  L.push(ORACLE_SQL.trim());
  L.push("```");
  L.push("");
  L.push("## Per day");
  for (const f of o) {
    L.push("");
    L.push(`### ${f.name}`);
    L.push("");
    L.push("| Day | Date | Weekday | Vehicles | Exits | Overrides | Revenue (paise) |");
    L.push("| ---: | --- | --- | ---: | ---: | ---: | ---: |");
    for (const d of f.days) {
      const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayOf(d.day)];
      L.push(
        `| ${d.day} | ${d.date} | ${wd} | ${d.vehicles} | ${d.exits} | ${d.overrides} | ${d.revenue} |`,
      );
    }
  }
  L.push("");
  return L.join("\n");
}

/** Oracle totals straight from the database (window = STABLE_DAYS, in dataset dates). */
export const ORACLE_SQL = `
with shift as (
  select o.id as org_id,
         (o.created_at at time zone '${TIMEZONE}')::date - date '${DATASET_START}' as days
  from public.organizations o where o.name = 'Demo Parking Co (synthetic)'
)
select f.name,
       count(*) filter (where e.type = 'ENTRY') as vehicles,
       count(*) filter (where e.type = 'EXIT') as exits,
       count(*) filter (where e.type = 'OVERRIDE') as overrides,
       coalesce(sum((e.payload ->> 'amount_paise')::bigint) filter (where e.payload ->> 'mode' = 'CASH'), 0) as cash,
       coalesce(sum((e.payload ->> 'amount_paise')::bigint) filter (where e.payload ->> 'mode' = 'UPI'), 0) as upi,
       coalesce(sum((e.payload ->> 'amount_paise')::bigint) filter (where e.type = 'PAYMENT'), 0) as revenue
from public.events e
join public.facilities f on f.id = e.facility_id
join shift s on s.org_id = f.org_id
where (e.device_time at time zone '${TIMEZONE}')::date - s.days
      between date '${datasetDate(STABLE_DAYS.from)}' and date '${datasetDate(STABLE_DAYS.to)}'
group by f.name
order by f.name;
`;

// ---- SQL -----------------------------------------------------------------------------------------------------

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const j = (v) => `${q(JSON.stringify(v))}::jsonb`;

export function toSql(data) {
  const { org, users, facilities, events } = data;
  const facIds = facilities.map((f) => q(f.id)).join(", ");
  const userIds = users.map((u) => q(u.id)).join(", ");
  const out = [];
  out.push(
    `-- CON-11 demo seed. GENERATED by supabase/seed/generate.mjs (seed ${SEED}); do not edit by hand.`,
  );
  out.push("-- Synthetic data only. Load it with: pnpm seed:demo (local Supabase stack only).");
  out.push("begin;");
  out.push(`do $guard$
begin
  if coalesce(current_setting('pmp.demo_seed', true), '') <> 'local-only' then
    raise exception 'demo seed refused: load it with pnpm seed:demo against the local Supabase stack only';
  end if;
  if exists (select 1 from public.facilities f join public.organizations o on o.id = f.org_id
             where o.name = ${q(org.name)} and o.id <> ${q(org.id)}) then
    raise exception 'demo seed refused: another organisation already uses the demo name';
  end if;
end
$guard$;`);
  // Reset: remove only the demo rows (by facility id, organisation id and demo user id), children first.
  out.push(`do $reset$
declare
  fac uuid[] := array[${facIds}]::uuid[];
  t text;
begin
  foreach t in array array['shift_reviews', 'device_heartbeats', 'enrollment_codes', 'sync_conflicts', 'open_sessions',
                           'events', 'devices', 'staff', 'passes', 'tariffs', 'zones'] loop
    if to_regclass('public.' || t) is not null and exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = t and column_name = 'facility_id') then
      execute format('delete from public.%I where facility_id = any ($1)', t) using fac;
    end if;
  end loop;
  delete from public.memberships where org_id = ${q(org.id)} or user_id in (${userIds});
  delete from public.facilities where id = any (fac);
  delete from public.organizations where id = ${q(org.id)};
  delete from auth.users where id in (${userIds}) or email like '%@demo.pmp.test';
end
$reset$;`);

  // The shift (whole weeks) is fixed once, stored on the organisation, and read back by every later statement.
  out.push(`insert into public.organizations (id, name, created_at)
select ${q(org.id)}, ${q(org.name)},
       timestamptz '${DATASET_START} 00:00:00+05:30'
       + make_interval(days => 7 * floor((((now() at time zone '${TIMEZONE}')::date - date '${DATASET_START}') - 30) / 7.0)::int);`);
  out.push(`create temp table demo_shift as
select created_at as day0 from public.organizations where id = ${q(org.id)};`);

  const rows = (table, cols, list) =>
    `insert into ${table} (${cols.join(", ")}) values\n${list.map((r) => `  (${r.join(", ")})`).join(",\n")};`;
  out.push(
    rows(
      "public.facilities",
      ["id", "org_id", "name", "timezone", "slot_count", "created_at"],
      facilities.map((f) => [
        q(f.id),
        q(org.id),
        q(f.spec.name),
        q(TIMEZONE),
        f.slotCount,
        "(select day0 from demo_shift)",
      ]),
    ),
  );
  out.push(
    rows(
      "public.zones",
      ["id", "facility_id", "name", "capacity", "vehicle_class"],
      facilities.flatMap((f) =>
        f.zones.map((z) => [q(z.id), q(f.id), q(z.name), z.capacity, q(z.vehicleClass)]),
      ),
    ),
  );
  out.push(
    rows(
      "public.tariffs",
      ["id", "facility_id", "vehicle_class", "rule_json", "effective_from"],
      facilities.flatMap((f) =>
        Object.entries(f.tariffs).map(([cls, t]) => [
          q(t.id),
          q(f.id),
          q(cls),
          j(t.rule),
          "timestamptz '2026-01-01 00:00:00+05:30'",
        ]),
      ),
    ),
  );
  out.push(
    rows(
      "public.passes",
      ["id", "facility_id", "vehicle_no", "valid_to", "dues"],
      facilities.flatMap((f) =>
        f.passes.map((p) => [q(p.id), q(f.id), q(p.vehicleNo), `date ${q(p.validTo)}`, p.dues]),
      ),
    ),
  );
  out.push(
    rows(
      "public.staff",
      ["id", "facility_id", "name", "pin_hash", "pin_salt", "active", "created_at"],
      facilities.flatMap((f) =>
        f.staff.map((s) => [
          q(s.id),
          q(f.id),
          q(s.name),
          q(s.pinHash),
          q(s.pinSalt),
          s.active,
          "(select day0 from demo_shift)",
        ]),
      ),
    ),
  );
  out.push(
    rows(
      "public.devices",
      ["id", "facility_id", "name", "enrolled_at", "revoked_at"],
      facilities.flatMap((f) =>
        f.devices.map((d) => [
          q(d.id),
          q(f.id),
          q(d.name),
          "(select day0 from demo_shift)",
          d.revoked ? "(select day0 from demo_shift) + interval '20 days'" : "null",
        ]),
      ),
    ),
  );

  for (const u of users) {
    out.push(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', ${q(u.id)}, 'authenticated', 'authenticated', ${q(u.email)},
  extensions.crypt(${q(DEMO_PASSWORD)}, extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
values (${q(u.id)}, ${q(u.id)}, ${q(u.id)}, 'email', ${j({ sub: u.id, email: u.email, email_verified: true })}, now(), now(), now());`);
  }
  out.push(
    rows(
      "public.memberships",
      ["user_id", "org_id", "facility_id", "role"],
      users.map((u) => [
        q(u.id),
        q(org.id),
        u.facility ? q(facilities.find((f) => f.spec.key === u.facility).id) : "null",
        q(u.role),
      ]),
    ),
  );

  // Events: staged in a temp table, then inserted one by one in time order so the triggers see a real sequence.
  out.push(`create temp table demo_events (
  seq integer primary key, id uuid, facility_id uuid, device_id uuid, staff_id uuid, type text, session_id uuid,
  payload jsonb, minute integer, delay_s integer);`);
  for (let i = 0; i < events.length; i += 1000) {
    out.push(
      rows(
        "demo_events",
        [
          "seq",
          "id",
          "facility_id",
          "device_id",
          "staff_id",
          "type",
          "session_id",
          "payload",
          "minute",
          "delay_s",
        ],
        events
          .slice(i, i + 1000)
          .map((e, k) => [
            i + k,
            q(e.id),
            q(e.facility),
            q(e.device),
            q(e.staff),
            q(e.type),
            q(e.session),
            j(e.payload),
            e.minute,
            e.delayS,
          ]),
      ),
    );
  }
  // Committed in batches: each event takes transaction-scoped advisory locks (0005/0006), and ~40k of them in one
  // transaction exhaust the lock table. A failed run leaves partial demo rows; running the seed again replaces them.
  out.push("commit;");
  out.push(`do $events$
declare
  r record;
  day0 timestamptz := (select day0 from demo_shift);
  t timestamptz;
  n integer := 0;
begin
  if coalesce(current_setting('pmp.demo_seed', true), '') <> 'local-only' then
    raise exception 'demo seed refused: load it with pnpm seed:demo against the local Supabase stack only';
  end if;
  for r in select * from demo_events order by seq loop
    t := day0 + make_interval(mins => r.minute);
    continue when t + make_interval(secs => r.delay_s) > now();
    insert into public.events (id, facility_id, device_id, staff_id, type, session_id, payload, device_time, received_at,
                               source, schema_version)
    values (r.id, r.facility_id, r.device_id, r.staff_id, r.type, r.session_id, r.payload, t,
            t + make_interval(secs => r.delay_s), 'LIVE', 1);
    n := n + 1;
    if n % 500 = 0 then
      commit;
    end if;
  end loop;
  raise notice 'demo seed: % events inserted, dataset day 0 = %', n, (day0 at time zone '${TIMEZONE}')::date;
end
$events$;`);
  return out.join("\n\n") + "\n";
}

if (process.argv[1] && process.argv[1].endsWith("generate.mjs")) {
  const data = generate();
  if (process.argv.includes("--oracle")) process.stdout.write(oracleMarkdown(data));
  else if (process.argv.includes("--sql")) process.stdout.write(toSql(data));
  else {
    process.stderr.write("usage: node supabase/seed/generate.mjs --sql | --oracle\n");
    process.exitCode = 2;
  }
}
