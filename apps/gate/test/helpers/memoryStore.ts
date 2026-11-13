import type { Event } from "@pmp/contracts";
import type { OutboxRow, OutboxStore, RowUpdate, SyncState } from "@pmp/sync-rules";

/** Minimal in-memory `OutboxStore`, for transport-only tests that don't need real SQLite (compare
 * `sqliteOutboxStore.test.ts`, which drives the real gate-owned store). Mirrors the shape of
 * `@pmp/sync-rules`'s own internal test helper, which that package does not export. */
export class MemoryStore implements OutboxStore {
  private readonly rows = new Map<
    string,
    { id: string; event: Event; attempts: number; deviceTime: string; state: SyncState }
  >();

  add(event: Event): void {
    this.rows.set(event.id, {
      id: event.id,
      event,
      attempts: 0,
      deviceTime: event.device_time,
      state: "PENDING",
    });
  }

  async pending(limit: number): Promise<OutboxRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.state === "PENDING")
      .sort((a, b) =>
        a.deviceTime === b.deviceTime
          ? a.id < b.id
            ? -1
            : 1
          : a.deviceTime < b.deviceTime
            ? -1
            : 1,
      )
      .slice(0, limit)
      .map(({ id, event, attempts, deviceTime }) => ({ id, event, attempts, deviceTime }));
  }

  async apply(updates: RowUpdate[]): Promise<void> {
    for (const u of updates) {
      const row = this.rows.get(u.id);
      if (!row) continue;
      row.state = u.state;
      row.attempts = u.attempts;
    }
  }

  count(state: SyncState): number {
    return [...this.rows.values()].filter((r) => r.state === state).length;
  }
}
