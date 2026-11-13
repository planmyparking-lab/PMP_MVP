import { formatRupees, parseTariff } from "@pmp/contracts";
import type { Tariff } from "@pmp/contracts";

/**
 * Read-only view of a facility's configuration (migration 0001: zones, tariffs, passes). Tariff rule JSON is checked
 * with the shared IC-04 schema (`parseTariff`); a row that does not parse is reported, never summarised from guesses.
 */
export type TariffSummary =
  | {
      ok: true;
      model: Tariff["model"];
      lines: string[];
      effectiveFrom: string;
      effectiveTo: string | null;
    }
  | { ok: false; error: string };

const hhmm = (s: string) => `${s.slice(0, 2)}:${s.slice(2, 4)}`;

const mins = (m: number) =>
  m % 60 === 0 ? `${m / 60} h` : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;

export function describeTariff(ruleJson: unknown): TariffSummary {
  const parsed = parseTariff(ruleJson);
  if (!parsed.ok) {
    const first = parsed.issues[0];
    return {
      ok: false,
      error: `Rule does not match the tariff contract${first ? ` (${first.path.map(String).join(".") || "rule"}: ${first.message})` : ""}`,
    };
  }
  const t = parsed.value;
  const lines: string[] = [];
  if (t.model === "HOURLY_SLABS") {
    let from = 0;
    for (const s of t.slabs) {
      if (s.upToMinutes === null) break;
      lines.push(
        `${from === 0 ? "Up to" : `${mins(from)} to`} ${mins(s.upToMinutes)}: ${formatRupees(s.pricePaise)}`,
      );
      from = s.upToMinutes;
    }
    if (t.repeat) {
      lines.push(
        `After that: ${formatRupees(t.repeat.pricePaise)} for every started ${mins(t.repeat.everyMinutes)}`,
      );
    }
  } else if (t.model === "FLAT") {
    lines.push(`${formatRupees(t.flatPaise)} for every started 24 h`);
  } else {
    lines.push(`${formatRupees(t.flatPaise)} once per entry, however long the stay`);
  }
  if (t.graceMinutes > 0) lines.push(`First ${mins(t.graceMinutes)} free`);
  if (t.minimumPaise !== undefined) lines.push(`Minimum ${formatRupees(t.minimumPaise)}`);
  if (t.dayCapPaise !== undefined) lines.push(`At most ${formatRupees(t.dayCapPaise)} per day`);
  if (t.night) {
    const extra =
      t.night.surchargePaise !== undefined
        ? `${formatRupees(t.night.surchargePaise)} added`
        : `${t.night.multiplierPercent}% of the fare added on top`;
    lines.push(`Stay touching ${hhmm(t.night.fromHHMM)}–${hhmm(t.night.toHHMM)} (night): ${extra}`);
  }
  return {
    ok: true,
    model: t.model,
    lines,
    effectiveFrom: t.effectiveFrom,
    effectiveTo: t.effectiveTo ?? null,
  };
}

/**
 * `MH12AB1234` -> `MH••••••34`: the state code and the last two characters, enough for staff to recognise a pass but
 * never more than four characters of any plate (OQ-26). Plates shorter than eight characters are hidden completely,
 * because their first and last two would be most of the plate.
 */
export function maskPlate(plate: string): string {
  const p = plate.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (p.length < 8) return "••••";
  return `${p.slice(0, 2)}${"•".repeat(p.length - 4)}${p.slice(-2)}`;
}

export type PassState = "active" | "expiring" | "expired";

/** Expiring = valid for 7 more days or fewer, counting `today` (both are yyyy-mm-dd civil dates). */
export function passState(validTo: string, today: string): PassState {
  if (validTo < today) return "expired";
  const days = (Date.parse(`${validTo}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return days <= 7 ? "expiring" : "active";
}
