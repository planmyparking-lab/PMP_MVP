/**
 * What the Console can and cannot do today. This list feeds the dashboard and the "not connected" notices, so
 * the screens never claim more than the repository contains. Update it when a dependency lands.
 * Sources: docs/team/member-03-anamika.md and supabase/migrations (0001 to 0010; 0010 holds the row-level security).
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
      "Reads zones, open_sessions and today's events, and today's KPIs from v_daily_kpis and v_hourly (revenue by mode). Shows each zone's latest physical count with SYNC-04's 3% drift flag. Refreshes every 10 seconds.",
    needs: [
      "v_zone_now, so occupancy comes from one view instead of open_sessions (Akanksha, OQ-50)",
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
      "Facility insert and status columns, and shift and pass-type tables, for the save and activate flow (Akanksha)",
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
    works:
      "Lists enrolled devices and guards with each phone's latest heartbeat (queue, battery). Revokes a lost phone and deactivates a guard (owner or manager).",
    needs: [
      "Enrollment and PIN functions to add phones and guards, and to reactivate a guard (Akanksha)",
    ],
  },
  {
    id: "CON-09",
    title: "Overstay",
    href: "/overstay",
    state: "partial",
    works:
      "Lists vehicles inside at or over a limit from open_sessions, longest first, with CSV export (no number plates).",
    needs: ["Threshold storage per facility and the alert job (Akanksha, CLD-07)"],
  },
  {
    id: "CON-06",
    title: "Shift review",
    href: "/shifts",
    state: "partial",
    works:
      "Lists the last 30 days of shifts from shift events with variance and filters. Sign-off writes shift_reviews (owner or manager, closed shifts only).",
    needs: [
      "Shift views (Akanksha, Afzal); see OQ-51",
      "The variance threshold for a required note (OQ-22)",
    ],
  },
  {
    id: "CON-07",
    title: "Conflicts inbox",
    href: "/conflicts",
    state: "partial",
    works:
      "Reads sync_conflicts for the selected facility, grouped by type with age and status. Adds notes to a conflict (conflict_resolutions, ADD_NOTE) without closing it.",
    needs: [
      "The resolve_conflict function for Keep first, Keep second and Mark as test, and the OQ-49 decision (Afzal, Akanksha)",
    ],
  },
];

export const featureById = (id: string): FeatureStatus => {
  const feature = FEATURES.find((f) => f.id === id);
  if (!feature) throw new Error(`Unknown feature ${id}`);
  return feature;
};
