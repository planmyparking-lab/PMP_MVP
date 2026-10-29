import { buildReportWorkbook } from "../../../src/lib/reports/excel";
import { demoReport } from "../../../src/lib/reports/demoData";
import { REPORT_TYPES } from "../../../src/lib/reports/model";
import { parseReportParams } from "../../../src/lib/reports/params";
import { renderReportHtml } from "../../../src/reports/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DATE = "2026-10-25";

/**
 * Labelled demo only: renders invented sample data so the report layout can be seen in a browser. It is off in
 * production unless REPORT_DEMO=1, and it never reads a database or needs the report secret.
 * Query: type=daily|weekly|monthly, date=yyyy-mm-dd, format=html|xlsx.
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production" && process.env.REPORT_DEMO !== "1") {
    return new Response("Not found", { status: 404 });
  }
  const q = new URL(req.url).searchParams;
  const parsed = parseReportParams({
    type: q.get("type") ?? REPORT_TYPES[0],
    facility: "demo",
    date: q.get("date") ?? DEFAULT_DATE,
    format: "xlsx",
  });
  if (!parsed.ok) {
    return Response.json({ error: "invalid_request", issues: parsed.issues }, { status: 400 });
  }
  const { type, period } = parsed.value;
  const data = demoReport(new Date().toISOString(), type, period);
  if (q.get("format") === "xlsx") {
    const bytes = await buildReportWorkbook(data);
    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="demo-report-${type}-${period.start}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  }
  return new Response(renderReportHtml(data), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
