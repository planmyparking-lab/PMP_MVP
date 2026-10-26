import { useState } from "react";
import { Text, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";

import { WriteRuleError, writeOverride } from "../src/data/writeEvent";
import {
  OVERRIDE_REASON_CODES,
  isWithinCorrectionWindow,
  validateOverrideInput,
} from "../src/domain/override";
import { normalizeShortCode } from "../src/domain/token";
import { useI18n } from "../src/ui/useSyncState";
import { usePortRequired, type StaffSession } from "../src/ui/port";
import { BigButton, Field, KVRow, Muted, Note, Screen, ToggleRow } from "../src/ui/ui";
import { addLogLine } from "../src/lib/log";

/**
 * Override screen (GATE-07 sequences 3-4, T-GATE-07-U1/I1): reason (fixed codes) + optional
 * note; WRONG_CLASS corrections write `change.vehicle_class` and are bounded by the 2-minute
 * window for a guard, open-ended for a supervisor (role comes from the staff session).
 *
 * Honesty notes:
 * - the write requires target_event_id (schema), so the ENTRY event id of the chosen session is
 *   looked up in the local events; without it the write is refused with the explanation (never
 *   skipped silently);
 * - notes are recorded as text and rendered as Text nodes only (never HTML — rule) and scrubbed
 *   out of logs at push time (src/lib/log.ts);
 * - standalone use (no sessionId param) offers the session picker from the local registry.
 */

export default function OverrideScreen() {
  const port = usePortRequired();
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();

  const events = port.readEvents();
  const openSessions = port.registry.list();

  const [sessionId, setSessionId] = useState<string | null>(
    typeof params.sessionId === "string" && params.sessionId.length > 0 ? params.sessionId : null,
  );
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [correctedClass, setCorrectedClass] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const session =
    sessionId === null ? null : (openSessions.find((s) => s.sessionId === sessionId) ?? null);
  const nowIso = new Date().toISOString();
  const sessionRole: StaffSession["role"] | null = port.staffSession?.role ?? null;

  const correctionAllowed =
    reasonCode === "WRONG_CLASS" &&
    session !== null &&
    (isWithinCorrectionWindow(session.enteredAt, nowIso) || sessionRole === "SUPERVISOR");
  const correctionBlockedByWindow =
    reasonCode === "WRONG_CLASS" &&
    session !== null &&
    !isWithinCorrectionWindow(session.enteredAt, nowIso) &&
    sessionRole !== "SUPERVISOR";

  async function save() {
    if (session === null) {
      setError(t("override.session"));
      return;
    }
    if (reasonCode === null) {
      setError(t("override.reasonCode"));
      return;
    }
    const rule = validateOverrideInput({ reasonCode, note: note });
    if (!rule.ok) {
      setError(
        rule.issue === "UNKNOWN_REASON_CODE" ? t("override.reasonCode") : t("override.noteMissing"),
      );
      return;
    }
    const entryEvent = events.find((e) => e.type === "ENTRY" && e.session_id === session.sessionId);
    if (entryEvent === undefined) {
      setError(`${t("errors.writeRejected", { detail: "no local ENTRY event id" })}`);
      return;
    }
    setBusy(true);
    try {
      await writeOverride(port.writeDeps, {
        sessionId: session.sessionId,
        targetEventId: entryEvent.id,
        reasonCode: reasonCode as never,
        note: note.length === 0 ? undefined : note,
        change:
          correctionAllowed && correctedClass !== null
            ? { vehicle_class: correctedClass }
            : undefined,
      });
      addLogLine(`override saved session=${session.sessionId} reason=${reasonCode}`, nowIso);
      port.bump();
      setSaved(true);
      setError(null);
    } catch (err) {
      setError(err instanceof WriteRuleError ? err.message : String(err));
      addLogLine(`override write failed: ${String(err)}`, nowIso);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={t("override.title")} onBack={() => router.back()}>
      {session !== null ? (
        <View>
          <KVRow
            label={t("override.session")}
            value={normalizeShortCode(session.shortCode) ?? session.shortCode}
          />
          <Muted>{`${t("exit.enteredAt")}: ${new Date(Date.parse(session.enteredAt)).toISOString().slice(0, 16)}Z`}</Muted>
        </View>
      ) : (
        <View>
          <Note>{t("override.session")}</Note>
          {openSessions.map((candidate) => (
            <ToggleRow
              key={candidate.sessionId}
              label={`${candidate.shortCode} · ${t(`classes.${candidate.vehicleClass}`)}`}
              active={false}
              onPress={() => setSessionId(candidate.sessionId)}
            />
          ))}
          {openSessions.length === 0 && <Note tone="warn">{t("exit.notFound")}</Note>}
        </View>
      )}

      {session !== null && (
        <View>
          <Text style={styles.label}>{t("override.reasonCode")}</Text>
          {OVERRIDE_REASON_CODES.map((code) => (
            <ToggleRow
              key={code}
              label={t(`override.reasonLabel.${code}`)}
              active={reasonCode === code}
              onPress={() => {
                setReasonCode(code);
                if (code !== "WRONG_CLASS") setCorrectedClass(null);
              }}
            />
          ))}
          <Field
            label={t("override.note")}
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={200}
          />

          {correctionBlockedByWindow && (
            <Note tone="warn">{t("override.changeClassSupervisor")}</Note>
          )}
          {correctionAllowed && (
            <View>
              <Text style={styles.label}>{t("override.newClass")}</Text>
              {port.config.classes.map((classId) => (
                <ToggleRow
                  key={classId}
                  label={t(`classes.${classId}`)}
                  active={correctedClass === classId}
                  onPress={() => setCorrectedClass(classId)}
                />
              ))}
              <Note>{t("override.changeClassWindow")}</Note>
            </View>
          )}

          {saved && <Note tone="ok">{t("override.saved")}</Note>}
          {error !== null && <Note tone="danger">{error}</Note>}
          <BigButton title={t("override.submit")} onPress={() => void save()} disabled={busy} />
        </View>
      )}
    </Screen>
  );
}

const styles = {
  label: { marginTop: 12, marginBottom: 2, color: "#556577", fontSize: 13 },
};
