import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { ReasonCode } from "@pmp/contracts";

import { Scanner } from "../src/ui/Scanner";
import {
  WriteRuleError,
  waiveExitBundle,
  writeExit,
  type ExitBundle,
} from "../src/data/writeEvent";
import {
  doubleExitCheck,
  exitBundleFor,
  exitGate,
  lookupExitSession,
  lostTokenSearch,
  resolveExitInput,
  resolveFare,
  type FareResolution,
} from "../src/domain/exitFlow";
import { findOpenShift } from "../src/domain/shiftTotals";
import { cashChangePaise } from "../src/domain/paymentRules";
import { lookupPass } from "../src/domain/pass";
import {
  OVERRIDE_REASON_CODES,
  isWithinCorrectionWindow,
  validateOverrideInput,
} from "../src/domain/override";
import { istClockTime } from "../src/domain/istClock";
import { formatPaise, humanizeAgeMs, parseRupeeInput } from "../src/domain/paise";
import { useI18n } from "../src/ui/useSyncState";
import { usePortRequired } from "../src/ui/port";
import { BigButton, Field, KVRow, Note, P, Screen, ToggleRow } from "../src/ui/ui";
import { addLogLine } from "../src/lib/log";
import { exitTimingLine } from "../src/lib/diag";
import { elapsedFlowMs, resetFlowTimer, startFlowTimer } from "../src/domain/flowTimer";

/**
 * Exit screen (GATE-02 sequences 4.2-4.7 + GATE-04 payment + GATE-05 pass states):
 * resolve input (scan / typed code / lost-token search by plate or class-window) → local
 * double-exit guard → fare (entry-tariff rule) → payment → writeExit in ONE transaction
 * (EXIT + PAYMENT [+ PAYMENT(WAIVED)/OVERRIDE on waiver]) → close the registry row.
 *
 * Contract-honest states here (never papered over):
 * - all four payment modes are IC-01-payable (SYNC-01); a PASS exit needs the session's plate and
 *   a VALID pass row (dues settlement at the gate itself is an open partner decision, OQ-41) —
 *   without them the screen shows the pass lookup screen and the explanation note;
 * - the tariff id rides the EXIT payload only when it is an IC-01 uuid; Tariff.id is a uuid for
 *   every fixture too since PR #6's review (traceable to the tariffs row and EXIT.tariff_id), so
 *   this is now a defensive guard rather than a dev/fixture-only gap. `tariff_version` is not
 *   emitted until the contract grows a version field;
 * - a waiver is a WAIVED-exit: EXIT + PAYMENT(mode WAIVED, 0) + reason OVERRIDE in one
 *   transaction per the sheet mapping;
 * - NO_TARIFF offers waiver/call-manager (T-GATE-02-N4), never an invisible zero fare.
 */

type Mode = "scan" | "code" | "lost";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The EXIT payload's tariff_id must be an IC-01 uuid. A defensive guard, not a normal path:
 * Tariff.id is schema-enforced as a uuid, so this only omits the field if that invariant is
 * ever violated, rather than producing an invalid event. */
function tariffAuditId(tariffId: string): string | undefined {
  return UUID_PATTERN.test(tariffId) ? tariffId : undefined;
}

type Pick =
  | { kind: "idle" }
  | { kind: "invalid" }
  | { kind: "wrongFacility" }
  | { kind: "none" }
  | { kind: "many"; ids: string[] }
  | { kind: "one"; sessionId: string };

function describe(error: unknown): string {
  if (error instanceof WriteRuleError) return `${error.reason}: ${error.message}`;
  return error instanceof Error ? error.message : "unknown error";
}

export default function ExitScreen() {
  const port = usePortRequired();
  const { t } = useI18n();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("scan");
  const [typed, setTyped] = useState("");
  const [lostPlate, setLostPlate] = useState("");
  const [lostClass, setLostClass] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick>({ kind: "idle" });
  // How this session was found — recorded on the EXIT payload as exit_method (GATE-02 rule 12).
  const [foundVia, setFoundVia] = useState<ExitBundle["exitMethod"] | null>(null);
  const [waiveReason, setWaiveReason] = useState<string | null>(null);
  const [waiveNote, setWaiveNote] = useState("");
  const [showWaive, setShowWaive] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSession, setSavedSession] = useState<string | null>(null);
  // Cash change calculator (GATE-04 sequence 4.4): the panel state is SCREEN-only; the tendered
  // amount is display-only and never reaches the PAYMENT write (paymentRules.cashChangePaise).
  const [cashPanel, setCashPanel] = useState(false);
  const [tendered, setTendered] = useState("");
  const flowStartedAt = useRef<number | null>(null);

  useEffect(() => {
    flowStartedAt.current = resetFlowTimer(performance.now());
  }, []);

  function startFlowIfNeeded() {
    flowStartedAt.current = startFlowTimer(flowStartedAt.current, performance.now());
  }

  const events = port.readEvents();
  const openSessions = port.registry.list();
  const nowIso = new Date().toISOString();
  const openShift = port.deviceId === null ? null : findOpenShift(events, port.deviceId);

  function switchMode(next: Mode) {
    setMode(next);
    resetFlow();
  }

  function resetFlow() {
    flowStartedAt.current = resetFlowTimer(performance.now());
    setPick({ kind: "idle" });
    setFoundVia(null);
    setTyped("");
    setLostPlate("");
    setLostClass(null);
    setWaiveReason(null);
    setWaiveNote("");
    setShowWaive(false);
    setSaveError(null);
    setSavedSession(null);
    setCashPanel(false);
    setTendered("");
  }

  function resolveInput(
    input: { kind: "scan"; payload: string } | { kind: "code"; typed: string },
  ) {
    startFlowIfNeeded();
    const resolved = resolveExitInput(input, port.config.facilityId);
    const outcome = lookupExitSession(resolved, openSessions);
    setSaveError(null);
    if (resolved.kind === "INVALID") return setPick({ kind: "invalid" });
    if (resolved.kind === "WRONG_FACILITY") return setPick({ kind: "wrongFacility" });
    setFoundVia(input.kind === "scan" ? "SCAN" : "CODE");
    if (outcome.kind === "none") return setPick({ kind: "none" });
    if (outcome.kind === "many") {
      return setPick({ kind: "many", ids: outcome.sessions.map((s) => s.sessionId) });
    }
    return setPick({ kind: "one", sessionId: outcome.session.sessionId });
  }

  function resolveLost(by: "plate" | "class") {
    startFlowIfNeeded();
    if (by === "plate") {
      const outcome = lostTokenSearch({ kind: "plate", plate: lostPlate }, openSessions);
      return applyOutcome(outcome);
    }
    if (lostClass === null) return;
    return applyOutcome(
      lostTokenSearch({ kind: "classWindow", vehicleClass: lostClass, nowIso }, openSessions),
    );
  }

  function applyOutcome(outcome: ReturnType<typeof lostTokenSearch>) {
    setSaveError(null);
    setFoundVia("LOOKUP");
    if (outcome.kind === "none") return setPick({ kind: "none" });
    if (outcome.kind === "many") {
      return setPick({ kind: "many", ids: outcome.sessions.map((s) => s.sessionId) });
    }
    return setPick({ kind: "one", sessionId: outcome.session.sessionId });
  }

  const session =
    pick.kind === "one" ? (openSessions.find((s) => s.sessionId === pick.sessionId) ?? null) : null;
  const exited = session !== null ? doubleExitCheck(events, session.sessionId) : null;
  const fare: FareResolution | null =
    session !== null && exited !== null && exited.ok
      ? resolveFare(session, nowIso, port.config.tariffs)
      : null;
  // GATE-05 exit path: PASS payment rides a VALID pass row matched by the session's plate
  // (lookupPass precedence: DUES/EXPIRED never open the gate silently — states stay on /pass).
  const passForExit =
    session !== null && session.vehicleNo !== null && fare !== null && fare.ok
      ? lookupPass(session.vehicleNo ?? "", port.config.passes, nowIso)
      : null;

  async function commitPay(button: "CASH" | "UPI" | "PASS") {
    if (session === null || fare === null || !fare.ok) return;
    startFlowIfNeeded();
    setSaveError(null);
    try {
      const method = foundVia ?? "LOOKUP";
      const bundle =
        button === "PASS"
          ? {
              sessionId: session.sessionId,
              farePaise: fare.farePaise,
              exitMethod: method,
              tariffId: tariffAuditId(fare.tariffId),
              payment: { mode: "PASS" as const, amountPaise: 0 },
            }
          : exitBundleFor(session, fare.farePaise, {
              button,
              method,
              tariffId: tariffAuditId(fare.tariffId),
            });
      const saveStartedAt = performance.now();
      await writeExit(port.writeDeps, bundle);
      const savedAt = performance.now();
      port.registry.close(session.sessionId);
      port.bump();
      addLogLine(
        exitTimingLine(
          elapsedFlowMs(flowStartedAt.current, savedAt),
          savedAt - saveStartedAt,
          button,
        ),
        new Date().toISOString(),
      );
      setSavedSession(session.sessionId);
    } catch (error) {
      setSaveError(describe(error));
      addLogLine(`exit write failed: ${describe(error)}`, new Date().toISOString());
    }
  }

  async function commitWaive() {
    if (session === null) return;
    startFlowIfNeeded();
    const rule = validateOverrideInput({ reasonCode: waiveReason ?? "", note: waiveNote });
    if (!rule.ok) {
      // the message must match the actual failure: a missing reason code is NOT a note-length
      // problem (T-GATE-04-U3 "Waive requires reason"; exit.waiveNeedsReason)
      setSaveError(
        rule.issue === "UNKNOWN_REASON_CODE"
          ? t("exit.waiveNeedsReason")
          : t("override.noteMissing"),
      );
      return;
    }
    const entryEvent = events.find((e) => e.type === "ENTRY" && e.session_id === session.sessionId);
    if (entryEvent === undefined) {
      // the OVERRIDE schema requires target_event_id; without the local ENTRY event id this
      // write is impossible (never silently skipped — surfaced, OQ-37 read-API note)
      setSaveError(t("errors.writeRejected", { detail: "no local ENTRY event id" }));
      return;
    }
    setSaveError(null);
    try {
      const bundle = waiveExitBundle({
        sessionId: session.sessionId,
        entryEventId: entryEvent.id,
        // validateOverrideInput above proved this is one of the fixed reason codes
        reasonCode: waiveReason as ReasonCode,
        note: waiveNote,
        exitMethod: foundVia ?? "LOOKUP",
      });
      const saveStartedAt = performance.now();
      await writeExit(port.writeDeps, bundle);
      const savedAt = performance.now();
      port.registry.close(session.sessionId);
      port.bump();
      addLogLine(
        exitTimingLine(
          elapsedFlowMs(flowStartedAt.current, savedAt),
          savedAt - saveStartedAt,
          "WAIVED",
        ),
        new Date().toISOString(),
      );
      setSavedSession(session.sessionId);
    } catch (error) {
      setSaveError(describe(error));
      addLogLine(`waived exit write failed: ${describe(error)}`, new Date().toISOString());
    }
  }

  if (savedSession !== null) {
    return (
      <Screen title={t("exit.title")} onBack={() => router.back()}>
        <Note tone="ok">{t("exit.exitSaved")}</Note>
        <BigButton title={t("nav.exit")} onPress={resetFlow} />
      </Screen>
    );
  }

  // GATE-06 failure 9: no open shift routes to the open-shift screen — same gate shape as the
  // entry screen (entryFlow.entryGate), fee-free of any write: closing a session outside a shift
  // window would lose its reconciliation row.
  const gate = port.deviceId === null ? null : exitGate({ openShift });
  if (gate === null) {
    return (
      <Screen title={t("exit.title")} onBack={() => router.back()}>
        <Note>{t("common.loading")}</Note>
      </Screen>
    );
  }
  if (!gate.ok) {
    return (
      <Screen title={t("exit.title")} onBack={() => router.back()}>
        <Note tone="danger">{t("exit.noOpenShift")}</Note>
        <BigButton title={t("shift.openTitle")} onPress={() => router.push("/shift/open")} />
      </Screen>
    );
  }

  return (
    <Screen title={t("exit.title")} onBack={() => router.back()}>
      <View style={styles.modes}>
        <BigButton
          title={t("exit.scan")}
          kind={mode === "scan" ? "primary" : "secondary"}
          onPress={() => switchMode("scan")}
        />
        <BigButton
          title={t("exit.typeCode")}
          kind={mode === "code" ? "primary" : "secondary"}
          onPress={() => switchMode("code")}
        />
        <BigButton
          title={t("exit.lostToken")}
          kind={mode === "lost" ? "primary" : "secondary"}
          onPress={() => switchMode("lost")}
        />
      </View>

      {mode === "scan" && pick.kind === "idle" && (
        <View style={styles.scannerBox}>
          <Scanner
            hint={t("exit.scan")}
            onScanned={(payload) => resolveInput({ kind: "scan", payload })}
            onUnavailable={() => switchMode("code")}
          />
          <BigButton
            title={t("exit.typeCode")}
            kind="secondary"
            onPress={() => switchMode("code")}
          />
        </View>
      )}

      {mode === "code" && pick.kind === "idle" && (
        <View>
          <Field
            label={t("exit.typeCode")}
            value={typed}
            onChangeText={setTyped}
            placeholder={t("exit.codeExample")}
          />
          <BigButton
            title={t("common.confirm")}
            onPress={() => resolveInput({ kind: "code", typed })}
          />
        </View>
      )}

      {mode === "lost" && pick.kind === "idle" && (
        <View>
          <Note>{t("exit.lostToken")}</Note>
          <Field
            label={t("exit.searchByPlate")}
            value={lostPlate}
            onChangeText={setLostPlate}
            placeholder={t("exit.plateExample")}
          />
          <BigButton
            title={t("exit.searchByPlate")}
            kind="secondary"
            onPress={() => resolveLost("plate")}
          />
          <Text style={styles.label}>{t("exit.searchByClass")}</Text>
          {port.config.classes.map((classId) => (
            <ToggleRow
              key={classId}
              label={t(`classes.${classId}`)}
              active={lostClass === classId}
              onPress={() => setLostClass(classId)}
            />
          ))}
          <BigButton
            title={t("exit.searchByClass")}
            kind="secondary"
            onPress={() => resolveLost("class")}
          />
        </View>
      )}

      {pick.kind === "invalid" && <Note tone="danger">{t("exit.notFound")}</Note>}
      {pick.kind === "wrongFacility" && <Note tone="danger">{t("exit.wrongFacility")}</Note>}
      {pick.kind === "none" && (
        <View>
          <Note tone="danger">{t("exit.notFound")}</Note>
          <BigButton
            title={t("exit.lostToken")}
            kind="secondary"
            onPress={() => switchMode("lost")}
          />
        </View>
      )}

      {pick.kind === "many" && (
        <View>
          <Note>{t("exit.severalMatches")}</Note>
          {pick.ids.map((id) => {
            const record = openSessions.find((s) => s.sessionId === id);
            if (record === undefined) return null;
            return (
              <ToggleRow
                key={id}
                label={`${record.shortCode} · ${t(`classes.${record.vehicleClass}`)} · ${istClockTime(Date.parse(record.enteredAt))}`}
                active={false}
                onPress={() => setPick({ kind: "one", sessionId: id })}
              />
            );
          })}
        </View>
      )}

      {session !== null && exited !== null && (
        <View style={styles.sessionCard}>
          <Text style={styles.sessionTitle}>
            {`${session.shortCode} · ${t(`classes.${session.vehicleClass}`)}`}
          </Text>
          <Text
            style={styles.kvText}
          >{`${t("exit.enteredAt")}: ${istClockTime(Date.parse(session.enteredAt))}`}</Text>
          <Text style={styles.kvText}>
            {`${t("exit.duration")}: ${humanizeAgeMs(Date.parse(nowIso) - Date.parse(session.enteredAt))}`}
          </Text>
          {session.vehicleNo != null && (
            <Text style={styles.kvText}>{`${t("exit.vehicleNo")}: ${session.vehicleNo}`}</Text>
          )}
          {session.vehicleNo === null && (
            <Text style={styles.kvText}>{`${t("exit.vehicleNo")}: ${t("common.unknown")}`}</Text>
          )}

          {!exited.ok && (
            <Note tone="danger">
              {t("exit.alreadyExited", { time: istClockTime(Date.parse(exited.exitedAtIso)) })}
            </Note>
          )}

          {exited.ok && fare !== null && fare.ok && (
            <View>
              {fare.skewHint && <Note>{t("exit.clockSkew")}</Note>}
              <Text
                style={styles.fare}
              >{`${t("exit.amountDue")}: ${formatPaise(fare.farePaise)}`}</Text>
              <Text style={styles.label}>{t("exit.choosePayment")}</Text>
              <BigButton
                title={`${t("payment.cash")} · ${formatPaise(fare.farePaise)}`}
                onPress={() => {
                  setCashPanel(true);
                  setSaveError(null);
                }}
              />
              <BigButton
                title={`${t("payment.upi")} · ${formatPaise(fare.farePaise)}`}
                onPress={() => void commitPay("UPI")}
                kind="secondary"
              />
              {/* T-GATE-04-N1: the operator QR image lives in facility config (Console, pending);
                  until an image field arrives the always-correct text fallback shows. */}
              <Note>{t("payment.upiHint")}</Note>
              <Note>{t("payment.attestedLabel")}</Note>
              {cashPanel && (
                <View>
                  <KVRow label={t("payment.cashDue")} value={formatPaise(fare.farePaise)} />
                  <Field
                    label={t("payment.tendered")}
                    value={tendered}
                    onChangeText={setTendered}
                    inputMode="decimal"
                    placeholder={t("exit.amountExample")}
                  />
                  {(() => {
                    const changePaise = cashChangePaise(parseRupeeInput(tendered), fare.farePaise);
                    return changePaise !== null ? (
                      <KVRow label={t("payment.changeDue")} value={formatPaise(changePaise)} />
                    ) : null;
                  })()}
                  <BigButton title={t("exit.confirmExit")} onPress={() => void commitPay("CASH")} />
                  <BigButton
                    title={t("common.cancel")}
                    kind="secondary"
                    onPress={() => {
                      setCashPanel(false);
                      setTendered("");
                      setSaveError(null);
                    }}
                  />
                </View>
              )}
              <Note>{t("payment.attestedLabel")}</Note>
              {passForExit?.state === "VALID" ? (
                <BigButton
                  title={`${t("payment.pass")} · ${t("exit.passValidNote")}`}
                  onPress={() => void commitPay("PASS")}
                />
              ) : (
                <Note>{t("exit.passPending")}</Note>
              )}
              <BigButton
                title={`→ ${t("nav.pass")}`}
                kind="secondary"
                onPress={() => router.push("/pass")}
              />
              <Note>{t("exit.passLookupHint")}</Note>
              <BigButton
                title={t("payment.waive")}
                kind="secondary"
                onPress={() => setShowWaive(true)}
              />
              <WaivePanel
                visible={showWaive}
                reason={waiveReason}
                note={waiveNote}
                onReason={setWaiveReason}
                onNote={setWaiveNote}
                t={t}
                withinCorrectionWindow={isWithinCorrectionWindow(session.enteredAt, nowIso)}
                onCommit={() => void commitWaive()}
              />
            </View>
          )}

          {exited.ok && fare !== null && !fare.ok && fare.reason === "NO_TARIFF" && (
            <View>
              <Note tone="danger">{t("exit.noTariff")}</Note>
              <Note tone="warn">{t("exit.callManager")}</Note>
              <BigButton
                title={t("payment.waive")}
                kind="danger"
                onPress={() => setShowWaive(true)}
              />
              <WaivePanel
                visible={showWaive}
                reason={waiveReason}
                note={waiveNote}
                onReason={setWaiveReason}
                onNote={setWaiveNote}
                t={t}
                withinCorrectionWindow={isWithinCorrectionWindow(session.enteredAt, nowIso)}
                onCommit={() => void commitWaive()}
              />
            </View>
          )}
        </View>
      )}

      {saveError !== null && (
        <Note tone="danger">{t("errors.writeRejected", { detail: saveError })}</Note>
      )}
    </Screen>
  );
}

function WaivePanel(props: {
  visible: boolean;
  reason: string | null;
  note: string;
  onReason: (code: string) => void;
  onNote: (note: string) => void;
  withinCorrectionWindow: boolean;
  onCommit: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (!props.visible) return null;
  return (
    <View>
      <Text style={styles.label}>{props.t("payment.waiveReason")}</Text>
      {OVERRIDE_REASON_CODES.map((code) => (
        <ToggleRow
          key={code}
          label={props.t(`override.reasonLabel.${code}`)}
          active={props.reason === code}
          onPress={() => props.onReason(code)}
        />
      ))}
      <Field
        label={props.t("override.note")}
        value={props.note}
        onChangeText={props.onNote}
        multiline
        maxLength={200}
      />
      {props.withinCorrectionWindow && <Note>{props.t("override.changeClassWindow")}</Note>}
      <BigButton title={props.t("exit.doOverride")} kind="danger" onPress={props.onCommit} />
    </View>
  );
}

const styles = StyleSheet.create({
  modes: { flexDirection: "row", gap: 8 },
  sessionCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: P.card,
    borderWidth: 1,
    borderColor: P.border,
  },
  sessionTitle: { fontSize: 20, fontWeight: "700", color: P.text, marginBottom: 4 },
  kvText: { color: P.text, fontSize: 15, marginTop: 2 },
  fare: { fontSize: 24, fontWeight: "800", color: P.ok, marginTop: 6 },
  label: { marginTop: 12, marginBottom: 2, color: P.muted, fontSize: 13 },
  scannerBox: { minHeight: 260, marginTop: 8, gap: 8 },
});
