import { LiveRefresh } from "../../src/components/LiveRefresh";
import { OverstayView } from "../../src/components/OverstayView";
import { loadFacilityLive } from "../../src/lib/data/facility";
import { overstayList, parseThreshold } from "../../src/lib/overstayList";

export default async function OverstayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const live = await loadFacilityLive();
  if (!live) return <OverstayView />;

  const threshold = parseThreshold((await searchParams).threshold);
  return (
    <OverstayView
      liveStatus={<LiveRefresh asOf={live.asOf} seconds={30} />}
      live={{
        facilityName: live.facility.name,
        asOf: live.asOf,
        thresholdMinutes: threshold.minutes,
        thresholdFromQuery: threshold.fromQuery,
        thresholdError: threshold.error,
        rows: live.inside.ok ? overstayList(live.inside.data, live.asOf, threshold.minutes) : [],
        error: live.inside.ok ? undefined : live.inside.error,
      }}
    />
  );
}
