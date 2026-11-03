import { ConflictsView } from "../../src/components/ConflictsView";

export default function ConflictsPage() {
  return <ConflictsView rows={[]} nowIso={new Date().toISOString()} />;
}
