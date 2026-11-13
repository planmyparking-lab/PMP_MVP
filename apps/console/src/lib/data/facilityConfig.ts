import "server-only";
import { describeTariff, maskPlate, passState } from "../facilityConfig";
import type { PassState, TariffSummary } from "../facilityConfig";
import { createSupabaseServerClient } from "../supabase/server";
import { localDate } from "./localDay";
import { getConsoleSession } from "./session";
import type { FacilitySummary, Loaded } from "./types";

export const PASS_LIMIT = 500;

export interface ZoneConfig {
  id: string;
  name: string;
  capacity: number;
  vehicleClass: string;
}
export interface TariffConfig {
  id: string;
  vehicleClass: string;
  effectiveFrom: string;
  summary: TariffSummary;
}
export interface PassConfig {
  id: string;
  /** Masked; the full number never leaves the server (OQ-26). */
  plate: string;
  validTo: string;
  duesPaise: number;
  state: PassState;
}

export interface FacilityConfigLive {
  facility: FacilitySummary;
  asOf: string;
  zones: Loaded<ZoneConfig[]>;
  tariffs: Loaded<TariffConfig[]>;
  passes: Loaded<PassConfig[]>;
  passesTruncated: boolean;
}

/** Zones, tariffs and passes of the selected facility (migration 0001), read with the user's JWT. */
export async function loadFacilityConfig(): Promise<FacilityConfigLive | null> {
  const session = await getConsoleSession();
  if (session.kind !== "ok" || !session.facility) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const facility = session.facility;
  const asOf = new Date().toISOString();
  const today = localDate(asOf, facility.timezone) ?? asOf.slice(0, 10);

  const [zonesRes, tariffsRes, passesRes] = await Promise.all([
    supabase
      .from("zones")
      .select("id, name, capacity, vehicle_class")
      .eq("facility_id", facility.id)
      .order("name"),
    supabase
      .from("tariffs")
      .select("id, vehicle_class, rule_json, effective_from")
      .eq("facility_id", facility.id)
      .order("vehicle_class")
      .order("effective_from", { ascending: false }),
    supabase
      .from("passes")
      .select("id, vehicle_no, valid_to, dues")
      .eq("facility_id", facility.id)
      .order("valid_to")
      .limit(PASS_LIMIT),
  ]);

  return {
    facility,
    asOf,
    zones: zonesRes.error
      ? { ok: false, error: `zones: ${zonesRes.error.message}` }
      : {
          ok: true,
          data: (zonesRes.data ?? []).map((z) => ({
            id: String(z.id),
            name: String(z.name),
            capacity: Number(z.capacity),
            vehicleClass: String(z.vehicle_class),
          })),
        },
    tariffs: tariffsRes.error
      ? { ok: false, error: `tariffs: ${tariffsRes.error.message}` }
      : {
          ok: true,
          data: (tariffsRes.data ?? []).map((t) => ({
            id: String(t.id),
            vehicleClass: String(t.vehicle_class),
            effectiveFrom: String(t.effective_from),
            summary: describeTariff(t.rule_json),
          })),
        },
    passes: passesRes.error
      ? { ok: false, error: `passes: ${passesRes.error.message}` }
      : {
          ok: true,
          data: (passesRes.data ?? []).map((p) => ({
            id: String(p.id),
            plate: maskPlate(String(p.vehicle_no)),
            validTo: String(p.valid_to),
            duesPaise: Number(p.dues),
            state: passState(String(p.valid_to), today),
          })),
        },
    passesTruncated: (passesRes.data?.length ?? 0) >= PASS_LIMIT,
  };
}
