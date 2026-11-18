"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { formatIstDateTime } from "../lib/format";

/**
 * Re-runs the server loaders every `seconds` while the tab is visible (CON-04: 10-second polling until
 * Realtime is wired). Shows when the data on screen was read.
 */
export function LiveRefresh({ asOf, seconds = 10 }: { asOf: string; seconds?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") start(() => router.refresh());
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [paused, router, seconds]);

  return (
    <button
      suppressHydrationWarning
      type="button"
      className={`live-pill${paused ? " paused" : ""}${pending ? " busy" : ""}`}
      onClick={() => setPaused((p) => !p)}
      aria-pressed={!paused}
      title={paused ? "Auto-refresh paused. Click to resume." : "Auto-refresh on. Click to pause."}
    >
      <span className="live-dot" aria-hidden="true" />
      {paused ? "Paused" : "Live"}
      <span className="live-time">· {formatIstDateTime(asOf).split(", ")[1]}</span>
    </button>
  );
}
