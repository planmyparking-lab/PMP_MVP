/**
 * What the Console can and cannot do today. This list feeds the dashboard and the "not connected" notices, so
 * the screens never claim more than the repository contains. Update it when a dependency lands.
 * Sources: docs/team/member-03-anamika.md and supabase/migrations (0001 to 0006).
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
    works:
      "Sign-in and server loaders read zones, open_sessions and today's events; the board refreshes every 10 seconds.",
    needs: [
      "Row-level security policies so signed-in managers can read rows (CLD-03, Akanksha)",
      "Views v_zone_now, v_daily_kpis and v_hourly to replace the open_sessions count (Akanksha)",
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
    works: "Lists enrolled devices and guards from the database. Health status rules are tested.",
    needs: [
      "device_heartbeats table, enrollment function and PIN function (Akanksha)",
      "Row-level security policies (CLD-03)",
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
      "Threshold storage per facility and the alert job (Akanksha, CLD-07)",
      "Row-level security so the page can read open_sessions (CLD-03)",
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
    state: "partial",
    works: "Reads sync_conflicts for the selected facility, grouped by type with age and status.",
    needs: [
      "conflict_resolutions and resolve_conflict for actions (Afzal, Akanksha)",
      "Row-level security policies (CLD-03)",
    ],
  },
];

export const featureById = (id: string): FeatureStatus => {
  const feature = FEATURES.find((f) => f.id === id);
  if (!feature) throw new Error(`Unknown feature ${id}`);
  return feature;
};
