import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEmail, parsePayload, runReportJob, SIGNED_URL_SECONDS } from "./reportJob.mjs";

const RUN = "0190a000-0000-7000-8000-0000000000a1";
const FAC = "0190a000-0000-7000-8000-000000000001";
const payload = {
  job_run_id: RUN,
  cadence: "daily",
  facility_id: FAC,
  period_start: "2026-10-25",
  period_end: "2026-10-25",
};
const run = {
  id: RUN,
  job: "daily_report",
  facility_id: FAC,
  period_start: "2026-10-25",
  status: "running",
};

function setup({
  route = [200, 200],
  resend = [200],
  recipients = ["a@example.test", "b@example.test"],
  runRow = run,
} = {}) {
  const calls = { fetch: [], uploads: [], signed: [], finished: [], sleeps: [], logs: [] };
  let routeIdx = 0;
  let resendIdx = 0;
  const deps = {
    config: {
      consoleUrl: "https://console.test/",
      routeSecret: "route-secret",
      resendKey: "re_key",
      mailFrom: "r@example.test",
    },
    fetch: async (url, init) => {
      calls.fetch.push({ url, init });
      if (url.startsWith("https://api.resend.com")) {
        const status = resend[Math.min(resendIdx++, resend.length - 1)];
        return { ok: status >= 200 && status < 300, status };
      }
      const status = route[Math.min(routeIdx++, route.length - 1)];
      return {
        ok: status === 200,
        status,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    },
    sleep: async (ms) => void calls.sleeps.push(ms),
    log: (l) => calls.logs.push(l),
    db: {
      getRun: async () => runRow,
      facilityName: async () => "Demo <Mall>",
      recipients: async () => recipients,
      finish: async (id, status, detail) => void calls.finished.push({ id, status, detail }),
    },
    storage: {
      upload: async (path, bytes, type) => void calls.uploads.push({ path, type, n: bytes.length }),
      signedUrl: async (path, seconds) => (
        calls.signed.push({ path, seconds }),
        `https://signed.test/${path}?t=SECRET-TOKEN`
      ),
    },
  };
  return { deps, calls };
}

const resendCalls = (calls) =>
  calls.fetch.filter((c) => c.url.startsWith("https://api.resend.com"));

test("parsePayload accepts a well-formed payload and rejects the rest", () => {
  assert.equal(parsePayload(payload).facilityId, FAC);
  for (const bad of [
    null,
    [],
    {},
    { ...payload, cadence: "hourly" },
    { ...payload, job_run_id: "x" },
    { ...payload, period_start: "25-10-2026" },
  ]) {
    assert.equal(parsePayload(bad), null);
  }
});

test("happy path: two files stored, 7-day links, one email per recipient, row succeeded", async () => {
  const { deps, calls } = setup();
  const result = await runReportJob(payload, deps);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(
    calls.uploads.map((u) => u.path),
    [`${FAC}/daily/2026-10-25.pdf`, `${FAC}/daily/2026-10-25.xlsx`],
  );
  assert.ok(calls.signed.every((s) => s.seconds === 604800 && s.seconds === SIGNED_URL_SECONDS));
  assert.equal(resendCalls(calls).length, 2);
  assert.deepEqual(calls.finished[0].detail, { files: 2, recipients: 2, sent: 2, failed: 0 });
  const routeCall = calls.fetch[0];
  assert.equal(
    routeCall.url,
    `https://console.test/api/reports/daily?facility=${FAC}&date=2026-10-25&format=pdf`,
  );
  assert.equal(routeCall.init.headers["x-report-secret"], "route-secret");
});

test("each recipient gets their own email and an idempotency key (they never see each other)", async () => {
  const { deps, calls } = setup();
  await runReportJob(payload, deps);
  const [first, second] = resendCalls(calls).map((c) => ({
    body: JSON.parse(c.init.body),
    key: c.init.headers["Idempotency-Key"],
  }));
  assert.deepEqual(first.body.to, ["a@example.test"]);
  assert.deepEqual(second.body.to, ["b@example.test"]);
  assert.equal(first.key, `${RUN}:a@example.test`);
  assert.notEqual(first.key, second.key);
});

test("the facility name is HTML-escaped in the email", () => {
  const mail = buildEmail({
    facilityName: "A <b>&</b>",
    cadence: "daily",
    periodStart: "2026-10-25",
    periodEnd: "2026-10-25",
    links: { pdf: "https://x/?a=1&b=2", xlsx: "https://y" },
  });
  assert.ok(mail.html.includes("A &lt;b&gt;&amp;&lt;/b&gt;"));
  assert.ok(mail.html.includes("a=1&amp;b=2"));
});

test("a route failure is retried 3 times with backoff, then the row fails with the stage and status only", async () => {
  const { deps, calls } = setup({ route: [500] });
  const result = await runReportJob(payload, deps);
  assert.equal(result.status, "failed");
  assert.equal(calls.fetch.length, 3);
  assert.deepEqual(calls.sleeps, [1000, 2000]);
  assert.deepEqual(calls.finished[0].detail, { reason: "route_failed", http_status: 500 });
  assert.equal(calls.uploads.length, 0);
  assert.equal(resendCalls(calls).length, 0);
});

test("a retry that succeeds is accepted", async () => {
  const { deps } = setup({ route: [503, 200, 200] });
  assert.equal((await runReportJob(payload, deps)).status, "succeeded");
});

test("a 401 from the route is not retried", async () => {
  const { deps, calls } = setup({ route: [401] });
  assert.equal((await runReportJob(payload, deps)).status, "failed");
  assert.equal(calls.fetch.length, 1);
});

test("a failed email marks the run failed, still counts the rest, and never records an address", async () => {
  const { deps, calls } = setup({ resend: [200, 500] });
  const result = await runReportJob(payload, deps);
  assert.equal(result.status, "failed");
  assert.deepEqual(calls.finished[0].detail, {
    files: 2,
    recipients: 2,
    sent: 1,
    failed: 1,
    reason: "email_failed",
  });
  assert.ok(!JSON.stringify(calls.finished).includes("@"));
});

test("no recipient: skipped, nothing fetched or sent", async () => {
  const { deps, calls } = setup({ recipients: [] });
  const result = await runReportJob(payload, deps);
  assert.equal(result.status, "skipped");
  assert.equal(calls.fetch.length, 0);
  assert.deepEqual(calls.finished[0].detail, { reason: "no_recipients" });
});

test("a call for a row that is not running, is missing, or names another period does nothing", async () => {
  for (const runRow of [
    null,
    { ...run, status: "succeeded" },
    { ...run, status: "failed" },
    { ...run, facility_id: "0190a000-0000-7000-8000-000000000002" },
    { ...run, period_start: "2026-10-24" },
    { ...run, job: "weekly_report" },
  ]) {
    const { deps, calls } = setup({ runRow });
    assert.equal((await runReportJob(payload, deps)).status, "ignored");
    assert.equal(calls.fetch.length, 0);
    assert.equal(calls.finished.length, 0);
  }
});

test("a malformed payload is rejected before any lookup", async () => {
  const { deps, calls } = setup();
  assert.equal((await runReportJob({ nope: 1 }, deps)).status, "rejected");
  assert.equal(calls.fetch.length, 0);
});

test("signed links and secrets never reach the log or the job row", async () => {
  const { deps, calls } = setup();
  await runReportJob(payload, deps);
  const text = JSON.stringify([calls.logs, calls.finished]);
  for (const secret of ["SECRET-TOKEN", "signed.test", "route-secret", "re_key"])
    assert.ok(!text.includes(secret), secret);
});

test("a storage failure fails the run at the storage stage and sends nothing", async () => {
  const { deps, calls } = setup();
  deps.storage.upload = async () => {
    throw new Error("boom with https://signed.test/x");
  };
  const result = await runReportJob(payload, deps);
  assert.equal(result.status, "failed");
  assert.deepEqual(calls.finished[0].detail, { reason: "storage_failed" });
  assert.equal(resendCalls(calls).length, 0);
});
