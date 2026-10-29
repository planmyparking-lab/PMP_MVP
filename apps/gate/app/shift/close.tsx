import { useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";

import {
  computeShiftVariance,
  findOpenShift,
  shiftTotals,
  validateShiftClose,
} from "../../src/domain/shiftTotals";
import { WriteRuleError, writeEvent } from "../../src/data/writeEvent";
import { formatPaise, parseRupeeInput } from "../../src/domain/paise";
import { istClockTime } from "../../src/domain/istClock";
import { cancelZoneReminders } from "../../src/notifications/schedule";
import { useOccupancy, useI18n } from "../../src/ui/useSyncState";
import { usePortRequired } from "../../src/ui/port";
import { BigButton, Field, KVRow, Muted, Note, Screen } from "../../src/ui/ui";

/**
 * Shift CLOSE screen (GATE-06 sequences 2-5; T-GATE-06-U1/U3/N1/N2): expected cash shows
 * float + CASH payments of the window; UPI compares the DECLARED number against the attested
 * local total; variances beyond the facility threshold REQUIRE a reason (strictly-greater
 * rule). The SHIFT_CLOSE payload (SYNC-01) persists the reconciliation row: counted/expected
 * cash, declared/attested UPI and both signed variances, paired with the SHIFT_OPEN's shift_id
 * — the open/close pair is append-only (no correction events; corrections ride OVERRIDE, OQ-30).
 *
 * Honesty notes:
 * - counted cash is a required integer (0 valid, empty not — T-GATE-06-N1);
 * - the opening float prefers the persisted SHIFT_OPEN payload (findOpenShift); only a
 *   pre-payload event falls back to the manual re-entry field;
 * - variance sign convention: counted − expected cash and declared − attested UPI (the sheet's
 *   U2 numbers); the contract does not pin the sign for SQL, see event-envelope.md open items;
 * - unsynced payments never block the close; the count is displayed instead;
 * - the shift's zone reminders are cancelled ONLY after the close event actually commits.
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

  const floatPaise =
    openShift?.openingFloatPaise ?? port.openingFloatPaise ?? parseRupeeInput(floatText);
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

  async function close() {
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
    if (openShift.shiftId == null) {
      // the close must pair with the open's shift_id; a pre-SYNC-01 SHIFT_OPEN cannot provide
      // one, so the reconciliation stays review-only rather than inventing an id
      setError(t("errors.writeRejected", { detail: "open shift has no shift id payload" }));
      return;
    }
    try {
      // SHIFT_CLOSE payload (SYNC-01): full reconciliation, signed variances, paired by
      // shift_id; reason travels in the payload's `reason` when one was required/given.
      await writeEvent(port.writeDeps, {
        type: "SHIFT_CLOSE",
        payload: {
          shift_id: openShift.shiftId,
          counted_cash_paise: countedCash,
          expected_cash_paise: variance.expectedCashPaise,
          upi_total_declared_paise: upiDeclared ?? 0,
          upi_attested_sum_paise: variance.upiAttestedTotalPaise,
          variance_cash_paise: variance.cashVariancePaise,
          variance_upi_paise: variance.upiVariancePaise,
          reason: reason.trim() === "" ? undefined : reason.trim(),
        },
      });
      // only AFTER the close commits: cancel exactly what was scheduled for this shift
      if (port.reminderIds.length > 0) {
        await cancelZoneReminders(port.reminderIds);
        port.setReminderIds([]);
      }
      port.setOpeningFloat(null);
      port.bump();
      setError(null);
    } catch (err) {
      setError(err instanceof WriteRuleError ? err.message : String(err));
    }
  }

  const unsyncedCount = port.devClient.health().queueDepth;
  const stillInside = Object.values(occupancy?.zones ?? {}).reduce(
    (acc, zone) => acc + zone.count,
    0,
  );

  return (
    <Screen title={t("shift.closeTitle")} onBack={() => router.back()}>
      {port.openingFloatPaise === null && openShift.openingFloatPaise === null && (
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
      {openShift.shiftId === null && (
        <Note tone="warn">
          {t("errors.writeRejected", { detail: "open shift has no shift id payload" })}
        </Note>
      )}

      <BigButton title={t("shift.reviewClose")} onPress={() => void close()} />
      <Muted>{`${t("home.currentShift", { time: istClockTime(Date.parse(openShift.openAt)) })} · ${t("shift.vehicles")}: ${String(totals.vehicles)}`}</Muted>
    </Screen>
  );
}
