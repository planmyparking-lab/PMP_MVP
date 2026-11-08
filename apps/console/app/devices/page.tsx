import { DevicesView } from "../../src/components/DevicesView";
import { LiveDevices } from "../../src/components/LiveDevices";
import { loadFacilityLive } from "../../src/lib/data/facility";

export default async function DevicesPage() {
  const live = await loadFacilityLive();
  return <DevicesView live={live ? <LiveDevices live={live} /> : undefined} />;
}
