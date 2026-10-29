/**
 * What the Console can and cannot do today. This list feeds the dashboard and the "not connected" notices, so
 * the screens never claim more than the repository contains. Update it when a dependency lands.
 * Sources: docs/team/member-03-anamika.md and supabase/migrations (0001 to 0003 only).
 */
export type FeatureState = "partial" | "blocked";

export interface FeatureStatus {
  id: string;
  title: string;
  href: string;
  state: FeatureState;
  /** What exists in this repository. */
  works: string;
  /** What is missing, and whose it is. */
  needs: string[];
}

export const FEATURES: FeatureStatus[] = [
  {
    id: "CON-04/05",
    title: "Dashboard and occupancy",
    href: "/occupancy",
    state: "partial",
    works: "Colour-band logic and the overrides-per-100 formula exist and are tested.",
    needs: [
      "Database views v_zone_now, v_daily_kpis and v_hourly (Akanksha)",
      "Row-level security policies and sign-in (CLD-03, CON-03)",
    ],
  },
  {
    id: "CON-01",
    title: "Setup wizard",
    href: "/setup",
    state: "partial",
    works:
      "Tariffs are built in the real contract shape and checked with the shared schema. The try-a-fare panel runs the shared fare engine. Capacity, time-rule and PIN checks run live.",
    needs: [
      "facility_setup_drafts table to save drafts (Akanksha)",
      "Sign-in and security policies, then the save and activate flow",
    ],
  },
  {
    id: "CON-08",
    title: "Reports",
    href: "/reports",
    state: "partial",
    works:
      "Report templates, Excel output and the secured report route exist. A labelled demo is available.",
    needs: [
      "Report views v_report_* and a data loader (Akanksha)",
      "A real PDF render on Linux has not been run",
    ],
  },
  {
    id: "CON-02/10",
    title: "Devices and health",
    href: "/devices",
    state: "partial",
    works: "Device health status rules exist and are tested.",
    needs: [
      "device_heartbeats table, enrollment function and PIN function (Akanksha)",
      "Sign-in and security policies",
    ],
  },
  {
    id: "CON-09",
    title: "Overstay",
    href: "/overstay",
    state: "partial",
    works:
      "Threshold validation and the at-or-over evaluation (pass holders excluded) exist and are tested.",
    needs: [
      "open_sessions on main (Afzal, on feature/sync-02-open-sessions)",
      "Threshold storage and the alert job (Akanksha, CLD-07); see OQ-44",
    ],
  },
  {
    id: "CON-06",
    title: "Shift review",
    href: "/shifts",
    state: "blocked",
    works: "Nothing built yet.",
    needs: ["Shift views and the shift_reviews table (Akanksha, Afzal)"],
  },
  {
    id: "CON-07",
    title: "Conflicts inbox",
    href: "/conflicts",
    state: "blocked",
    works: "Nothing built yet.",
    needs: ["sync_conflicts, conflict_resolutions and resolve_conflict (Afzal, Akanksha)"],
  },
];

export const featureById = (id: string): FeatureStatus => {
  const feature = FEATURES.find((f) => f.id === id);
  if (!feature) throw new Error(`Unknown feature ${id}`);
  return feature;
};
