import { useMemo, useReducer, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";

import { buildTokenReceipt } from "../../src/print/escpos";
import { deliverReceipt, initialPrintState, reducePrintState } from "../../src/print/printMachine";
import { fakePrinterTransport } from "../../src/print/printer";
import { qrPayloadFor } from "../../src/domain/token";
import { istClockTime } from "../../src/domain/istClock";
import { istDateString } from "@pmp/domain";
import { useI18n } from "../../src/ui/useSyncState";
import { usePortRequired } from "../../src/ui/port";
import { BigButton, KVRow, Muted, Note, Screen, ToggleRow } from "../../src/ui/ui";
import { TokenFullScreen } from "../../src/ui/TokenFullScreen";
import { addLogLine } from "../../src/lib/log";
import { DEV_CONTROLS_ENABLED } from "../../src/lib/buildMode";

/**
 * Printer settings (GATE-10 sequences 1-3): pairing status, receipt BYTES build and the print
 * state machine over a labeled DEV transport.
 *
 * Honesty notes:
 * - nothing is paired: the Bluetooth transport waits for the printer-model decision (OQ-31), so
 *   the pairing panel says exactly that and there is NO fake "connected to <printer>" row;
 * - test prints use fakePrinterTransport and the outcome shown is the transport's truth
 *   (OK/ERROR/TIMEOUT through deliverReceipt); a failed test print falls back to the
 *   TokenFullScreen, never to a claimed print;
 * - the receipt bytes are real ESC/POS (same bytes a Bluetooth transport would send).
 */

type Behavior = "succeed" | "throw" | "slow";

const OUTCOME_KEYS = {
  OK: "outcomeOk",
  TIMEOUT: "outcomeTimeout",
  ERROR: "outcomeError",
} as const;

export default function PrinterScreen() {
  const port = usePortRequired();
  const { t } = useI18n();
  const router = useRouter();

  const sessions = port.registry.list();
  const [sessionId, setSessionId] = useState<string | null>(sessions[0]?.sessionId ?? null);
  const [behavior, setBehavior] = useState<Behavior>("succeed");
  const [machine, dispatch] = useReducer(reducePrintState, initialPrintState);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);

  const selected =
    sessions.find((session) => session.sessionId === sessionId) ?? sessions[0] ?? null;
  const row =
    selected ??
    (DEV_CONTROLS_ENABLED
      ? {
          sessionId: "demo-session",
          shortCode: "P4RK1",
          vehicleClass: "Car",
          vehicleNo: null,
          enteredAt: new Date().toISOString(),
        }
      : null);

  const bytes = useMemo(() => {
    if (row === null) return null;
    const enteredMs = Date.parse(row.enteredAt);
    return buildTokenReceipt({
      facilityName: port.config.facilityName,
      shortCode: row.shortCode,
      qrPayload: qrPayloadFor(port.config.facilityId, row.shortCode, row.sessionId),
      enteredAtDisplay: `${istDateString(enteredMs)} ${istClockTime(enteredMs)}`,
      vehicleClass: row.vehicleClass,
    });
  }, [row, port.config]);

  const hexHead = useMemo(
    () =>
      bytes === null
        ? ""
        : Array.from(bytes.slice(0, 64))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join(" "),
    [bytes],
  );

  async function print() {
    if (!DEV_CONTROLS_ENABLED || bytes === null) return;
    setBusy(true);
    dispatch({ kind: "start" });
    try {
      const report = await deliverReceipt(
        fakePrinterTransport(behavior, behavior === "slow" ? { delayMs: 6500 } : {}),
        bytes,
      );
      // The transport-level retry lives inside deliverReceipt; the machine mirrors the FINAL
      // outcome so the screen shows the same truth the real driver would report.
      dispatch({ kind: "attemptDone", outcome: report.outcome });
      addLogLine(
        `test print ${report.outcome} (attempts ${report.attemptsUsed}, transport ${behavior})`,
        new Date().toISOString(),
      );
    } finally {
      setBusy(false);
    }
  }

  if (showToken && row !== null) {
    return (
      <TokenFullScreen
        token={{
          shortCode: row.shortCode,
          qrPayload: qrPayloadFor(port.config.facilityId, row.shortCode, row.sessionId),
          enteredAt: row.enteredAt,
          sessionId: row.sessionId,
        }}
        onDone={() => setShowToken(false)}
        doneLabel={t("common.back")}
      />
    );
  }

  return (
    <Screen title={t("printer.title")} onBack={() => router.back()}>
      <KVRow label={t("printer.pairingTitle")} value={t("printer.nothingPaired")} />
      <Note>{t("printer.realPrintNote")}</Note>

      {!DEV_CONTROLS_ENABLED && <Note>{t("printer.productionUnavailable")}</Note>}
      {DEV_CONTROLS_ENABLED && <Note tone="ok">{t("printer.testTitle")}</Note>}
      {sessions.length > 0 ? (
        <View>
          {sessions.slice(0, 4).map((session) => (
            <ToggleRow
              key={session.sessionId}
              label={`${session.shortCode} · ${session.vehicleClass}`}
              active={row?.sessionId === session.sessionId}
              onPress={() => setSessionId(session.sessionId)}
            />
          ))}
        </View>
      ) : row !== null ? (
        <Muted>{`${t("printer.demoToken")} · ${row.shortCode} · ${row.vehicleClass}`}</Muted>
      ) : (
        <Muted>{t("printer.noSession")}</Muted>
      )}

      {DEV_CONTROLS_ENABLED && bytes !== null && (
        <>
          <Muted>{`${t("printer.bytes")}: ${String(bytes.length)} B`}</Muted>
          <Muted>{hexHead}</Muted>
        </>
      )}

      {DEV_CONTROLS_ENABLED && (
        <>
          {(() => {
            const label =
              machine.stage === "OK"
                ? t("printer.stateOk")
                : machine.stage === "FAILED"
                  ? t("printer.stateFailed")
                  : machine.stage === "PRINTING"
                    ? t("printer.statePrinting")
                    : "";
            return machine.stage === "IDLE" ? null : (
              <Note
                tone={
                  machine.stage === "OK" ? "ok" : machine.stage === "FAILED" ? "warn" : undefined
                }
              >
                {`${label} · ${t("printer.attempts", { count: machine.attemptsUsed })}${machine.lastOutcome ? ` · ${t(`printer.${OUTCOME_KEYS[machine.lastOutcome]}`)}` : ""}`}
              </Note>
            );
          })()}

          {machine.stage === "FAILED" && (
            <BigButton
              title={t("entry.printFallback")}
              kind="danger"
              onPress={() => setShowToken(true)}
            />
          )}

          <View>
            {(["succeed", "throw", "slow"] as const).map((candidate) => (
              <ToggleRow
                key={candidate}
                label={
                  candidate === "succeed"
                    ? t("printer.behaviorSucceed")
                    : candidate === "throw"
                      ? t("printer.behaviorFail")
                      : t("printer.behaviorSlow")
                }
                active={behavior === candidate}
                onPress={() => setBehavior(candidate)}
              />
            ))}
          </View>

          <BigButton
            title={t("printer.testPrint")}
            onPress={() => void print()}
            disabled={busy || machine.stage === "PRINTING"}
          />
          {machine.stage !== "IDLE" && (
            <BigButton
              title={t("printer.reprint")}
              kind="secondary"
              onPress={() => dispatch({ kind: "manualReprint" })}
              disabled={machine.stage === "PRINTING"}
            />
          )}
        </>
      )}
    </Screen>
  );
}
