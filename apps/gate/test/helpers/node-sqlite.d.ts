/**
 * Minimal ambient typing for Node's built-in `node:sqlite` (stable since Node 22.5, still flagged
 * experimental). `@types/node` 22.20.5 (pinned in this repo) does not ship `sqlite.d.ts` yet; this
 * covers only the surface `nodeSqliteDb.ts` actually calls. Test-only — never imported by app code.
 */
declare module "node:sqlite" {
  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }
  export class StatementSync {
    run(...params: unknown[]): StatementResultingChanges;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  }
  export class DatabaseSync {
    constructor(location: string, options?: Record<string, unknown>);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
