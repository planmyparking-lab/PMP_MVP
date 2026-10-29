import { createRateLimiter } from "../../../../src/lib/reports/access";
import { handleReportRequest } from "../../../../src/lib/reports/handler";
import { renderPdf } from "../../../../src/lib/reports/pdf";

// Chromium and exceljs need Node APIs, so this route cannot run on the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authFailures = createRateLimiter(10, 60_000);
const perFacility = createRateLimiter(30, 60_000);

export async function GET(req: Request, ctx: { params: Promise<{ type: string }> }) {
  const { type } = await ctx.params;
  return handleReportRequest(req, type, {
    secret: process.env.REPORT_ROUTE_SECRET,
    // No loadReportData yet: it must read the KPI views (IC-07), which do not exist. The route answers 501.
    renderPdf,
    authFailures,
    perFacility,
    log: (line) => console.log(JSON.stringify(line)),
  });
}
