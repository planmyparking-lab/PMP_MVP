// CLD-06: the report job, as plain JavaScript with every outside effect passed in, so Node tests it and Deno
// (the Edge runtime) runs the same file. No Deno API, no network call and no clock is used directly in here.
//
// One call handles one facility and one period (a job_runs row that run_report_job started):
//   1. fetch the PDF and the Excel file from the Console report route (IC-08), retrying a failed fetch up to 3 times;
//   2. store both in the private `reports` bucket (replacing an earlier file for the same period);
//   3. sign 7-day links;
//   4. email each recipient separately (they never see each other), with an idempotency key so a retry cannot send twice;
//   5. finish the job_runs row.
// Only reasons, counts and stage names are written to job_runs and the log: never an email address, a link, a secret or a
// message text from a service.

export const SIGNED_URL_SECONDS = 7 * 24 * 60 * 60; // exactly 7 days (sheet CLD-06)
export const FETCH_ATTEMPTS = 3;
export const FORMATS = ["pdf", "xlsx"];
const CONTENT_TYPE = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CADENCES = ["daily", "weekly", "monthly"];

/** Returns the payload when it is well formed, or null. */
export function parsePayload(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const { job_run_id, cadence, facility_id, period_start, period_end } = body;
  if (typeof job_run_id !== "string" || !UUID.test(job_run_id)) return null;
  if (typeof facility_id !== "string" || !UUID.test(facility_id)) return null;
  if (!CADENCES.includes(cadence)) return null;
  if (typeof period_start !== "string" || !DATE.test(period_start)) return null;
  if (typeof period_end !== "string" || !DATE.test(period_end)) return null;
  return {
    jobRunId: job_run_id,
    cadence,
    facilityId: facility_id,
    periodStart: period_start,
    periodEnd: period_end,
  };
}

const escapeHtml = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export function buildEmail({ facilityName, cadence, periodStart, periodEnd, links }) {
  const period = periodStart === periodEnd ? periodStart : `${periodStart} to ${periodEnd}`;
  const subject = `${facilityName}: ${cadence} parking report, ${period}`;
  const text =
    `Your ${cadence} parking report for ${facilityName} (${period}) is ready.\n\n` +
    `PDF: ${links.pdf}\nExcel: ${links.xlsx}\n\nThe links work for 7 days.`;
  const html =
    `<p>Your ${cadence} parking report for <strong>${escapeHtml(facilityName)}</strong> (${period}) is ready.</p>` +
    `<p><a href="${escapeHtml(links.pdf)}">Download the PDF</a><br>` +
    `<a href="${escapeHtml(links.xlsx)}">Download the Excel file</a></p>` +
    `<p>The links work for 7 days.</p>`;
  return { subject, text, html };
}

async function fetchReport(deps, payload, format) {
  const { consoleUrl, routeSecret } = deps.config;
  const url =
    `${consoleUrl.replace(/\/+$/, "")}/api/reports/${payload.cadence}` +
    `?facility=${payload.facilityId}&date=${payload.periodStart}&format=${format}`;
  let lastStatus = 0;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await deps.fetch(url, { headers: { "x-report-secret": routeSecret } });
      lastStatus = res.status;
      if (res.status === 200) return new Uint8Array(await res.arrayBuffer());
      // 4xx other than 429 cannot succeed on a retry.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch {
      lastStatus = 0;
    }
    if (attempt < FETCH_ATTEMPTS) await deps.sleep(1000 * 2 ** (attempt - 1));
  }
  const error = new Error("route fetch failed");
  error.stage = "route";
  error.code = lastStatus;
  throw error;
}

/**
 * deps = {
 *   config: { consoleUrl, routeSecret, resendKey, mailFrom },
 *   fetch, sleep,
 *   db: { getRun(id), facilityName(id), recipients(facilityId, cadence), finish(id, status, detail) },
 *   storage: { upload(path, bytes, contentType), signedUrl(path, seconds) },
 *   log(line)
 * }
 * Returns { status } and never throws: a failure is written to job_runs and returned.
 */
export async function runReportJob(rawPayload, deps) {
  const payload = parsePayload(rawPayload);
  if (!payload) return { status: "rejected" };

  const run = await deps.db.getRun(payload.jobRunId);
  // A call for a row that does not exist, or is not running, or names another facility or period, does nothing:
  // this is what stops a forged or repeated call from sending anything.
  if (
    !run ||
    run.status !== "running" ||
    run.facility_id !== payload.facilityId ||
    run.period_start !== payload.periodStart ||
    run.job !== `${payload.cadence}_report`
  ) {
    return { status: "ignored" };
  }

  const finish = async (status, detail) => {
    await deps.db.finish(payload.jobRunId, status, detail);
    deps.log({
      event: "report.job",
      job: run.job,
      facility: payload.facilityId,
      status,
      ...detail,
    });
    return { status };
  };

  let stage = "start";
  try {
    stage = "recipients";
    const recipients = await deps.db.recipients(payload.facilityId, payload.cadence);
    if (recipients.length === 0) return finish("skipped", { reason: "no_recipients" });

    stage = "route";
    const files = {};
    for (const format of FORMATS) files[format] = await fetchReport(deps, payload, format);

    stage = "storage";
    const links = {};
    for (const format of FORMATS) {
      const path = `${payload.facilityId}/${payload.cadence}/${payload.periodStart}.${format}`;
      await deps.storage.upload(path, files[format], CONTENT_TYPE[format]);
      links[format] = await deps.storage.signedUrl(path, SIGNED_URL_SECONDS);
    }

    stage = "email";
    const facilityName = (await deps.db.facilityName(payload.facilityId)) ?? "Parking facility";
    const mail = buildEmail({
      facilityName,
      cadence: payload.cadence,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      links,
    });
    let sent = 0;
    let failed = 0;
    for (const email of recipients) {
      try {
        const res = await deps.fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${deps.config.resendKey}`,
            "Content-Type": "application/json",
            // A retry of this run cannot send the same email twice.
            "Idempotency-Key": `${payload.jobRunId}:${email}`,
          },
          body: JSON.stringify({ from: deps.config.mailFrom, to: [email], ...mail }),
        });
        if (res.ok) sent++;
        else failed++;
      } catch {
        failed++;
      }
    }
    const detail = { files: FORMATS.length, recipients: recipients.length, sent, failed };
    return finish(
      failed === 0 ? "succeeded" : "failed",
      failed === 0 ? detail : { ...detail, reason: "email_failed" },
    );
  } catch (error) {
    const detail = { reason: `${error?.stage ?? stage}_failed` };
    if (typeof error?.code === "number" && error.code > 0) detail.http_status = error.code;
    return finish("failed", detail);
  }
}
