import { createRateLimiter } from "../../../../src/lib/reports/access";
import { handleReportRequest } from "../../../../src/lib/reports/handler";
import { loadReportData } from "../../../../src/lib/reports/loadReportData";
import { renderPdf } from "../../../../src/lib/reports/pdf";
import { readSupabaseEnv } from "../../../../src/lib/supabase/env";
import { createClient } from "@supabase/supabase-js";
import type { ReportRpc } from "../../../../src/lib/reports/loadReportData";

// Chromium and exceljs need Node APIs, so this route cannot run on the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authFailures = createRateLimiter(10, 60_000);
const perFacility = createRateLimiter(30, 60_000);

/**
 * No user session here (the scheduler calls with the shared secret), so this uses the public anon key and the
 * SECURITY DEFINER function report_data() (0013, OQ-72), which checks the same secret itself. Without a Supabase
 * project or a secret the route has no loader and answers 501.
 */
function reportLoader(secret: string | undefined) {
  const env = readSupabaseEnv();
  if (!env || !secret) return undefined;
  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpc: ReportRpc = async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    return { data, error: error ? { code: error.code } : null };
  };
  return (params: Parameters<typeof loadReportData>[0]) => loadReportData(params, { rpc, secret });
}

export async function GET(req: Request, ctx: { params: Promise<{ type: string }> }) {
  const { type } = await ctx.params;
  const secret = process.env.REPORT_ROUTE_SECRET;
  return handleReportRequest(req, type, {
    secret,
    loadReportData: reportLoader(secret),
    renderPdf,
    authFailures,
    perFacility,
    log: (line) => console.log(JSON.stringify(line)),
  });
}
