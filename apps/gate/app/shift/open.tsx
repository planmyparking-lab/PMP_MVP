import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";

import { findOpenShift } from "../../src/domain/shiftTotals";
import { zoneReminderTimes } from "../../src/notifications/zoneReminders";
import { formatPaise, parseRupeeInput } from "../../src/domain/paise";
import { istClockTime } from "../../src/domain/istClock";
import { WriteRuleError, writeEvent } from "../../src/data/writeEvent";
import { useI18n } from "../../src/ui/useSyncState";
import { usePortRequired } from "../../src/ui/port";
import { scheduleZoneReminders } from "../../src/notifications/schedule";
import { BigButton, Field, Muted, Note, Screen } from "../../src/ui/ui";
import { addLogLine } from "../../src/lib/log";
import { afterShiftOpenNavigation } from "../../src/domain/navigation";

/**
 * Shift OPEN screen (GATE-06 sequences 1-2; T-GATE-06-I1): guard opens with an opening float,
 * event SHIFT_OPEN is written once per device guard shift, then the shift's zone reminders
 * (1/3 and 2/3 of the shift length — config length or 480 default) are scheduled.
 *
 * Honesty notes:
 * - the float is provider state (ui/port.tsx) because the IC-01 SHIFT_OPEN payload cannot
 *   carry it yet; the value is required on the close screen, so it is preserved there;
 * - when a shift is ALREADY open on this device the screen blocks with a close-first note and
 *   never schedules a second reminder pair;
 * - reminders denied/not scheduled → null ids and a screen note (banner path covers it).
 */

export default function ShiftOpenScreen() {
  const port = usePortRequired();
  const { t } = useI18n();
  const router = useRouter();
  const [floatText, setFloatText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const events = port.readEvents();
  const openShift = port.deviceId === null ? null : findOpenShift(events, port.deviceId);

  async function open() {
    const floatPaise = parseRupeeInput(floatText);
    if (floatPaise === null) {
      setError(t("shift.countedRequired"));
      return;
    }
    setBusy(true);
    try {
      const atIso = new Date().toISOString();
      await writeEvent(port.writeDeps, { type: "SHIFT_OPEN" });
      port.setOpeningFloat(floatPaise);
      addLogLine(`shift opened float=${String(floatPaise)}`, atIso);
      const plan = zoneReminderTimes(atIso, port.config.shiftLengthMinutes);
      const ids = await scheduleZoneReminders(plan);
      port.setReminderIds(ids ?? []);
      port.bump();
      const destination = afterShiftOpenNavigation(router.canGoBack());
      if (destination.kind === "back") router.back();
      else router.replace(destination.route);
    } catch (err) {
      setError(err instanceof WriteRuleError ? err.message : String(err));
      addLogLine(`shift open failed: ${String(err)}`, new Date().toISOString());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={t("shift.openTitle")} onBack={() => router.back()}>
      {openShift !== null ? (
        <View>
          <Note tone="warn">{t("shift.alreadyOpen")}</Note>
          <Muted>{`${t("home.currentShift", { time: istClockTime(Date.parse(openShift.openAt)) })} · ${t("shift.openingFloat")}: ${port.openingFloatPaise === null ? t("common.unknown") : formatPaise(port.openingFloatPaise)}`}</Muted>
          <BigButton title={t("shift.closeTitle")} onPress={() => router.replace("/shift/close")} />
        </View>
      ) : (
        <View>
          <Note>{t("common.devSeed")}</Note>
          <Field
            label={t("shift.openingFloat")}
            value={floatText}
            onChangeText={setFloatText}
            inputMode="decimal"
            placeholder={t("shift.openingFloatExample")}
          />
          {error !== null && <Note tone="danger">{error}</Note>}
          <BigButton title={t("shift.openNow")} onPress={() => void open()} disabled={busy} />
        </View>
      )}
    </Screen>
  );
}
