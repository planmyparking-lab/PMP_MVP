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
      "Reads zones, open_sessions and today's events; uses v_daily_kpis and v_hourly (revenue by mode) as soon as they are deployed. Refreshes every 10 seconds.",
    needs: [
      "Row-level security policies so signed-in managers can read rows (CLD-03, Akanksha)",
      "KPI views merged (#33) and v_zone_now for occupancy (Akanksha, after SYNC-04)",
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
    works:
      "Lists enrolled devices and guards with each phone's latest heartbeat (queue, battery). Revokes a lost phone and deactivates a guard (owner or manager).",
    needs: [
      "Row-level security policies so those writes are allowed (CLD-03, #34)",
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
    needs: [
      "Threshold storage per facility and the alert job (Akanksha, CLD-07)",
      "Row-level security so the page can read open_sessions (CLD-03)",
    ],
  },
  {
    id: "CON-06",
    title: "Shift review",
    href: "/shifts",
    state: "partial",
    works:
      "Lists the last 30 days of shifts from shift events with variance and filters. Sign-off writes shift_reviews as soon as that table is deployed.",
    needs: [
      "shift_reviews table and its insert policy (#31, #34); shift views (Akanksha, Afzal); see OQ-51",
      "Row-level security so events are readable (CLD-03)",
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
      "Row-level security policies so notes can be read and written (CLD-03, #34)",
      "The resolve_conflict function for Keep first, Keep second and Mark as test, and the OQ-49 decision (Afzal, Akanksha)",
    ],
  },
];

export const featureById = (id: string): FeatureStatus => {
  const feature = FEATURES.find((f) => f.id === id);
  if (!feature) throw new Error(`Unknown feature ${id}`);
  return feature;
};
