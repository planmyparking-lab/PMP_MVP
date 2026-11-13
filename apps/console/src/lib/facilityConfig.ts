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

/** Valid and expiring passes shown, soonest expiry first. */
export const PASS_LIMIT = 500;
/** Expired passes shown after them, most recently expired first. */
export const EXPIRED_PASS_LIMIT = 50;

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

/**
 * Which version of each vehicle class's tariff applies at `nowIso`: per class, the newest version that has started is
 * `current`, versions starting later are `scheduled`, and older ones are `replaced`. A row whose start cannot be read is
 * `unknown`, never guessed into place.
 */
export type TariffStatus = "current" | "scheduled" | "replaced" | "unknown";

export function tariffStatuses(
  rows: ReadonlyArray<{ id: string; vehicleClass: string; effectiveFrom: string }>,
  nowIso: string,
): Record<string, TariffStatus> {
  const now = Date.parse(nowIso);
  const out: Record<string, TariffStatus> = {};
  const byClass = new Map<string, { id: string; start: number }[]>();
  for (const r of rows) {
    const start = Date.parse(r.effectiveFrom);
    if (!Number.isFinite(start)) {
      out[r.id] = "unknown";
      continue;
    }
    const list = byClass.get(r.vehicleClass) ?? [];
    list.push({ id: r.id, start });
    byClass.set(r.vehicleClass, list);
  }
  for (const list of byClass.values()) {
    list.sort((a, b) => b.start - a.start || (a.id < b.id ? -1 : 1));
    let currentFound = false;
    for (const t of list) {
      if (t.start > now) out[t.id] = "scheduled";
      else if (!currentFound) {
        out[t.id] = "current";
        currentFound = true;
      } else out[t.id] = "replaced";
    }
  }
  return out;
}

/**
 * The fare engine decides whether a tariff applies from the rule's own `effectiveFrom` (an IST calendar date), while
 * the row's `effective_from` is a timestamp. When the two name different days the page says so, because the date shown
 * and the date the gate phones apply would disagree.
 */
export function effectiveDateMismatch(
  rowLocalDate: string | null,
  ruleDate: string | null,
): string | null {
  if (!rowLocalDate || !ruleDate || rowLocalDate === ruleDate) return null;
  return `The rule starts on ${ruleDate}, the tariff row on ${rowLocalDate}. The gate phones use the rule's date.`;
}
