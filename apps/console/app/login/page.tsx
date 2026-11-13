import { readSupabaseEnv } from "../../src/lib/supabase/env";
import { sanitizeRedirect } from "../../src/lib/safeRedirect";
import { LoginForm } from "../../src/components/LoginForm";
import { ParkingScene } from "../../src/components/art/ParkingScene";
import { Icon } from "../../src/components/ui/Icon";
import type { IconName } from "../../src/components/ui/Icon";

export const metadata = { title: "Sign in · PlanMyParking" };

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "gauge", title: "Live occupancy", text: "Every zone, refreshed on its own" },
  { icon: "swap", title: "Sync conflicts", text: "Flagged for a person to decide" },
  { icon: "file", title: "Owner reports", text: "Daily, weekly and monthly" },
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

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = sanitizeRedirect(typeof params.next === "string" ? params.next : "/");
  const configured = readSupabaseEnv() !== null;

  return (
    <div className="auth">
      <section className="auth-art" aria-label="About PlanMyParking">
        <div className="auth-glow" aria-hidden="true" />
        <div className="auth-grid" aria-hidden="true" />

        <div className="auth-art-inner">
          <Wordmark />

          <div className="auth-art-main">
            <div className="auth-copy">
              <span className="auth-kicker">Operator Console</span>
              <h2>
                Run every gate, zone and shift from <em>one screen</em>.
              </h2>
              <p>
                Gate phones work offline and sync when they can. The console shows you what is
                happening and what needs a decision.
              </p>
            </div>

            <div className="auth-scene">
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

          <ul className="auth-features">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <span className="auth-feature-icon">
                  <Icon name={f.icon} size={17} />
                </span>
                <span>
                  <b>{f.title}</b>
                  <span>{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel-bg" aria-hidden="true" />
        <div className="auth-mobile-brand">
          <Wordmark />
        </div>
        <div className="auth-card">
          <div className="auth-card-mark" aria-hidden="true">
            <img src="/brand/mark-256.png" alt="" width={30} height={30} />
          </div>
          <span className="auth-kicker">Welcome back</span>
          <h1>Sign in to your console</h1>
          <p className="auth-lead">For facility owners and managers.</p>
          <LoginForm next={next} configured={configured} />
          <div className="auth-card-foot">
            <span className="auth-card-foot-icon">
              <Icon name="device" size={16} />
            </span>
            <span>
              <b>Gate guard?</b> Sign in on the gate phone with your PIN, not here.
            </span>
          </div>
        </div>
        <p className="auth-legal">© {new Date().getFullYear()} PlanMyParking · Operator Console</p>
      </section>
    </div>
  );
}
