/**
 * Stable uuids for the named fixture tariffs in tariffs.json. Tariff.id became a required uuid
 * per Afzal's PR #6 review (item 1: traceability from an EXIT event's tariff_id to a tariffs row),
 * so the friendly fixture names ("CAR-A" etc.) can no longer live in the `id` field itself. Keep
 * this file's values in sync by hand with tariffs.json; tests and dev seeds that need to refer to
 * a specific fixture tariff by name should import TARIFF_IDS instead of hardcoding a uuid or the
 * old string id.
 */
export const TARIFF_IDS = {
  "CAR-A": "0192f0a0-0000-7000-9000-00000000a001",
  "CAR-B": "0192f0a0-0000-7000-9000-00000000a002",
  "BIKE-A": "0192f0a0-0000-7000-9000-00000000a003",
  "TRUCK-A": "0192f0a0-0000-7000-9000-00000000a004",
  "FLAT-A": "0192f0a0-0000-7000-9000-00000000a005",
  "NIGHT-A": "0192f0a0-0000-7000-9000-00000000a006",
  "CAR-A-WIDE": "0192f0a0-0000-7000-9000-00000000a007",
  "MIN-A": "0192f0a0-0000-7000-9000-00000000a008",
} as const;
