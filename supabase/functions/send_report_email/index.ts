// CLD-06 Edge Function: thin Deno wrapper around reportJob.mjs (all the logic and its tests live there).
// Called by public.run_report_job() through pg_net with `Authorization: Bearer <report_job_key>`.
// NOT RUN LOCALLY: this repository's local stack has no Edge runtime, so this file is unverified. See README.md.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { parsePayload, runReportJob } from "./reportJob.mjs";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const need = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing function secret ${name}`);
  return value;
};

// Constant-time comparison of two secrets.
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // Only the database's own scheduler call (carrying the Vault key) may start a run.
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer || !sameSecret(bearer, need("REPORT_JOB_KEY"))) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!parsePayload(body)) return new Response("bad request", { status: 400 });

  const supabase = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const deps = {
    config: {
      consoleUrl: need("CONSOLE_URL"),
      routeSecret: need("REPORT_ROUTE_SECRET"),
      resendKey: need("RESEND_API_KEY"),
      mailFrom: need("REPORT_MAIL_FROM"),
    },
    fetch: (url: string, init?: RequestInit) => fetch(url, init),
    sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    log: (line: Record<string, unknown>) => console.log(JSON.stringify(line)),
    db: {
      async getRun(id: string) {
        const { data, error } = await supabase
          .from("job_runs")
          .select("id, job, facility_id, period_start, status")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error("job_runs read failed");
        return data;
      },
      async facilityName(id: string) {
        const { data } = await supabase
          .from("facilities")
          .select("name")
          .eq("id", id)
          .maybeSingle();
        return data?.name ?? null;
      },
      async recipients(facilityId: string, cadence: string) {
        const { data, error } = await supabase
          .from("report_recipients")
          .select("email")
          .eq("facility_id", facilityId)
          .eq("cadence", cadence);
        if (error) throw new Error("report_recipients read failed");
        return (data ?? []).map((r: { email: string }) => r.email);
      },
      async finish(id: string, status: string, detail: Record<string, unknown>) {
        const { error } = await supabase
          .from("job_runs")
          .update({ status, detail, finished_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw new Error("job_runs write failed");
      },
    },
    storage: {
      async upload(path: string, bytes: Uint8Array, contentType: string) {
        const { error } = await supabase.storage
          .from("reports")
          .upload(path, bytes, { contentType, upsert: true });
        if (error) throw new Error("upload failed");
      },
      async signedUrl(path: string, seconds: number) {
        const { data, error } = await supabase.storage
          .from("reports")
          .createSignedUrl(path, seconds);
        if (error || !data) throw new Error("sign failed");
        return data.signedUrl;
      },
    },
  };

  // Rendering a PDF can take longer than pg_net waits for a reply: answer now, finish in the background.
  const work = runReportJob(body, deps);
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
  return new Response(JSON.stringify({ accepted: true }), {
    status: 202,
    headers: { "content-type": "application/json" },
  });
});
