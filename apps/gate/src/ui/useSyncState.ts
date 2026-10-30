import { useEffect, useMemo, useRef, useState } from "react";

import {
  getLanguage,
  setLanguage as setI18nLanguage,
  subscribeLanguage,
  translate,
  type AppLanguage,
} from "../i18n/config";
import type { HealthSnapshot, OccupancySnapshot, SyncClient } from "../data/ic02";

/**
 * Screen hooks (device-side). The port (src/ui/port.tsx) supplies the SyncClient in dev mode;
 * these hooks only know the port interface.
 */

/** GATE-12 rule 7: every string through i18n; screens bind `t` and re-render on language flip
 * (T-GATE-12-E1: language change mid-flow preserves state — this hook never remounts anything). */
export function useI18n(): {
  t: (key: string, options?: Record<string, unknown>) => string;
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
} {
  const [language, setCurrent] = useState<AppLanguage>(getLanguage());
  useEffect(() => subscribeLanguage(setCurrent), []);
  const t = useMemo(
    () => (key: string, options?: Record<string, unknown>) => translate(key, options),
    [], // `translate` reads the module's current language; the component re-renders on the flip
  );
  return {
    t,
    language,
    setLanguage: (next) => {
      setI18nLanguage(next);
    },
  };
}

/** SYNC-04 occupancy view; re-delivers on local writes (client's own re-delivery contract). */
export function useOccupancy(
  client: SyncClient | null,
  facilityId: string,
): OccupancySnapshot | null {
  const [snapshot, setSnapshot] = useState<OccupancySnapshot | null>(null);
  useEffect(() => {
    if (client === null) return undefined; // device id / runtime still loading
    const off = client.observeOccupancy(facilityId, setSnapshot);
    return () => {
      off();
    };
  }, [client, facilityId]);
  return snapshot;
}

const HEALTH_POLL_MS = 1000;

/** SYNC-06 health snapshot, polled (no IC-02 observer exists for health — a provider upgrade
 * would move this onto an observer without touching screens). */
export function useHealth(client: SyncClient | null): HealthSnapshot | null {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  useEffect(() => {
    if (client === null) return undefined;
    setHealth(client.health());
    const id = setInterval(() => setHealth(client.health()), HEALTH_POLL_MS);
    return () => {
      clearInterval(id);
    };
  }, [client]);
  return health;
}

/** Offline-after-grace tracking for the OFFLINE banner (10 s grace, deriveBanners rule). */
export function useOfflineTrack(online: boolean): number {
  const offlineSinceRef = useRef<number | null>(null);
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    if (!online && offlineSinceRef.current === null) offlineSinceRef.current = Date.now();
    if (online) offlineSinceRef.current = null;
  }, [online]);
  useEffect(() => {
    if (!online) {
      const id = setInterval(() => setNowTick((n) => n + 1), 1000);
      return () => {
        clearInterval(id);
      };
    }
    return undefined;
  }, [online]);
  if (online || offlineSinceRef.current === null) return 0;
  void nowTick; // re-render signal (the interval keeps this fresh while offline)
  return Date.now() - offlineSinceRef.current;
}
