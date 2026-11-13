import "server-only";
import {
  EXPIRED_PASS_LIMIT,
  PASS_LIMIT,
  describeTariff,
  effectiveDateMismatch,
  maskPlate,
  passState,
  tariffStatuses,
} from "../facilityConfig";
import type { PassState, TariffStatus, TariffSummary } from "../facilityConfig";
import { probeLimit, takeLimited } from "../readLimits";
import { createSupabaseServerClient } from "../supabase/server";
import { localDate } from "./localDay";
import { getConsoleSession } from "./session";
import type { FacilitySummary, Loaded } from "./types";

export interface ZoneConfig {
  id: string;
  name: string;
  capacity: number;
  vehicleClass: string;
}
export interface TariffConfig {
  id: string;
  vehicleClass: string;
  /** The row's start as a calendar date in the facility's time zone (null if unreadable). */
  effectiveDate: string | null;
  status: TariffStatus;
  /** Set when the rule JSON and the row disagree on the start day. */
  dateWarning: string | null;
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

export interface PassCounts {
  /** Valid today, including those expiring within 7 days. */
  valid: number;
  expired: number;
}

export interface FacilityConfigLive {
  facility: FacilitySummary;
  asOf: string;
  zones: Loaded<ZoneConfig[]>;
  tariffs: Loaded<TariffConfig[]>;
  /** Valid passes first (soonest expiry first), then the most recently expired. */
  passes: Loaded<PassConfig[]>;
  /** Exact counts from the database, independent of how many rows are shown. */
  passCounts: Loaded<PassCounts>;
  /** More valid passes exist than PASS_LIMIT. */
  passesTruncated: boolean;
  /** More expired passes exist than EXPIRED_PASS_LIMIT. */
  expiredTruncated: boolean;
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

  const passes = () =>
    supabase.from("passes").select("id, vehicle_no, valid_to, dues").eq("facility_id", facility.id);
  const passCount = () =>
    supabase
      .from("passes")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facility.id);

  const [zonesRes, tariffsRes, validRes, expiredRes, validCountRes, expiredCountRes] =
    await Promise.all([
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
      passes().gte("valid_to", today).order("valid_to").limit(probeLimit(PASS_LIMIT)),
      passes()
        .lt("valid_to", today)
        .order("valid_to", { ascending: false })
        .limit(probeLimit(EXPIRED_PASS_LIMIT)),
      passCount().gte("valid_to", today),
      passCount().lt("valid_to", today),
    ]);

  const valid = takeLimited(validRes.data, PASS_LIMIT);
  const expired = takeLimited(expiredRes.data, EXPIRED_PASS_LIMIT);
  const passError = validRes.error ?? expiredRes.error;
  const countError = validCountRes.error ?? expiredCountRes.error;

  const tariffRows = (tariffsRes.data ?? []).map((t) => ({
    id: String(t.id),
    vehicleClass: String(t.vehicle_class),
    effectiveFrom: String(t.effective_from),
    rule: t.rule_json,
  }));
  const statuses = tariffStatuses(tariffRows, asOf);

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
          data: tariffRows.map((t) => {
            const summary = describeTariff(t.rule);
            const effectiveDate = localDate(t.effectiveFrom, facility.timezone);
            return {
              id: t.id,
              vehicleClass: t.vehicleClass,
              effectiveDate,
              status: statuses[t.id] ?? "unknown",
              dateWarning: summary.ok
                ? effectiveDateMismatch(effectiveDate, summary.effectiveFrom)
                : null,
              summary,
            };
          }),
        },
    passes: passError
      ? { ok: false, error: `passes: ${passError.message}` }
      : {
          ok: true,
          data: [...valid.rows, ...expired.rows].map((p) => ({
            id: String(p.id),
            plate: maskPlate(String(p.vehicle_no)),
            validTo: String(p.valid_to),
            duesPaise: Number(p.dues),
            state: passState(String(p.valid_to), today),
          })),
        },
    passCounts: countError
      ? { ok: false, error: `pass counts: ${countError.message}` }
      : {
          ok: true,
          data: { valid: validCountRes.count ?? 0, expired: expiredCountRes.count ?? 0 },
        },
    passesTruncated: valid.truncated,
    expiredTruncated: expired.truncated,
  };
}
