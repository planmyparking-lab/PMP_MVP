import { SetupWizard } from "../../src/components/SetupWizard";
import type { SaveTarget } from "../../src/components/SetupWizard";
import { getConsoleSession } from "../../src/lib/data/session";

export default async function SetupPage() {
  const session = await getConsoleSession();
  const target: SaveTarget | null =
    session.kind === "ok" && session.facility && session.facilityRole
      ? {
          facilityName: session.facility.name,
          slotCount: session.facility.slotCount,
          // The role on this facility, not "owns anything" (an owner of X who manages Y is a manager on Y).
          role: session.facilityRole,
        }
      : null;
  return <SetupWizard target={target} />;
}
