import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";

import { PortProvider } from "../src/ui/port";
import { ZONE_COUNT_ROUTE, addReminderTapListener } from "../src/notifications/schedule";
import { addLogLine } from "../src/lib/log";
import { AppErrorBoundary } from "../src/ui/AppErrorBoundary";

/**
 * App shell (GATE-12): router stack under the port provider, notifications handler, reminder
 * deep links. Screen headers come from the Screen primitive; headerShown stays off so the
 * 56 dp target rules and i18n titles own the chrome.
 */

// Foreground display behavior once per app launch (Android 13+ needs the posted channel).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Notification-tap bridge: reminder taps deep-link to /zone-count (GATE-08 sequence 4.5). */
function ReminderTapBridge() {
  const router = useRouter();
  useEffect(
    () =>
      addReminderTapListener((route) => {
        if (route === ZONE_COUNT_ROUTE) {
          router.navigate(ZONE_COUNT_ROUTE);
          addLogLine(`reminder tap → deep link ${ZONE_COUNT_ROUTE}`, new Date().toISOString());
        }
      }),
    [router],
  );
  return null;
}

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <PortProvider>
        <StatusBar style="dark" />
        <ReminderTapBridge />
        <Stack screenOptions={{ headerShown: false }} />
      </PortProvider>
    </AppErrorBoundary>
  );
}
