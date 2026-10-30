import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useState } from "react";

import { findOpenShift } from "../src/domain/shiftTotals";
import { getLanguage, type AppLanguage } from "../src/i18n/config";
import {
  deriveBanners,
  visibleBanners,
  type Banner,
  type BannerKind,
} from "../src/ui/deriveBanners";
import { usePortRequired } from "../src/ui/port";
import { useHealth, useI18n, useOfflineTrack } from "../src/ui/useSyncState";
import { BigButton, Muted, Note, P } from "../src/ui/ui";
import { addLogLine } from "../src/lib/log";

/** Home screen (GATE-12 shell; C.0 rule: never more than two screens from home — single hub).

DEV-MODE labeling lives here on purpose: the shell runs FakeSync until the real IC-02 client
lands, so the very first banner line is the dev-mode notice. */

const MENU = [
  { key: "nav.entry", route: "/entry" },
  { key: "nav.exit", route: "/exit" },
  { key: "nav.pass", route: "/pass" },
  { key: "nav.zoneCount", route: "/zone-count" },
  { key: "nav.shift", route: "/shift/close" },
  { key: "nav.backfill", route: "/backfill" },
  { key: "nav.status", route: "/status" },
  { key: "nav.printer", route: "/settings/printer" },
] as const;

type TFn = ReturnType<typeof useI18n>["t"];

function bannerTitle(kind: Banner["kind"], queueMinutes: number, t: TFn): string {
  switch (kind) {
    case "OFFLINE":
      return t("banner.offline");
    case "QUEUE_OLD":
      return t("banner.queueOld", { minutes: queueMinutes });
    case "OLD_BUILD":
      return t("banner.oldBuild");
    case "LOW_BATTERY":
      return t("banner.lowBattery");
    case "LOW_STORAGE":
      return t("banner.lowStorage");
    case "CLOCK_SKEW":
      return t("banner.clockSkew");
    default:
      return kind;
  }
}

function hhmm(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return "";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  return new Date(at).toISOString().slice(11, 16);
}

export default function Home() {
  const port = usePortRequired();
  const { t } = useI18n();
  const router = useRouter();
  const health = useHealth(port.client);
  const online = health === null ? true : health.online;
  const offlineForMs = useOfflineTrack(online);

  const events = port.readEvents();
  const openShift = port.deviceId === null ? null : findOpenShift(events, port.deviceId);
  const session = port.staffSession;
  const [languageSaveFailed, setLanguageSaveFailed] = useState(false);
  const [dismissedBanners, setDismissedBanners] = useState<BannerKind[]>([]);

  async function changeLanguage(language: AppLanguage) {
    setLanguageSaveFailed(false);
    try {
      await port.persistLanguagePreference(language);
    } catch {
      setLanguageSaveFailed(true);
    }
  }

  const activeBanners =
    health === null
      ? []
      : deriveBanners(health, {
          offlineForMs,
          batteryPercent: null, // battery module unapproved (OQ-29): banner skipped, status "unknown"
          freeStorageMb: null,
          clockSkewMs: 0, // no trusted server time source in dev mode — real client pending
        });
  const activeBannerKey = activeBanners.map(({ kind }) => kind).join(",");
  useEffect(() => {
    const activeKinds = new Set(activeBannerKey.split(",").filter(Boolean));
    setDismissedBanners((current) => current.filter((kind) => activeKinds.has(kind)));
  }, [activeBannerKey]);
  const banners = visibleBanners(activeBanners, dismissedBanners);

  useEffect(() => {
    addLogLine("home opened; dev-mode shell with in-memory IC-02", new Date().toISOString());
  }, []);

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <Text style={styles.title}>{t("app.name")}</Text>
      <Note>{t("common.devMode")}</Note>

      {session === null ? (
        <View style={styles.sessionCard}>
          <Text style={styles.sessionText}>{t("home.noSession")}</Text>
          <BigButton title={t("nav.login")} onPress={() => router.push("/login")} kind="primary" />
        </View>
      ) : (
        <View style={styles.sessionCard}>
          <Text style={styles.sessionText}>{`${session.name} · ${session.role}`}</Text>
          <Text style={{ color: P.text }}>
            {openShift === null
              ? t("home.noShift")
              : t("home.currentShift", { time: hhmm(openShift.openAt) })}
          </Text>
        </View>
      )}

      {banners.map((banner) => (
        <View key={banner.kind} style={styles.bannerRow}>
          <View style={styles.bannerMessage}>
            <Note>
              {bannerTitle(banner.kind, Math.round((health?.oldestUnsyncedAgeMs ?? 0) / 60_000), t)}
            </Note>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.dismiss")}
            onPress={() =>
              setDismissedBanners((current) =>
                current.includes(banner.kind) ? current : [...current, banner.kind],
              )
            }
            style={styles.dismissButton}
          >
            <Text style={styles.dismissText}>×</Text>
          </Pressable>
        </View>
      ))}

      <ScrollView contentContainerStyle={styles.grid}>
        {MENU.map((item) => (
          <View key={item.key} style={styles.cell}>
            <BigButton
              title={t(item.key)}
              onPress={() => router.push(item.route as never)}
              kind="secondary"
            />
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.langRow}>
          <Text style={styles.langLabel}>{t("common.language")}:</Text>
          <BigButton
            title={t("common.languageHi")}
            kind={getLanguage() === "hi" ? "primary" : "secondary"}
            onPress={() => void changeLanguage("hi")}
          />
          <BigButton
            title={t("common.languageEn")}
            kind={getLanguage() === "en" ? "primary" : "secondary"}
            onPress={() => void changeLanguage("en")}
          />
        </View>
        {languageSaveFailed && <Note tone="danger">{t("common.languageSaveFailed")}</Note>}
        {session !== null && (
          <BigButton
            title={t("common.logout")}
            kind="danger"
            onPress={() => {
              addLogLine("logout", new Date().toISOString());
              port.setStaffSession(null);
            }}
          />
        )}
        <Muted>
          {`v${port.appVersion ?? t("common.unknown")} · schema ${port.schemaVersion} · ${port.mode}`}
        </Muted>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: P.bg },
  title: { fontSize: 24, fontWeight: "800", color: P.text, paddingHorizontal: 12, paddingTop: 8 },
  sessionCard: {
    margin: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: P.card,
    borderWidth: 1,
    borderColor: P.border,
  },
  bannerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  bannerMessage: { flex: 1 },
  dismissButton: {
    minWidth: 56,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  dismissText: { color: P.text, fontSize: 24 },
  sessionText: { fontSize: 16, fontWeight: "700", color: P.text, marginBottom: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 8 },
  cell: { width: "48.5%" },
  footer: { paddingHorizontal: 12, paddingBottom: 16 },
  langRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  langLabel: { color: P.muted, fontSize: 14 },
});
