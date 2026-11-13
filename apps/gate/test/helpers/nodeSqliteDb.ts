import { DatabaseSync } from "node:sqlite";

import type { GateSqliteDb } from "../../src/data/gateSqliteDb";

/**
 * `GateSqliteDb` backed by Node's built-in `node:sqlite` — the test-time stand-in for the real
 * `expo-sqlite` database (see `gateSqliteDb.ts`'s header: vitest cannot load expo's native
 * binding, so the gate's SQLite tests run the SAME `sqliteOutboxStore.ts` SQL against this real
 * on-disk SQLite engine instead of a mock). Pass a real file path (not `:memory:`) to test restart
 * recovery: closing this handle and opening a fresh one against the same path reads back
 * everything a prior process committed.
 */
export function createNodeSqliteDb(
  location: string = ":memory:",
): GateSqliteDb & { close(): void } {
  const db = new DatabaseSync(location);
  return {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { changes: Number(info.changes) };
    },
    async getAllAsync<T>(sql: string, params: readonly unknown[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async withTransactionAsync(task) {
      db.exec("BEGIN");
      try {
        await task();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}

/** Wraps a `GateSqliteDb` so `runAsync` throws `error` the first time `shouldFail` matches the
 * SQL text — used to prove atomicity by injecting a failure mid-transaction (the brief's "Event
 * insert failure" / "Outbox insert failure and rollback" cases). Fires once, then passes through. */
export function withOneRunFailure(
  db: GateSqliteDb,
  shouldFail: (sql: string) => boolean,
  error: Error,
): GateSqliteDb {
  let armed = true;
  return {
    execAsync: (sql) => db.execAsync(sql),
    getAllAsync: (sql, params) => db.getAllAsync(sql, params),
    withTransactionAsync: (task) => db.withTransactionAsync(task),
    async runAsync(sql, params) {
      if (armed && shouldFail(sql)) {
        armed = false;
        throw error;
      }
      return db.runAsync(sql, params);
    },
  };
}
