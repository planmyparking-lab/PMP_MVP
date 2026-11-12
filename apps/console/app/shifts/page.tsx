import { LiveRefresh } from "../../src/components/LiveRefresh";
import { LiveShifts } from "../../src/components/LiveShifts";
import { ShiftsView } from "../../src/components/ShiftsView";
import { loadShiftsLive } from "../../src/lib/data/shifts";

export default async function ShiftsPage() {
  const live = await loadShiftsLive();
  if (!live) return <ShiftsView />;
  return <LiveShifts live={live} liveStatus={<LiveRefresh asOf={live.asOf} seconds={30} />} />;
}
