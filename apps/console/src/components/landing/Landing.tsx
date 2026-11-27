import type { ReactNode } from "react";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { CopyPhone, GatePhoneDemo, LiveLotDemo, SyncDemo } from "./LandingDemos";
import { HeroScene } from "./HeroScene";

/** Public contact details, as given by the team for the landing page. */
export const CONTACT = {
  linkedin: "https://www.linkedin.com/company/planmyparking/",
  phoneDisplay: "+91 82920 55416",
  phoneHref: "tel:+918292055416",
} as const;

/**
 * Every claim on this page describes something the repository already contains (docs/team, src/lib/features.ts,
 * apps/gate). Nothing here promises a feature that is not built. Example figures in the demos are labelled as such.
 */
const FEATURES: { icon: IconName; title: string; body: string; where: string; wide?: boolean }[] = [
  {
    icon: "gauge",
    title: "Live occupancy",
    body: "Vehicles inside each zone, refreshed every few seconds, with a flag when a guard's head count drifts from the system by more than 3%.",
    where: "Console",
    wide: true,
  },
  {
    icon: "device",
    title: "Gate phone app",
    body: "Entry, exit, pass check, zone count and paper backfill, on an Android phone that keeps working without signal.",
    where: "Gate app",
  },
  {
    icon: "car",
    title: "Fares and payments",
    body: "Your tariff prices every exit. Cash, UPI to your own QR, or pass. A waiver always needs a reason.",
    where: "Gate app · Console",
  },
  {
    icon: "swap",
    title: "Sync conflicts",
    body: "Duplicate exits, exits with no entry and phone clock problems collect in one inbox, so a manager decides instead of guessing.",
    where: "Console",
  },
  {
    icon: "clock",
    title: "Shift review",
    body: "Guards open and close shifts with a cash count. You see the variance and sign each shift off.",
    where: "Gate app · Console",
  },
  {
    icon: "alert",
    title: "Overstay",
    body: "Vehicles parked past your limit, longest first. The CSV export leaves number plates out.",
    where: "Console",
  },
  {
    icon: "plug",
    title: "Devices and staff",
    body: "Every gate phone's battery and upload queue. Revoke a lost phone or deactivate a guard in one step.",
    where: "Console",
  },
  {
    icon: "file",
    title: "Owner reports",
    body: "Daily, weekly and monthly reports: vehicles, revenue by payment mode and overrides, as Excel or PDF.",
    where: "Console",
    wide: true,
  },
];

const FACTS: { big: string; small: string }[] = [
  {
    big: "Offline first",
    small: "Every event is saved on the phone first and uploads when the network returns.",
  },
  {
    big: "₹ to the paisa",
    small: "Fares and totals are stored as whole paise, so the cash count matches.",
  },
  {
    big: "No gateway fee",
    small: "UPI goes straight to your own QR; the guard confirms the money arrived.",
  },
  { big: "हिन्दी · English", small: "The gate app speaks the guard's language." },
];

function Wordmark() {
  return (
    <a className="lp-brand" href="#top" aria-label="PlanMyParking home">
      {/* Plain img: the mark is a small static PNG with transparency (same as the sidebar). */}
      <img src="/brand/mark-256.png" alt="" width={36} height={36} />
      <span>
        PlanMy<b>Parking</b>
      </span>
    </a>
  );
}

export function Landing({ signIn }: { signIn: ReactNode }) {
  return (
    <div className="lp" id="top">
      {/* ---------- hero: full-bleed first screen; the skyline and road are visible on load ---------- */}
      <header className="lp-hero">
        <div>
          <div className="lp-frame">
            <nav className="lp-nav" aria-label="Main">
              <Wordmark />
              <ul className="lp-links">
                <li>
                  <a href="#features">Features</a>
                </li>
                <li>
                  <a href="#gate-app">Gate app</a>
                </li>
                <li>
                  <a href="#how">How it works</a>
                </li>
                <li>
                  <a href="#contact">Contact</a>
                </li>
              </ul>
              <div className="lp-nav-actions">
                <a className="lp-btn lp-btn-ghost lp-help" href="#how">
                  Help
                </a>
                <a className="lp-btn lp-btn-lime" href="#signin">
                  Login
                </a>
              </div>
            </nav>

            <div className="lp-stage">
              <section className="lp-card" id="signin" aria-labelledby="signin-title">
                <div className="lp-card-head">
                  <span className="lp-avatar" aria-hidden="true">
                    <img src="/brand/mark-256.png" alt="" width={26} height={26} />
                  </span>
                  <span className="lp-pill">
                    <Icon name="lock" size={13} /> Owners and managers
                  </span>
                </div>
                <h2 id="signin-title">Sign in to the Console</h2>
                <p className="lp-card-lead">See your facility, your gates and your shifts.</p>
                {signIn}
                <div className="lp-guard">
                  <Icon name="device" size={16} />
                  <span>
                    <b>Gate guard?</b> Sign in on the gate phone with your PIN, not here.
                  </span>
                </div>
              </section>

              <div className="lp-pitch">
                <span className="lp-kicker">Parking operations, one screen</span>
                <h1>
                  <span className="lp-line">Every gate, zone</span>{" "}
                  <span className="lp-line">
                    and shift, <em>planned.</em>
                  </span>
                </h1>
                <p className="lp-lead">
                  Gate phones that <b>work offline</b>. One console that shows{" "}
                  <b>everything, live</b>.
                </p>
                <ul className="lp-highlights" aria-label="Highlights">
                  <li>
                    <Icon name="gauge" size={15} /> Live occupancy
                  </li>
                  <li>
                    <Icon name="car" size={15} /> Cash · UPI · Pass
                  </li>
                  <li>
                    <Icon name="clock" size={15} /> Shift checks
                  </li>
                </ul>
                <div className="lp-ctas">
                  <a className="lp-btn lp-btn-lime lp-btn-lg" href="#contact">
                    Request a demo <Icon name="arrowRight" size={16} />
                  </a>
                  <a className="lp-btn lp-btn-ghost lp-btn-lg" href="#live-lot">
                    Watch a lot fill up
                  </a>
                </div>
              </div>
            </div>

            {/* the city strip sits below the text, never behind it */}
            <HeroScene />
          </div>
        </div>
      </header>

      <main>
        <div className="lp-wrap">
          <ul className="lp-facts">
            {FACTS.map((f) => (
              <li key={f.big}>
                <strong>{f.big}</strong>
                <span>{f.small}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* ---------- live lot ---------- */}
        <section className="lp-block" id="live-lot">
          <div className="lp-wrap lp-split">
            <div className="lp-copy">
              <span className="lp-eyebrow">Live occupancy</span>
              <h2>Know how full every zone is, without walking the lot.</h2>
              <p>
                Each entry and exit at the gate moves the count. The Console shows free slots per
                zone, turns a zone amber at 70% and red above 90%, so you can send cars where there
                is room.
              </p>
              <p className="lp-note">The lot on the right is an animated example, not live data.</p>
            </div>
            <LiveLotDemo />
          </div>
        </section>

        {/* ---------- gate app ---------- */}
        <section className="lp-block lp-block-alt" id="gate-app">
          <div className="lp-wrap lp-split lp-split-rev">
            <GatePhoneDemo />
            <div className="lp-copy">
              <span className="lp-eyebrow">Gate app</span>
              <h2>Big buttons, the guard&apos;s own language, and no signal needed.</h2>
              <p>
                The gate phone prices the exit from your tariff and records cash, UPI or pass in a
                tap. Switch the phone between English and Hindi to see the real screen text.
              </p>
              <ul className="lp-ticks">
                <li>Signs in with a PIN, not a password</li>
                <li>Prints a token, or shows a QR when the printer fails</li>
                <li>Warns when the phone clock is off or storage is low</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ---------- features ---------- */}
        <section className="lp-block" id="features">
          <div className="lp-wrap">
            <span className="lp-eyebrow">Features</span>
            <h2 className="lp-h2-wide">Everything a parking operator checks in a day</h2>
            <div className="lp-bento">
              {FEATURES.map((f) => (
                <article key={f.title} className={f.wide ? "lp-feature lp-wide" : "lp-feature"}>
                  <span className="lp-ico">
                    <Icon name={f.icon} size={20} />
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                  <span className="lp-where">{f.where}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <section className="lp-block lp-block-alt" id="how">
          <div className="lp-wrap">
            <span className="lp-eyebrow">How it works</span>
            <h2 className="lp-h2-wide">
              From the gate to your screen, even when the network drops
            </h2>
            <ol className="lp-steps">
              <li>
                <h3>The guard logs it at the gate</h3>
                <p>Entry, exit and payment are saved on the phone first, signal or not.</p>
              </li>
              <li>
                <h3>The phone syncs</h3>
                <p>
                  Queued events upload when the connection returns. A resent event is stored once.
                </p>
              </li>
              <li>
                <h3>You see it in the Console</h3>
                <p>Occupancy, revenue by mode, shifts and conflicts update for your facility.</p>
              </li>
            </ol>
            <SyncDemo />
          </div>
        </section>

        {/* ---------- who ---------- */}
        <section className="lp-block" id="who">
          <div className="lp-wrap">
            <span className="lp-eyebrow">Who it is for</span>
            <h2 className="lp-h2-wide">One system, two kinds of user</h2>
            <div className="lp-roles">
              <div className="lp-role lp-role-main">
                <h3>Owners and managers</h3>
                <p className="lp-who">Use the Console in a browser.</p>
                <ul className="lp-ticks">
                  <li>Set up zones, capacity and tariffs, and try a fare before saving</li>
                  <li>Watch occupancy and today&apos;s revenue</li>
                  <li>Review shifts, conflicts and overstays</li>
                  <li>Manage gate phones and guards</li>
                </ul>
                <a className="lp-btn lp-btn-lime" href="#signin">
                  Sign in to the Console
                </a>
              </div>
              <div className="lp-role">
                <h3>Gate guards</h3>
                <p className="lp-who">Use the gate app on an Android phone.</p>
                <ul className="lp-ticks">
                  <li>PIN sign-in on an enrolled phone</li>
                  <li>Large buttons for entry, exit and payment</li>
                  <li>Hindi and English</li>
                  <li>Keeps working without network</li>
                </ul>
                <a className="lp-btn lp-btn-ghost" href="#contact">
                  Ask about the gate app
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- contact ---------- */}
        <section className="lp-block" id="contact">
          <div className="lp-wrap">
            <div className="lp-cta">
              <div className="lp-cta-copy">
                <span className="lp-eyebrow">Get started</span>
                <h2>Bring PlanMyParking to your facility</h2>
                <p>
                  Tell us about your lot, its gates and its zones. We will walk you through the gate
                  app and the Console.
                </p>
              </div>
              <div className="lp-contact">
                <a
                  className="lp-contact-row"
                  href={CONTACT.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="lp-contact-ico" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.5h4V21H3zM9.5 9.5h3.8v1.6h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.1c0-1.22-.02-2.79-1.7-2.79-1.7 0-1.96 1.33-1.96 2.7V21h-4z" />
                    </svg>
                  </span>
                  <span>
                    <b>LinkedIn</b>
                    <small>linkedin.com/company/planmyparking</small>
                  </span>
                  <Icon name="arrowRight" size={16} />
                </a>
                <CopyPhone display={CONTACT.phoneDisplay} href={CONTACT.phoneHref} />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap">
          <Wordmark />
          <nav aria-label="Footer">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#contact">Contact</a>
            <a href="/login">Console sign in</a>
          </nav>
          <span>© {new Date().getFullYear()} PlanMyParking</span>
        </div>
      </footer>
    </div>
  );
}
