import { describe, expect, it, vi } from "vitest";

import { newId, type Event } from "@pmp/contracts";
import { AuthError, Uploader } from "@pmp/sync-rules";

import { SupabaseIngestTransport } from "../src/data/supabaseIngestTransport";

/**
 * SupabaseIngestTransport tests (pasted brief Step 4: "distinguish retryable failures from
 * permanent failures", "handle network loss, timeout, authentication failure and server
 * rejection", "never log secrets or sensitive payload data"). No real network call: `rpc` is a
 * fake implementing the narrow `SupabaseRpcClient` port, so these are fully independent of
 * CLD-03/staging (see the blocker note in supabaseIngestTransport.ts).
 */

const FACILITY = "00000000-0000-4000-8000-0000000000f1";
const DEVICE = "00000000-0000-4000-8000-0000000000d1";
const STAFF = "00000000-0000-4000-8000-0000000000b1";
const ZONE = "00000000-0000-4000-8000-0000000000c1";

function makeEntry(): Event {
  return {
    id: newId(),
    type: "ENTRY",
    facility_id: FACILITY,
    device_id: DEVICE,
    staff_id: STAFF,
    session_id: newId(),
    device_time: "2026-10-29T10:00:00.000Z",
    source: "LIVE",
    schema_version: 1,
    payload: { vehicle_class: "Car", zone_id: ZONE, short_code: "7K2QX" },
  };
}

describe("SupabaseIngestTransport.ingest", () => {
  it("calls the actual RPC name and payload shape from migration 0004: rpc('ingest_events', { events })", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { results: [], accepted: 0 }, error: null });
    const transport = new SupabaseIngestTransport({ rpc });
    const events = [makeEntry()];

    await transport.ingest(events);

    expect(rpc).toHaveBeenCalledWith("ingest_events", { events });
  });

  it("returns the server's raw response unvalidated (Uploader is the validation authority)", async () => {
    const serverResponse = {
      results: [{ id: "x", status: "ACCEPTED" }],
      accepted: 1,
      duplicates: 0,
      rejected: 0,
      min_supported_version: 1,
      server_time: "2026-10-29T10:00:01.000Z",
    };
    const transport = new SupabaseIngestTransport({
      rpc: async () => ({ data: serverResponse, error: null }),
    });

    await expect(transport.ingest([makeEntry()])).resolves.toBe(serverResponse);
  });

  it("maps SQLSTATE 28000 (not authenticated) to AuthError", async () => {
    const transport = new SupabaseIngestTransport({
      rpc: async () => ({ data: null, error: { message: "not authenticated", code: "28000" } }),
    });
    await expect(transport.ingest([makeEntry()])).rejects.toBeInstanceOf(AuthError);
  });

  it("maps SQLSTATE 42501 (not an enrolled device) to AuthError", async () => {
    const transport = new SupabaseIngestTransport({
      rpc: async () => ({
        data: null,
        error: { message: "caller is not an active enrolled device", code: "42501" },
      }),
    });
    await expect(transport.ingest([makeEntry()])).rejects.toBeInstanceOf(AuthError);
  });

  it("treats any other server rejection as a retryable (non-auth) failure", async () => {
    const transport = new SupabaseIngestTransport({
      rpc: async () => ({
        data: null,
        error: { message: "batch too large (max 500)", code: "22023" },
      }),
    });
    const error = await transport.ingest([makeEntry()]).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(AuthError);
    expect(error).toBeInstanceOf(Error);
  });

  it("propagates a thrown network/timeout error untouched (no auth misclassification)", async () => {
    const networkError = new Error("fetch failed: network unreachable");
    const transport = new SupabaseIngestTransport({
      rpc: async () => {
        throw networkError;
      },
    });
    await expect(transport.ingest([makeEntry()])).rejects.toBe(networkError);
  });

  it("never logs the event payload or an auth error's detail (no secrets in logs)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const transport = new SupabaseIngestTransport({
        rpc: async () => ({
          data: null,
          error: { message: "secret-looking-detail", code: "28000" },
        }),
      });
      await transport.ingest([makeEntry()]).catch(() => undefined);
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("SupabaseIngestTransport wired through Uploader end to end (fake RPC, no network)", () => {
  it("AUTH_REQUIRED stops uploading and keeps every event pending", async () => {
    const { MemoryStore } = await import("./helpers/memoryStore");
    const store = new MemoryStore();
    store.add(makeEntry());
    const transport = new SupabaseIngestTransport({
      rpc: async () => ({ data: null, error: { message: "no jwt", code: "28000" } }),
    });
    const uploader = new Uploader(store, transport);
    expect(await uploader.uploadBatch()).toEqual({ kind: "AUTH_REQUIRED" });
    expect(store.count("PENDING")).toBe(1);
  });

  it("a server-accepted batch marks the rows SENT", async () => {
    const { MemoryStore } = await import("./helpers/memoryStore");
    const store = new MemoryStore();
    const entry = makeEntry();
    store.add(entry);
    const transport = new SupabaseIngestTransport({
      rpc: async (_fn, args) => {
        const sent = args.events as Event[];
        return {
          data: {
            results: sent.map((e) => ({ id: e.id, status: "ACCEPTED" })),
            accepted: sent.length,
            duplicates: 0,
            rejected: 0,
            min_supported_version: 1,
            server_time: "2026-10-29T10:00:01.000Z",
          },
          error: null,
        };
      },
    });
    const uploader = new Uploader(store, transport);
    expect(await uploader.uploadBatch()).toMatchObject({ kind: "UPLOADED", sent: 1 });
    expect(store.count("SENT")).toBe(1);
  });
});
