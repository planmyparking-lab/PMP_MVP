import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { buildQrMatrix, type QrMatrix } from "../print/qr";
import type { TokenView } from "../domain/entryFlow";
import { BigButton, Muted, P } from "./ui";
import { useI18n } from "./useSyncState";

/**
 * TokenFullScreen (GATE-10 sequences 4.3/4.9, T-GATE-10-I1): the fallback token screen shown
 * whenever printing fails/times out, and reachable at any time for the same token. The QR on
 * screen encodes exactly the PRINTED payload (`qrPayloadFor` output) — no alternate data path.
 * The RSVP-style grid keeps this dependency-free (no svg module is on the approved list).
 */

export function QrView({ matrix, sizeDp = 216 }: { matrix: QrMatrix | null; sizeDp?: number }) {
  const { t } = useI18n();
  if (matrix === null) {
    // GATE-12 rule 7: no hard-coded text — the typed token code remains the fallback path.
    return <Muted>{t("errors.qrUnavailable")}</Muted>;
  }
  const cell = Math.floor(sizeDp / matrix.moduleCount) || 2;
  return (
    <View
      accessibilityLabel={t("entry.qrToken")}
      style={[
        styles.qrGrid,
        { width: cell * matrix.moduleCount, height: cell * matrix.moduleCount },
      ]}
    >
      {matrix.modules.map((row, rowIndex) => (
        <View key={`row-${String(rowIndex)}`} style={styles.qrRow}>
          {row.map((dark, colIndex) => (
            <View
              key={`cell-${String(rowIndex)}-${String(colIndex)}`}
              style={{ width: cell, height: cell, backgroundColor: dark ? "#0F172A" : "#FFFFFF" }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

export function TokenFullScreen(props: {
  token: TokenView;
  onReprint?: () => void;
  onDone?: () => void;
  reprintLabel?: string;
  doneLabel?: string;
  notice?: string;
}) {
  const { t } = useI18n();
  const matrix = buildQrMatrix(props.token.qrPayload);
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
      <Text style={styles.saved}>{t("entry.tokenShown")}</Text>
      <View style={styles.qrCard}>
        <QrView matrix={matrix} />
      </View>
      <Text style={styles.code}>{props.token.shortCode}</Text>
      {props.notice !== undefined && (
        <Text style={{ color: P.warn, fontSize: P.body, marginTop: 6 }}>{props.notice}</Text>
      )}
      <View style={styles.actions}>
        {props.onReprint !== undefined && (
          <BigButton
            title={props.reprintLabel ?? t("printer.reprint")}
            onPress={props.onReprint}
            kind="secondary"
          />
        )}
        {props.onDone !== undefined && (
          <BigButton title={props.doneLabel ?? t("entry.newVehicle")} onPress={props.onDone} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  saved: { fontSize: 22, fontWeight: "700", color: P.ok, marginBottom: 16 },
  qrCard: {
    padding: 16,
    borderWidth: 2,
    borderColor: P.border,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },
  qrGrid: { borderWidth: 4, borderColor: "#0F172A" },
  qrRow: { flexDirection: "row" },
  code: { fontSize: 34, fontWeight: "800", color: P.text, letterSpacing: 4, marginTop: 14 },
  actions: { alignSelf: "stretch", marginTop: 24 },
});
