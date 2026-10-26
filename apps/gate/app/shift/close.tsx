import { useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";

import {
  computeShiftVariance,
  findOpenShift,
  shiftTotals,
  validateShiftClose,
} from "../../src/domain/shiftTotals";
import { formatPaise, parseRupeeInput } from "../../src/domain/paise";
import { istClockTime } from "../../src/domain/istClock";
import { useOccupancy, useI18n } from "../../src/ui/useSyncState";
import { usePortRequired } from "../../src/ui/port";
import { BigButton, Field, KVRow, Muted, Note, Screen } from "../../src/ui/ui";

/**
 * Shift CLOSE screen (GATE-06 sequences 2-5; T-GATE-06-U1/U3/N1/N2): expected cash shows
 * float + CASH payments of the window; UPI compares the DECLARED number against the attested
 * local total; variances beyond the facility threshold REQUIRE a reason (strictly-greater
 * rule). IC-01 does not yet carry the totals/variance fields, so the screen reviews the
 * reconciliation but does not persist a bare SHIFT_CLOSE event or cancel the shift reminders.
 *
 * Honesty notes:
 * - counted cash is a required integer (0 valid, empty not — T-GATE-06-N1);
 * - float lost by restart → the screen demands it again with the explainer (it cannot be
 *   derived — INPUT-not-derivable rule, shiftTotals.ts header);
 * - unsynced payments never block the close; the count is displayed instead.
 */

export default function ShiftCloseScreen() {
  const port = usePortRequired();
  const { t } = useI18n();
  const router = useRouter();
  const occupancy = useOccupancy(port.client, port.config.facilityId);
  const [countedText, setCountedText] = useState("");
  const [declaredText, setDeclaredText] = useState("");
  const [floatText, setFloatText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const events = port.readEvents();
  const openShift = port.deviceId === null ? null : findOpenShift(events, port.deviceId);

  const floatPaise = port.openingFloatPaise ?? parseRupeeInput(floatText);
  const totals = useMemo(
    () => (openShift === null ? null : shiftTotals(events, openShift)),
    [openShift, port.eventsVersion, floatPaise],
  );

  if (openShift === null || totals === null) {
    return (
      <Screen title={t("shift.closeTitle")} onBack={() => router.back()}>
        <Note tone="warn">{t("home.noShift")}</Note>
        <BigButton title={t("shift.openTitle")} onPress={() => router.push("/shift/open")} />
      </Screen>
    );
  }

  const countedCash = countedText.trim() === "" ? null : parseRupeeInput(countedText);
  const upiDeclared = declaredText.trim() === "" ? 0 : parseRupeeInput(declaredText);
  const variance =
    countedCash !== null && floatPaise !== null
      ? computeShiftVariance({
          openingFloatPaise: floatPaise,
          countedCashPaise: countedCash,
          upiDeclaredPaise: upiDeclared ?? 0,
          totals,
          thresholdPaise: port.config.varianceThresholdPaise,
        })
      : null;

  const closeValidation =
    variance !== null ? validateShiftClose(countedCash, variance, reason) : null;

  function close() {
    if (openShift === null || totals === null) {
      setError(t("home.noShift"));
      return;
    }
    if (variance === null || closeValidation === null || countedCash === null) {
      setError(t("shift.countedRequired"));
      return;
    }
    if (!closeValidation.ok) {
      setError(
        closeValidation.issue === "COUNTED_CASH_REQUIRED"
          ? t("shift.countedRequired")
          : t("shift.varianceReasonRequired", {
              amount: formatPaise(variance.thresholdPaise),
            }),
      );
      return;
    }
    setError(t("shift.closeUnavailable"));
  }

  const unsyncedCount = port.devClient.health().queueDepth;
  const stillInside = Object.values(occupancy?.zones ?? {}).reduce(
    (acc, zone) => acc + zone.count,
    0,
  );

  return (
    <Screen title={t("shift.closeTitle")} onBack={() => router.back()}>
      {port.openingFloatPaise === null && (
        <Field
          label={`${t("shift.openingFloat")} · ${t("shift.floatUnknown")}`}
          value={floatText}
          onChangeText={setFloatText}
          inputMode="decimal"
          placeholder={t("shift.openingFloatExample")}
        />
      )}

      <KVRow
        label={t("shift.openingFloat")}
        value={floatPaise === null ? t("common.unknown") : formatPaise(floatPaise)}
      />
      <KVRow
        label={t("shift.expectedCash")}
        value={variance === null ? "—" : formatPaise(variance.expectedCashPaise)}
      />
      <KVRow
        label={t("payment.upi")}
        value={variance === null ? "—" : formatPaise(variance.upiAttestedTotalPaise)}
      />

      <Field
        label={t("shift.countedCash")}
        value={countedText}
        onChangeText={setCountedText}
        inputMode="decimal"
        placeholder={t("shift.countedCashExample")}
      />
      <Field
        label={t("shift.upiDeclared")}
        value={declaredText}
        onChangeText={setDeclaredText}
        inputMode="decimal"
        placeholder={t("shift.upiTotalExample")}
      />

      {variance !== null && (
        <View>
          <KVRow
            label={`${t("shift.variance")} · ${t("payment.cash")}`}
            value={`${formatPaise(variance.cashVariancePaise)}`}
          />
          <KVRow
            label={`${t("shift.variance")} · ${t("payment.upi")}`}
            value={`${formatPaise(variance.upiVariancePaise)}`}
          />
          {(variance.cashReasonRequired || variance.upiReasonRequired) && (
            <Field
              label={`${t("shift.varianceReason")} · ${t("shift.varianceReasonRequired", { amount: formatPaise(variance.thresholdPaise) })}`}
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={200}
            />
          )}
        </View>
      )}

      {unsyncedCount > 0 && <Note>{t("shift.notSyncedCount", { count: unsyncedCount })}</Note>}
      {stillInside > 0 && <Note>{`${t("shift.stillInside")} (${String(stillInside)})`}</Note>}
      {error !== null && <Note tone="danger">{error}</Note>}
      <Note tone="warn">{t("shift.closeUnavailable")}</Note>

      <BigButton title={t("shift.reviewClose")} onPress={close} />
      <Muted>{`${t("home.currentShift", { time: istClockTime(Date.parse(openShift.openAt)) })} · ${t("shift.vehicles")}: ${String(totals.vehicles)}`}</Muted>
    </Screen>
  );
}
