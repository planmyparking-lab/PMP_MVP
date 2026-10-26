import { z } from "zod";

/**
 * Tariff rule JSON (integration contract IC-04, owner: Nikhil, schema home here per
 * docs/team/member-01-afzal.md "single schema in contracts; fare function in packages/domain").
 *
 * Field meanings follow docs/team/member-02-nikhil.md section GATE-03 (rule model, fixture tariffs
 * and the 60-case table). Money is integer paise everywhere. Model-specific fields:
 *
 * - `HOURLY_SLABS`: cumulative bands `slabs` (a duration inside a band prices at the band's flat
 *   `pricePaise`); durations beyond the last finite band are priced by `repeat` (price per started
 *   unit). A slab with `upToMinutes: null` may appear only as the last slab and only marks the
 *   open-ended tail: its own `pricePaise` is not used for pricing, `repeat` governs. This rule
 *   remains subject to partner confirmation.
 * - `FLAT`: `flatPaise` per started 24 h block.
 * - `PER_ENTRY`: `flatPaise` once per entry (stays are not split into blocks, no `dayCapPaise`).
 *
 * `effectiveFrom`/`effectiveTo` are IST calendar dates (YYYY-MM-DD, inclusive bounds; India has no
 * daylight saving time, so a fixed +05:30 offset is used). `night` is an IST wall-clock window
 * (`fromHHMM`/`toHHMM`, `HHMM` digits); it may wrap past midnight and requires exactly one of
 * `multiplierPercent` or `surchargePaise`.
 */

export const TARIFF_MODELS = ["HOURLY_SLABS", "FLAT", "PER_ENTRY"] as const;
export type TariffModel = (typeof TARIFF_MODELS)[number];

const paise = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger, "paise must be a safe integer");
const istDate = z.string().date(); // YYYY-MM-DD, semantic: IST calendar date
const hhmm = z.string().regex(/^([01]\d|2[0-3])[0-5]\d$/, "expected 4-digit HHMM, 0000-2359");

const TariffSlab = z.object({
  /** Upper bound of the cumulative band in minutes (inclusive); null marks the open-ended tail. */
  upToMinutes: z.number().int().positive().nullable(),
  pricePaise: paise,
});

const TariffRepeat = z.object({
  /** Length of one repeat unit in minutes. */
  everyMinutes: z.number().int().positive(),
  /** Price of one started repeat unit. */
  pricePaise: paise,
});

const TariffNight = z.object({
  /** IST wall clock, digits, e.g. "2200". */
  fromHHMM: hhmm,
  /** IST wall clock, digits, e.g. "0600"; may be earlier than fromHHMM (window wraps midnight). */
  toHHMM: hhmm,
  /** Exactly one of the two must be set; multiplier semantics remain subject to confirmation. */
  multiplierPercent: z
    .number()
    .int()
    .min(0)
    .refine(Number.isSafeInteger, "multiplierPercent must be a safe integer")
    .optional(),
  surchargePaise: paise.optional(),
});

const base = {
  id: z.string().min(1), // config id (e.g. "CAR-A"); may be any non-empty string, not a UUID
  facilityId: z.string().min(1),
  vehicleClass: z.string().min(1),
  effectiveFrom: istDate,
  effectiveTo: istDate.optional(),
  graceMinutes: z.number().int().min(0),
  dayCapPaise: paise.optional(),
  minimumPaise: paise.optional(),
  night: TariffNight.optional(),
};

const HourlySlabsTariff = z
  .object({
    ...base,
    model: z.literal("HOURLY_SLABS"),
    slabs: z.array(TariffSlab).min(1, "HOURLY_SLABS needs at least one slab"),
    repeat: TariffRepeat.optional(),
  })
  .check((ctx) => {
    const t = ctx.value;
    if (!t.repeat) {
      ctx.issues.push({
        code: "custom",
        message: "repeat is required: it prices stays beyond the last slab",
        input: t,
        path: ["repeat"],
      });
      return;
    }
    // Finite bands must strictly ascend; a null (open-ended) slab, if any, must be last.
    let last: number | null = null;
    for (let i = 0; i < t.slabs.length; i++) {
      const slab = t.slabs[i];
      if (slab && slab.upToMinutes === null) {
        if (i !== t.slabs.length - 1) {
          ctx.issues.push({
            code: "custom",
            message: "a null upToMinutes slab may only be the last slab",
            input: t,
            path: ["slabs", i, "upToMinutes"],
          });
        }
        continue;
      }
      if (slab && last !== null && slab.upToMinutes !== null && slab.upToMinutes <= last) {
        ctx.issues.push({
          code: "custom",
          message: "slabs must be strictly sorted by upToMinutes",
          input: t,
          path: ["slabs", i, "upToMinutes"],
        });
      }
      if (slab && typeof slab.upToMinutes === "number") last = slab.upToMinutes;
    }
  });

const FlatTariff = z.object({ ...base, model: z.literal("FLAT"), flatPaise: paise });

const PerEntryTariff = z.object({ ...base, model: z.literal("PER_ENTRY"), flatPaise: paise });

export const Tariff = z
  .discriminatedUnion("model", [HourlySlabsTariff, FlatTariff, PerEntryTariff])
  .check((ctx) => {
    const t = ctx.value;
    // cross-model rules on the union result
    if (t.effectiveTo !== undefined && t.effectiveTo < t.effectiveFrom) {
      ctx.issues.push({
        code: "custom",
        message: "effectiveTo must not be before effectiveFrom",
        input: t,
        path: ["effectiveTo"],
      });
    }
    if (t.night) {
      const has =
        (t.night.multiplierPercent !== undefined ? 1 : 0) +
        (t.night.surchargePaise !== undefined ? 1 : 0);
      if (has === 0) {
        ctx.issues.push({
          code: "custom",
          message: "night requires multiplierPercent or surchargePaise",
          input: t,
          path: ["night"],
        });
      } else if (has > 1) {
        ctx.issues.push({
          code: "custom",
          message: "night accepts only one of multiplierPercent and surchargePaise",
          input: t,
          path: ["night"],
        });
      }
    }
  });

export type Tariff = z.output<typeof Tariff>;

/** Parse envelope for the tariff schema (same shape as events.ts ParseResult, but for Tariff). */
export type TariffParseResult =
  { ok: true; value: Tariff } | { ok: false; issues: z.core.$ZodIssue[] };

export function parseTariff(input: unknown): TariffParseResult {
  const r = Tariff.safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, issues: r.error.issues };
}
