import { ActivityView } from "../../src/components/ActivityView";
import { LiveRefresh } from "../../src/components/LiveRefresh";
import { parseActivityFilter } from "../../src/lib/activity";
import { loadActivity } from "../../src/lib/data/activity";
import { offlineReason } from "../../src/lib/data/reason";
import { getConsoleSession } from "../../src/lib/data/session";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const live = await loadActivity(parseActivityFilter(await searchParams));
  if (!live) return <ActivityView reason={offlineReason(await getConsoleSession())} />;
  return <ActivityView live={live} liveStatus={<LiveRefresh asOf={live.asOf} seconds={30} />} />;
}
