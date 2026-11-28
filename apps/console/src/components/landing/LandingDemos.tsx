"use client";

import { useEffect, useRef, useState } from "react";
import { occupancyView } from "../../lib/occupancyBand";
import type { OccupancyBand } from "../../lib/occupancyBand";
import { Icon } from "../ui/Icon";

/** Starts timers only when the visitor has not asked for reduced motion. */
function useMotionAllowed(): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAllowed(!query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return allowed;
}

/* ------------------------------------------------------------------ live lot */

export interface LotZone {
  id: string;
  name: string;
  capacity: number;
}

export const LOT_ZONES: LotZone[] = [
  { id: "A", name: "Zone A · Cars", capacity: 16 },
  { id: "B", name: "Zone B · Cars", capacity: 16 },
  { id: "C", name: "Zone C · Bikes", capacity: 12 },
];

/** Deterministic starting lot (same on server and client, so hydration matches): A 11/16, B 14/16, C 7/12. */
export function initialLot(): boolean[][] {
  const start = [11, 14, 7];
  return LOT_ZONES.map((z, zi) =>
    Array.from({ length: z.capacity }, (_, i) => (i * 7 + zi * 3) % z.capacity < start[zi]),
  );
}

/** One car enters or leaves. Each zone stays between 40% and 100% full, so the bands change without the lot
 * emptying. Pure, so it can be tested. */
export function nextLotStep(
  lot: boolean[][],
  r: number,
): { lot: boolean[][]; key: string; entered: boolean } | null {
  const zi = r % lot.length;
  const zone = lot[zi];
  const filled = zone.filter(Boolean).length;
  const entered =
    filled / zone.length < 0.4 ? true : filled === zone.length ? false : (r >> 8) % 3 !== 0;
  const candidates = zone.map((taken, i) => (taken !== entered ? i : -1)).filter((i) => i >= 0);
  if (candidates.length === 0) return null;
  const slot = candidates[(r >> 4) % candidates.length];
  const next = lot.map((z) => z.slice());
  next[zi][slot] = entered;
  return { lot: next, key: `${zi}-${slot}`, entered };
}

const BAND_LABEL: Record<OccupancyBand, string> = {
  low: "Room",
  medium: "Filling",
  high: "Nearly full",
};

export function LiveLotDemo() {
  const motion = useMotionAllowed();
  const [lot, setLot] = useState<boolean[][]>(initialLot);
  const [fresh, setFresh] = useState<string | null>(null);
  const seed = useRef(7);
  const lotRef = useRef(lot);
  useEffect(() => {
    lotRef.current = lot;
  }, [lot]);

  useEffect(() => {
    if (!motion) return;
    const timer = window.setInterval(() => {
      // Small linear congruential generator: varied but repeatable, no Math.random.
      seed.current = (seed.current * 1103515245 + 12345) % 2147483648;
      const step = nextLotStep(lotRef.current, seed.current);
      if (!step) return;
      setLot(step.lot);
      setFresh(step.entered ? step.key : null);
    }, 1300);
    return () => window.clearInterval(timer);
  }, [motion]);

  const totals = lot.reduce(
    (acc, zone) => ({ used: acc.used + zone.filter(Boolean).length, cap: acc.cap + zone.length }),
    { used: 0, cap: 0 },
  );
  const overall = Math.round((totals.used / totals.cap) * 100);

  return (
    <div className="lp-lot" aria-label="Example parking lot, animated">
      <div className="lp-lot-head">
        <div className="lp-ring" style={{ ["--p" as string]: overall }}>
          <span>
            <b>{overall}%</b>
            <small>full</small>
          </span>
        </div>
        <div>
          <span className="lp-live">
            <i /> Example lot
          </span>
          <p className="lp-lot-total">
            <b>{totals.cap - totals.used}</b> free of {totals.cap} slots
          </p>
        </div>
      </div>

      <div className="lp-zones">
        {LOT_ZONES.map((z, zi) => {
          const used = lot[zi].filter(Boolean).length;
          const view = occupancyView(used, z.capacity);
          return (
            <div key={z.id} className={`lp-zone lp-band-${view.band}`}>
              <div className="lp-zone-top">
                <b>{z.name}</b>
                <span className="lp-band">{BAND_LABEL[view.band]}</span>
              </div>
              <div className={`lp-slots ${z.id === "C" ? "lp-slots-bike" : ""}`}>
                {lot[zi].map((taken, i) => (
                  <span
                    key={i}
                    className={`lp-slot${taken ? " lp-taken" : ""}${fresh === `${zi}-${i}` ? " lp-fresh" : ""}`}
                  />
                ))}
              </div>
              <div className="lp-zone-foot">
                <span>
                  {z.capacity - used} free · {used}/{z.capacity}
                </span>
                <span className="lp-bar">
                  <span style={{ width: `${Math.round(view.percent)}%` }} />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ gate phone */

/** Copied from apps/gate/src/i18n/{en,hi}.json (exit, payment, banner, classes) so the demo shows the real wording. */
export const GATE_TEXT = {
  en: {
    title: "Vehicle exit",
    offline: "Offline — saved on this phone",
    class: "Class",
    classValue: "Car",
    zone: "Zone",
    duration: "Duration",
    fare: "Fare",
    choose: "Choose payment",
    cash: "Cash",
    upi: "UPI received",
    pass: "Pass",
    waive: "Waive",
    upiHint: "Ask customer to scan your UPI QR",
  },
  hi: {
    title: "वाहन एग्ज़िट",
    offline: "ऑफ़लाइन — इस फोन पर सेव है",
    class: "श्रेणी",
    classValue: "कार",
    zone: "ज़ोन",
    duration: "समय",
    fare: "किराया",
    choose: "भुगतान चुनें",
    cash: "नकद",
    upi: "UPI प्राप्त",
    pass: "पास",
    waive: "माफ",
    upiHint: "ग्राहक से कहें कि आपका UPI QR स्कैन करें",
  },
} as const;

export function GatePhoneDemo() {
  const [lang, setLang] = useState<"en" | "hi">("en");
  const [paid, setPaid] = useState<string | null>(null);
  const t = GATE_TEXT[lang];

  return (
    <div className="lp-phone-wrap">
      <div className="lp-lang" role="group" aria-label="Gate app language">
        <button
          type="button"
          suppressHydrationWarning
          aria-pressed={lang === "en"}
          onClick={() => setLang("en")}
        >
          English
        </button>
        <button
          type="button"
          suppressHydrationWarning
          aria-pressed={lang === "hi"}
          onClick={() => setLang("hi")}
          lang="hi"
        >
          हिन्दी
        </button>
      </div>
      <div className="lp-phone" lang={lang}>
        <div className="lp-phone-notch" />
        <div className="lp-phone-screen">
          <div className="lp-phone-banner">
            <Icon name="plugOff" size={13} /> {t.offline}
          </div>
          <h4>{t.title}</h4>
          <dl className="lp-phone-kv">
            <div>
              <dt>{t.class}</dt>
              <dd>{t.classValue}</dd>
            </div>
            <div>
              <dt>{t.zone}</dt>
              <dd>B</dd>
            </div>
            <div>
              <dt>{t.duration}</dt>
              <dd>2h 35m</dd>
            </div>
          </dl>
          <p className="lp-phone-fare">
            <span>{t.fare}</span>
            <b>₹60.00</b>
          </p>
          <p className="lp-phone-label">{t.choose}</p>
          <div className="lp-phone-pay">
            {(["cash", "upi", "pass", "waive"] as const).map((k) => (
              <button
                key={k}
                type="button"
                suppressHydrationWarning
                className={`lp-pay lp-pay-${k}${paid === k ? " lp-pay-on" : ""}`}
                onClick={() => setPaid(k)}
              >
                {t[k]}
              </button>
            ))}
          </div>
          <p className="lp-phone-hint">{t.upiHint}</p>
        </div>
      </div>
      <p className="lp-note">Example screen. Fare and times are sample values.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ offline sync */

export function SyncDemo() {
  const [online, setOnline] = useState(false);
  const [queue, setQueue] = useState(3);
  const [synced, setSynced] = useState(41);
  const [inFlight, setInFlight] = useState(0);

  // While online, upload one queued event at a time, like the outbox does.
  useEffect(() => {
    if (!online || queue === 0) return;
    const timer = window.setTimeout(() => {
      setQueue((q) => q - 1);
      setInFlight((n) => n + 1);
      window.setTimeout(() => {
        setInFlight((n) => n - 1);
        setSynced((s) => s + 1);
      }, 650);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [online, queue]);

  const logVehicle = () => setQueue((q) => q + 1);

  return (
    <div className="lp-sync" aria-label="Try it: offline sync example">
      <div className="lp-sync-side">
        <span className="lp-sync-tag">
          <Icon name="device" size={14} /> Gate phone
        </span>
        <p className={online ? "lp-net lp-net-on" : "lp-net"}>
          {online ? "Online — uploading" : "Offline — saved on this phone"}
        </p>
        <p className="lp-big">
          <b>{queue}</b> waiting to sync
        </p>
        <div className="lp-sync-actions">
          <button
            type="button"
            suppressHydrationWarning
            className="lp-btn lp-btn-lime"
            onClick={logVehicle}
          >
            Log a vehicle
          </button>
          <button
            type="button"
            suppressHydrationWarning
            className="lp-switch"
            role="switch"
            aria-checked={online}
            onClick={() => setOnline((o) => !o)}
          >
            <span className="lp-switch-knob" />
            Network {online ? "on" : "off"}
          </button>
        </div>
      </div>

      <div className={`lp-wire${online ? " lp-wire-on" : ""}`} aria-hidden="true">
        <span className="lp-wire-line" />
        {Array.from({ length: Math.min(inFlight, 3) }, (_, i) => (
          <span key={i} className="lp-packet" style={{ animationDelay: `${i * 0.12}s` }} />
        ))}
        {!online && <span className="lp-wire-cut">✕</span>}
      </div>

      <div className="lp-sync-side lp-sync-console">
        <span className="lp-sync-tag">
          <Icon name="dashboard" size={14} /> Console
        </span>
        <p className="lp-big">
          <b>{synced}</b> vehicles today
        </p>
        <p className="lp-sync-sub">
          {queue > 0 && !online
            ? `${queue} more will appear when the phone reconnects.`
            : "Up to date with the gate."}
        </p>
      </div>
      <p className="lp-note lp-sync-note">
        Try it: log a few vehicles with the network off, then switch it on. Example numbers.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ contact */

export function CopyPhone({ display, href }: { display: string; href: string }) {
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard refused: select the number so the visitor can copy it by hand.
      const node = textRef.current;
      if (node) window.getSelection()?.selectAllChildren(node);
    }
  };

  return (
    <div className="lp-contact-row">
      <span className="lp-contact-ico" aria-hidden="true">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
        </svg>
      </span>
      <span>
        <b>Call us</b>
        <a href={href} className="lp-phone-link">
          <small ref={textRef}>{display}</small>
        </a>
      </span>
      <button
        type="button"
        suppressHydrationWarning
        className="lp-copybtn"
        onClick={() => void copy()}
        aria-label="Copy phone number"
      >
        <Icon name={copied ? "check" : "copy"} size={15} />
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}
