import { describe, expect, it } from "vitest";
import { IngestResponse, IngestResult } from "../src";

const envelope = {
  accepted: 0,
  duplicates: 0,
  rejected: 1,
  min_supported_version: 1,
  server_time: "2026-10-01T10:00:00.000Z",
};

describe("IngestResult", () => {
  it("keeps the optional detail of a rejected result", () => {
    const parsed = IngestResult.parse({
      id: "018f0000-0000-7000-8000-000000000001",
      status: "REJECTED",
      reason: "INVALID_PAYLOAD",
      detail: "payload.fare_paise",
    });
    expect(parsed.detail).toBe("payload.fare_paise");
  });

  it("does not require detail, reason or id", () => {
    expect(IngestResult.parse({ status: "ACCEPTED" })).toEqual({ status: "ACCEPTED" });
    expect(IngestResult.parse({ id: "x", status: "DUPLICATE" })).toEqual({
      id: "x",
      status: "DUPLICATE",
    });
    expect(
      IngestResult.parse({ status: "REJECTED", reason: "INVALID_ENVELOPE", detail: "event" }),
    ).toEqual({ status: "REJECTED", reason: "INVALID_ENVELOPE", detail: "event" });
  });

  it("rejects a detail that is not a string", () => {
    expect(IngestResult.safeParse({ status: "REJECTED", detail: 5 }).success).toBe(false);
    expect(IngestResult.safeParse({ status: "REJECTED", detail: null }).success).toBe(false);
  });

  it("keeps an unknown reason as a plain string so a newer server never breaks an older app", () => {
    const parsed = IngestResult.parse({ status: "REJECTED", reason: "SOME_NEW_REASON" });
    expect(parsed.reason).toBe("SOME_NEW_REASON");
  });

  it("ignores keys it does not know instead of failing", () => {
    const parsed = IngestResult.parse({ status: "ACCEPTED", future_field: 1 });
    expect(parsed).toEqual({ status: "ACCEPTED" });
  });
});

describe("IngestResponse", () => {
  it("accepts a batch whose results mix details and missing ids", () => {
    const parsed = IngestResponse.parse({
      ...envelope,
      rejected: 2,
      results: [
        { status: "REJECTED", reason: "INVALID_ENVELOPE", detail: "id" },
        { id: "a", status: "REJECTED", reason: "INVALID_PAYLOAD", detail: "payload.?" },
      ],
    });
    expect(parsed.results.map((r) => r.detail)).toEqual(["id", "payload.?"]);
    expect(parsed.results[0]?.id).toBeUndefined();
  });

  it("still rejects a response with an unknown status", () => {
    const bad = { ...envelope, results: [{ status: "MAYBE" }] };
    expect(IngestResponse.safeParse(bad).success).toBe(false);
  });
});
