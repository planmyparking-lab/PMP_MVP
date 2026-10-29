import { ReportsView } from "../../src/components/ReportsView";

// Read on the server: only whether the secret is set is passed on, never its value.
export const dynamic = "force-dynamic";

export default function ReportsPage() {
  const secretConfigured = Boolean(process.env.REPORT_ROUTE_SECRET);
  const demoEnabled = process.env.NODE_ENV !== "production" || process.env.REPORT_DEMO === "1";
  return <ReportsView secretConfigured={secretConfigured} demoEnabled={demoEnabled} />;
}
