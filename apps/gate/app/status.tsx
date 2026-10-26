import { useState } from "react";
import { Share } from "react-native";
import { useRouter } from "expo-router";

import { findOpenShift } from "../src/domain/shiftTotals";
import { humanizeAgeMs } from "../src/domain/paise";
import { istClockTime } from "../src/domain/istClock";
import { istDateString } from "@pmp/domain";
import { buildDiagnosticsBlob } from "../src/lib/diag";
import { configIssues } from "../src/data/appConfig";
import { addLogLine } from "../src/lib/log";
import { useHealth, useI18n } from "../src/ui/useSyncState";
import { usePortRequired } from "../src/ui/port";
import { BigButton, KVRow, Muted, Note, Screen } from "../src/ui/ui";
import { translationParity } from "../src/i18n/config";
import { ACTIVE_SAFETY_LIMIT_MODE } from "../src/domain/zoneCount";

/**
 * Status screen (GATE-12 sequences 1-5): SYNC-06 queue metrics, device facts, config source and
 * the diagnostics share (rule: share the scrubbed built blob over the OS share sheet — the log
 * lines are already scrubbed in src/lib/log.ts; numbers of tokens are masked at capture time).
 *
 * Honesty notes:
 * - battery/storage read "Unknown": the modules are not approved for use (OQ-29), so the banner
 *   derivation treats them as unknown inputs and this screen says nothing more than that;
 * - "never synced" is a real state here (DEV_FAKE syncs nothing) and is never painted over;
 * - the config row says exactly where the settings came from (DEV SEED, not a synced snapshot);
 * - Hindi/English key parity is checked live from the two bundles (i18n/parity.ts).
 */

export default function StatusScreen() {
  const port = usePortRequired();
  const { t } = useI18n();
  const router = useRouter();
  const health = useHealth(port.client);
  const [shared, setShared] = useState(false);

  const events = port.readEvents();
  const openShift = port.deviceId === null ? null : findOpenShift(events, port.deviceId);
  const parity = translationParity();
  const issues = configIssues(port.config, new Date().toISOString());

  const lastSync = health?.lastSyncAt ?? null;
  const lastSyncText =
    lastSync === null
      ? t("common.never")
      : `${istDateString(Date.parse(lastSync))} ${istClockTime(Date.parse(lastSync))}`;

  async function share() {
    const blob = buildDiagnosticsBlob({
      appVersion: port.appVersion,
      schemaVersion: port.schemaVersion,
      deviceId: port.deviceId,
      facilityId: port.config.facilityId,
      configSource: t("status.configSourceDev"),
      currentShiftOpenedAt: openShift === null ? null : openShift.openAt,
      lastSyncAt: lastSync,
      queueDepth: health?.queueDepth ?? 0,
      oldestUnsyncedAgeMs: health?.oldestUnsyncedAgeMs ?? 0,
      online: health?.online ?? false,
      quarantinedCount: health?.quarantinedCount ?? 0,
      syncBlocked: health?.syncBlocked ?? false,
      generatedAt: new Date().toISOString(),
    });
    try {
      await Share.share({ message: blob });
      addLogLine("diagnostics shared", new Date().toISOString());
      setShared(true);
    } catch {
      addLogLine("diagnostics share cancelled/failed", new Date().toISOString());
    }
  }

  return (
    <Screen title={t("status.title")} onBack={() => router.back()}>
      <KVRow label={t("status.lastSync")} value={lastSyncText} />
      <KVRow label={t("status.queueDepth")} value={String(health?.queueDepth ?? 0)} />
      <KVRow
        label={t("status.oldestAge")}
        value={humanizeAgeMs(health?.oldestUnsyncedAgeMs ?? 0)}
      />
      <KVRow label={t("status.events")} value={String(events.length)} />
      <KVRow
        label={t("status.currentShift")}
        value={
          openShift === null
            ? "—"
            : `${istDateString(Date.parse(openShift.openAt))} ${istClockTime(Date.parse(openShift.openAt))}`
        }
      />
      <KVRow label={t("status.appVersion")} value={port.appVersion ?? t("common.unknown")} />
      <KVRow label={t("status.schemaVersion")} value={String(port.schemaVersion)} />
      <KVRow label={t("status.deviceId")} value={port.deviceId ?? t("common.unknown")} />
      <KVRow
        label={t("status.battery")}
        value={t("status.unknownPending", { question: "OQ-29" })}
      />
      <KVRow
        label={t("status.storage")}
        value={t("status.unknownPending", { question: "OQ-29" })}
      />
      <KVRow label={t("status.configSource")} value={t("status.configSourceDev")} />
      <KVRow
        label={t("status.safetyLimitMode")}
        value={t(`zoneCount.safetyLimitMode.${ACTIVE_SAFETY_LIMIT_MODE}`)}
      />
      <KVRow
        label={t("status.configIssues")}
        value={
          issues.length === 0
            ? t("status.noIssues")
            : issues.map((issue) => String(issue)).join(", ")
        }
      />
      <KVRow
        label={t("status.parity")}
        value={
          parity.ok
            ? "OK (en ⇄ hi)"
            : `MISSING: en→hi ${parity.missingInHi.length}, hi→en ${parity.missingInEn.length}`
        }
      />
      {port.deviceIdProblem !== null && (
        <Note tone="danger">{`${t("errors.writeRejected", { detail: port.deviceIdProblem })}`}</Note>
      )}
      {shared && <Note tone="ok">{t("status.diagnosticsCopied")}</Note>}
      <BigButton title={t("status.diagnostics")} kind="secondary" onPress={() => void share()} />
      <Muted>{t("banner.devMode")}</Muted>
    </Screen>
  );
}
