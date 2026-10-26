import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";

import {
  isLocked,
  lockRemainingMs,
  recordFailedAttempt,
  recordSuccessfulLogin,
  type LockoutRecord,
} from "../../src/auth/lockout";
import { loginStalenessGate, pinShapeError } from "../../src/auth/pinSession";
import { createSubmissionGuard } from "../../src/auth/submissionGuard";
import { useHealth, useI18n } from "../../src/ui/useSyncState";
import { lockoutElapsedNow, usePortRequired } from "../../src/ui/port";
import { BigButton, Muted, Note, Screen, ToggleRow } from "../../src/ui/ui";
import { addLogLine } from "../../src/lib/log";
import { DEV_CONTROLS_ENABLED } from "../../src/lib/buildMode";

/**
 * Login screen (GATE-09 sequences 1-5): staff picker, PIN input, the 5-fail/5-minute lockout
 * countdown, the 14-day (or never-synced) staleness gate, and the labeled dev bypass.
 *
 * Honesty notes:
 * - PIN "verification" cannot exist yet: the hash parameters (IC-06, owner Akanksha) are not
 *   agreed, so a submitted PIN shows the pending note and is NOT counted as a failed attempt —
 *   counting unverifiable attempts toward a lockout would be fabrication. The lockout machinery
 *   itself is real and exercised via the clearly-labeled dev simulation button;
 * - the lockout record is the restored one (port.lockout; restart-rollback aware per
 *   pinSession.ts) and every mutation is persisted through port.persistLockoutElapsed;
 * - the staleness gate reads the REAL health snapshot: in the dev shell lastSyncAt is null, so
 *   the never-synced refusal shows — the bypass button is the only entrance and it labels itself.
 */

export default function LoginScreen() {
  const port = usePortRequired();
  const { t } = useI18n();
  const router = useRouter();
  const health = useHealth(port.client);

  const [staffId, setStaffId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingVisible, setPendingVisible] = useState(false);
  const [record, setRecord] = useState<LockoutRecord>(port.lockout.record);
  const [busy, setBusy] = useState(false);
  const submissionGuard = useRef(createSubmissionGuard()).current;
  const [, tick] = useState(0);
  const lockoutReady = port.lockoutLoadStatus === "ready";

  // 1 s re-render drives the lockout countdown while it is active.
  useEffect(() => {
    const interval = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (lockoutReady) setRecord(port.lockout.record);
  }, [lockoutReady, port.lockout.record]);

  const locked = isLocked(record, lockoutElapsedNow());
  const remainingSeconds = Math.ceil(
    Math.max(0, lockRemainingMs(record, lockoutElapsedNow())) / 1000,
  );
  const stale = loginStalenessGate(health?.lastSyncAt ?? null, Date.now());

  function submit() {
    if (!lockoutReady || busy || locked) return;
    const shape = pinShapeError(pin);
    if (shape !== null) {
      setError(t("login.wrongLength"));
      return;
    }
    // IC-06 pending: nothing on this phone can verify a PIN, so this is a pending notice, not a
    // counted failure (see header) — and never a silent "success".
    setPendingVisible(true);
    setError(null);
    addLogLine(
      "PIN submitted — verification not configured (IC-06); attempt not counted",
      new Date().toISOString(),
    );
  }

  async function simulateWrongPin() {
    if (!DEV_CONTROLS_ENABLED || !lockoutReady || locked) return;
    const release = submissionGuard.tryAcquire();
    if (release === null) return;
    setBusy(true);
    try {
      const next = recordFailedAttempt(record, lockoutElapsedNow());
      await port.persistLockoutElapsed(next);
      setRecord(next);
    } catch {
      setError(t("login.lockoutPersistenceFailed"));
      return;
    } finally {
      release();
      setBusy(false);
    }
    addLogLine("DEV: simulated wrong PIN counted toward the lockout", new Date().toISOString());
  }

  async function devBypass() {
    if (!DEV_CONTROLS_ENABLED || !lockoutReady) return;
    const staff = port.config.staff.find((row) => row.staffId === staffId);
    if (staff === undefined) {
      setError(t("login.chooseStaff"));
      return;
    }
    const release = submissionGuard.tryAcquire();
    if (release === null) return;
    setBusy(true);
    // Successful login clears the counter (lockout rule) — through the SAME persist path even on
    // a bypass row, so the persisted state matches what the screen did.
    const cleared = recordSuccessfulLogin();
    try {
      await port.persistLockoutElapsed(cleared);
    } catch {
      setError(t("login.lockoutPersistenceFailed"));
      return;
    } finally {
      release();
      setBusy(false);
    }
    setRecord(cleared);
    port.setStaffSession({
      staffId: staff.staffId,
      name: staff.name,
      role: staff.role,
      startedAtIso: new Date().toISOString(),
    });
    addLogLine(
      `dev bypass session opened as ${staff.name} (no PIN verify)`,
      new Date().toISOString(),
    );
    setError(null);
    setPin("");
    router.replace("/");
  }

  async function retryLockoutLoad() {
    const release = submissionGuard.tryAcquire();
    if (release === null) return;
    setBusy(true);
    try {
      const recovered = await port.retryLockoutLoad();
      setError(recovered ? null : t("login.lockoutUnavailable"));
    } finally {
      release();
      setBusy(false);
    }
  }

  return (
    <Screen title={t("login.title")} onBack={() => router.back()}>
      {port.lockout.rollbackDetected && <Note tone="warn">{t("login.rollbackDetected")}</Note>}
      {!lockoutReady && (
        <View>
          <Note tone="danger">
            {port.lockoutLoadStatus === "loading"
              ? t("login.lockoutLoading")
              : t("login.lockoutUnavailable")}
          </Note>
          {port.lockoutLoadStatus === "error" && (
            <BigButton
              title={t("login.retryLockout")}
              kind="secondary"
              onPress={() => void retryLockoutLoad()}
              disabled={busy}
            />
          )}
        </View>
      )}

      <Text style={styles.label}>{t("login.chooseStaff")}</Text>
      {port.config.staff.map((candidate) => (
        <ToggleRow
          key={candidate.staffId}
          label={`${candidate.name} · ${candidate.role}`}
          active={staffId === candidate.staffId}
          onPress={() => setStaffId(candidate.staffId)}
        />
      ))}

      <Text style={styles.label}>{t("login.pinPrompt")}</Text>
      <TextInput
        style={[styles.pin, locked && styles.pinDisabled]}
        value={pin}
        onChangeText={(raw) => {
          setPin(raw.replace(/\D/g, "").slice(0, 6));
          setPendingVisible(false);
        }}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        editable={lockoutReady && !locked && !busy}
        accessibilityLabel={t("login.pinPrompt")}
      />
      {error !== null && <Note tone="danger">{error}</Note>}
      {pendingVisible && (
        <View>
          <Note tone="warn">{t("login.verifyPendingTitle")}</Note>
          <Muted>{t("login.verifyPendingBody")}</Muted>
        </View>
      )}

      {locked ? (
        <Note tone="danger">
          {t("login.lockout", {
            minutes: Math.floor(remainingSeconds / 60),
            seconds: remainingSeconds % 60,
          })}
        </Note>
      ) : (
        <BigButton
          title={t("login.title")}
          onPress={() => submit()}
          disabled={!lockoutReady || busy || pendingVisible}
        />
      )}

      {!stale.ok && (
        <View>
          <Note tone="warn">
            {stale.reason === "NEVER_SYNCED"
              ? t("login.stalenessNever")
              : t("login.stalenessDays", { days: Math.floor(stale.daysOld) })}
          </Note>
        </View>
      )}

      {DEV_CONTROLS_ENABLED && (
        <>
          <View>
            <Note>{t("login.devBypassBody")}</Note>
            <BigButton title={t("login.devBypass")} kind="secondary" onPress={() => devBypass()} />
          </View>

          <View>
            <Muted>{`${t("login.devSimulateWrongPin")} · ${t("login.verifyPendingBody")}`}</Muted>
            <BigButton
              title={t("login.devSimulateWrongPin")}
              kind="quiet"
              onPress={() => simulateWrongPin()}
              disabled={!lockoutReady || locked || busy}
            />
          </View>
        </>
      )}

      <BigButton
        title={t("enroll.title")}
        kind="secondary"
        onPress={() => router.push("/enroll")}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: 12, marginBottom: 2, fontSize: 13 },
  pin: {
    borderWidth: 1,
    borderColor: "#8895a7",
    borderRadius: 8,
    paddingVertical: 14,
    fontSize: 24,
    textAlign: "center",
    letterSpacing: 8,
  },
  pinDisabled: { opacity: 0.4 },
});
