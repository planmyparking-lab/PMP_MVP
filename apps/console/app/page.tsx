import { DashboardView } from "../src/components/DashboardView";
import { LiveDashboard } from "../src/components/LiveDashboard";
import { loadFacilityLive } from "../src/lib/data/facility";
import { offlineReason } from "../src/lib/data/reason";
import { getConsoleSession } from "../src/lib/data/session";

export default async function Dashboard() {
  const live = await loadFacilityLive();
  if (live) return <LiveDashboard live={live} />;
  return <DashboardView reason={offlineReason(await getConsoleSession())} />;
}
