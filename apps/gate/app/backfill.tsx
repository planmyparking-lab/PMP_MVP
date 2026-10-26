import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  backfillDuplicateWarning,
  isOlderThan24h,
  resolvePaperTime,
  validateBackfillExit,
  validateBackfillTime,
  type BackfillExitMode,
} from "../src/domain/backfill";
import { OVERRIDE_REASON_CODES, validateOverrideInput } from "../src/domain/override";
import { findOpenShift } from "../src/domain/shiftTotals";
import { formatPaise, parseRupeeInput } from "../src/domain/paise";
import { istClockTime } from "../src/domain/istClock";
import { useI18n } from "../src/ui/useSyncState";
import { usePortRequired } from "../src/ui/port";
import { BigButton, Field, Muted, Note, P, Screen, Tabs, ToggleRow } from "../src/ui/ui";
import { addLogLine } from "../src/lib/log";

/**
 * Paper-backfill screen (GATE-11 sequences 2-3): tabs for entries/exits; time picker (HH:MM
 * resolved to the most recent matching instant), class/zone/plate/code for entries, mode +
 * amount + (reason) for exits; duplicate warning against locally-known rows; supervisor-only
 * rule for times older than 24 h.
 *
 * THE WRITE PATH IS DELIBERATELY BLOCKED: IC-01 events cannot carry a `source =
 * PAPER_BACKFILL` flag yet, so a persisted backfill event today would be
 * INDISTINGUISHABLE from a live event — fabrication of provenance is prohibited. This screen
 * validates drafts to full completeness and displays the blocked panel; NOTHING is written by
 * this flow (the reason panel cites the exact contract gap). When the envelope TODO lands, the
 * write wrapper goes here and nowhere else.
 */

type Tab = "entries" | "exits";

export default function BackfillScreen() {
  const port = usePortRequired();
  const { t } = useI18n();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("entries");
  const [timeText, setTimeText] = useState("");
  const [classId, setClassId] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [plate, setPlate] = useState("");
  const [code, setCode] = useState("");
  const [exitMode, setExitMode] = useState<BackfillExitMode | null>(null);
  const [amountText, setAmountText] = useState("");
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);

  const events = port.readEvents();
  const openShift = port.deviceId === null ? null : findOpenShift(events, port.deviceId);
  const nowIso = new Date().toISOString();
  const role = port.staffSession?.role ?? null;

  const resolvedTime = useMemo(
    () => (timeText.trim() === "" ? null : resolvePaperTime(timeText, Date.parse(nowIso))),
    [timeText, nowIso],
  );
  // {ok:true; iso} | {ok:false} → the single usable instant (null while unresolved/invalid).
  const paperIso = resolvedTime !== null && resolvedTime.ok ? resolvedTime.iso : null;
  const timeCheck =
    paperIso !== null
      ? validateBackfillTime(paperIso, nowIso, openShift === null ? null : openShift.openAt)
      : null;
  const olderThan24 = paperIso !== null ? isOlderThan24h(paperIso, nowIso) : false;
  const supervisorRequired = olderThan24 && role !== "SUPERVISOR";

  const duplicate =
    paperIso !== null
      ? backfillDuplicateWarning(
          port.registry.list(),
          {
            shortCode: code.trim() === "" ? null : code.trim().toUpperCase(),
            vehicleNo: plate.trim() === "" ? null : plate.trim(),
          },
          paperIso,
        )
      : null;

  const amount = parseRupeeInput(amountText);
  const exitCheck =
    tab === "exits"
      ? validateBackfillExit({
          mode: exitMode,
          amountPaise: amount === null ? (amountText.trim() === "" ? null : Number.NaN) : amount,
          reasonCode,
        })
      : null;

  function reviewNext() {
    setReviewed(true);
    if (tab === "exits" && exitCheck !== null && exitCheck.ok && amount !== null) {
      const rule = validateOverrideInput({ reasonCode: reasonCode ?? "", note: null });
      if (!rule.ok) {
        addLogLine(
          `backfill exit draft: typed amount ${String(amount)} requires a fixed reason (event write remains blocked by the IC-01 contract gap)`,
          nowIso,
        );
      }
    }
  }

  function reset() {
    setTimeText("");
    setClassId(null);
    setZoneId(null);
    setPlate("");
    setCode("");
    setExitMode(null);
    setAmountText("");
    setReasonCode(null);
    setReviewed(false);
  }

  return (
    <Screen title={t("backfill.title")} onBack={() => router.back()}>
      <Tabs
        options={[
          { key: "entries", label: t("backfill.tabEntries") },
          { key: "exits", label: t("backfill.tabExits") },
        ]}
        active={tab}
        onSelect={(key) => {
          setTab(key === "exits" ? "exits" : "entries");
          setReviewed(false);
        }}
      />

      <Field
        label={`${t("backfill.paperTime")} · ${t("backfill.hintTime")}`}
        value={timeText}
        onChangeText={(raw) => {
          setTimeText(raw);
          setReviewed(false);
        }}
        placeholder={t("backfill.timeExample")}
      />
      {timeText.trim() !== "" && paperIso === null && (
        <Note tone="danger">{t("backfill.invalidTime")}</Note>
      )}
      {timeCheck !== null && !timeCheck.ok && timeCheck.issue === "FUTURE" && (
        <Note tone="danger">{t("backfill.futureRejected")}</Note>
      )}
      {timeCheck !== null && !timeCheck.ok && timeCheck.issue === "OLDER_THAN_24H" && (
        <Note tone="danger">{t("backfill.older24")}</Note>
      )}
      {resolvedTime !== null && resolvedTime.ok && (
        <Muted>{`→ ${istClockTime(Date.parse(resolvedTime.iso))} IST`}</Muted>
      )}

      {tab === "entries" && (
        <View>
          <Text style={styles.label}>{t("backfill.vehicleClass")}</Text>
          {port.config.classes.map((candidate) => (
            <ToggleRow
              key={candidate}
              label={t(`classes.${candidate}`)}
              active={classId === candidate}
              onPress={() => {
                setClassId(candidate);
                setZoneId(null);
                setReviewed(false);
              }}
            />
          ))}
          {classId !== null && (
            <View>
              <Text style={styles.label}>{t("backfill.zone")}</Text>
              {port.config.zones
                .filter((zone) => zone.vehicle_class.includes(classId))
                .map((zone) => (
                  <ToggleRow
                    key={zone.id}
                    label={zone.id}
                    active={zoneId === zone.id}
                    onPress={() => setZoneId(zone.id)}
                  />
                ))}
            </View>
          )}
          <Field label={t("backfill.plateHint")} value={plate} onChangeText={setPlate} />
          <Field label={t("backfill.codeHint")} value={code} onChangeText={setCode} />
        </View>
      )}

      {tab === "exits" && (
        <View>
          <Text style={styles.label}>{t("backfill.exitMode")}</Text>
          {(["CASH", "UPI"] as const).map((candidate) => (
            <ToggleRow
              key={candidate}
              label={candidate === "CASH" ? t("payment.cash") : t("payment.upi")}
              active={exitMode === candidate}
              onPress={() => {
                setExitMode(candidate);
                setReviewed(false);
              }}
            />
          ))}
          <Field
            label={t("backfill.amount")}
            value={amountText}
            onChangeText={setAmountText}
            inputMode="decimal"
            placeholder={t("backfill.amountExample")}
          />
          {amountText.trim() !== "" && amount === null && (
            <Note tone="danger">{t("backfill.invalidAmount")}</Note>
          )}
          <Text style={styles.label}>{t("backfill.amountReason")}</Text>
          {OVERRIDE_REASON_CODES.map((candidate) => (
            <ToggleRow
              key={candidate}
              label={t(`override.reasonLabel.${candidate}`)}
              active={reasonCode === candidate}
              onPress={() => {
                setReasonCode(candidate);
                setReviewed(false);
              }}
            />
          ))}
          {exitCheck !== null &&
            !exitCheck.ok &&
            (() => {
              const issue = exitCheck.issue;
              return (
                <Note tone="danger">
                  {issue === "MODE_REQUIRED"
                    ? t("backfill.modeRequired")
                    : issue === "AMOUNT_REQUIRED"
                      ? t("backfill.amountRequired")
                      : issue === "AMOUNT_INVALID"
                        ? t("backfill.invalidAmount")
                        : t("backfill.reasonRequired")}
                </Note>
              );
            })()}
        </View>
      )}

      {duplicate !== null && duplicate.duplicateOf.length > 0 && (
        <Note tone="warn">
          {t("backfill.duplicate", {
            time: istClockTime(Date.parse(duplicate.duplicateOf[0]?.enteredAt ?? nowIso)),
          })}
        </Note>
      )}

      <BigButton title={t("common.confirm")} kind="secondary" onPress={() => reviewNext()} />

      {reviewed && (
        <View>
          {supervisorRequired || (timeCheck !== null && !timeCheck.ok) ? (
            <Note tone="warn">{t("backfill.draftReady")}</Note>
          ) : (
            <Note tone="ok">{t("backfill.draftValid")}</Note>
          )}
          <Note tone="warn">{t("backfill.writeBlockedBody")}</Note>
          <Muted>
            {t("backfill.writeBlockedTitle")}
            {tab === "exits" && amount !== null ? ` · ${formatPaise(amount)}` : ""}
          </Muted>
          <BigButton
            title={t("common.back")}
            kind="quiet"
            onPress={() => {
              addLogLine(`backfill draft reviewed (${tab}; nothing written by design)`, nowIso);
              reset();
            }}
          />
        </View>
      )}

      <Note tone="danger">{t("backfill.writeBlockedTitle")}</Note>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: 12, marginBottom: 2, color: P.muted, fontSize: 13 },
});
