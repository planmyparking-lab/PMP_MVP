/**
 * Storage-agnostic SQLite port for the gate app (GATE-02 pasted brief, "SQLite OutboxStore").
 *
 * Shaped to match `expo-sqlite`'s `SQLiteDatabase` (`execAsync`, `runAsync`, `getAllAsync`,
 * `withTransactionAsync`) EXACTLY, so a real `expo-sqlite` database object satisfies this
 * interface structurally with no adapter code at all — see `expoGateDb.ts`. Vitest cannot load
 * expo's native binding, so tests drive `sqliteOutboxStore.ts` against a small `node:sqlite`
 * implementation of this same port instead (`apps/gate/test/helpers/nodeSqliteDb.ts`); the SQL in
 * `sqliteOutboxStore.ts` is plain, portable SQLite (no expo-only extensions), so the two drivers
 * exercise the same logic.
 */
/** `expo-sqlite`'s own bind-value union (minus the blob variant, which this store never binds):
 * `SQLiteBindParams` is `Record<string, SQLiteBindValue> | SQLiteBindValue[]`, so a plain mutable
 * array of these is accepted by the real driver's overloaded `runAsync`/`getAllAsync`. */
export type GateSqliteBindValue = string | number | null | boolean;

export interface GateSqliteDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: GateSqliteBindValue[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, params: GateSqliteBindValue[]): Promise<T[]>;
  /** Rolls back on a thrown error from `task` (restart recovery relies on this: a crash mid-task
   * never leaves a half-written row behind once the process restarts and reopens the file). */
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
