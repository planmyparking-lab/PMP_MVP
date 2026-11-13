// Event generator for the ingest load test (T-CLD-10-X1, T-CLD-05-X1). Plain ES module with no imports, so the same file
// runs under Node (tools/load/events.test.mjs) and under k6 (tools/load/ingest.k6.js). It builds IC-01 event envelopes
// (docs/integrations/event-envelope.md) for one simulated enrolled device: ENTRY, EXIT, PAYMENT, repeated, one event
// per step. Everything is deterministic for a given seed, so a run can be reproduced.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // no I, L, O, U: matches the short_code rule in the contract
const VARIANT = "89ab";

/** Small seeded PRNG (mulberry32). Returns a function giving floats in [0, 1). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (rng, digits) => {
  let out = "";
  for (let i = 0; i < digits; i++) out += Math.floor(rng() * 16).toString(16);
  return out;
};

/** UUID version 7: 48-bit millisecond timestamp, version nibble 7, variant 8-b, the rest random. */
export function uuidv7(ms, rng) {
  const time = Math.floor(ms).toString(16).padStart(12, "0");
  const variant = VARIANT[Math.floor(rng() * 4)];
  return `${time.slice(0, 8)}-${time.slice(8)}-7${hex(rng, 3)}-${variant}${hex(rng, 3)}-${hex(rng, 12)}`;
}

/** A 5-character Crockford base32 token, the short_code of an ENTRY. */
export function shortCode(rng) {
  let out = "";
  for (let i = 0; i < 5; i++) out += CROCKFORD[Math.floor(rng() * CROCKFORD.length)];
  return out;
}

/** UTC ISO 8601 with seconds and a literal Z (the contract's `z.iso.datetime()` form), no fraction. */
export function utcTime(ms) {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

/**
 * One simulated enrolled device. `next()` returns the next event of the cycle ENTRY -> EXIT -> PAYMENT (one parking
 * session per three events), with `device_time` advancing by `stepMs` per event. `facilityId`, `deviceId` and `staffId`
 * must be the device's own enrolled values and an active staff member, or `ingest_events` rejects the event
 * (CLAIM_MISMATCH, STAFF_NOT_ACTIVE).
 */
export class DeviceSim {
  constructor({
    seed,
    facilityId,
    deviceId,
    staffId,
    zoneId,
    startMs,
    stepMs = 5000,
    vehicleClass = "CAR",
  }) {
    this.rng = makeRng(seed);
    this.facilityId = facilityId;
    this.deviceId = deviceId;
    this.staffId = staffId;
    this.zoneId = zoneId;
    this.startMs = startMs;
    this.stepMs = stepMs;
    this.vehicleClass = vehicleClass;
    this.count = 0;
    this.session = null;
    this.fare = 0;
  }

  next() {
    const ms = this.startMs + this.count * this.stepMs;
    const phase = this.count % 3;
    this.count += 1;
    const base = {
      id: uuidv7(ms, this.rng),
      facility_id: this.facilityId,
      device_id: this.deviceId,
      staff_id: this.staffId,
      device_time: utcTime(ms),
      source: "LIVE",
      schema_version: 1,
    };
    if (phase === 0) {
      this.session = uuidv7(ms, this.rng);
      this.fare = (1 + Math.floor(this.rng() * 40)) * 100; // whole paise, 100 to 4000
      return {
        ...base,
        type: "ENTRY",
        session_id: this.session,
        payload: {
          vehicle_class: this.vehicleClass,
          zone_id: this.zoneId,
          short_code: shortCode(this.rng),
        },
      };
    }
    if (phase === 1) {
      return {
        ...base,
        type: "EXIT",
        session_id: this.session,
        payload: { fare_paise: this.fare, exit_method: "SCAN" },
      };
    }
    return {
      ...base,
      type: "PAYMENT",
      session_id: this.session,
      payload: {
        mode: this.rng() < 0.5 ? "CASH" : "UPI",
        amount_paise: this.fare,
        upi_attested: false,
      },
    };
  }
}

/**
 * Decides, once per step, whether the device is offline. An outage starts with probability `probability` per online
 * step and lasts `minSteps` to `maxSteps` steps (at the default 5 s step, 60 to 120 steps are 5 to 10 minutes, the
 * D.10 scenario). `tick()` returns `{ offline, flush }`: `flush` is true on the first online step after an outage,
 * when the buffered events should be sent in one batch.
 */
export class OutageTracker {
  constructor(rng, { probability = 1 / 120, minSteps = 60, maxSteps = 120 } = {}) {
    this.rng = rng;
    this.probability = probability;
    this.minSteps = minSteps;
    this.maxSteps = maxSteps;
    this.remaining = 0;
  }

  tick() {
    if (this.remaining > 0) {
      this.remaining -= 1;
      if (this.remaining > 0) return { offline: true, flush: false };
      return { offline: false, flush: true };
    }
    if (this.rng() < this.probability) {
      const span = this.maxSteps - this.minSteps + 1;
      this.remaining = this.minSteps + Math.floor(this.rng() * span);
      return { offline: true, flush: false };
    }
    return { offline: false, flush: false };
  }
}

/** Splits a list into batches of at most `size` (ingest_events accepts at most 500 events per call). */
export function chunk(list, size = 500) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
