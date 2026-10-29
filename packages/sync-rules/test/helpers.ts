import { newId, type Event } from "@pmp/contracts";
import type { IngestTransport, OutboxRow, OutboxStore, RowUpdate, SyncState } from "../src";

const FACILITY = "00000000-0000-4000-8000-0000000000f1";
const DEVICE = "00000000-0000-4000-8000-0000000000d1";
const STAFF = "00000000-0000-4000-8000-0000000000b1";
const ZONE = "00000000-0000-4000-8000-0000000000c1";

export function makeEntry(deviceTime: string, id: string = newId()): Event {
  return {
    id,
    type: "ENTRY",
    facility_id: FACILITY,
    device_id: DEVICE,
    staff_id: STAFF,
    session_id: newId(),
    device_time: deviceTime,
    source: "LIVE",
    schema_version: 1,
    payload: { vehicle_class: "CAR", zone_id: ZONE, short_code: "7K2QX" },
  };
}

interface StoredRow extends OutboxRow {
  state: SyncState;
  code?: string;
}

/** In-memory OutboxStore. `failNextApply` simulates the app being killed after the RPC succeeded. */
export class MemoryStore implements OutboxStore {
  rows = new Map<string, StoredRow>();
  failNextApply = false;
  applyCalls = 0;

  add(event: Event): void {
    this.rows.set(event.id, {
      id: event.id,
      event,
      attempts: 0,
      deviceTime: event.device_time,
      state: "PENDING",
    });
  }
  addRaw(id: string, event: unknown, deviceTime = "2026-10-01T10:00:00.000Z"): void {
    this.rows.set(id, { id, event, attempts: 0, deviceTime, state: "PENDING" });
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
    this.applyCalls += 1;
    if (this.failNextApply) {
      this.failNextApply = false;
      throw new Error("killed before the local write");
    }
    for (const u of updates) {
      const row = this.rows.get(u.id)!;
      row.state = u.state;
      row.attempts = u.attempts;
      row.code = u.code;
    }
  }
  count(state: SyncState): number {
    return [...this.rows.values()].filter((r) => r.state === state).length;
  }
}

/** Fake cloud: stores event ids once (duplicate on re-send) and rejects ids listed in `rejectIds`. */
export class FakeCloud implements IngestTransport {
  stored = new Set<string>();
  rejectIds = new Map<string, string>();
  calls: string[][] = [];
  failWith: unknown = null;
  async ingest(events: Event[]): Promise<unknown> {
    this.calls.push(events.map((e) => e.id));
    if (this.failWith) throw this.failWith;
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;
    const results = events.map((e) => {
      const reason = this.rejectIds.get(e.id);
      if (reason) {
        rejected += 1;
        return { id: e.id, status: "REJECTED", reason };
      }
      if (this.stored.has(e.id)) {
        duplicates += 1;
        return { id: e.id, status: "DUPLICATE" };
      }
      this.stored.add(e.id);
      accepted += 1;
      return { id: e.id, status: "ACCEPTED" };
    });
    return {
      results,
      accepted,
      duplicates,
      rejected,
      min_supported_version: 1,
      server_time: "2026-10-01T10:00:00.000Z",
    };
  }
}
