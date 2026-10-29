import { randomUUID } from "node:crypto";
import { REPORT_SECRET_HEADER, secretMatches } from "./access";
import { buildReportWorkbook } from "./excel";
import { parseReportParams } from "./params";
import { renderReportHtml } from "../../reports/render";
import type { RateLimiter } from "./access";
import type { ReportData } from "./model";
import type { ReportParams } from "./params";

/**
 * CON-08 / IC-08: the report route logic as a plain function from a Request to a Response, so it is testable
 * without a server. `GET /api/reports/{daily|weekly|monthly}?facility=&date=&format=pdf|xlsx`, one file per
 * call (OQ-32 recommendation).
 *
 * Where the numbers come from is NOT decided here: `loadReportData` is supplied by the caller and must
 * return a ReportData built from the KPI views (IC-07, Akanksha), or `null` for an unknown facility. Until
 * those views exist the route is wired with no loader and answers 501.
 */
export interface ReportDeps {
  secret: string | undefined;
  loadReportData?: (params: ReportParams) => Promise<ReportData | null>;
  renderPdf: (html: string) => Promise<Uint8Array>;
  /** Limits requests that failed authentication, per client. */
  authFailures: RateLimiter;
  /** Limits accepted requests, per facility. */
  perFacility: RateLimiter;
  log: (line: Record<string, unknown>) => void;
  now?: () => number;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const clientKey = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

export async function handleReportRequest(
  req: Request,
  type: string,
  deps: ReportDeps,
): Promise<Response> {
  const now = deps.now ?? Date.now;
  const started = now();

  if (!secretMatches(req.headers.get(REPORT_SECRET_HEADER), deps.secret)) {
    if (!deps.authFailures.allow(clientKey(req), started)) {
      return json(429, { error: "too_many_requests" });
    }
    return json(401, { error: "unauthorized" });
  }

  const url = new URL(req.url);
  const parsed = parseReportParams({
    type,
    facility: url.searchParams.get("facility"),
    date: url.searchParams.get("date"),
    format: url.searchParams.get("format"),
  });
  if (!parsed.ok) return json(400, { error: "invalid_request", issues: parsed.issues });
  const params = parsed.value;

  if (!deps.perFacility.allow(params.facility, started)) {
    return json(429, { error: "too_many_requests" });
  }
  if (!deps.loadReportData) return json(501, { error: "report_data_unavailable" });

  const jobId = randomUUID();
  try {
    const data = await deps.loadReportData(params);
    if (!data) return json(404, { error: "not_found" });

    let bytes: Uint8Array;
    let contentType: string;
    if (params.format === "xlsx") {
      bytes = await buildReportWorkbook(data);
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
      bytes = await deps.renderPdf(renderReportHtml(data));
      contentType = "application/pdf";
    }
    deps.log({
      event: "report.render",
      type: params.type,
      facility: params.facility,
      format: params.format,
      durationMs: now() - started,
      bytes: bytes.byteLength,
    });
    const filename = `report-${params.type}-${params.period.start}.${params.format}`;
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    // Only the error class and a job id are logged: messages can quote report content.
    deps.log({
      event: "report.render_failed",
      jobId,
      type: params.type,
      facility: params.facility,
      error: error instanceof Error ? error.name : "unknown",
    });
    return json(500, { error: "render_failed", jobId });
  }
}
