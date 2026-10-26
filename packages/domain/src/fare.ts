import { parseTariff } from "@pmp/contracts";
import type { Paise, Tariff } from "@pmp/contracts";

/**
 * Fare engine (feature GATE-03, integration contract IC-04). Pure and deterministic: no I/O, no
 * clock reads, no randomness, integer paise only. See docs/team/member-02-nikhil.md section
 * GATE-03 (rule model and the 60-case fixture table).
 *
 * Semantics implemented here (entry-date tariff selection remains an open decision; night and
 * open-ended slab semantics below are provisional and require partner confirmation):
 * - Inputs are parsed defensively; a tariff that does not satisfy the IC-04 schema throws
 *   `FareError("INVALID_TARIFF")` instead of silently pricing (callers may pre-validate with
 *   `parseTariff`).
 * - `exitAt < entryAt` -> `INVALID_RANGE` (F10-1). Callers that want to salvage clock-skewed exits
 *   clamp the times themselves before calling (GATE-02 screen rule).
 * - Duration is whole minutes rounded up; a duration within `graceMinutes` prices 0 for the whole
 *   stay (grace is a threshold, it is not subtracted from priced minutes; F2-2 proves this).
 * - Effective date: the tariff must cover the entry instant's IST date (the tariff in force at
 *   entry applies to the whole stay; recommended default of OQ-20, recorded back as
 *   `tariff_version` on the EXIT event). Date bounds are inclusive.
 * - The priceable stay is split into 1440-minute blocks counted from entry; each block is priced
 *   from zero on the same rules (no second grace) and capped at `dayCapPaise`; PER_ENTRY is priced
 *   once for the whole stay instead (F6-4: "per entry, no daily repeat").
 * - Night window (`fromHHMM`-`toHHMM` IST, may wrap midnight, end-exclusive) adds its surcharge
 *   once for the stay after caps when any minute of `[entryAt, exitAt)` falls inside the window
 *   (F8-5: a stay starting exactly at the window end does not overlap). With `multiplierPercent`
 *   (interim default): a percent of the post-cap subtotal, rounded half-up.
 * - `minimumPaise` is applied last to the total (F12-2).
 * - Instant equality across time zones holds: instants are compared in UTC epoch milliseconds and
 *   IST is a fixed +05:30 offset (F11-4, F11-5). India has no DST, so this is exact.
 *
 * Every error is a typed `FareError`, never a silent zero, never a non-integer amount, and inputs
 * are never mutated (T-GATE-03-U8).
 */

export type FareErrorCode =
  | "NO_TARIFF" // null tariff or tariff not effective on the entry's IST date (F9-5, F10-3)
  | "INVALID_RANGE" // exitAt before entryAt or an unparseable instant (F10-1, F10-4)
  | "CLASS_MISMATCH" // tariff.vehicleClass !== vehicleClass argument (F10-2)
  | "INVALID_TARIFF" // tariff failed IC-04 schema validation (F10-5; see T-GATE-03-N1)
  | "FARE_OVERFLOW"; // result is outside the safe integer-paise range

export class FareError extends Error {
  readonly code: FareErrorCode;

  constructor(code: FareErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "FareError";
    this.code = code;
  }
}

export function isFareError(e: unknown): e is FareError {
  return e instanceof FareError;
}

/** India Standard Time offset: UTC+05:30 in minutes (fixed; India has no daylight saving). */
export const IST_OFFSET_MINUTES = 330;
const MS_PER_MINUTE = 60_000;
const DAY_MINUTES = 1440;

export type FareStep = {
  /** Short machine label; UI copy lives with the callers, not here. */
  label: "duration" | "grace" | "blocks" | "night" | "minimum";
  detail?: string;
  /** Running total in paise after this step. */
  paiseAfter: Paise;
};

export type FareComputation = {
  farePaise: Paise;
  tariffId: string;
  model: Tariff["model"];
  vehicleClass: string;
  /** The entry instant's IST date (YYYY-MM-DD) used for the effective-date check. */
  effectiveDate: string;
  durationMinutes: number;
  graceApplied: boolean;
  /**
   * One representative entry for repeated full 1440-minute blocks, followed by an optional remainder.
   * The number of full blocks is included in the `blocks` step detail and derivable from durationMinutes.
   */
  blocks: { index: number; minutes: number; rawPaise: Paise; cappedPaise: Paise }[];
  /** True when any minute of the stay falls inside the tariff's night window. */
  nightOverlap: boolean;
  /** Night surcharge/multiplier amount added after the capped block sum. */
  nightPaise: Paise;
  /** True when `minimumPaise` raised the total. */
  minimumRaised: boolean;
  /** Human-followable step list for the Console "try it" panel and dispute resolution. */
  steps: FareStep[];
};

/**
 * Instant strings accepted by the IC-04 contract: full-seconds ISO 8601 with a trailing `Z` or an
 * explicit offset (F11 rows, GATE-02 "device_time UTC ISO 8601"). Everything else (including
 * space-separated strings that engines silently parse as LOCAL time) is rejected as
 * INVALID_RANGE instead of being misread.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/** Strict ISO instant parser shared with GATE-02's tariff selection; null for anything unparseable. */
export function parseInstant(iso: string): number | null {
  if (typeof iso !== "string" || !ISO_INSTANT.test(iso)) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** The instant's calendar date in IST as YYYY-MM-DD (compared string-wise against tariff bounds). */
export function istDateString(ms: number): string {
  const shifted = new Date(ms + IST_OFFSET_MINUTES * MS_PER_MINUTE);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "2200" -> 1320. Shape is guaranteed by the tariff regex. */
function hhmmToMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
}

/**
 * Does `[entryMs, exitMs)` overlap the IST (midnight-maybe-wrapping) window [from, to)?
 * Calculated in the IST-shifted periodic frame of a 1440-minute day: the stay is the ms interval
 * [e0, e0 + dMs), taken modulo the 1440-minute cycle; a segment overlaps when it intersects the
 * direct or the wrapped remainder. Exact at millisecond precision; a stay spanning a full cycle
 * overlaps every non-empty segment.
 */
function overlapsNightWindow(entryMs: number, exitMs: number, from: number, to: number): boolean {
  const cycleMs = DAY_MINUTES * MS_PER_MINUTE;
  const dMs = exitMs - entryMs;
  if (dMs <= 0) return false; // empty stay has no minutes to overlap
  if (dMs >= cycleMs) return true;
  const e0 = (entryMs + IST_OFFSET_MINUTES * MS_PER_MINUTE) % cycleMs;
  const f1 = e0 + dMs;
  const segments =
    from <= to
      ? ([[from, to]] as [number, number][])
      : ([
          [from, DAY_MINUTES],
          [0, to],
        ] as [number, number][]);
  for (const [s, e] of segments) {
    if (e === s) continue; // zero-length window never overlaps
    const segStartMs = s * MS_PER_MINUTE;
    const segEndMs = e * MS_PER_MINUTE;
    if (segStartMs < f1 && e0 < segEndMs) return true; // direct hit
    if (f1 > cycleMs && segStartMs < f1 - cycleMs) return true; // wrapped tail after midnight
  }
  return false;
}

/** Raw (uncapped) price of one block of `minutes` priced from zero on the tariff's own rules. */
function priceBlockFromZero(tariff: Tariff, minutes: number): number {
  if (tariff.model === "FLAT") return safePaise(tariff.flatPaise);
  if (tariff.model !== "HOURLY_SLABS" || tariff.repeat === undefined) {
    throw new FareError("INVALID_TARIFF", "tariff model does not define per-duration pricing");
  }
  for (const slab of tariff.slabs) {
    if (slab.upToMinutes !== null && minutes <= slab.upToMinutes) {
      return safePaise(slab.pricePaise); // cumulative band: flat price for the whole duration
    }
  }
  // Beyond the last finite band: started repeat units (F2-4: 181 min -> 1 unit).
  let lastFinite: { upToMinutes: number; pricePaise: number } | null = null;
  for (let i = tariff.slabs.length - 1; i >= 0; i--) {
    const slab = tariff.slabs[i];
    if (slab && slab.upToMinutes !== null) {
      lastFinite = { upToMinutes: slab.upToMinutes, pricePaise: slab.pricePaise };
      break;
    }
  }
  if (lastFinite === null) {
    throw new FareError("INVALID_TARIFF", "slabs contain no finite band");
  }
  const units = Math.ceil((minutes - lastFinite.upToMinutes) / tariff.repeat.everyMinutes);
  return safePaise(lastFinite.pricePaise + units * tariff.repeat.pricePaise);
}

/**
 * Whole minutes from entry to exit, rounded up. Exported because the gate exit screen, the
 * fixture table and dispute tooling all talk in rounded-up minutes.
 */
export function durationMinutes(entryAt: string, exitAt: string): number {
  const entry = parseInstant(entryAt);
  const exit = parseInstant(exitAt);
  if (entry === null || exit === null || exit < entry) {
    throw new FareError("INVALID_RANGE", "times must be UTC ISO 8601 instants, exitAt >= entryAt");
  }
  return wholeMinutesUpTo(exit - entry);
}

function wholeMinutesUpTo(diffMs: number): number {
  const whole = Math.floor(diffMs / MS_PER_MINUTE);
  return diffMs % MS_PER_MINUTE > 0 ? whole + 1 : whole;
}

function safePaise(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FareError("FARE_OVERFLOW", "fare exceeds the safe integer-paise range");
  }
  return value;
}

export function computeFare(
  tariff: Tariff | null | undefined,
  entryAt: string,
  exitAt: string,
  vehicleClass: string,
): FareComputation {
  if (tariff === null || tariff === undefined) {
    throw new FareError("NO_TARIFF", "no tariff for this facility, class and date");
  }
  const parsed = parseTariff(tariff);
  if (!parsed.ok) {
    const issue = parsed.issues[0]?.message ?? "tariff schema validation failed";
    throw new FareError("INVALID_TARIFF", `validate the tariff first: ${issue}`);
  }
  const t: Tariff = parsed.value;

  if (t.vehicleClass !== vehicleClass) {
    throw new FareError(
      "CLASS_MISMATCH",
      `tariff ${t.id} is for class ${t.vehicleClass}, not ${vehicleClass}`,
    );
  }

  const entryMs = parseInstant(entryAt);
  const exitMs = parseInstant(exitAt);
  if (entryMs === null || exitMs === null) {
    throw new FareError("INVALID_RANGE", "times must be UTC ISO 8601 instants");
  }
  if (exitMs < entryMs) {
    throw new FareError("INVALID_RANGE", "exitAt is before entryAt");
  }
  const duration = wholeMinutesUpTo(exitMs - entryMs);

  const effectiveDate = istDateString(entryMs);
  if (
    effectiveDate < t.effectiveFrom ||
    (t.effectiveTo !== undefined && effectiveDate > t.effectiveTo)
  ) {
    throw new FareError(
      "NO_TARIFF",
      `tariff ${t.id} is not effective on ${effectiveDate} (IST entry date)`,
    );
  }

  const steps: FareStep[] = [
    { label: "duration", detail: `${duration} min rounded up`, paiseAfter: 0 },
  ];

  // Grace is a threshold on the whole stay (F1-3/F1-4): within grace the stay prices 0.
  if (duration <= t.graceMinutes) {
    steps.push({ label: "grace", detail: `within grace ${t.graceMinutes} min`, paiseAfter: 0 });
    return {
      farePaise: 0,
      tariffId: t.id,
      model: t.model,
      vehicleClass,
      effectiveDate,
      durationMinutes: duration,
      graceApplied: true,
      blocks: [],
      nightOverlap: false,
      nightPaise: 0,
      minimumRaised: false,
      steps,
    };
  }

  // Per-stay base: PER_ENTRY is priced once; identical full blocks are priced together and exposed compactly.
  const blocks: FareComputation["blocks"] = [];
  let subtotal = 0;
  if (t.model === "PER_ENTRY") {
    subtotal = safePaise(t.flatPaise);
    steps.push({ label: "blocks", detail: "per entry, once", paiseAfter: subtotal });
  } else {
    const fullBlocks = Math.floor(duration / DAY_MINUTES);
    const remainder = duration % DAY_MINUTES;
    if (fullBlocks > 0) {
      const raw = priceBlockFromZero(t, DAY_MINUTES);
      const capped = t.dayCapPaise === undefined ? raw : Math.min(raw, t.dayCapPaise);
      subtotal = safePaise(subtotal + safePaise(capped * fullBlocks));
      blocks.push({ index: 1, minutes: DAY_MINUTES, rawPaise: raw, cappedPaise: capped });
    }
    if (remainder > 0) {
      const raw = priceBlockFromZero(t, remainder);
      const capped = t.dayCapPaise === undefined ? raw : Math.min(raw, t.dayCapPaise);
      subtotal = safePaise(subtotal + capped);
      blocks.push({
        index: fullBlocks + 1,
        minutes: remainder,
        rawPaise: raw,
        cappedPaise: capped,
      });
    }
    if (fullBlocks === 0) {
      steps.push({
        label: "blocks",
        detail: `${duration} min block${t.dayCapPaise === undefined ? "" : " capped"}`,
        paiseAfter: subtotal,
      });
    } else {
      steps.push({
        label: "blocks",
        detail: `${fullBlocks} full block(s) at ${blocks[0]?.cappedPaise ?? 0} paise${
          remainder > 0 ? " plus remainder" : ""
        }`,
        paiseAfter: subtotal,
      });
    }
  }

  // Night window: surcharge added once after caps (or percent of the subtotal, pending confirmation).
  let nightOverlap = false;
  let nightPaise = 0;
  if (t.night !== undefined) {
    const from = hhmmToMinutes(t.night.fromHHMM);
    const to = hhmmToMinutes(t.night.toHHMM);
    nightOverlap = overlapsNightWindow(entryMs, exitMs, from, to);
    if (nightOverlap) {
      const multiplier = t.night.multiplierPercent ?? 0;
      nightPaise = safePaise(
        t.night.surchargePaise !== undefined
          ? t.night.surchargePaise
          : Number((BigInt(subtotal) * BigInt(multiplier) + 50n) / 100n),
      );
    }
  }
  subtotal = safePaise(subtotal + nightPaise);
  if (nightPaise > 0) {
    steps.push({ label: "night", detail: `night window overlap`, paiseAfter: subtotal });
  }

  let minimumRaised = false;
  if (t.minimumPaise !== undefined && subtotal < t.minimumPaise) {
    subtotal = safePaise(t.minimumPaise);
    minimumRaised = true;
    steps.push({ label: "minimum", detail: "raised to minimum", paiseAfter: subtotal });
  }

  return {
    farePaise: subtotal,
    tariffId: t.id,
    model: t.model,
    vehicleClass,
    effectiveDate,
    durationMinutes: duration,
    graceApplied: false,
    blocks,
    nightOverlap,
    nightPaise,
    minimumRaised,
    steps,
  };
}

/**
 * Fare for a (already or defensively validated) tariff, in integer paise. Throws `FareError`;
 * never returns a floating-point, negative or silent-zero amount.
 */
export function fare(
  tariff: Tariff | null | undefined,
  entryAt: string,
  exitAt: string,
  vehicleClass: string,
): Paise {
  return computeFare(tariff, entryAt, exitAt, vehicleClass).farePaise;
}
