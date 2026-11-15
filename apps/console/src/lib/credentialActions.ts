import { z } from "zod";

/**
 * CON-02 credential actions the Console can perform with the #34 column grants: deactivate a guard (`staff.active`) and
 * revoke a phone (`devices.revoked_at`). Adding a guard, setting a PIN, reactivating a guard and enrolling a phone need
 * database functions that do not exist yet (`set_staff_pin`, `create_enrollment_code`, IC-05, IC-06), so they are not
 * offered here. Row-level security is the real control; these helpers only shape input and messages.
 */
export const GuardTarget = z.object({ staff_id: z.uuid() });
export const DeviceTarget = z.object({ device_id: z.uuid() });

export interface ActionState {
  ok: boolean;
  message: string | null;
}

export const ACTION_IDLE: ActionState = { ok: false, message: null };

/** Why reactivating is not offered (sheet C2 step 3: "reactivation requires a new PIN"). */
export const REACTIVATE_UNAVAILABLE =
  "Reactivating a guard needs a new PIN, and PINs can only be set through set_staff_pin, which is not built yet.";

export const ADD_GUARD_UNAVAILABLE =
  "Adding a guard needs set_staff_pin (IC-06), which hashes the PIN in the database. It is not built yet.";

export const ADD_DEVICE_UNAVAILABLE =
  "Adding a phone needs create_enrollment_code and enroll_device (IC-05). They are not built yet.";

/** User-facing text for a failed update. Never echoes the database message. */
export function credentialUpdateError(code: string | null | undefined): string {
  switch (code) {
    case "42501":
      return "Your account cannot change this yet (row-level security is not deployed).";
    case "PGRST205":
    case "42P01":
      return "This table is not available in the database yet.";
    default:
      return "Nothing was saved. Try again in a moment.";
  }
}

/**
 * An update that matched no row is not an error in PostgREST. It means the row was already in the target state, is in
 * another facility, or row-level security hid it. All three are told the same way, because the Console cannot tell
 * them apart and must not claim more than it knows.
 */
export function nothingChanged(what: "guard" | "phone"): string {
  return what === "guard"
    ? "Nothing changed: this guard is already inactive, or your account cannot change staff in this facility yet."
    : "Nothing changed: this phone is already revoked, or your account cannot change devices in this facility yet.";
}

/**
 * Events still waiting on the facility's phones, from each phone's latest heartbeat (0008). `ingest_events` checks
 * that the staff member is active and the phone is not revoked when an event ARRIVES (0004), not when it was recorded,
 * so anything still queued when a guard is deactivated or a phone revoked is refused at sync (see OQ-63).
 */
export interface QueueSummary {
  /** Events waiting across the phones that reported a heartbeat. */
  events: number;
  /** Phones with at least one waiting event. */
  phonesWithQueue: number;
  /** Active phones with no heartbeat, whose queue is unknown. */
  phonesUnknown: number;
}

export function facilityQueue(
  devices: ReadonlyArray<{ id: string; revokedAt: string | null }>,
  heartbeats: ReadonlyArray<{ deviceId: string; queueDepth: number }> | null,
): QueueSummary | null {
  if (heartbeats === null) return null;
  const byDevice = new Map(heartbeats.map((h) => [h.deviceId, h.queueDepth]));
  let events = 0;
  let phonesWithQueue = 0;
  let phonesUnknown = 0;
  for (const d of devices) {
    if (d.revokedAt !== null) continue;
    const q = byDevice.get(d.id);
    if (q === undefined) phonesUnknown++;
    else if (q > 0) {
      events += q;
      phonesWithQueue++;
    }
  }
  return { events, phonesWithQueue, phonesUnknown };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The unsynced-events warning shown before deactivating a guard. Queue sizes are per phone, not per guard. */
export function guardQueueWarning(q: QueueSummary | null): string {
  if (q === null) {
    return "Queue sizes are unknown (no heartbeats can be read). Ask the facility's phones to sync before you deactivate, so this guard's recorded events are not refused.";
  }
  const parts: string[] = [];
  if (q.events > 0) {
    parts.push(
      `${plural(q.events, "event is", "events are")} still waiting to sync on ${plural(q.phonesWithQueue, "phone", "phones")}. Any of them recorded by this guard will be refused.`,
    );
  }
  if (q.phonesUnknown > 0) {
    parts.push(
      `${plural(q.phonesUnknown, "phone has", "phones have")} sent no heartbeat, so ${q.phonesUnknown === 1 ? "its" : "their"} queue is unknown.`,
    );
  }
  if (parts.length === 0)
    return "No phone reports events waiting to sync, so nothing recorded by this guard is lost.";
  return `${parts.join(" ")} Ask the phones to sync first if you can.`;
}

/**
 * The unsynced-events warning shown before revoking one phone. `queueDepth` is null when the phone sent no heartbeat,
 * and "unavailable" when no heartbeat can be read at all.
 */
export function phoneQueueWarning(queueDepth: number | null | "unavailable"): string {
  if (queueDepth === "unavailable") {
    return "Queue sizes are unknown (no heartbeats can be read). Any events still waiting on this phone will be refused. Let it sync first if you can.";
  }
  if (queueDepth === null) {
    return "This phone has sent no heartbeat, so it is unknown whether events are still waiting on it. Any that are will be refused.";
  }
  if (queueDepth === 0) return "Its last heartbeat reported no events waiting to sync.";
  return `Its last heartbeat reported ${plural(queueDepth, "event", "events")} still waiting to sync. They will be refused. Let it sync first if you can.`;
}
