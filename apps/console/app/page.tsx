import { DashboardView } from "../src/components/DashboardView";
import { LiveDashboard } from "../src/components/LiveDashboard";
import { Landing } from "../src/components/landing/Landing";
import { LoginForm } from "../src/components/LoginForm";
import { loadFacilityLive } from "../src/lib/data/facility";
import { offlineReason } from "../src/lib/data/reason";
import { getConsoleSession } from "../src/lib/data/session";
import { showsLanding } from "../src/lib/landingRoute";
import { sanitizeRedirect } from "../src/lib/safeRedirect";
import "./landing.css";

/** Landing title and description only for signed-out visitors; the Dashboard keeps the layout's title. */
export async function generateMetadata() {
  const session = await getConsoleSession();
  if (!showsLanding(session.kind)) return {};
  return {
    title: "PlanMyParking · Parking operations, planned",
    description:
      "Offline-first gate app and operator console for parking facilities: live occupancy, cash, UPI and pass payments, shifts and conflicts.",
  };
}

/** Signed out: the public landing page with the real sign-in form. Signed in (or offline preview): the Dashboard. */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getConsoleSession();
  if (showsLanding(session.kind)) {
    // A visitor sent here from a protected page signs in and goes back to it.
    const params = await searchParams;
    const next = sanitizeRedirect(typeof params.next === "string" ? params.next : "/");
    return <Landing signIn={<LoginForm next={next} configured />} />;
  }

  const live = await loadFacilityLive();
  if (live) return <LiveDashboard live={live} />;
  return <DashboardView reason={offlineReason(session)} />;
}
