import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import type { TextInputProps } from "react-native";

import { useI18n } from "./useSyncState";

/**
 * Shared screen primitives (GATE-12 C.0 UI rules: every touch target ≥ 56 dp, all strings via
 * i18n, no two-screens-from-home rule here — that is the router's job). Colors/typography are
 * deliberately few and reused so the guard-facing screens stay uniform and TalkBack-labelable
 * (T-GATE-12-X1). No state of their own beyond local focus.
 */

export const P = {
  bg: "#F4F7FB",
  card: "#FFFFFF",
  border: "#CBD5E1",
  text: "#0F172A",
  muted: "#556577",
  accent: "#1D4ED8",
  ok: "#166534",
  warn: "#A1600A",
  danger: "#B42318",
  screenTitle: 20,
  body: 15,
  big: 22,
  touch: 56,
} as const;

export type ButtonKinds = "primary" | "secondary" | "danger" | "quiet";

const KIND_COLORS: Record<ButtonKinds, { bg: string; fg: string; border: string }> = {
  primary: { bg: P.accent, fg: "#FFFFFF", border: P.accent },
  secondary: { bg: P.card, fg: P.text, border: P.border },
  danger: { bg: P.card, fg: P.danger, border: P.danger },
  quiet: { bg: "transparent", fg: P.accent, border: "transparent" },
};

export function BigButton(props: {
  title: string;
  onPress: () => void;
  kind?: ButtonKinds;
  disabled?: boolean;
  testID?: string;
}) {
  const kind = props.kind ?? "primary";
  const colors = KIND_COLORS[kind];
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.title}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.touchable,
        { backgroundColor: colors.bg, borderColor: colors.border, minHeight: P.touch },
        props.disabled && styles.disabled,
        pressed && !props.disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, { color: props.disabled ? P.muted : colors.fg }]}>
        {props.title}
      </Text>
    </Pressable>
  );
}

export function Screen(props: { title: string; onBack?: () => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <View style={styles.screenHeader}>
        {props.onBack !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
            onPress={props.onBack}
            style={styles.backBtn}
          >
            <Text style={{ color: P.accent, fontSize: 16 }}>‹</Text>
          </Pressable>
        )}
        <Text style={styles.screenTitle}>{props.title}</Text>
      </View>
      <View style={styles.screenBody}>{props.children}</View>
    </SafeAreaView>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>;
}

export function Note({ children, tone }: { children: ReactNode; tone?: "warn" | "danger" | "ok" }) {
  const color = tone === "danger" ? P.danger : tone === "ok" ? P.ok : P.warn;
  return (
    <View style={[styles.note, { borderColor: color }]}>
      <Text style={{ color, fontSize: P.body }}>{children}</Text>
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={{ color: P.muted, fontSize: 13 }}>{children}</Text>;
}

export function KVRow(props: { label: string; value: ReactNode }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{props.label}</Text>
      <Text style={styles.kvValue}>{props.value}</Text>
    </View>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  inputMode?: TextInputProps["inputMode"];
  multiline?: boolean;
  maxLength?: number;
  editable?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        inputMode={props.inputMode}
        multiline={props.multiline}
        maxLength={props.maxLength}
        editable={props.editable}
        style={[styles.fieldInput, props.multiline === true && styles.fieldMultiline]}
      />
    </View>
  );
}

/** Simple two-tab switch (backfill entry/exit etc.). */
export function Tabs(props: {
  options: readonly { key: string; label: string }[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <View style={styles.tabs}>
      {props.options.map((option) => {
        const active = option.key === props.active;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            onPress={() => props.onSelect(option.key)}
            style={[styles.tab, active && styles.tabActive, { minHeight: P.touch }]}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ToggleRow(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={[styles.toggleRow, { minHeight: P.touch }, props.active && styles.toggleActive]}
    >
      <Text style={props.active ? styles.tabTextActive : styles.toggleText}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touchable: {
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 8,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  buttonText: { fontSize: P.big, fontWeight: "600" },
  screen: { flex: 1, backgroundColor: P.bg },
  screenHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    minHeight: P.touch,
  },
  backBtn: {
    width: P.touch,
    height: P.touch,
    alignItems: "center",
    justifyContent: "center",
  },
  screenTitle: { fontSize: P.screenTitle, fontWeight: "700", color: P.text },
  screenBody: { flex: 1, padding: 12, paddingBottom: 24 },
  heading: { fontSize: 17, fontWeight: "700", color: P.text, marginTop: 12, marginBottom: 4 },
  note: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    backgroundColor: P.card,
  },
  kv: {
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: P.border,
  },
  kvLabel: { color: P.muted, fontSize: P.body },
  kvValue: {
    color: P.text,
    fontSize: P.body,
    fontWeight: "600",
    textAlign: "right",
    flexShrink: 1,
    marginLeft: 12,
  },
  fieldWrap: { marginTop: 10 },
  fieldLabel: { color: P.muted, fontSize: 13, marginBottom: 4 },
  fieldInput: {
    backgroundColor: P.card,
    borderWidth: 1,
    borderColor: P.border,
    borderRadius: 10,
    minHeight: P.touch,
    justifyContent: "center",
    paddingHorizontal: 12,
    fontSize: 16,
    color: P.text,
  },
  fieldMultiline: { minHeight: 96, textAlignVertical: "top" },
  tabs: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: P.border,
    borderRadius: 12,
    overflow: "hidden",
    marginTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: P.card,
    paddingVertical: 12,
  },
  tabActive: { backgroundColor: P.accent },
  tabText: { fontSize: P.body, color: P.text },
  tabTextActive: { fontSize: P.body, color: "#FFFFFF", fontWeight: "700" },
  toggleRow: {
    borderWidth: 1,
    borderColor: P.border,
    borderRadius: 10,
    backgroundColor: P.card,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
    paddingHorizontal: 12,
  },
  toggleText: { fontSize: P.body, color: P.text },
  toggleActive: { backgroundColor: P.accent, borderColor: P.accent },
});
