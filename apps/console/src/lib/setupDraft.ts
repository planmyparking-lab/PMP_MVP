import { formatRupees, toPaise } from "@pmp/contracts";
import {
  capacityWarning,
  classesWithoutTariff,
  dayCapBelowSlab,
  tariffClassesWithoutZone,
  validateEffectiveFrom,
  validateGraceMinutes,
  validateNightWindow,
  validateSlabs,
  validateZoneCapacity,
} from "./tariffRules";
import { validateOverstayMinutes } from "./overstay";
import type { Slab } from "./tariffRules";

/**
 * Local, in-browser setup draft for the wizard screen. It is never sent or stored anywhere, and it holds no
 * guard PIN. All checks reuse the shared rule functions; this file only wires text fields to them.
 */
export interface ZoneDraft {
  name: string;
  capacity: string;
  vehicleClass: string;
}
export interface SlabDraft {
  from: string;
  to: string;
  price: string;
}
export interface TariffDraft {
  vehicleClass: string;
  slabs: SlabDraft[];
  dayCap: string;
}
export interface SetupDraft {
  name: string;
  slotCount: string;
  zones: ZoneDraft[];
  tariffs: TariffDraft[];
  grace: string;
  nightOn: boolean;
  nightStart: string;
  nightEnd: string;
  effectiveFrom: string;
  overstay: string;
}

export const emptyDraft = (): SetupDraft => ({
  name: "",
  slotCount: "",
  zones: [{ name: "", capacity: "", vehicleClass: "Car" }],
  tariffs: [{ vehicleClass: "Car", slabs: [{ from: "0", to: "60", price: "" }], dayCap: "" }],
  grace: "15",
  nightOn: false,
  nightStart: "22:00",
  nightEnd: "06:00",
  effectiveFrom: "",
  overstay: "240",
});

/** Example values so a first-time visitor can see a valid configuration. Clearly example, not a real facility. */
export const exampleDraft = (today: string): SetupDraft => ({
  name: "Example Mall",
  slotCount: "180",
  zones: [
    { name: "Basement A", capacity: "100", vehicleClass: "Car" },
    { name: "Two-wheeler bay", capacity: "80", vehicleClass: "Two-wheeler" },
  ],
  tariffs: [
    {
      vehicleClass: "Car",
      slabs: [
        { from: "0", to: "60", price: "40" },
        { from: "60", to: "180", price: "70" },
      ],
      dayCap: "300",
    },
    { vehicleClass: "Two-wheeler", slabs: [{ from: "0", to: "240", price: "20" }], dayCap: "" },
  ],
  grace: "15",
  nightOn: true,
  nightStart: "22:00",
  nightEnd: "06:00",
  effectiveFrom: today,
  overstay: "240",
});

export interface Analysis {
  facility: { name?: string; slotCount?: string };
  zones: { name?: string; capacity?: string; vehicleClass?: string }[];
  capacityWarning: string | null;
  tariffs: {
    slabs: (string | undefined)[];
    slabProblems: string[];
    dayCap?: string;
    vehicleClass?: string;
  }[];
  classProblems: string[];
  classWarnings: string[];
  grace?: string;
  night?: string;
  effectiveFrom?: string;
  overstay?: string;
  /** Errors per wizard step (1 to 5; step 5 is the review itself). */
  stepErrors: Record<1 | 2 | 3 | 4, number>;
}

const moneyOrNull = (text: string): number | null => {
  try {
    return toPaise(text.trim());
  } catch {
    return null;
  }
};
const whole = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

export function analyse(d: SetupDraft, todayIst: string): Analysis {
  const a: Analysis = {
    facility: {},
    zones: [],
    capacityWarning: null,
    tariffs: [],
    classProblems: [],
    classWarnings: [],
    stepErrors: { 1: 0, 2: 0, 3: 0, 4: 0 },
  };

  if (d.name.trim() === "") a.facility.name = "Give the facility a name.";
  const slots = whole(d.slotCount);
  if (slots === null) a.facility.slotCount = "Enter the number of parking slots (a whole number).";

  d.zones.forEach((z, i) => {
    const err: Analysis["zones"][number] = {};
    if (z.name.trim() === "") err.name = "Name the zone.";
    if (!validateZoneCapacity(whole(z.capacity)))
      err.capacity = "Capacity must be a whole number of at least 1.";
    if (z.vehicleClass.trim() === "") err.vehicleClass = "Choose a vehicle class.";
    a.zones[i] = err;
  });
  const caps = d.zones.map((z) => whole(z.capacity)).filter((n): n is number => n !== null);
  if (slots !== null && caps.length > 0) a.capacityWarning = capacityWarning(caps, slots);

  const zoneClasses = d.zones
    .filter((z) => z.vehicleClass.trim())
    .map((z) => ({ vehicleClass: z.vehicleClass.trim() }));
  const tariffClasses = d.tariffs
    .filter((t) => t.vehicleClass.trim())
    .map((t) => ({ vehicleClass: t.vehicleClass.trim() }));
  d.tariffs.forEach((t, i) => {
    const entry: Analysis["tariffs"][number] = { slabs: [], slabProblems: [] };
    if (t.vehicleClass.trim() === "") entry.vehicleClass = "Choose a vehicle class.";
    const slabs: Slab[] = [];
    let priceOk = true;
    t.slabs.forEach((s, j) => {
      const price = moneyOrNull(s.price);
      const from = whole(s.from);
      const to = whole(s.to);
      if (price === null) {
        entry.slabs[j] = "Enter a price in rupees, such as 40 or 40.50.";
        priceOk = false;
      } else if (from === null || to === null) {
        entry.slabs[j] = "Minutes must be whole numbers.";
        priceOk = false;
      } else slabs.push({ fromMinute: from, toMinute: to, pricePaise: price });
    });
    if (priceOk) entry.slabProblems = validateSlabs(slabs).map((p) => p.message);
    if (t.dayCap.trim() !== "") {
      const cap = moneyOrNull(t.dayCap);
      if (cap === null) entry.dayCap = "Enter the day cap in rupees.";
      else if (priceOk && dayCapBelowSlab(slabs, cap)) {
        entry.dayCap = `The day cap (${formatRupees(cap)}) is below the highest single slab.`;
      }
    }
    a.tariffs[i] = entry;
  });
  a.classProblems = classesWithoutTariff(zoneClasses, tariffClasses).map(
    (c) => `Zones allow ${c}, but there is no tariff for it.`,
  );
  a.classWarnings = tariffClassesWithoutZone(zoneClasses, tariffClasses).map(
    (c) => `There is a tariff for ${c}, but no zone allows that class.`,
  );

  if (!validateGraceMinutes(whole(d.grace)))
    a.grace = "Grace must be a whole number of minutes, 0 or more.";
  if (d.nightOn && !validateNightWindow(d.nightStart, d.nightEnd)) {
    a.night = "Use two different times written HH:MM. The window may cross midnight.";
  }
  if (!validateEffectiveFrom(d.effectiveFrom, todayIst)) {
    a.effectiveFrom =
      d.effectiveFrom === ""
        ? "Choose the date the tariff starts."
        : "A new tariff cannot start in the past.";
  }
  const overstay = validateOverstayMinutes(whole(d.overstay) ?? Number.NaN);
  if (!overstay.ok) a.overstay = overstay.message;

  const count = (xs: unknown[]) => xs.filter(Boolean).length;
  a.stepErrors[1] =
    count(Object.values(a.facility)) + a.zones.reduce((n, z) => n + count(Object.values(z)), 0);
  a.stepErrors[2] =
    a.tariffs.reduce(
      (n, t) =>
        n + count(t.slabs) + t.slabProblems.length + (t.dayCap ? 1 : 0) + (t.vehicleClass ? 1 : 0),
      0,
    ) + a.classProblems.length;
  a.stepErrors[3] = count([a.grace, a.night, a.effectiveFrom]);
  a.stepErrors[4] = count([a.overstay]);
  return a;
}

/** The draft as a plain object for the local "download draft" button. Contains no PIN. */
export function draftToJson(d: SetupDraft) {
  const w = (s: string) => whole(s);
  return {
    note: "Local draft. Not saved to any facility and not activated.",
    facility: { name: d.name.trim(), slotCount: w(d.slotCount) },
    zones: d.zones.map((z) => ({
      name: z.name.trim(),
      capacity: w(z.capacity),
      vehicleClass: z.vehicleClass.trim(),
    })),
    tariffs: d.tariffs.map((t) => ({
      vehicleClass: t.vehicleClass.trim(),
      slabs: t.slabs.map((s) => ({
        fromMinute: w(s.from),
        toMinute: w(s.to),
        pricePaise: moneyOrNull(s.price),
      })),
      dayCapPaise: t.dayCap.trim() === "" ? null : moneyOrNull(t.dayCap),
    })),
    graceMinutes: w(d.grace),
    nightWindow: d.nightOn ? { start: d.nightStart, end: d.nightEnd } : null,
    tariffEffectiveFrom: d.effectiveFrom,
    overstayMinutes: w(d.overstay),
  };
}

export const todayInIst = (now = Date.now()): string =>
  new Date(now + 330 * 60_000).toISOString().slice(0, 10);
