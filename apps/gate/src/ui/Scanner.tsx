import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

import { P } from "./ui";
import { useI18n } from "./useSyncState";

/**
 * Camera scanner (GATE-10 sequence 4; T-GATE-10-N1). QR-only via expo-camera; permission is
 * requested at FIRST USE with a plain explanation, and a denied/unusable camera fires
 * `onUnavailable` so the screen can switch to the typed-code path (never a dead view).
 * Repeated scans of the same payload inside the cooldown are dropped (caller gets clean edges).
 */

export type ScannerProps = {
  /** One callback per new scanned payload (1.5 s per-payload cooldown). */
  onScanned: (payload: string) => void;
  /** Camera unusable (permission / module failure) — caller switches modes. */
  onUnavailable: (reason: "permission" | "camera") => void;
  torch?: boolean;
  hint?: string;
};

const COOLDOWN_MS = 1500;

export function Scanner(props: ScannerProps) {
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const [requested, setRequested] = useState(false);
  const [torchOn, setTorchOn] = useState(props.torch === true);
  const cooldownRef = useRef<{ payload: string; at: number }>({ payload: "", at: 0 });
  const unavailableRef = useRef(props.onUnavailable);
  unavailableRef.current = props.onUnavailable;

  useEffect(() => {
    setTorchOn(props.torch === true);
  }, [props.torch]);

  useEffect(() => {
    if (permission === null) {
      // permissions state not yet resolved: auto-request once when it arrives denied-but-able
      return;
    }
    if (permission.granted) return;
    if (permission.canAskAgain && !requested) {
      setRequested(true);
      void requestPermission().then((outcome) => {
        if (!outcome.granted) unavailableRef.current("permission");
      });
      return;
    }
    if (!permission.canAskAgain) unavailableRef.current("permission");
  }, [permission, requested, requestPermission]);
  if (permission === null || !permission.granted) {
    return (
      <View style={styles.dead}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setRequested(true);
            void requestPermission().then((outcome) => {
              if (!outcome.granted) unavailableRef.current("permission");
            });
          }}
        >
          <Text style={styles.hintText}>{props.hint ?? ""}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.body}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        enableTorch={torchOn}
        onBarcodeScanned={({ data }: { data: string }) => {
          const now = Date.now();
          if (cooldownRef.current.payload === data && now - cooldownRef.current.at < COOLDOWN_MS) {
            return;
          }
          cooldownRef.current = { payload: data, at: now };
          props.onScanned(data);
        }}
      />
      <View style={styles.torchRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("scanner.toggleTorch")}
          onPress={() => setTorchOn((on) => !on)}
          style={styles.torch}
        >
          <Text style={styles.torchText}>{torchOn ? "✕" : "⊕"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, minHeight: 220, borderRadius: 12, overflow: "hidden" },
  camera: { flex: 1 },
  dead: {
    flex: 1,
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    backgroundColor: P.card,
    borderRadius: 12,
  },
  hintText: { fontSize: 16, color: P.accent, textAlign: "center" },
  torchRow: { position: "absolute", bottom: 12, right: 12 },
  torch: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#0F172ACC",
    alignItems: "center",
    justifyContent: "center",
  },
  torchText: { color: "#FFFFFF", fontSize: 22 },
});
