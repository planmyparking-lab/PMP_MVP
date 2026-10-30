import * as Notifications from "expo-notifications";

import { translate } from "../i18n/config";
import type { ZoneReminderPlan } from "./zoneReminders";

/**
 * expo-notifications wiring for zone-count reminders (GATE-08 sequence 4.4, device-side;
 * T-GATE-08-U1's instants come from the pure zoneReminders module and schedule EXACTLY here).
 *
 * PERMISSION RULE (GATE-08 failure 9): denied notifications → reminders via the persistent
 * in-app banner at the same instants; the screen stores the returned ids only when scheduling
 * succeeded so shift close cancels exactly what was scheduled (no dangling notifications).
 * Tap deep link → router path /zone-count is wired in app/_layout.tsx.
 */

const CHANNEL_ID = "zone-reminders";
const NOTIFICATION_ROUTE_KEY = "route";
export const ZONE_COUNT_ROUTE = "/zone-count";

export type ScheduledReminders = { ids: string[] };

export async function ensureAndroidChannel(): Promise<void> {
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: translate("zoneCount.title"),
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  } catch {
    // channel creation failure ⇒ reminders fail-as-denied; the banner path covers it
  }
}

export async function reminderPermissionState(): Promise<boolean> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    return !!settings.granted;
  } catch {
    return false; // treated as denied: banner path (never a fake "scheduled")
  }
}

export async function requestReminderPermission(): Promise<boolean> {
  try {
    const outcome = await Notifications.requestPermissionsAsync();
    return !!outcome.granted;
  } catch {
    return false;
  }
}

/** Schedule exactly the plan's alarm instants (future only); returns null when denied. */
export async function scheduleZoneReminders(plan: ZoneReminderPlan): Promise<string[] | null> {
  try {
    const granted = await reminderPermissionState();
    if (!granted) return null;
    await ensureAndroidChannel();
    const ids: string[] = [];
    for (const alarm of plan.reminderAlarms) {
      const at = Date.parse(alarm.atIso);
      if (Number.isNaN(at) || at <= Date.now()) continue; // past instants are never scheduled
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: translate("zoneCount.title"),
          body: translate("zoneCount.chooseZone"),
          sound: "default",
          data: { [NOTIFICATION_ROUTE_KEY]: ZONE_COUNT_ROUTE, label: alarm.label },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at) },
      });
      ids.push(id);
    }
    return ids;
  } catch {
    return null;
  }
}

export async function cancelZoneReminders(ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // already gone (fired or cleared): cancelling a dead id is not an error path
    }
  }
}

/** Tap deep-link subscription: resolves the routed key; the router concern is the caller's. */
export function addReminderTapListener(
  onRoute: (route: string, label: string) => void,
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, unknown>;
    const route =
      typeof data[NOTIFICATION_ROUTE_KEY] === "string"
        ? (data[NOTIFICATION_ROUTE_KEY] as string)
        : null;
    const label = typeof data.label === "string" ? (data.label as string) : "";
    if (route !== null) onRoute(route, label);
  });
  return () => sub.remove();
}
