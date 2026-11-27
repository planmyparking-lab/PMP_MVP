/**
 * Shapes the server loaders hand to the Console views. Plain data only (no Supabase types), so client
 * components can import them. Every field that could not be read is a `Loaded` error, never a made-up value.
 */
import type { SyncConflictRow } from "../conflicts";
import type { ZoneCheck } from "../zoneDrift";
import type { Probe } from "./probe";

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

export interface FacilitySummary {
  id: string;
  orgId: string;
  name: string;
  timezone: string;
  slotCount: number;
}

/** What the shell knows about the visitor. `offline` = no Supabase project configured. */
export type ConsoleSession =
  | { kind: "offline" }
  | { kind: "signed-out" }
  | { kind: "denied"; email: string; detail: string }
  | {
      kind: "ok";
      /** auth.users id of the signed-in user (attributes reviews; never taken from a request). */
      userId: string;
      email: string;
      /** "owner" if the user owns anything. Display only; for permissions on a facility use `facilityRole`. */
      role: "owner" | "manager";
      facilities: FacilitySummary[];
      /** Null when memberships exist but no facility row is readable yet. */
      facility: FacilitySummary | null;
      /** The user's role on `facility` (same rule as `is_member()` in 0010); null when `facility` is null. */
      facilityRole: "owner" | "manager" | null;
    };

export interface ZoneLive {
  id: string;
  name: string;
  capacity: number;
  vehicleClass: string;
  occupied: number;
}

export interface VehicleInside {
  sessionId: string;
  shortCode: string;
  zoneName: string;
  vehicleClass: string;
  entryTime: string;
  hasPass: boolean;
  passId: string | null;
}

export interface DeviceLive {
  id: string;
  name: string;
  enrolledAt: string;
  revokedAt: string | null;
}

export interface StaffLive {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
}

/** Today's figures from the KPI views (#33): `v_daily_kpis` for the day, `v_hourly` for the hours. */
export interface KpiToday {
  /** Facility-local date the figures are for. */
  localDate: string;
  vehicles: number;
  exits: number;
  cashPaise: number;
  upiPaise: number;
  passPaise: number;
  declaredTotalPaise: number;
  overrides: number;
  overridesPer100: number | null;
  avgStayMinutes: number | null;
  orphanExits: number;
  /** 24 buckets, facility-local hour. */
  entriesByHour: number[];
}

/** Latest accepted heartbeat of one device (`device_heartbeats`, #31). */
export interface HeartbeatLive {
  deviceId: string;
  receivedAt: string;
  queueDepth: number;
  oldestUnsyncedAgeS: number;
  appVersion: string;
  schemaVersion: number;
  /** Null when the phone cannot read its battery (OQ-29). */
  batteryPct: number | null;
}

export interface FacilityLive {
  facility: FacilitySummary;
  asOf: string;
  zones: Loaded<ZoneLive[]>;
  inside: Loaded<VehicleInside[]>;
  conflicts: Loaded<SyncConflictRow[]>;
  devices: Loaded<DeviceLive[]>;
  staff: Loaded<StaffLive[]>;
  /** Today in IST, counted from events directly (used when the KPI views are absent). */
  today: Loaded<{ entries: number; exits: number; overrides: number; entriesByHour: number[] }>;
  /** Today from the KPI views; `absent` until #33 is merged. */
  kpis: Probe<KpiToday>;
  /** Device health from `device_heartbeats` (0008). */
  heartbeats: Probe<HeartbeatLive[]>;
  /** Latest physical count per zone id, null when the zone has never been counted (SYNC-04 drift rule, #28). */
  zoneChecks: Loaded<Record<string, ZoneCheck | null>>;
}
