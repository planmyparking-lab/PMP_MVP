import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The views import server actions, which pull in server-only code; they are not called when rendering.
vi.mock("../app/conflicts/actions", () => ({ addConflictNote: vi.fn() }));
vi.mock("../app/devices/actions", () => ({ deactivateGuard: vi.fn(), revokeDevice: vi.fn() }));

import { ConflictsView, notesUnavailableReason } from "../src/components/ConflictsView";
import { LiveDevices } from "../src/components/LiveDevices";
import { checkConflictNote, groupConflictNotes, noteInsertError } from "../src/lib/conflictNotes";
import {
  facilityQueue,
  guardQueueWarning,
  phoneQueueWarning,
  credentialUpdateError,
  DeviceTarget,
  GuardTarget,
  nothingChanged,
} from "../src/lib/credentialActions";
import type { SyncConflictRow } from "../src/lib/conflicts";
import type { FacilityLive } from "../src/lib/data/types";

const CONFLICT = "0190f0f0-0000-7000-8000-0000000000c1";

describe("CON-07 conflict notes", () => {
  it("accepts a trimmed note and rejects a blank or oversized one", () => {
    expect(checkConflictNote({ conflict_id: CONFLICT, note: "  Checked the gate  " })).toEqual({
      ok: true,
      input: { conflict_id: CONFLICT, note: "Checked the gate" },
    });
    expect(checkConflictNote({ conflict_id: CONFLICT, note: "   " })).toEqual({
      ok: false,
      error: "Write a note first.",
    });
    expect(checkConflictNote({ conflict_id: CONFLICT, note: "x".repeat(501) })).toMatchObject({
      ok: false,
    });
    expect(checkConflictNote({ conflict_id: "nope", note: "fine" })).toEqual({
      ok: false,
      error: "That conflict could not be read. Reload the page and try again.",
    });
  });

  it("never shows the database message for a failed insert", () => {
    expect(noteInsertError("42501")).toContain("row-level security");
    expect(noteInsertError("PGRST205")).toContain("not deployed");
    expect(noteInsertError("23503")).toContain("no longer exists");
    expect(noteInsertError("XX000")).toBe("The note could not be saved. Try again in a moment.");
  });

  it("groups notes by conflict and masks numbers like the activity log", () => {
    const grouped = groupConflictNotes([
      {
        id: "n1",
        conflict_id: CONFLICT,
        action: "ADD_NOTE",
        note: "Call 98765 43210 about MH12AB1234",
        resolved_by: "u1",
        resolved_at: "2026-11-13T07:00:00Z",
      },
      {
        id: "n2",
        conflict_id: "other",
        action: "ADD_NOTE",
        note: null,
        resolved_by: "u2",
        resolved_at: "2026-11-13T06:00:00Z",
      },
    ]);
    expect(grouped[CONFLICT]?.[0]?.note).toBe("Call •••• •••• about ••••");
    expect(grouped.other?.[0]?.note).toBe("");
  });

  it("says why notes are unavailable for each probe state", () => {
    expect(notesUnavailableReason({ state: "ok", data: {} })).toBeNull();
    expect(notesUnavailableReason({ state: "denied", error: "x" })).toContain("row-level security");
    expect(notesUnavailableReason({ state: "absent" })).toContain("not deployed");
    expect(notesUnavailableReason(undefined)).toContain("Sign in");
  });
});

const row: SyncConflictRow = {
  id: CONFLICT,
  facility_id: "f1",
  type: "ORPHAN_EXIT",
  event_ids: ["0190f0f0-0000-7000-8000-0000000000e1"],
  session_id: null,
  dedupe_key: CONFLICT,
  status: "OPEN",
  detail: {},
  created_at: "2026-11-13T06:00:00Z",
  resolved_by: null,
  resolved_at: null,
};

describe("Conflicts page", () => {
  it("opens Review with notes when notes can be written, and keeps deciding actions disabled", () => {
    const html = renderToStaticMarkup(
      <ConflictsView
        rows={[row]}
        nowIso="2026-11-13T07:00:00Z"
        connected
        notes={{ state: "ok", data: {} }}
        userId="u1"
      />,
    );
    expect(html).toContain("Live: notes can be added");
    expect(html).toContain("A note never closes a conflict.");
    expect(html).toContain("Add note: open Review");
    expect(html).toContain("Keep first. Unavailable:");
  });

  it("stays read-only and says why when notes cannot be read", () => {
    const html = renderToStaticMarkup(
      <ConflictsView
        rows={[row]}
        nowIso="2026-11-13T07:00:00Z"
        connected
        notes={{ state: "denied", error: "permission denied" }}
      />,
    );
    expect(html).toContain("Live and read-only");
    expect(html).toContain("cannot read notes yet");
  });
});

describe("events still waiting to sync (review of #51)", () => {
  const devices = [
    { id: "d1", revokedAt: null },
    { id: "d2", revokedAt: null },
    { id: "d3", revokedAt: null },
    { id: "old", revokedAt: "2026-11-01T00:00:00Z" },
  ];

  it("adds up the active phones' queues and counts phones with no heartbeat", () => {
    const q = facilityQueue(devices, [
      { deviceId: "d1", queueDepth: 150 },
      { deviceId: "d2", queueDepth: 0 },
      { deviceId: "old", queueDepth: 99 },
    ]);
    expect(q).toEqual({ events: 150, phonesWithQueue: 1, phonesUnknown: 1 });
    expect(guardQueueWarning(q)).toBe(
      "150 events are still waiting to sync on 1 phone. Any of them recorded by this guard will be refused. 1 phone has sent no heartbeat, so its queue is unknown. Ask the phones to sync first if you can.",
    );
  });

  it("says so plainly when nothing is waiting, and when heartbeats cannot be read", () => {
    expect(guardQueueWarning({ events: 0, phonesWithQueue: 0, phonesUnknown: 0 })).toContain(
      "nothing recorded by this guard is lost",
    );
    expect(facilityQueue(devices, null)).toBeNull();
    expect(guardQueueWarning(null)).toContain("Queue sizes are unknown");
  });

  it("warns per phone before a revoke", () => {
    expect(phoneQueueWarning(3)).toContain("3 events still waiting to sync. They will be refused.");
    expect(phoneQueueWarning(0)).toContain("no events waiting");
    expect(phoneQueueWarning(null)).toContain("sent no heartbeat");
    expect(phoneQueueWarning("unavailable")).toContain("Queue sizes are unknown");
  });
});

describe("CON-02 credential actions", () => {
  it("accepts only a uuid target", () => {
    expect(GuardTarget.safeParse({ staff_id: "not-a-uuid" }).success).toBe(false);
    expect(DeviceTarget.safeParse({ device_id: CONFLICT }).success).toBe(true);
  });

  it("explains an update that changed nothing without guessing why", () => {
    expect(nothingChanged("guard")).toContain("already inactive, or your account cannot");
    expect(nothingChanged("phone")).toContain("already revoked, or your account cannot");
    expect(credentialUpdateError("42501")).toContain("row-level security");
    expect(credentialUpdateError(undefined)).toBe("Nothing was saved. Try again in a moment.");
  });

  const live: FacilityLive = {
    facility: { id: "f1", orgId: "o1", name: "Demo", timezone: "Asia/Kolkata", slotCount: 10 },
    asOf: "2026-11-13T07:00:00Z",
    devices: {
      ok: true,
      data: [
        { id: "d1", name: "Entry gate phone", enrolledAt: "2026-10-14T00:00:00Z", revokedAt: null },
        {
          id: "d2",
          name: "Old phone",
          enrolledAt: "2026-10-14T00:00:00Z",
          revokedAt: "2026-11-01T00:00:00Z",
        },
      ],
    },
    staff: {
      ok: true,
      data: [
        { id: "s1", name: "Asha", active: true, createdAt: "2026-10-14T00:00:00Z" },
        { id: "s2", name: "Ravi", active: false, createdAt: "2026-10-14T00:00:00Z" },
      ],
    },
    heartbeats: { state: "absent" },
  } as unknown as FacilityLive;

  it("offers Revoke only for active phones, Deactivate for active guards, and explains Reactivate", () => {
    const html = renderToStaticMarkup(<LiveDevices live={live} />);
    expect(html.match(/>Revoke</g)?.length).toBe(1);
    expect(html.match(/>Deactivate</g)?.length).toBe(1);
    expect(html).toContain("Reactivate. Unavailable: Reactivating a guard needs a new PIN");
  });
});
