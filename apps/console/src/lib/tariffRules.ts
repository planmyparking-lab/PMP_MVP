/**
 * CON-01 wizard validation (T-CON-01-U1 to U5). Pure functions; the tariff rule JSON itself belongs to the
 * fare engine (IC-04), so only the form-level rules listed in the CON-01 sheet are checked here.
 */
export interface Slab {
  fromMinute: number;
  toMinute: number;
  pricePaise: number;
}

export interface Problem {
  code: "gap" | "overlap" | "invalid";
  message: string;
}

const isWhole = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

export function validateSlabs(slabs: readonly Slab[]): Problem[] {
  const problems: Problem[] = [];
  slabs.forEach((s, i) => {
    if (
      !isWhole(s.fromMinute) ||
      !isWhole(s.toMinute) ||
      !isWhole(s.pricePaise) ||
      s.toMinute <= s.fromMinute
    ) {
      problems.push({ code: "invalid", message: `Slab ${i + 1} is not a valid range and price.` });
    }
  });
  if (problems.length > 0) return problems;
  const sorted = [...slabs].sort((a, b) => a.fromMinute - b.fromMinute);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.fromMinute > prev.toMinute) {
      problems.push({
        code: "gap",
        message: `Gap between minute ${prev.toMinute} and minute ${cur.fromMinute}.`,
      });
    } else if (cur.fromMinute < prev.toMinute) {
      problems.push({
        code: "overlap",
        message: `Overlap between minute ${cur.fromMinute} and minute ${prev.toMinute}.`,
      });
    }
  }
  return problems;
}

/** The day cap must not be below the highest single slab price. */
export function dayCapBelowSlab(slabs: readonly Slab[], dayCapPaise: number): boolean {
  return slabs.some((s) => dayCapPaise < s.pricePaise);
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A night window may cross midnight (22:00 to 06:00); it cannot be empty (start equal to end). */
export function validateNightWindow(start: string, end: string): boolean {
  return TIME.test(start) && TIME.test(end) && start !== end;
}

export function validateZoneCapacity(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** A sum of zone capacities that differs from the slot count is a warning, never an error. */
export function capacityWarning(
  zoneCapacities: readonly number[],
  slotCount: number,
): string | null {
  const sum = zoneCapacities.reduce((a, b) => a + b, 0);
  return sum === slotCount
    ? null
    : `Zone capacities add up to ${sum}, but the facility has ${slotCount} slots.`;
}

/** Grace minutes: a whole number of 0 or more. */
export function validateGraceMinutes(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A NEW tariff version may not take effect in the past. Both arguments are `yyyy-mm-dd` civil dates (the
 * caller passes today's IST date); the same day is allowed. Nothing else about the date is checked here.
 */
export function validateEffectiveFrom(effectiveFrom: string, todayIst: string): boolean {
  return CIVIL_DATE.test(effectiveFrom) && CIVIL_DATE.test(todayIst) && effectiveFrom >= todayIst;
}

/** Vehicle classes a facility allows (from its zones) that have no tariff: each needs one before activation. */
export function classesWithoutTariff(
  zones: readonly { vehicleClass: string }[],
  tariffs: readonly { vehicleClass: string }[],
): string[] {
  const priced = new Set(tariffs.map((t) => t.vehicleClass));
  return [...new Set(zones.map((z) => z.vehicleClass))].filter((c) => !priced.has(c)).sort();
}

/** Tariffs whose vehicle class no zone allows any more: a warning when a class is removed from a zone. */
export function tariffClassesWithoutZone(
  zones: readonly { vehicleClass: string }[],
  tariffs: readonly { vehicleClass: string }[],
): string[] {
  const allowed = new Set(zones.map((z) => z.vehicleClass));
  return [...new Set(tariffs.map((t) => t.vehicleClass))].filter((c) => !allowed.has(c)).sort();
}

export type WizardStep = 1 | 2 | 3 | 4 | 5;

/** "Activate" is enabled only when steps 1 to 5 are valid; returns the steps still to fix (empty = ready). */
export function activationBlockers(valid: Readonly<Record<WizardStep, boolean>>): WizardStep[] {
  return ([1, 2, 3, 4, 5] as const).filter((step) => valid[step] !== true);
}
