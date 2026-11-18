import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PropsWithChildren } from "react";
import type { Event } from "@pmp/contracts";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

import { DEV_APP_CONFIG, type GateAppConfig } from "../data/appConfig";
import { FakeSync } from "../data/fakeSync";
import { SessionRegistry } from "../data/localSessions";
import { SCHEMA_VERSION, type WriteDeps } from "../data/writeEvent";
import { defaultUuidV7 } from "../domain/token";
import type { SyncClient } from "../data/ic02";
import { setLanguage, type AppLanguage } from "../i18n/config";
import { loadLanguagePreference, saveLanguagePreference } from "../i18n/preference";
import type { LockoutRecord } from "../auth/lockout";
import { createLockoutRecord } from "../auth/lockout";
import {
  loadPersistedLockout,
  restoredLockout,
  savePersistedLockout,
  type LockoutStorage,
  type LockoutLoadResult,
  type RestoredLockout,
} from "../auth/pinSession";
import { loadOrCreateStableId, type SecureKv } from "../auth/secureIdentity";
import { addLogLine } from "../lib/log";

/**
 * PortProvider — the ONE place that wires screens to a SyncClient + write layer + config.
 * The dev shell runs `FakeSync` (in-memory IC-02 double) until Afzal's `packages/sync-rules`
 * ships a real client; screens consume only `usePort()` surfaces, so swapping the client is a
 * provider-internal change (IC-02/T-IC02-GATE-1 design).
 *
 * DEV-MODE honesty surface (visible on the status screen and the banner row):
 * - `mode: "DEV_FAKE"` and the local-only registry are labeled everywhere they show;
 * - nothing ever fakes a sync — `lastSyncAt` stays null until a REAL client syncs, and the
 *   staleness/never-synced login gates stay real;
 * - the device id is load-or-create-once from expo-secure-store (allowed module); writes stay
 *   impossible (fail closed) until it resolves, because event attribution must not be retry-able
 *   under a rotating identity.
 */

export type StaffSession = {
  staffId: string;
  name: string;
  role: "GUARD" | "SUPERVISOR";
  startedAtIso: string;
};

export type RuntimeMode = "DEV_FAKE";

export type PortRuntime = {
  mode: RuntimeMode;
  config: GateAppConfig;
  deviceId: string | null;
  deviceIdProblem: string | null;
  appVersion: string | null;
  schemaVersion: number;
  /** The client screens write through (FakeSync in dev mode; the real client later). */
  client: SyncClient;
  /** Dev-only affordances (FakeSync cast); on a real client this surface moves into it. */
  devClient: FakeSync;
  writeDeps: WriteDeps;
  /** Render-time snapshot for screens (`FakeSync.listEventsSync()`) — deliberately NOT the
   * async IC-02 `listEvents()`/`WriteDeps.readEvents` contract (OQ-37); this surface predates and
   * is independent of it. */
  readEvents: () => readonly Event[];
  /** Bumped after every committed write so event-derived views reload. */
  eventsVersion: number;
  bump: () => void;
  /** Open-session stand-in for SYNC-03 (see src/data/localSessions.ts). */
  registry: SessionRegistry;
  /** Opening float kept for the open shift (provider state mirrors the SHIFT_OPEN payload's
   * opening_float_paise; the event payload is the source of truth after SYNC-01). */
  openingFloatPaise: number | null;
  setOpeningFloat: (paise: number | null) => void;
  /** expo-notifications ids for the shift's zone reminders (cancelled at close). */
  reminderIds: readonly string[];
  setReminderIds: (ids: readonly string[]) => void;
  staffSession: StaffSession | null;
  setStaffSession: (session: StaffSession | null) => void;
  /** Lockout record restored from secure storage at boot (rollback-aware; see pinSession). */
  lockout: RestoredLockout;
  /** PIN actions stay blocked until this state is ready. */
  lockoutLoadStatus: "loading" | "ready" | "error";
  /** Persist the operator's selected language using the existing SecureStore adapter. */
  persistLanguagePreference: (language: AppLanguage) => Promise<void>;
  /** Re-read or retry persisting a failed lockout update. */
  retryLockoutLoad: () => Promise<boolean>;
  /** Persist/refresh the lockout record as elapsed time moves (called by the login screen). */
  persistLockoutElapsed: (record: LockoutRecord) => Promise<void>;
};

const PortContext = createContext<PortRuntime | null>(null);

const DEVICE_ID_KEY = "gate.deviceId";
const LOCKOUT_KEY = "gate.lockout";
const LANGUAGE_KEY = "gate.language";

/** SecureKv adapter over the allowed expo-secure-store module (never MMKV; logs never see it). */
const secureKv: SecureKv & LockoutStorage = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  delete: (key) => SecureStore.deleteItemAsync(key),
};

/** Monotonic-ish elapsed source used consistently by the lockout wiring (pinSession restore +
 * lockout.ts record updates); performance.now() is monotonic on RN runtimes. */
export function lockoutElapsedNow(): number {
  return performance.now();
}

export function PortProvider({ children }: PropsWithChildren) {
  const [deviceIdState, setDeviceIdState] = useState<{ id: string | null; problem: string | null }>(
    {
      id: null,
      problem: null,
    },
  );
  const [lockoutState, setLockoutState] = useState<RestoredLockout>({
    record: createLockoutRecord(),
    rollbackDetected: false,
  });
  const [lockoutLoadStatus, setLockoutLoadStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const pendingLockoutWrite = useRef<LockoutRecord | null>(null);
  const languageSelectedByUser = useRef(false);
  const [eventsVersion, setEventsVersion] = useState(0);
  const [openingFloat, setOpeningFloat] = useState<number | null>(null);
  const [reminderIds, setReminderIds] = useState<string[]>([]);
  const [staffSession, setStaffSession] = useState<StaffSession | null>(null);

  const retryLockoutLoad = useCallback(async (): Promise<boolean> => {
    setLockoutLoadStatus("loading");
    try {
      const pending = pendingLockoutWrite.current;
      if (pending !== null) {
        const nowElapsed = lockoutElapsedNow();
        const nowWall = Date.now();
        const persisted = await savePersistedLockout(
          secureKv,
          LOCKOUT_KEY,
          pending,
          nowElapsed,
          nowWall,
        );
        pendingLockoutWrite.current = null;
        setLockoutState(restoredLockout(persisted, lockoutElapsedNow(), Date.now()));
      } else {
        const result: LockoutLoadResult = await loadPersistedLockout(
          secureKv,
          LOCKOUT_KEY,
          lockoutElapsedNow(),
          Date.now(),
        );
        if (!result.ok) {
          setLockoutLoadStatus("error");
          addLogLine(
            "lockout state unavailable or invalid; PIN actions remain blocked",
            new Date().toISOString(),
          );
          return false;
        }
        setLockoutState(result.value);
      }
      setLockoutLoadStatus("ready");
      return true;
    } catch {
      setLockoutLoadStatus("error");
      addLogLine(
        "lockout state could not be secured; PIN actions remain blocked",
        new Date().toISOString(),
      );
      return false;
    }
  }, []);

  const persistLanguage = useCallback(async (language: AppLanguage) => {
    languageSelectedByUser.current = true;
    setLanguage(language);
    try {
      await saveLanguagePreference(secureKv, LANGUAGE_KEY, language);
    } catch (error) {
      addLogLine("language preference could not be saved", new Date().toISOString());
      throw error;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await loadLanguagePreference(secureKv, LANGUAGE_KEY);
      if (cancelled || languageSelectedByUser.current) return;
      if (!result.ok) {
        addLogLine(
          "language preference unavailable or invalid; using the default language",
          new Date().toISOString(),
        );
        return;
      }
      if (result.language !== null) setLanguage(result.language);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const idResult = await loadOrCreateStableId(secureKv, DEVICE_ID_KEY, () => defaultUuidV7());
      void retryLockoutLoad();
      if (cancelled) return;
      if (!idResult.ok) {
        addLogLine(
          `device identity problem: ${idResult.reason} (${idResult.detail}); writes stay blocked`,
          new Date().toISOString(),
        );
        setDeviceIdState({ id: null, problem: `${idResult.reason}: ${idResult.detail}` });
        return;
      }
      setDeviceIdState({ id: idResult.id, problem: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [retryLockoutLoad]);

  const bump = useMemo(() => () => setEventsVersion((v) => v + 1), []);

  const config = DEV_APP_CONFIG;

  const sync = useMemo(() => {
    const zones = Object.fromEntries(config.zones.map((z) => [z.id, { capacity: z.capacity }]));
    return new FakeSync({ zones, openSessions: [], online: true, syncBlocked: false });
  }, [config]);

  const registry = useMemo(() => new SessionRegistry(), []);

  const writeDeps = useMemo(
    () => ({
      client: sync as SyncClient,
      // WriteDeps.readEvents is the async IC-02 contract (OQ-37): delegate to listEvents(), never
      // the render-time listEventsSync() below.
      readEvents: () => sync.listEvents(),
      // unresolved device id → "" fails the IC-01 envelope (writes blocked, fail closed)
      deviceId: deviceIdState.id ?? "",
      // the DEV seed facility stamp (a real install must match the JWT facility claim)
      facilityId: config.facilityId,
      // attribution from the PIN session; blank before login → validation fails closed
      staffId: staffSession?.staffId ?? "",
      now: () => new Date().toISOString(),
    }),
    [config.facilityId, deviceIdState.id, staffSession, sync],
  );

  const persistLockoutElapsed = useCallback(
    async (record: LockoutRecord) => {
      if (lockoutLoadStatus !== "ready") {
        throw new Error("Lockout state is not ready");
      }
      pendingLockoutWrite.current = record;
      try {
        const persisted = await savePersistedLockout(
          secureKv,
          LOCKOUT_KEY,
          record,
          lockoutElapsedNow(),
          Date.now(),
        );
        pendingLockoutWrite.current = null;
        setLockoutState(restoredLockout(persisted, lockoutElapsedNow(), Date.now()));
      } catch (error) {
        setLockoutLoadStatus("error");
        addLogLine(
          "lockout persistence failed; PIN actions remain blocked",
          new Date().toISOString(),
        );
        throw error;
      }
    },
    [lockoutLoadStatus],
  );

  const runtime: PortRuntime = useMemo(
    () => ({
      mode: "DEV_FAKE",
      config,
      deviceId: deviceIdState.id,
      deviceIdProblem: deviceIdState.problem,
      appVersion: Constants.expoConfig?.version ?? null,
      schemaVersion: SCHEMA_VERSION,
      client: sync,
      devClient: sync,
      writeDeps,
      readEvents: () => sync.listEventsSync(),
      eventsVersion,
      bump,
      registry,
      openingFloatPaise: openingFloat,
      setOpeningFloat,
      reminderIds,
      // SetStateAction vs the readonly surface: convert at the boundary so screens may pass
      // readonly arrays (they never patch by previous state).
      setReminderIds: (ids) => setReminderIds([...ids]),
      staffSession,
      setStaffSession,
      lockout: lockoutState,
      lockoutLoadStatus,
      persistLanguagePreference: persistLanguage,
      retryLockoutLoad,
      // store setter accepts SetStateAction; the runtime surface pins to the value form so
      // screens can pass readonly arrays (they never "replace on equality").
      persistLockoutElapsed,
    }),
    [
      config,
      deviceIdState,
      sync,
      writeDeps,
      eventsVersion,
      bump,
      registry,
      openingFloat,
      reminderIds,
      staffSession,
      lockoutState,
      lockoutLoadStatus,
      persistLanguage,
      retryLockoutLoad,
      persistLockoutElapsed,
    ],
  );

  return <PortContext.Provider value={runtime}>{children}</PortContext.Provider>;
}

export function usePort(): PortRuntime | null {
  return useContext(PortContext);
}

/** The screens' accessor: the provider mounts before the router stack renders, so null is a
 * programming error, not a runtime state. */
export function usePortRequired(): PortRuntime {
  const port = useContext(PortContext);
  if (port === null) throw new Error("usePortRequired used before PortProvider mounted");
  return port;
}
