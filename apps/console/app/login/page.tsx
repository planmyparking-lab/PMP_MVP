import { redirect } from "next/navigation";
import { signInUrl } from "../../src/lib/landingRoute";
import { readSupabaseEnv } from "../../src/lib/supabase/env";
import { sanitizeRedirect } from "../../src/lib/safeRedirect";
import { LoginForm } from "../../src/components/LoginForm";
import { ParkingScene } from "../../src/components/art/ParkingScene";
import { Icon } from "../../src/components/ui/Icon";
import type { IconName } from "../../src/components/ui/Icon";
import "./login.css";

export const metadata = { title: "Sign in · PlanMyParking" };

const POINTS: { icon: IconName; label: string }[] = [
  { icon: "gauge", label: "Live occupancy" },
  { icon: "swap", label: "Sync conflicts" },
  { icon: "file", label: "Owner reports" },
];

function Wordmark() {
  return (
    <span className="wordmark">
      <img src="/brand/mark-256.png" alt="" width={34} height={34} />
      <span>
        PlanMy<b>Parking</b>
      </span>
    </span>
  );
}

/**
 * Sign-in page: one centred card on a dark field. The story half and the form half share the card, so their tops
 * and bottoms always line up, and the card's height follows the window so nothing is cut off at higher zoom.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = sanitizeRedirect(typeof params.next === "string" ? params.next : "/");
  const configured = readSupabaseEnv() !== null;
  // Sign-in lives on the landing page now. This page stays only for the offline case, where it explains that
  // Supabase is not set up on this computer.
  if (configured) redirect(signInUrl(next));

  return (
    <div className="lg">
      <div className="lg-bg" aria-hidden="true" />

      <div className="lg-mobile-brand">
        <Wordmark />
      </div>

      <div className="lg-shell">
        <section className="lg-story" aria-label="About PlanMyParking">
          <Wordmark />

          <div className="lg-copy">
            <span className="lg-kicker">Operator Console</span>
            <h2>
              Run every gate, zone and shift from <em>one screen</em>.
            </h2>
            <p>
              Gate phones work offline and sync when they can. The console shows you what is
              happening and what needs a decision.
            </p>
          </div>

          <div className="lg-scene">
            <div className="lg-scene-frame">
              <ParkingScene id="login" />
              <span className="scene-chip chip-a">
                <span className="chip-dot" /> Free slot found
              </span>
              <span className="scene-chip chip-b">
                <Icon name="checkCircle" size={14} /> Entry synced
              </span>
              <span className="scene-chip chip-c">
                <Icon name="gauge" size={14} /> Zone B · 12 free
              </span>
            </div>
          </div>

          <ul className="lg-points">
            {POINTS.map((p) => (
              <li key={p.label}>
                <Icon name={p.icon} size={15} />
                {p.label}
              </li>
            ))}
          </ul>
        </section>

        <section className="lg-formside">
          <div className="lg-form">
            <div className="lg-form-head">
              <span className="lg-form-mark" aria-hidden="true">
                <img src="/brand/mark-256.png" alt="" width={26} height={26} />
              </span>
              <span className="lg-pill">
                <Icon name="lock" size={13} /> Owners and managers
              </span>
            </div>
            <h1>Welcome back</h1>
            <p className="lg-lead">Sign in to see your facility, your gates and your shifts.</p>
            <LoginForm next={next} configured={configured} />
            <div className="lg-guard">
              <span className="lg-guard-icon">
                <Icon name="device" size={16} />
              </span>
              <span>
                <b>Gate guard?</b> Sign in on the gate phone with your PIN, not here.
              </span>
            </div>
          </div>
        </section>
      </div>

      <p className="lg-foot">© {new Date().getFullYear()} PlanMyParking · Operator Console</p>
    </div>
  );
}
