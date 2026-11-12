/* global __ENV, __VU, open */
// k6 ingest load test (T-CLD-10-X1; also produces the data for T-CLD-05-X1). Scenario from the member sheet, D.10:
// 20 simulated enrolled devices, each sending one event every 5 seconds for one hour, with batches arriving after
// simulated outages (a device pauses 5 to 10 minutes, then flushes everything it buffered in one batch).
// Pass: ingest_events p95 under 300 ms, no failed batch, KPI views under 500 ms at the end of the run.
//
// STATUS: NEVER RUN. k6 is not installed here, no staging project exists (CLD-01) and no device can be enrolled yet
// (`enroll_device` is not written), so this script has not been executed against anything. Only the event generator
// (tools/load/events.js) is tested. See tools/load/README.md before using it. Run it only against staging, never production.
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import { DeviceSim, OutageTracker, chunk, makeRng } from "./events.js";

const STEP_SECONDS = 5;
const DURATION = __ENV.DURATION || "1h";
const BASE = (__ENV.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = __ENV.SUPABASE_ANON_KEY || "";
// A JSON file outside the repository: [{ "token", "device_id", "facility_id", "staff_id", "zone_id" }, ...], one entry
// per enrolled staging device. Device tokens are secrets and are never committed.
const DEVICES = JSON.parse(open(__ENV.DEVICES_FILE || "devices.json"));

const failedBatches = new Counter("ingest_failed_batches");
const sentEvents = new Counter("ingest_events_sent");
const kpiViewMs = new Trend("kpi_view_ms", true);

export const options = {
  scenarios: {
    devices: { executor: "constant-vus", vus: DEVICES.length, duration: DURATION },
  },
  thresholds: {
    "http_req_duration{name:ingest}": ["p(95)<300"],
    ingest_failed_batches: ["count==0"],
    kpi_view_ms: ["p(95)<500"],
  },
};

export function setup() {
  if (!BASE || !ANON_KEY) throw new Error("set SUPABASE_URL and SUPABASE_ANON_KEY (staging only)");
  if (!__ENV.MANAGER_TOKEN && __ENV.SKIP_VIEW_CHECK !== "true") {
    // Devices cannot read the KPI views, so the 500 ms check needs an owner or manager token. Failing here is deliberate:
    // an empty Trend would pass its threshold and look like a result.
    throw new Error(
      "set MANAGER_TOKEN (owner or manager of the facility), or SKIP_VIEW_CHECK=true to skip",
    );
  }
  return { startMs: Date.now() };
}

const state = {}; // per VU, created on first iteration

export default function (data) {
  const device = DEVICES[(__VU - 1) % DEVICES.length];
  if (!state.sim) {
    const seed = 1000 + __VU;
    state.sim = new DeviceSim({
      seed,
      facilityId: device.facility_id,
      deviceId: device.device_id,
      staffId: device.staff_id,
      zoneId: device.zone_id,
      startMs: data.startMs,
      stepMs: STEP_SECONDS * 1000,
    });
    state.outage = new OutageTracker(makeRng(seed + 7919));
    state.buffer = [];
  }

  state.buffer.push(state.sim.next());
  const { offline } = state.outage.tick();
  if (!offline) {
    for (const batch of chunk(state.buffer)) send(device, batch);
    state.buffer = [];
  }
  sleep(STEP_SECONDS);
}

function send(device, batch) {
  const res = http.post(`${BASE}/rest/v1/rpc/ingest_events`, JSON.stringify({ events: batch }), {
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${device.token}`,
    },
    tags: { name: "ingest" },
  });
  sentEvents.add(batch.length);
  let ok = res.status === 200;
  if (ok) {
    const body = res.json();
    ok = body.rejected === 0 && body.accepted + body.duplicates === batch.length;
  }
  check(res, { "batch fully accepted": () => ok });
  if (!ok) failedBatches.add(1);
}

export function teardown(data) {
  if (!__ENV.MANAGER_TOKEN) return;
  const facilityId = DEVICES[0].facility_id;
  for (let i = 0; i < 20; i++) {
    for (const view of ["v_daily_kpis", "v_hourly"]) {
      const res = http.get(`${BASE}/rest/v1/${view}?facility_id=eq.${facilityId}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${__ENV.MANAGER_TOKEN}` },
        tags: { name: view },
      });
      check(res, { [`${view} answered`]: (r) => r.status === 200 });
      kpiViewMs.add(res.timings.duration);
    }
  }
  console.log(`run started ${new Date(data.startMs).toISOString()}`);
}
