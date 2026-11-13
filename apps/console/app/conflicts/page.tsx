import { ConflictsView } from "../../src/components/ConflictsView";
import { loadConflictNotes } from "../../src/lib/data/conflictNotes";
import { loadFacilityLive } from "../../src/lib/data/facility";
import { offlineReason } from "../../src/lib/data/reason";
import { getConsoleSession } from "../../src/lib/data/session";

export default async function ConflictsPage() {
  const live = await loadFacilityLive();
  if (!live) {
    return (
      <ConflictsView
        rows={[]}
        nowIso={new Date().toISOString()}
        reason={offlineReason(await getConsoleSession())}
      />
    );
  }
  const [notes, session] = await Promise.all([
    loadConflictNotes(live.facility.id),
    getConsoleSession(),
  ]);
  return (
    <ConflictsView
      notes={notes}
      userId={session.kind === "ok" ? session.userId : undefined}
      rows={live.conflicts.ok ? live.conflicts.data : []}
      nowIso={live.asOf}
      connected
      error={live.conflicts.ok ? undefined : live.conflicts.error}
      facilityName={live.facility.name}
    />
  );
}
