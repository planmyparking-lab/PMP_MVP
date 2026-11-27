import { Landing } from "../../src/components/landing/Landing";
import { LoginForm } from "../../src/components/LoginForm";
import { Icon } from "../../src/components/ui/Icon";
import { getConsoleSession } from "../../src/lib/data/session";
import { isSignedIn } from "../../src/lib/landingRoute";
import { readSupabaseEnv } from "../../src/lib/supabase/env";
import { signOut } from "../actions";
import "../landing.css";

export const metadata = {
  title: "PlanMyParking · Parking operations, planned",
  description:
    "Offline-first gate app and operator console for parking facilities: live occupancy, cash, UPI and pass payments, shifts and conflicts.",
};

/**
 * The landing page at a fixed address, open to everyone. "/" shows it only while signed out; this lets a signed-in
 * owner or manager come back to it from the Console ("Home page" in the sidebar) without signing out.
 */
export default async function Welcome() {
  const session = await getConsoleSession();

  if (!isSignedIn(session)) {
    return <Landing signIn={<LoginForm next="/" configured={readSupabaseEnv() !== null} />} />;
  }

  return (
    <Landing
      account={{ email: session.email }}
      signIn={
        <div className="lp-signed-in">
          <a className="lp-btn lp-btn-lime lp-btn-lg" href="/">
            Open Dashboard <Icon name="arrowRight" size={16} />
          </a>
          <form action={signOut}>
            <button suppressHydrationWarning type="submit" className="lp-signout">
              Sign out
            </button>
          </form>
        </div>
      }
    />
  );
}
