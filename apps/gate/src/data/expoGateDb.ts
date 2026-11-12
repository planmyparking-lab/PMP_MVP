import * as SQLite from "expo-sqlite";

import type { GateSqliteDb } from "./gateSqliteDb";

/**
 * Production `GateSqliteDb`: opens the on-device database via `expo-sqlite`. `SQLiteDatabase`
 * (expo-sqlite's real return type) already has `execAsync`/`runAsync`/`getAllAsync`/
 * `withTransactionAsync` with matching signatures, so no adapter object is needed — this is just
 * the one call site the app shell imports instead of reaching into `expo-sqlite` directly, so the
 * database name/location is decided in one place.
 *
 * NOT unit-testable here (needs the native Expo SQLite binding, unavailable under vitest/Node —
 * see `gateSqliteDb.ts`'s header). `sqliteOutboxStore.ts`'s SQL is plain, portable SQLite with no
 * expo-only extensions, exercised instead against `node:sqlite` in `test/sqliteOutboxStore.test.ts`.
 * Opening this on a real device/emulator is NOT RUN as part of this change — no physical-device
 * evidence exists yet (see `docs/team/evidence-nikhil.md`).
 */
export async function openGateDb(databaseName = "gate.db"): Promise<GateSqliteDb> {
  return SQLite.openDatabaseAsync(databaseName);
}
