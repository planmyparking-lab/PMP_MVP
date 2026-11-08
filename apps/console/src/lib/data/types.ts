/**
 * Shapes the server loaders hand to the Console views. Plain data only (no Supabase types), so client
 * components can import them. Every field that could not be read is a `Loaded` error, never a made-up value.
 */
import type { SyncConflictRow } from "../conflicts";

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
      email: string;
      role: "owner" | "manager";
      facilities: FacilitySummary[];
      /** Null when memberships exist but no facility row is readable yet. */
      facility: FacilitySummary | null;
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

export interface FacilityLive {
  facility: FacilitySummary;
  asOf: string;
  zones: Loaded<ZoneLive[]>;
  inside: Loaded<VehicleInside[]>;
  conflicts: Loaded<SyncConflictRow[]>;
  devices: Loaded<DeviceLive[]>;
  staff: Loaded<StaffLive[]>;
  /** Today in IST. */
  today: Loaded<{ entries: number; exits: number; overrides: number; entriesByHour: number[] }>;
}
