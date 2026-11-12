import { describe, expect, it } from "vitest";
import {
  allowedConflictActions,
  conflictAgeMinutes,
  isUnresolvedOver24Hours,
  parseSyncConflictRow,
  parseSyncConflictRows,
} from "../src/lib/conflicts";

const NOW = "2026-11-03T12:00:00Z";
const UUID = {
  conflict: "00000000-0000-4000-8000-000000000001",
  facility: "00000000-0000-4000-8000-000000000002",
  event: "00000000-0000-4000-8000-000000000003",
  session: "00000000-0000-4000-8000-000000000004",
  user: "00000000-0000-4000-8000-000000000005",
};

const openRow = {
  id: UUID.conflict,
  facility_id: UUID.facility,
  type: "DUPLICATE_EXIT" as const,
  event_ids: [UUID.event],
  session_id: UUID.session,
  dedupe_key: UUID.session,
  status: "OPEN" as const,
  detail: { detector: "test", nested: [1, true, null] },
  created_at: "2026-11-02T11:59:59Z",
  resolved_by: null,
  resolved_at: null,
};

describe("sync_conflicts row parser (migration 0006)", () => {
  it("accepts every migration column and preserves JSON detail", () => {
    expect(parseSyncConflictRow(openRow)).toEqual(openRow);
  });

  it("accepts a resolved row only with resolved_at and permits a null resolved_by", () => {
    const row = { ...openRow, status: "RESOLVED", resolved_at: NOW } as const;
    expect(parseSyncConflictRow(row)).toEqual(row);
  });

  it("enforces the database status/resolved_at check in both directions", () => {
    expect(() => parseSyncConflictRow({ ...openRow, status: "RESOLVED" })).toThrow();
    expect(() => parseSyncConflictRow({ ...openRow, resolved_at: NOW })).toThrow();
  });

  it("rejects an empty event_ids array, bad enum values and unknown columns", () => {
    expect(() => parseSyncConflictRow({ ...openRow, event_ids: [] })).toThrow();
    expect(() => parseSyncConflictRow({ ...openRow, type: "OTHER" })).toThrow();
    expect(() => parseSyncConflictRow({ ...openRow, invented: true })).toThrow();
  });

  it("parses query results atomically", () => {
    expect(parseSyncConflictRows([openRow])).toEqual([openRow]);
    expect(() => parseSyncConflictRows([openRow, { ...openRow, id: "not-a-uuid" }])).toThrow();
  });
});

describe("CON-07 conflict age", () => {
  it("returns whole elapsed minutes and rounds down", () => {
    expect(conflictAgeMinutes("2026-11-03T10:59:01Z", NOW)).toBe(60);
    expect(conflictAgeMinutes("2026-11-03T10:59:00Z", NOW)).toBe(61);
  });

  it("never returns a negative age and rejects invalid instants", () => {
    expect(conflictAgeMinutes("2026-11-03T13:00:00Z", NOW)).toBe(0);
    expect(() => conflictAgeMinutes("yesterday", NOW)).toThrow(RangeError);
  });
});

describe("CON-07 unresolved over 24 hours rule", () => {
  it("uses a strict over-24-hours boundary", () => {
    expect(
      isUnresolvedOver24Hours({ status: "OPEN", created_at: "2026-11-02T12:00:00Z" }, NOW),
    ).toBe(false);
    expect(
      isUnresolvedOver24Hours({ status: "OPEN", created_at: "2026-11-02T11:59:59Z" }, NOW),
    ).toBe(true);
  });

  it("never flags an already resolved conflict", () => {
    expect(
      isUnresolvedOver24Hours({ status: "RESOLVED", created_at: "2026-10-01T00:00:00Z" }, NOW),
    ).toBe(false);
  });
});

describe("CON-07 allowed actions", () => {
  it.each(["DUPLICATE_EXIT", "ORPHAN_EXIT", "DUPLICATE_ENTRY"] as const)(
    "%s allows event choice, test marking and a note",
    (type) => {
      expect(allowedConflictActions(type)).toEqual([
        "KEEP_FIRST",
        "KEEP_SECOND",
        "MARK_AS_TEST_ENTRY",
        "ADD_NOTE",
      ]);
    },
  );

  it("CLOCK_SKEW allows only Add note and Acknowledge", () => {
    expect(allowedConflictActions("CLOCK_SKEW")).toEqual(["ADD_NOTE", "ACKNOWLEDGE"]);
  });
});
