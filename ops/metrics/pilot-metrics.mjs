// MET-01..03 calculations. Formulas: docs/team/member-03-anamika.md sections C14 to C16, D14.
// Rows are plain objects with the column names of audit-sheet.csv / adherence-sheet.csv.
// Unresolved choices are parameters, not defaults (see OQ-35).

export const ZONE_BAR = 0.95;
export const FACILITY_BAR = 0.97;

// Input contract for vehicle counts (physical_count, system_count and the adherence entry counts), decided in
// OQ-38 (Afzal): a count is a whole number of vehicles, 0 or more. These functions read raw CSV cells, which
// arrive as strings, so digits-only text ("92", " 100 ", "007") is accepted and converted here, at the
// boundary. Rejected: fractions in any form ("5.5", "5.0", 5.5), blank or whitespace-only text, booleans,
// null, undefined, arrays and objects, signed, hexadecimal or exponent text ("-1", "+5", "0x10", "1e3"),
// non-numeric text, NaN, infinities and negative numbers. (field/cons12/roi.mjs differs on purpose: it takes
// numbers only.)
const WHOLE_NUMBER_TEXT = /^\d+$/;

function count(name, value) {
  const fail = () => {
    throw new RangeError(`${name} must be a whole number of 0 or more, got ${value}`);
  };
  let n;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && WHOLE_NUMBER_TEXT.test(value.trim()))
    n = Number(value.trim());
  else return fail();
  if (!Number.isSafeInteger(n) || n < 0) return fail();
  return n;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** One audit row: abs_error, pct_error = abs_error / max(physical, 1), accuracy = 1 - pct_error floored at 0. */
export function rowError(row) {
  const physical = count("physical_count", row.physical_count);
  const system = count("system_count", row.system_count);
  const absError = Math.abs(system - physical);
  const pctError = absError / Math.max(physical, 1);
  return { absError, pctError, accuracy: Math.max(0, 1 - pctError) };
}

/** Zone-level accuracy = mean of per-row accuracy. Returns null for no rows. */
export function zoneAccuracy(rows) {
  return mean(rows.map((r) => rowError(r).accuracy));
}

/**
 * Facility-level accuracy = 1 - sum(abs_error) / sum(physical) per round, then averaged over rounds.
 * A round is one visit and moment (grouped by `visit_id` + `moment`); OQ-35 asks whether to pool by moment.
 * A round with zero physical vehicles scores 1 if the system also shows none, otherwise 0.
 */
export function facilityAccuracy(rows) {
  const rounds = new Map();
  for (const r of rows) {
    // JSON of the raw pair cannot collide (a plain "a|b" join can: ["a|b","1"] vs ["a","b|1"]). Keeping
    // the original values also prevents distinct typed identifiers such as moment 1 and moment "1" from
    // being silently merged.
    const key = JSON.stringify([r.visit_id, r.moment]);
    const g = rounds.get(key) ?? { abs: 0, physical: 0 };
    g.abs += rowError(r).absError;
    g.physical += count("physical_count", r.physical_count);
    rounds.set(key, g);
  }
  return mean(
    [...rounds.values()].map((g) =>
      g.physical === 0 ? (g.abs === 0 ? 1 : 0) : 1 - g.abs / g.physical,
    ),
  );
}

/**
 * Weekly summary for one facility: accuracy per zone, lowest and mean zone accuracy, facility accuracy.
 * Every row must have a non-blank string `zone_id`; otherwise this throws (it never invents a zone).
 * Only zones that have rows appear: a missed zone or moment is not back-filled (sheet C14, "Failure").
 * Rows are used exactly as given. How outage visits are marked `excluded` is undecided (the audit sheet
 * has no such column), so callers must drop any excluded rows themselves before calling.
 */
export function weeklyOccupancySummary(rows) {
  const byZone = new Map();
  rows.forEach((r, i) => {
    if (typeof r.zone_id !== "string" || r.zone_id.trim() === "") {
      throw new RangeError(`zone_id must be a non-blank string (row ${i}), got ${r.zone_id}`);
    }
    byZone.set(r.zone_id, [...(byZone.get(r.zone_id) ?? []), r]);
  });
  const zones = Object.fromEntries([...byZone].map(([z, rs]) => [z, zoneAccuracy(rs)]));
  const values = Object.values(zones);
  return {
    zones,
    zoneMin: values.length ? Math.min(...values) : null,
    zoneMean: mean(values),
    facility: facilityAccuracy(rows),
  };
}

/**
 * T-MET-01-N1: compare the recorded audit rows with an explicit expected schedule.
 * Row identity is the typed tuple `[visit_id, moment, zone_id]`; no value is coerced, so callers cannot
 * accidentally hide a data-entry type mismatch. The expected list comes from the facility's audit plan,
 * because this library must not invent visits, moments or zones that are absent from the sheet.
 */
export function auditCompleteness(rows, expectedRows) {
  if (!Array.isArray(rows)) throw new RangeError(`rows must be an array, got ${rows}`);
  if (!Array.isArray(expectedRows)) {
    throw new RangeError(`expectedRows must be an array, got ${expectedRows}`);
  }
  const key = (row) => JSON.stringify([row?.visit_id, row?.moment, row?.zone_id]);
  const present = new Set(rows.map(key));
  const missing = expectedRows.filter((row) => !present.has(key(row)));
  return { complete: missing.length === 0, missing };
}

/**
 * Pass bar: both bars met in each of the final two weeks. `weeks` is oldest to newest; each item is a
 * weeklyOccupancySummary. `zoneBasis` ("min" = every zone, "mean" = average of zones) must be chosen
 * explicitly because the sheet does not say (OQ-35).
 */
export function sustainedPass(weeks, zoneBasis) {
  if (zoneBasis !== "min" && zoneBasis !== "mean") {
    throw new RangeError('zoneBasis must be "min" or "mean"');
  }
  if (weeks.length < 2) return false;
  return weeks.slice(-2).every((w) => {
    const zone = zoneBasis === "min" ? w.zoneMin : w.zoneMean;
    return zone !== null && w.facility !== null && zone >= ZONE_BAR && w.facility >= FACILITY_BAR;
  });
}

/** MET-02: adherence = system / independent, capped at 100%; overcount is reported separately. */
export function adherence({ independentEntries, systemEntries }) {
  const independent = count("independent_entries", independentEntries);
  const system = count("system_entries", systemEntries);
  if (independent === 0) return { adherencePct: null, overcount: system };
  return {
    adherencePct: Math.min(system / independent, 1) * 100,
    overcount: Math.max(system - independent, 0),
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN_AUDIT_HOURS = 2;

// Same rules as parseCivil() in apps/console/src/lib/reportPeriod.ts (strict yyyy-mm-dd, real calendar date).
// Kept as a separate copy on purpose: this folder is plain Node with no workspace imports, and
// packages/domain is reserved for the fare function. See the review notes before sharing code.
function isCalendarDate(value) {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * MET-02: recorded random draw of audit hours. `candidates` must already be OPEN hours only
 * ([{ date: "yyyy-mm-dd", hour: 0-23 }]), so a closed hour can never be drawn. The draw spans at least two
 * days and, when `peakHours` is given and available, includes at least one peak hour. Same seed, same draw.
 * Duplicate candidates (same date and hour) are collapsed first, keeping the first occurrence, so an hour
 * can never be drawn twice. If fewer than `count` distinct hours remain, it throws.
 *
 * Input checks (all throw RangeError with the offending field named):
 * - `count` (default 3, "three random hours per week") must be an integer of at least 2, because the
 *   two-day rule cannot be met with fewer than two hours.
 * - `candidates` must be an array of objects, each with `date` a real calendar date `yyyy-mm-dd` and `hour`
 *   an integer from 0 to 23.
 */
export function drawAuditHours({ candidates: rawCandidates, seed, count: n = 3, peakHours = [] }) {
  if (!Number.isInteger(n) || n < MIN_AUDIT_HOURS) {
    throw new RangeError(
      `count must be an integer of at least ${MIN_AUDIT_HOURS} (the two-day rule needs two hours), got ${n}`,
    );
  }
  if (!Array.isArray(rawCandidates)) {
    throw new RangeError(`candidates must be an array, got ${rawCandidates}`);
  }
  rawCandidates.forEach((c, i) => {
    if (c === null || typeof c !== "object" || Array.isArray(c)) {
      throw new RangeError(`candidates[${i}] must be an object with date and hour, got ${c}`);
    }
    if (!isCalendarDate(c.date)) {
      throw new RangeError(`candidates[${i}].date must be a real yyyy-mm-dd date, got ${c.date}`);
    }
    if (!Number.isInteger(c.hour) || c.hour < 0 || c.hour > 23) {
      throw new RangeError(`candidates[${i}].hour must be an integer from 0 to 23, got ${c.hour}`);
    }
  });
  const seen = new Set();
  const candidates = rawCandidates.filter((c) => {
    const key = `${c.date}|${c.hour}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const isPeak = (c) => peakHours.includes(c.hour);
  const peakAvailable = peakHours.length > 0 && candidates.some(isPeak);
  const days = new Set(candidates.map((c) => c.date));
  if (candidates.length < n) throw new RangeError("not enough distinct open hours to draw from");
  if (days.size < 2) throw new RangeError("candidates must cover at least two days");
  const rand = mulberry32(seed);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const pool = [...candidates];
    const picked = [];
    while (picked.length < n) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    if (new Set(picked.map((c) => c.date)).size >= 2 && (!peakAvailable || picked.some(isPeak))) {
      return picked;
    }
  }
  throw new RangeError("could not satisfy the draw rules with these candidates");
}

export const PACK_SECTIONS = [
  "Facility status",
  "Occupancy accuracy",
  "Adherence",
  "Sync health",
  "Conflicts",
  "Overrides",
  "Reports",
  "Cloud",
  "Open issues",
  "Decisions needed from Afzal",
];

/**
 * MET-03 completeness check. Every section `## <n>. <title>` must exist with a body that is not blank and
 * has no TODO marker. A section with no figure must say "Missing: <reason>" instead of staying empty.
 */
export function checkPackCompleteness(markdown) {
  const problems = [];
  PACK_SECTIONS.forEach((title, i) => {
    const heading = new RegExp(`^##\\s+${i + 1}\\.\\s+${title}\\s*$`, "mi");
    const m = heading.exec(markdown);
    if (!m) return problems.push(`missing section ${i + 1}: ${title}`);
    const rest = markdown.slice(m.index + m[0].length);
    const next = rest.search(/^##\s+\d+\./m);
    const body = (next === -1 ? rest : rest.slice(0, next)).trim();
    if (!body)
      problems.push(`section ${i + 1} (${title}) is empty; write "Missing: <reason>" if no data`);
    else if (/\bTODO\b/.test(body)) problems.push(`section ${i + 1} (${title}) still has a TODO`);
  });
  return { complete: problems.length === 0, problems };
}
