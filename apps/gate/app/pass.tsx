import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { isPassListStale, lookupPass, type PassLookupResult } from "../src/domain/pass";
import { formatPaise } from "../src/domain/paise";
import { istClockTime } from "../src/domain/istClock";
import { useHealth, useI18n } from "../src/ui/useSyncState";
import { usePortRequired } from "../src/ui/port";
import { BigButton, Field, Muted, Note, P, Screen, Tabs } from "../src/ui/ui";
import { afterPassLookupNavigation } from "../src/domain/navigation";

/**
 * Pass screen (GATE-05, T-GATE-05-U1/U2): exact-plate lookup over the (demo-seeded) pass rows
 * with the four contract states. Everything renders through the STATUS mapping, so when the
 * synced pass table arrives the screen needs zero changes.
 *
 * Honest limits displayed in place:
 * - rows in dev mode are the labeled seed set (until IC-04 read tables land);
 * - stale-data warning shows when lastSyncAt is null (never synced) or older than 24 h;
 * - the pass-QR path stays disabled (payload format pending with Anamika — pass.ts documents).
 */

const STATE_KEYS: Record<PassLookupResult["state"], string> = {
  VALID: "pass.stateValid",
  EXPIRED: "pass.stateExpired",
  NOT_FOUND: "pass.stateNotFound",
  DUES: "pass.stateDues",
};

const STATE_TONE: Record<PassLookupResult["state"], "ok" | "warn" | "danger"> = {
  VALID: "ok",
  EXPIRED: "danger",
  NOT_FOUND: "warn",
  DUES: "danger",
};

export default function PassScreen() {
  const port = usePortRequired();
  const { t } = useI18n();
  const router = useRouter();
  const health = useHealth(port.client);
  const [plate, setPlate] = useState("");
  const [result, setResult] = useState<PassLookupResult | null>(null);
  const [tab, setTab] = useState<"lookup" | "list">("lookup");

  function run() {
    setResult(lookupPass(plate, port.config.passes, new Date().toISOString()));
  }

  const lastSyncAt = health?.lastSyncAt ?? null;
  const stale = isPassListStale(lastSyncAt, Date.now());

  function returnToExit() {
    const destination = afterPassLookupNavigation(router.canGoBack());
    if (destination.kind === "back") router.back();
    else router.replace(destination.route);
  }

  return (
    <Screen title={t("pass.title")} onBack={() => router.back()}>
      <Tabs
        options={[
          { key: "lookup", label: t("pass.lookup") },
          { key: "list", label: t("nav.pass") },
        ]}
        active={tab}
        onSelect={(key) => setTab(key === "list" ? "list" : "lookup")}
      />

      {stale && (
        <Note>
          {t("pass.staleWarning", {
            time: lastSyncAt === null ? t("common.never") : istClockTime(Date.parse(lastSyncAt)),
          })}
        </Note>
      )}

      <Field
        label={t("pass.enterPlate")}
        value={plate}
        onChangeText={setPlate}
        placeholder={t("pass.plateExample")}
      />
      <BigButton title={t("pass.lookup")} onPress={run} />

      {result !== null && (
        <View style={styles.result}>
          <Text style={styles.headline}>
            {t(STATE_KEYS[result.state], {
              amount: result.pass !== null ? formatPaise(result.pass.dues) : "",
              date: result.pass?.valid_to ?? "",
            })}
          </Text>
          {result.pass !== null && (
            <Muted>
              {`${result.pass.id} · ${t("pass.validThrough", { date: result.pass.valid_to })}`}
            </Muted>
          )}
          <Note tone={STATE_TONE[result.state]}>
            {result.state === "VALID" ? t("payment.pass") : t("exit.amountDue")}
          </Note>
          {(result.state === "EXPIRED" || result.state === "NOT_FOUND") && (
            <BigButton title={t("nav.exit")} onPress={returnToExit} kind="secondary" />
          )}
        </View>
      )}

      {tab === "list" && (
        <View>
          <Note>{t("common.devSeed")}</Note>
          {port.config.passes.map((row) => (
            <View key={row.id} style={styles.kv}>
              <Text style={styles.kvText}>{row.vehicle_no}</Text>
              <Muted>{`${t("pass.validThrough", { date: row.valid_to })} · ${row.dues > 0 ? `${t("pass.dues")}: ${formatPaise(row.dues)}` : "—"}`}</Muted>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  result: { marginTop: 12, gap: 4 },
  headline: { fontSize: 18, fontWeight: "700", color: P.text },
  kv: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: P.border,
  },
  kvText: { color: P.text, fontSize: 15, fontWeight: "600" },
});
