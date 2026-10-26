import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  validateZoneCount,
  zoneGap,
  zoneSafetyLimit,
  ACTIVE_SAFETY_LIMIT_MODE,
} from "../src/domain/zoneCount";
import { findOpenShift } from "../src/domain/shiftTotals";
import { zoneReminderTimes } from "../src/notifications/zoneReminders";
import { istClockTime } from "../src/domain/istClock";
import { useOccupancy, useI18n } from "../src/ui/useSyncState";
import { usePortRequired } from "../src/ui/port";
import { BigButton, Field, KVRow, Muted, Note, P, Screen, ToggleRow } from "../src/ui/ui";

/**
 * Zone-count screen (GATE-08 sequences 4.2-4.5, T-GATE-08-U1/U2): zone → counted number (0 to
 * safety limit) → system value + gap → confirm above capacity → review (persistence is blocked
 * until IC-01 supports the count payload).
 *
 * Honesty notes:
 * - safety limit mode is ABSOLUTE_PLUS_50 (capacity + 50) so the D.8-U2 case (50 cap, 76 counted
 *   → warn + accept) holds; OQ-39 documents the conflict with the proportional reading;
 * - IC-01 does not yet define the ZONE_COUNT payload, so counts can be validated and reviewed but
 *   are not written as an empty event that would falsely imply the count was saved;
 * - shift reminders display from the pure plan; when notifications were denied (empty
 *   reminderIds with an open shift) the in-app banner path is announced here instead.
 */

export default function ZoneCountScreen() {
  const port = usePortRequired();
  const { t } = useI18n();
  const router = useRouter();
  const occupancy = useOccupancy(port.client, port.config.facilityId);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [countText, setCountText] = useState("");
  const [confirmedAbove, setConfirmedAbove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const events = port.readEvents();
  const openShift = port.deviceId === null ? null : findOpenShift(events, port.deviceId);

  const zone = useMemo(
    () => port.config.zones.find((z) => z.id === zoneId) ?? null,
    [port.config.zones, zoneId],
  );
  const systemCount = zoneId === null ? null : (occupancy?.zones[zoneId]?.count ?? null);
  const baselineAt = zoneId === null ? null : (occupancy?.zones[zoneId]?.baselineAt ?? null);

  const actual =
    countText.trim() === ""
      ? null
      : /^\d+$/.test(countText.trim())
        ? Number(countText.trim())
        : Number.NaN;
  const validation =
    zone !== null && actual !== null
      ? validateZoneCount(actual, zone.capacity, {
          safetyLimitMode: ACTIVE_SAFETY_LIMIT_MODE,
        })
      : null;
  const gap =
    zone !== null && actual !== null && Number.isInteger(actual) && systemCount !== null
      ? zoneGap(actual, systemCount)
      : null;

  const reminders =
    openShift !== null ? zoneReminderTimes(openShift.openAt, port.config.shiftLengthMinutes) : null;
  const remindersDenied = openShift !== null && port.reminderIds.length === 0;

  function save() {
    if (zone === null || actual === null || !Number.isInteger(actual)) {
      setError(t("zoneCount.notInteger"));
      return;
    }
    if (!validation?.ok) {
      setError(
        validation !== null && "issue" in validation && validation.issue === "ABOVE_SAFETY_LIMIT"
          ? t("zoneCount.aboveSafetyLimit")
          : t("zoneCount.notInteger"),
      );
      return;
    }
    if (validation.warning === "ABOVE_CAPACITY" && !confirmedAbove) {
      // warn + confirm (above capacity needs a deliberate second action)
      setConfirmedAbove(true);
      return;
    }
    setError(t("zoneCount.writeUnavailable"));
  }

  return (
    <Screen title={t("zoneCount.title")} onBack={() => router.back()}>
      <Text style={styles.label}>{t("zoneCount.chooseZone")}</Text>
      {port.config.zones.map((candidate) => (
        <ToggleRow
          key={candidate.id}
          label={`${candidate.id} · ${t("zoneCount.capacity", { n: candidate.capacity })}`}
          active={zoneId === candidate.id}
          onPress={() => {
            setZoneId(candidate.id);
            setConfirmedAbove(false);
            setCountText("");
            setError(null);
          }}
        />
      ))}

      {zone !== null && (
        <View>
          <KVRow
            label={t("zoneCount.system")}
            value={systemCount === null ? t("common.unknown") : String(systemCount)}
          />
          {baselineAt !== null && (
            <Muted>{t("zoneCount.baseline", { time: istClockTime(Date.parse(baselineAt)) })}</Muted>
          )}
          <Field
            label={t("zoneCount.actual")}
            value={countText}
            onChangeText={(raw) => {
              setCountText(raw);
              setConfirmedAbove(false);
            }}
            inputMode="numeric"
          />
          <Muted>{`${t("shift.threshold")}: 0…${String(zoneSafetyLimit(zone.capacity, ACTIVE_SAFETY_LIMIT_MODE))}`}</Muted>
          {validation !== null && !validation.ok && validation.issue === "ABOVE_SAFETY_LIMIT" && (
            <Note tone="danger">{t("zoneCount.aboveSafetyLimit")}</Note>
          )}
          {validation !== null && validation.ok && validation.warning === "ABOVE_CAPACITY" && (
            <Note tone="warn">
              {t("zoneCount.aboveCapacityWarning")}
              {confirmedAbove ? <Muted>{t("common.confirm")}</Muted> : null}
            </Note>
          )}
          {gap !== null && (
            <KVRow
              label={t("zoneCount.gap")}
              value={`${gap.direction === "OVER" ? "+" : gap.direction === "UNDER" ? "−" : "0"}${String(Math.abs(gap.gap))}`}
            />
          )}
          {error !== null && <Note tone="danger">{error}</Note>}
          <Note tone="warn">{t("zoneCount.writeUnavailable")}</Note>
          <BigButton title={t("zoneCount.confirmReview")} onPress={save} />
        </View>
      )}

      {reminders !== null && (
        <View>
          <Muted>
            {`${t("zoneCount.title")}: ${istClockTime(Date.parse(reminders.remindersIso[0] ?? ""))} · ${istClockTime(Date.parse(reminders.remindersIso[1] ?? ""))}${reminders.usedDefault ? ` · ${t("zoneCount.defaultShiftLength")}` : ""}`}
          </Muted>
          {remindersDenied && <Note>{t("shift.notifyDenied")}</Note>}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: 12, marginBottom: 2, color: P.muted, fontSize: 13 },
});
