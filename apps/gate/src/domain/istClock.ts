import { IST_OFFSET_MINUTES } from "@pmp/domain";

/**
 * IST display time (HH:MM) for receipts, banners and shift summaries (GATE-06/10 display
 * times are IST; storage stays UTC instants per the repo invariant).
 */
export { IST_OFFSET_MINUTES };

/** 1761_ish → "14:35" — the UTC-shifted wall clock, no seconds (display-only). */
export function istClockTime(ms: number): string {
  const shifted = new Date(ms + IST_OFFSET_MINUTES * 60_000);
  if (Number.isNaN(shifted.getTime())) return "--:--";
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
