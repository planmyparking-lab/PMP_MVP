import { LiveOccupancy } from "../../src/components/LiveOccupancy";
import { LiveRefresh } from "../../src/components/LiveRefresh";
import { OccupancyView } from "../../src/components/OccupancyView";
import { loadFacilityLive } from "../../src/lib/data/facility";
import { offlineReason } from "../../src/lib/data/reason";
import { getConsoleSession } from "../../src/lib/data/session";

export default async function OccupancyPage() {
  const live = await loadFacilityLive();
  if (!live) return <OccupancyView reason={offlineReason(await getConsoleSession())} />;
  return (
    <OccupancyView
      live={<LiveOccupancy live={live} />}
      liveStatus={<LiveRefresh asOf={live.asOf} />}
    />
  );
}
