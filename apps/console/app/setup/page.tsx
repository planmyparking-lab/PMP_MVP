import { SetupWizard } from "../../src/components/SetupWizard";
import type { SaveTarget } from "../../src/components/SetupWizard";
import { getConsoleSession } from "../../src/lib/data/session";

export default async function SetupPage() {
  const session = await getConsoleSession();
  const target: SaveTarget | null =
    session.kind === "ok" && session.facility
      ? { facilityName: session.facility.name, role: session.role }
      : null;
  return <SetupWizard target={target} />;
}
