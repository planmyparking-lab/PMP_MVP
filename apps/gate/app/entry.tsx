import { useEffect, useReducer, useState, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  TOKEN_SCREEN_IDLE_MS,
  entryGate,
  initialEntryContext,
  reduceEntry,
  tokenViewFor,
  type EntryContext,
  type EntryTap,
} from "../src/domain/entryFlow";
import { findOpenShift } from "../src/domain/shiftTotals";
import { generateToken } from "../src/domain/token";
import { suggestZone } from "../src/domain/suggestZone";
import { WriteRuleError, writeEvent } from "../src/data/writeEvent";
import { istClockTime } from "../src/domain/istClock";
import { istDateString } from "@pmp/domain";
import { useOccupancy, useI18n } from "../src/ui/useSyncState";
import { usePortRequired } from "../src/ui/port";
import { TokenFullScreen } from "../src/ui/TokenFullScreen";
import { BigButton, Field, Note, P, Screen, ToggleRow } from "../src/ui/ui";
import { addLogLine } from "../src/lib/log";
import { deliverReceipt } from "../src/print/printMachine";
import { fakePrinterTransport } from "../src/print/printer";
import { buildTokenReceipt } from "../src/print/escpos";
import { DEV_CONTROLS_ENABLED } from "../src/lib/buildMode";
import { entryTimingLine } from "../src/lib/diag";
import { elapsedFlowMs, startFlowTimer } from "../src/domain/flowTimer";

/**
 * Entry screen (GATE-01): class → zone → (plate) → confirm → saved token. The flow logic IS the
 * tested machine (src/domain/entryFlow.ts); this file only renders and performs the WRITE effect
 * (generateToken → writeEvent(ENTRY) → registry rows → dev occupancy adaptation).
 *
 * Failure surfaces, each per the sheet and never swallowed:
 * - write errors → paperFallback phase (GATE-11 route — T-GATE-01-N4);
 * - duplicate plate → blocking double-confirm (T-GATE-01-N2);
 * - shift not open → route to /shift/open (GATE-06 failure 9);
 * - print attempts fail closed in dev (no transport until OQ-31) → TokenFullScreen stays, per
 *   the sheet's own fallback rule (GATE-10 rule 9); the note explains, nothing claims a print.
 */

function zoneCounts(
  snapshot: { zones: Record<string, { count: number }> } | null,
): Record<string, number> {
  if (snapshot === null) return {};
  const out: Record<string, number> = {};
  for (const [zoneId, zone] of Object.entries(snapshot.zones)) out[zoneId] = zone.count;
  return out;
}

function describeError(error: unknown): string {
  if (error instanceof WriteRuleError) return `${error.reason}: ${error.message}`;
  return error instanceof Error ? error.message : "unknown error";
}

export default function EntryScreen() {
  const port = usePortRequired();
  const { t } = useI18n();
  const router = useRouter();
  const occupancy = useOccupancy(port.client, port.config.facilityId);
  // GATE-01 item 2: the plate is optional — an "Add number" affordance offers it, never requires
  // it. The field stays collapsed until the guard asks (pass-holder mandatory plate is not yet
  // reachable: PASS mode is unsupported by the current IC-01 contract).
  const [showPlate, setShowPlate] = useState(false);
  const flowStartedAt = useRef<number | null>(null);

  // The pure machine is config-parametric; the wrapper binds this facility's stable config and
  // reads the LIVE open-session list + clock at reduce time (dispatch stays tap-only).
  const [ctx, dispatch] = useReducer(
    (state: EntryContext, tap: EntryTap) =>
      reduceEntry(state, tap, {
        classes: port.config.classes,
        zones: port.config.zones,
        openSessions: port.registry.list(),
        nowMs: () => Date.now(),
      }),
    undefined,
    initialEntryContext,
  );

  // Fresh view data per render (confirm-time decisions must see the current registry).
  const configRef = useRef({
    classes: port.config.classes,
    zones: port.config.zones,
    openSessions: port.registry.list(),
    nowMs: () => Date.now(),
  });
  configRef.current = { ...configRef.current, openSessions: port.registry.list() };

  const events = port.readEvents();
  const openShift = port.deviceId === null ? null : findOpenShift(events, port.deviceId);
  const gate = port.deviceId === null ? null : entryGate({ configSynced: true, openShift });

  useEffect(() => {
    if (ctx.phase !== "saving") return;
    let cancelled = false;
    void (async () => {
      const classId = ctx.classId;
      const zoneId = ctx.zoneId;
      try {
        if (classId === undefined || zoneId === undefined) throw new Error("class/zone missing");
        const enteredAt = ctx.startedAtIso ?? new Date().toISOString();
        const openCodes = new Set(port.registry.list().map((row) => row.shortCode));
        const token = generateToken(openCodes, port.config.facilityId);
        const saveStartedAt = performance.now();
        await writeEvent(port.writeDeps, { type: "ENTRY", session_id: token.sessionId });
        const savedAt = performance.now();
        port.registry.record({
          sessionId: token.sessionId,
          shortCode: token.shortCode,
          vehicleClass: classId,
          vehicleNo: ctx.vehicleNo ?? null,
          enteredAt,
          zoneId,
        });
        // dev-mode occupancy adaptation (FakeSync-only; a real client's snapshot replaces this)
        port.devClient.attachSessionZone(token.sessionId, zoneId);
        addLogLine(
          entryTimingLine(
            elapsedFlowMs(flowStartedAt.current, savedAt),
            savedAt - saveStartedAt,
            token.regenerations,
            ctx.taps,
          ),
          enteredAt,
        );
        const view = tokenViewFor(token, enteredAt, port.config.facilityId);
        if (cancelled) return;
        dispatch({ kind: "writeOk", token: view });
        port.bump();
        // GATE-10: printing happens AFTER the save; the dev transport fails closed (no BT
        // until OQ-31), so the token screen remains with an honest note — never a claimed print.
        const receipt = buildTokenReceipt({
          facilityName: port.config.facilityName,
          shortCode: view.shortCode,
          qrPayload: view.qrPayload,
          enteredAtDisplay: `${istDateString(Date.parse(enteredAt))} ${istClockTime(Date.parse(enteredAt))}`,
          vehicleClass: classId,
        });
        if (DEV_CONTROLS_ENABLED) {
          const report = await deliverReceipt(fakePrinterTransport("throw"), receipt);
          addLogLine(
            `test print outcome=${report.outcome} attempts=${report.attemptsUsed}`,
            new Date().toISOString(),
          );
        }
      } catch (error) {
        addLogLine(`entry write failed: ${describeError(error)}`, new Date().toISOString());
        if (cancelled) return;
        dispatch({ kind: "writeFailed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx.phase]);

  // token-screen auto-return (sequence 4.6 shouldAutoReturn)
  useEffect(() => {
    if (ctx.phase !== "tokenShown") return;
    const id = setTimeout(() => dispatch({ kind: "reset" }), TOKEN_SCREEN_IDLE_MS);
    return () => {
      clearTimeout(id);
    };
  }, [ctx.phase]);

  // the plate affordance collapses again for the NEXT vehicle (it is optional, not sticky)
  useEffect(() => {
    if (ctx.phase === "idle") {
      setShowPlate(false);
      flowStartedAt.current = null;
    }
  }, [ctx.phase]);

  if (gate === null) {
    return (
      <Screen title={t("entry.title")} onBack={() => router.back()}>
        <Note>{`${t("common.loading")}${port.deviceIdProblem === null ? "" : ` · ${port.deviceIdProblem}`}`}</Note>
      </Screen>
    );
  }

  if (!gate.ok) {
    return (
      <Screen title={t("entry.title")} onBack={() => router.back()}>
        <Note tone="danger">
          {gate.gate === "CONFIG_NOT_SYNCED" ? t("entry.configNotSynced") : t("entry.shiftNotOpen")}
        </Note>
        <BigButton title={t("entry.openShift")} onPress={() => router.push("/shift/open")} />
      </Screen>
    );
  }

  if (ctx.phase === "tokenShown" && ctx.token !== undefined) {
    return (
      <TokenFullScreen
        token={ctx.token}
        notice={DEV_CONTROLS_ENABLED ? t("entry.printFallback") : undefined}
        onDone={() => dispatch({ kind: "reset" })}
      />
    );
  }

  if (ctx.phase === "paperFallback") {
    return (
      <Screen title={t("entry.title")} onBack={() => router.back()}>
        <Note tone="danger">{t("errors.paperFallbackTitle")}</Note>
        <Note>{t("errors.paperFallbackBody")}</Note>
        <BigButton title={t("nav.backfill")} onPress={() => router.push("/backfill")} />
        <BigButton title={t("entry.newVehicle")} onPress={() => dispatch({ kind: "reset" })} />
      </Screen>
    );
  }

  const suggested =
    ctx.classId !== undefined
      ? suggestZone(ctx.classId, zoneCounts(occupancy), port.config.zones)
      : null;

  return (
    <Screen title={t("entry.title")} onBack={() => router.back()}>
      <Note>{t("common.devSeed")}</Note>

      {(ctx.phase === "idle" || ctx.phase === "plateInvalid") && (
        <View>
          <Text style={styles.label}>{t("entry.pickClass")}</Text>
          {port.config.classes.map((classId) => (
            <ToggleRow
              key={classId}
              label={t(`classes.${classId}`)}
              active={ctx.classId === classId}
              onPress={() => {
                flowStartedAt.current = startFlowTimer(flowStartedAt.current, performance.now());
                dispatch({ kind: "tappedClass", classId });
              }}
            />
          ))}
        </View>
      )}

      {(ctx.phase === "classChosen" || ctx.phase === "zoneChosen") && (
        <View>
          <Text style={styles.label}>{t("entry.pickZone")}</Text>
          {port.config.zones
            .filter((zone) => ctx.classId !== undefined && zone.vehicle_class.includes(ctx.classId))
            .map((zone) => (
              <ToggleRow
                key={zone.id}
                label={`${zone.id} · ${t("zoneCount.capacity", { n: zone.capacity })}${
                  suggested !== null && suggested.zoneId === zone.id && suggested.full
                    ? ` · ${t("entry.zoneFull")}`
                    : ""
                }`}
                active={ctx.zoneId === zone.id}
                onPress={() => dispatch({ kind: "tappedZone", zoneId: zone.id })}
              />
            ))}
          {showPlate ? (
            <>
              <Field
                label={t("entry.plateHint")}
                value={ctx.vehicleNo ?? ""}
                onChangeText={(raw) =>
                  dispatch({ kind: "typedPlate", raw: raw.length === 0 ? null : raw })
                }
                placeholder={t("entry.plateExample")}
              />
              <BigButton
                title={t("common.ok")}
                kind="secondary"
                onPress={() => setShowPlate(false)}
              />
            </>
          ) : (
            <BigButton
              title={t("entry.addNumber")}
              kind="secondary"
              onPress={() => {
                dispatch({ kind: "tappedAddNumber" });
                setShowPlate(true);
              }}
            />
          )}
        </View>
      )}

      {ctx.phase === "duplicateBlocked" && <Note tone="danger">{t("entry.duplicateWarning")}</Note>}
      {ctx.phase === "plateInvalid" && <Note tone="danger">{t("entry.plateInvalid")}</Note>}
      {ctx.phase === "saving" && <Note>{t("entry.saving")}</Note>}

      {ctx.phase === "zoneChosen" && (
        <BigButton title={t("entry.confirm")} onPress={() => dispatch({ kind: "tappedConfirm" })} />
      )}
      {ctx.phase === "duplicateBlocked" && (
        <BigButton
          title={t("entry.duplicateOverride")}
          onPress={() => dispatch({ kind: "tappedConfirmWithOverride" })}
          kind="danger"
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: 12, marginBottom: 2, color: P.muted, fontSize: 13 },
});
