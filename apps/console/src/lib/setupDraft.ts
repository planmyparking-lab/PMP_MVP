import { formatRupees, parseTariff, toPaise } from "@pmp/contracts";
import type { Tariff } from "@pmp/contracts";
import {
  capacityWarning,
  classesWithoutTariff,
  dayCapBelowSlab,
  tariffClassesWithoutZone,
  validateEffectiveFrom,
  validateGraceMinutes,
  validateNightWindow,
  validateZoneCapacity,
} from "./tariffRules";
import { validateOverstayMinutes } from "./overstay";

/**
 * Local, in-browser setup draft for the wizard screen. It is never sent or stored anywhere, and it holds no
 * guard PIN. Tariffs are built in the real IC-04 shape and checked with the shared `parseTariff` schema, so the
 * wizard accepts exactly what the fare engine accepts. Facility-wide time rules (grace, night window, start
 * date) are applied to every tariff, because the contract stores them on each tariff.
 */
export const TARIFF_MODEL_OPTIONS = [
  {
    value: "HOURLY_SLABS",
    label: "Hourly slabs",
    help: "Price bands by stay length, then a repeat price.",
  },
  { value: "FLAT", label: "Flat per day", help: "One price for every started 24 hours." },
  { value: "PER_ENTRY", label: "Flat per entry", help: "One price per entry, whatever the stay." },
] as const;
export type TariffModelChoice = (typeof TARIFF_MODEL_OPTIONS)[number]["value"];

export interface ZoneDraft {
  name: string;
  capacity: string;
  vehicleClass: string;
}
export interface SlabDraft {
  /** Upper bound of the band, in minutes (inclusive). */
  upTo: string;
  price: string;
}
export interface TariffDraft {
  vehicleClass: string;
  model: TariffModelChoice;
  slabs: SlabDraft[];
  repeatEvery: string;
  repeatPrice: string;
  flat: string;
  dayCap: string;
  minimum: string;
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
  nightKind: "surcharge" | "multiplier";
  nightValue: string;
  effectiveFrom: string;
  overstay: string;
}

/**
 * Vehicle classes offered by the wizard. They must be the exact strings the gate app records on ENTRY and looks up
 * tariffs with (`apps/gate/src/data/appConfig.ts`: Car, Bike, Truck), or a saved tariff would never match a vehicle.
 * The final list per partner is OQ-13.
 */
export const VEHICLE_CLASSES = ["Car", "Bike", "Truck"] as const;

export const newTariff = (vehicleClass = "Car"): TariffDraft => ({
  vehicleClass,
  model: "HOURLY_SLABS",
  slabs: [{ upTo: "60", price: "" }],
  repeatEvery: "60",
  repeatPrice: "",
  flat: "",
  dayCap: "",
  minimum: "",
});

export const emptyDraft = (): SetupDraft => ({
  name: "",
  slotCount: "",
  zones: [{ name: "", capacity: "", vehicleClass: "Car" }],
  tariffs: [newTariff()],
  grace: "15",
  nightOn: false,
  nightStart: "22:00",
  nightEnd: "06:00",
  nightKind: "surcharge",
  nightValue: "",
  effectiveFrom: "",
  overstay: "240",
});

/** Example values so a first-time visitor can see a valid configuration. Clearly example, not a real facility. */
export const exampleDraft = (today: string): SetupDraft => ({
  name: "Example Mall",
  slotCount: "180",
  zones: [
    { name: "Basement A", capacity: "100", vehicleClass: "Car" },
    { name: "Two-wheeler bay", capacity: "80", vehicleClass: "Bike" },
  ],
  tariffs: [
    {
      ...newTariff("Car"),
      slabs: [
        { upTo: "60", price: "40" },
        { upTo: "180", price: "70" },
      ],
      repeatEvery: "60",
      repeatPrice: "20",
      dayCap: "300",
    },
    { ...newTariff("Bike"), model: "FLAT", flat: "20" },
  ],
  grace: "15",
  nightOn: true,
  nightStart: "22:00",
  nightEnd: "06:00",
  nightKind: "surcharge",
  nightValue: "50",
  effectiveFrom: today,
  overstay: "240",
});

const whole = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
const money = (s: string): number | null => {
  try {
    return toPaise(s.trim());
  } catch {
    return null;
  }
};
const hhmm = (t: string) => t.replace(":", "");
/** A real calendar date written yyyy-mm-dd. The start-date problem itself is reported on the Time rules step. */
const isRealDate = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * The tariff contract (IC-04) requires `id` to be a uuid, so it can be traced to tariffs.id and to
 * EXIT.payload.tariff_id. A draft has no database row yet, so each draft tariff gets a fixed, obviously
 * placeholder uuid (stable, so the try-a-fare result does not change on every render). The database assigns the
 * real id when saving exists.
 */
export const draftTariffId = (index: number): string =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;

export interface TariffFieldErrors {
  vehicleClass?: string;
  slabs: (string | undefined)[];
  repeatEvery?: string;
  repeatPrice?: string;
  flat?: string;
  dayCap?: string;
  minimum?: string;
  /** Messages from the shared tariff schema, for problems no single field explains. */
  schema: string[];
}

export interface BuiltTariff {
  vehicleClass: string;
  fieldErrors: TariffFieldErrors;
  /** Present only when every field converted and the shared schema accepted the tariff. */
  tariff?: Tariff;
}

/** Converts each tariff draft to the IC-04 shape and validates it with the shared schema. */
export function buildTariffs(d: SetupDraft): BuiltTariff[] {
  return d.tariffs.map((t, index) => {
    const fe: TariffFieldErrors = { slabs: [], schema: [] };
    if (t.vehicleClass.trim() === "") fe.vehicleClass = "Choose a vehicle class.";
    const grace = whole(d.grace);
    const out: Record<string, unknown> = {
      id: draftTariffId(index),
      facilityId: "draft",
      vehicleClass: t.vehicleClass.trim(),
      effectiveFrom: d.effectiveFrom,
      graceMinutes: grace,
      model: t.model,
    };
    let convertible =
      fe.vehicleClass === undefined && grace !== null && isRealDate(d.effectiveFrom);

    if (t.model === "HOURLY_SLABS") {
      const slabs: { upToMinutes: number; pricePaise: number }[] = [];
      t.slabs.forEach((s, j) => {
        const upTo = whole(s.upTo);
        const price = money(s.price);
        if (upTo === null || upTo < 1)
          fe.slabs[j] = "Enter the band length as whole minutes, at least 1.";
        else if (price === null) fe.slabs[j] = "Enter a price in rupees, such as 40 or 40.50.";
        else slabs.push({ upToMinutes: upTo, pricePaise: price });
      });
      const every = whole(t.repeatEvery);
      const price = money(t.repeatPrice);
      if (every === null || every < 1) fe.repeatEvery = "Whole minutes, at least 1.";
      if (price === null) fe.repeatPrice = "Enter the repeat price in rupees.";
      if (fe.slabs.some(Boolean) || fe.repeatEvery || fe.repeatPrice) convertible = false;
      out.slabs = slabs;
      out.repeat = { everyMinutes: every, pricePaise: price };
    } else {
      const flat = money(t.flat);
      if (flat === null) {
        fe.flat = "Enter the price in rupees.";
        convertible = false;
      }
      out.flatPaise = flat;
    }
    if (t.dayCap.trim() !== "" && t.model !== "PER_ENTRY") {
      const cap = money(t.dayCap);
      if (cap === null) {
        fe.dayCap = "Enter the day cap in rupees.";
        convertible = false;
      } else out.dayCapPaise = cap;
    }
    if (t.minimum.trim() !== "") {
      const min = money(t.minimum);
      if (min === null) {
        fe.minimum = "Enter the minimum fare in rupees.";
        convertible = false;
      } else out.minimumPaise = min;
    }
    if (d.nightOn) {
      const v = d.nightKind === "surcharge" ? money(d.nightValue) : whole(d.nightValue);
      if (v !== null) {
        out.night = {
          fromHHMM: hhmm(d.nightStart),
          toHHMM: hhmm(d.nightEnd),
          ...(d.nightKind === "surcharge" ? { surchargePaise: v } : { multiplierPercent: v }),
        };
      } else convertible = false;
    }
    if (!convertible) return { vehicleClass: t.vehicleClass.trim(), fieldErrors: fe };

    const parsed = parseTariff(out);
    if (!parsed.ok) {
      fe.schema = parsed.issues.map((i) => i.message);
      return { vehicleClass: t.vehicleClass.trim(), fieldErrors: fe };
    }
    // A day cap below the highest slab price makes the higher slab unreachable.
    if (parsed.value.dayCapPaise !== undefined && parsed.value.model === "HOURLY_SLABS") {
      const slabs = parsed.value.slabs.map((s) => ({
        fromMinute: 0,
        toMinute: 1,
        pricePaise: s.pricePaise,
      }));
      if (dayCapBelowSlab(slabs, parsed.value.dayCapPaise)) {
        fe.dayCap = `The day cap (${formatRupees(parsed.value.dayCapPaise)}) is below the highest single slab.`;
        return { vehicleClass: t.vehicleClass.trim(), fieldErrors: fe };
      }
    }
    return { vehicleClass: t.vehicleClass.trim(), fieldErrors: fe, tariff: parsed.value };
  });
}

/** Slot counts and capacities are Postgres integer columns; a larger number would fail only when saving. */
const MAX_COUNT = 2_147_483_647;
const TOO_LARGE = "That number is too large.";

export interface Analysis {
  facility: { name?: string; slotCount?: string };
  zones: { name?: string; capacity?: string; vehicleClass?: string }[];
  capacityWarning: string | null;
  tariffs: BuiltTariff[];
  classProblems: string[];
  classWarnings: string[];
  grace?: string;
  night?: string;
  nightValue?: string;
  effectiveFrom?: string;
  overstay?: string;
  /** Errors per wizard step (1 to 4; step 5 is the review itself). */
  stepErrors: Record<1 | 2 | 3 | 4, number>;
}

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
  else if (slots > MAX_COUNT) a.facility.slotCount = TOO_LARGE;

  d.zones.forEach((z, i) => {
    const err: Analysis["zones"][number] = {};
    if (z.name.trim() === "") err.name = "Name the zone.";
    if (!validateZoneCapacity(whole(z.capacity)))
      err.capacity = "Capacity must be a whole number of at least 1.";
    else if ((whole(z.capacity) ?? 0) > MAX_COUNT) err.capacity = TOO_LARGE;
    if (z.vehicleClass.trim() === "") err.vehicleClass = "Choose a vehicle class.";
    a.zones[i] = err;
  });
  const caps = d.zones.map((z) => whole(z.capacity)).filter((n): n is number => n !== null);
  if (slots !== null && caps.length > 0) a.capacityWarning = capacityWarning(caps, slots);

  if (!validateGraceMinutes(whole(d.grace)))
    a.grace = "Grace must be a whole number of minutes, 0 or more.";
  if (d.nightOn) {
    if (!validateNightWindow(d.nightStart, d.nightEnd)) {
      a.night = "Use two different times written HH:MM. The window may cross midnight.";
    }
    const v = d.nightKind === "surcharge" ? money(d.nightValue) : whole(d.nightValue);
    if (v === null) {
      a.nightValue =
        d.nightKind === "surcharge"
          ? "Enter the night surcharge in rupees."
          : "Enter the percentage as a whole number.";
    }
  }
  if (!validateEffectiveFrom(d.effectiveFrom, todayIst)) {
    a.effectiveFrom =
      d.effectiveFrom === ""
        ? "Choose the date the tariff starts."
        : "A new tariff cannot start in the past.";
  }
  const overstay = validateOverstayMinutes(whole(d.overstay) ?? Number.NaN);
  if (!overstay.ok) a.overstay = overstay.message;

  a.tariffs = buildTariffs(d);
  const zoneClasses = d.zones
    .filter((z) => z.vehicleClass.trim())
    .map((z) => ({ vehicleClass: z.vehicleClass.trim() }));
  const tariffClasses = d.tariffs
    .filter((t) => t.vehicleClass.trim())
    .map((t) => ({ vehicleClass: t.vehicleClass.trim() }));
  a.classProblems = classesWithoutTariff(zoneClasses, tariffClasses).map(
    (c) => `Zones allow ${c}, but there is no tariff for it.`,
  );
  a.classWarnings = tariffClassesWithoutZone(zoneClasses, tariffClasses).map(
    (c) => `There is a tariff for ${c}, but no zone allows that class.`,
  );

  const count = (xs: unknown[]) => xs.filter(Boolean).length;
  a.stepErrors[1] =
    count(Object.values(a.facility)) + a.zones.reduce((n, z) => n + count(Object.values(z)), 0);
  // A tariff is counted once: either it has field errors, or schema problems, or it is valid.
  a.stepErrors[2] =
    a.tariffs.reduce((n, t) => {
      const f = t.fieldErrors;
      const fields =
        count([f.vehicleClass, f.repeatEvery, f.repeatPrice, f.flat, f.dayCap, f.minimum]) +
        count(f.slabs);
      return n + fields + f.schema.length;
    }, 0) + a.classProblems.length;
  a.stepErrors[3] = count([a.grace, a.night, a.nightValue, a.effectiveFrom]);
  a.stepErrors[4] = count([a.overstay]);
  return a;
}

/** The draft as a plain object for the local "download draft" button. Contains no PIN. */
export function draftToJson(d: SetupDraft, todayIst: string) {
  const a = analyse(d, todayIst);
  return {
    note: "Local draft. Not saved to any facility and not activated. Tariffs use the IC-04 shape with placeholder ids (tariff id and facilityId); real ids are assigned when saving exists.",
    facility: { name: d.name.trim(), slotCount: whole(d.slotCount) },
    zones: d.zones.map((z) => ({
      name: z.name.trim(),
      capacity: whole(z.capacity),
      vehicleClass: z.vehicleClass.trim(),
    })),
    tariffs: a.tariffs.map((t) => t.tariff ?? null),
    overstayMinutes: whole(d.overstay),
  };
}

export const todayInIst = (now = Date.now()): string =>
  new Date(now + 330 * 60_000).toISOString().slice(0, 10);
