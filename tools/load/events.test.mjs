// Tests for the load-test event generator. Run: node --test tools/load/events.test.mjs
// They check the generator against the contract's own fixtures (packages/contracts/fixtures/events/valid) and the
// documented envelope rules. They do not run k6 and do not touch a database; see tools/load/README.md for what that means.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";
import { DeviceSim, OutageTracker, chunk, makeRng, shortCode, utcTime, uuidv7 } from "./events.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const fixture = (name) =>
  JSON.parse(
    readFileSync(here(`../../packages/contracts/fixtures/events/valid/${name}-1.json`), "utf8"),
  );

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const START = Date.UTC(2026, 10, 14, 6, 0, 0);
const device = (n, seed = 1000 + n) =>
  new DeviceSim({
    seed,
    facilityId: "5f1d2c3e-0000-4000-8000-000000000001",
    deviceId: `5f1d2c3e-0000-4000-8000-0000000000${String(10 + n)}`,
    staffId: "5f1d2c3e-0000-4000-8000-000000000003",
    zoneId: "5f1d2c3e-0000-4000-8000-000000000010",
    startMs: START,
  });

test("uuidv7 is a version 7 uuid that carries its millisecond timestamp", () => {
  const rng = makeRng(1);
  for (let i = 0; i < 200; i++) {
    const ms = START + i * 1000;
    const id = uuidv7(ms, rng);
    assert.match(id, UUID_V7);
    assert.equal(parseInt(id.replaceAll("-", "").slice(0, 12), 16), ms);
  }
});

test("utcTime has seconds and a literal Z, with no fraction or offset", () => {
  assert.equal(utcTime(START), "2026-11-14T06:00:00Z");
  assert.equal(utcTime(START + 4999), "2026-11-14T06:00:04Z");
  assert.match(utcTime(Date.now()), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test("shortCode is 5 characters of Crockford base32", () => {
  const rng = makeRng(7);
  for (let i = 0; i < 500; i++) assert.match(shortCode(rng), /^[0-9A-HJKMNP-TV-Z]{5}$/);
});

test("a device cycles ENTRY, EXIT, PAYMENT and keeps one session per cycle", () => {
  const sim = device(1);
  const events = Array.from({ length: 9 }, () => sim.next());
  assert.deepEqual(
    events.map((e) => e.type),
    ["ENTRY", "EXIT", "PAYMENT", "ENTRY", "EXIT", "PAYMENT", "ENTRY", "EXIT", "PAYMENT"],
  );
  for (let c = 0; c < 3; c++) {
    const [entry, exit, payment] = events.slice(c * 3, c * 3 + 3);
    assert.equal(exit.session_id, entry.session_id);
    assert.equal(payment.session_id, entry.session_id);
    assert.equal(
      payment.payload.amount_paise,
      exit.payload.fare_paise,
      "paid what the exit charged",
    );
    assert.ok(Number.isInteger(exit.payload.fare_paise) && exit.payload.fare_paise > 0);
    if (c > 0) assert.notEqual(entry.session_id, events[(c - 1) * 3].session_id);
  }
});

test("envelope and payload keys equal the contract fixtures exactly", () => {
  const sim = device(1);
  const [entry, exit, payment] = [sim.next(), sim.next(), sim.next()];
  const keys = (o) => Object.keys(o).sort();
  for (const [made, name] of [
    [entry, "entry"],
    [exit, "exit"],
    [payment, "payment"],
  ]) {
    const real = fixture(name);
    assert.deepEqual(keys(made), keys(real), `${name} envelope keys`);
    assert.deepEqual(keys(made.payload), keys(real.payload), `${name} payload keys`);
    assert.equal(made.source, real.source);
    assert.equal(made.schema_version, real.schema_version);
  }
});

test("ids are version 7, times are valid UTC and advance by one step", () => {
  const sim = device(2);
  let previous = START - 5000;
  for (let i = 0; i < 100; i++) {
    const e = sim.next();
    assert.match(e.id, UUID_V7);
    assert.match(e.session_id, UUID_V7);
    for (const key of ["facility_id", "device_id", "staff_id"]) assert.match(e[key], UUID);
    const t = Date.parse(e.device_time);
    assert.equal(t - previous, 5000);
    previous = t;
  }
});

test("the same seed reproduces a run and different seeds differ", () => {
  const a = Array.from(
    { length: 30 },
    (
      (s) => () =>
        s.next()
    )(device(1, 42)),
  );
  const b = Array.from(
    { length: 30 },
    (
      (s) => () =>
        s.next()
    )(device(1, 42)),
  );
  const c = Array.from(
    { length: 30 },
    (
      (s) => () =>
        s.next()
    )(device(1, 43)),
  );
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("one hour of 20 devices (14,400 events) produces no duplicate event id", () => {
  const ids = new Set();
  for (let d = 1; d <= 20; d++) {
    const sim = device(d);
    for (let i = 0; i < 720; i++) ids.add(sim.next().id);
  }
  assert.equal(ids.size, 20 * 720);
});

test("outages last 60 to 120 steps and each ends with exactly one flush that loses nothing", () => {
  let outages = 0;
  for (let d = 1; d <= 20; d++) {
    const sim = device(d);
    const tracker = new OutageTracker(makeRng(1000 + d + 7919));
    let buffer = [];
    let sent = 0;
    let offlineRun = 0;
    let maxBatch = 0;
    for (let step = 0; step < 720; step++) {
      buffer.push(sim.next());
      const { offline, flush } = tracker.tick();
      if (offline) {
        offlineRun += 1;
        continue;
      }
      if (flush) {
        outages += 1;
        assert.ok(offlineRun >= 60 && offlineRun <= 120, `outage of ${offlineRun} steps`);
        offlineRun = 0;
      }
      maxBatch = Math.max(maxBatch, buffer.length);
      sent += buffer.length;
      buffer = [];
    }
    assert.equal(
      sent + buffer.length,
      720,
      "every generated event is either sent or still buffered",
    );
    assert.ok(maxBatch <= 121, `batch of ${maxBatch}`);
    assert.ok(maxBatch <= 500, "within the ingest_events limit");
  }
  assert.ok(outages > 0, "the seeds exercise at least one outage");
});

test("chunk splits a long batch at the ingest_events limit", () => {
  assert.deepEqual(
    chunk(Array.from({ length: 1201 }, (_, i) => i)).map((c) => c.length),
    [500, 500, 201],
  );
  assert.deepEqual(chunk([]), []);
});

test("the k6 script is syntactically valid", () => {
  const result = spawnSync(process.execPath, ["--check", here("./ingest.k6.js")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});
