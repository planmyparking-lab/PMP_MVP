import { FacilityView } from "../../src/components/FacilityView";
import { loadFacilityConfig } from "../../src/lib/data/facilityConfig";
import { offlineReason } from "../../src/lib/data/reason";
import { getConsoleSession } from "../../src/lib/data/session";

export default async function FacilityPage() {
  const live = await loadFacilityConfig();
  if (!live) return <FacilityView reason={offlineReason(await getConsoleSession())} />;
  return <FacilityView live={live} />;
}
