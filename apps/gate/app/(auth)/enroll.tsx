import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";

import { Scanner } from "../../src/ui/Scanner";
import { useI18n } from "../../src/ui/useSyncState";
import { BigButton, Field, Muted, Note, Screen } from "../../src/ui/ui";
import { addLogLine } from "../../src/lib/log";

/**
 * Device enrollment (GATE-09 sequence 2): scan the one-time enrollment QR emitted by the
 * Console. `parkos-enroll:<code>` payloads are captured and displayed; the enrollment exchange
 * itself (device key ↔ Console) is IC-05/Akanksha's backend and is NOT shipped here, so the
 * screen says exactly that (exchangeBlocked) instead of pretending enrollment happened.
 *
 * Honesty notes:
 * - nothing is written to secure storage yet (that happens only when the real exchange lands —
 *   secureNote); the captured code is shown on screen only, never logged;
 * - camera unavailable (permission/hardware) switches to a manual code field rather than a
 *   dead scanner.
 */

const ENROLL_PAYLOAD = /^parkos-enroll:([A-Za-z0-9._:-]+)$/;
const ENROLL_CODE = /^[A-Za-z0-9._:-]+$/;

export default function EnrollScreen() {
  const { t } = useI18n();
  const router = useRouter();

  const [code, setCode] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [manual, setManual] = useState("");
  const [unavailable, setUnavailable] = useState<"permission" | "camera" | null>(null);

  function acceptPayload(payload: string) {
    const match = ENROLL_PAYLOAD.exec(payload.trim());
    if (match === null || match[1] === undefined) {
      setInvalid(true);
      setCode(null);
      return;
    }
    setInvalid(false);
    setCode(match[1]);
    // The code itself is a one-time credential: log the fact, never the value.
    addLogLine(
      "device enrollment code captured (exchange pending, IC-05)",
      new Date().toISOString(),
    );
  }

  function acceptManual(raw: string) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      setInvalid(true);
      return;
    }
    if (trimmed.startsWith("parkos-enroll:")) {
      acceptPayload(trimmed);
      return;
    }
    if (!ENROLL_CODE.test(trimmed)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setCode(trimmed);
    addLogLine(
      "device enrollment code typed manually (exchange pending, IC-05)",
      new Date().toISOString(),
    );
  }

  return (
    <Screen title={t("enroll.title")} onBack={() => router.back()}>
      <Note>{t("enroll.scanHint")}</Note>

      {unavailable === null ? (
        <Scanner
          hint={t("enroll.scanHint")}
          onScanned={(payload) => acceptPayload(payload)}
          onUnavailable={(reason) => setUnavailable(reason)}
        />
      ) : (
        <View>
          <Muted>{t("enroll.manualEntry")}</Muted>
          <Field label={t("enroll.title")} value={manual} onChangeText={setManual} maxLength={80} />
          <BigButton
            title={t("common.confirm")}
            kind="secondary"
            onPress={() => acceptManual(manual)}
          />
        </View>
      )}

      {code !== null && (
        <View>
          <Note tone="ok">{t("enroll.codeCaptured")}</Note>
          <Muted>{code}</Muted>
          <Note tone="warn">{t("enroll.exchangeBlocked")}</Note>
          <Muted>{t("enroll.secureNote")}</Muted>
        </View>
      )}
      {invalid && <Note tone="danger">{t("enroll.invalidCode")}</Note>}

      <BigButton title={t("common.back")} kind="quiet" onPress={() => router.back()} />
    </Screen>
  );
}
