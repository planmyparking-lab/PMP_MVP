import { describe, expect, it } from "vitest";
import { openSessionsToCsv, parseOpenSessionRow, toOpenSessionLike } from "../src/lib/openSessions";

const UUID = {
  session: "00000000-0000-4000-8000-000000000011",
  facility: "00000000-0000-4000-8000-000000000012",
  event: "00000000-0000-4000-8000-000000000013",
  zone: "00000000-0000-4000-8000-000000000014",
  pass: "00000000-0000-4000-8000-000000000015",
};

const row = {
  session_id: UUID.session,
  facility_id: UUID.facility,
  entry_event_id: UUID.event,
  zone_id: UUID.zone,
  vehicle_class: "CAR",
  short_code: "A12BC",
  vehicle_no: "PLATESECRET",
  pass_id: null,
  entry_time: "2026-11-03T06:30:00+05:30",
  created_at: "2026-11-03T01:00:01Z",
};

describe("open_sessions row adapter (migration 0005)", () => {
  it("parses the exact database row and rejects missing or extra columns", () => {
    expect(parseOpenSessionRow(row)).toEqual(row);
    const missing: Record<string, unknown> = { ...row };
    delete missing.created_at;
    expect(() => parseOpenSessionRow(missing)).toThrow();
    expect(() => parseOpenSessionRow({ ...row, invented: true })).toThrow();
  });

  it("rejects malformed UUIDs and timestamps", () => {
    expect(() => parseOpenSessionRow({ ...row, zone_id: "zone" })).toThrow();
    expect(() => parseOpenSessionRow({ ...row, entry_time: "2026-11-03 06:30" })).toThrow();
  });

  it("maps snake_case fields to the CON-09 OpenSessionLike shape", () => {
    expect(toOpenSessionLike(parseOpenSessionRow(row))).toEqual({
      sessionId: UUID.session,
      entryTime: row.entry_time,
      passId: null,
    });
    expect(toOpenSessionLike({ ...row, pass_id: UUID.pass }).passId).toBe(UUID.pass);
  });
});

describe("CON-09 CSV privacy", () => {
  it("excludes the vehicle_no column and value by default (OQ-26)", () => {
    const csv = openSessionsToCsv([row]);
    expect(csv).not.toContain("vehicle_no");
    expect(csv).not.toContain("PLATESECRET");
    expect(csv).toContain('"short_code"');
    expect(csv).toContain('"A12BC"');
  });

  it("includes vehicle numbers only with explicit opt-in", () => {
    const csv = openSessionsToCsv([row], { includeVehicleNumbers: true });
    expect(csv).toContain('"vehicle_no"');
    expect(csv).toContain('"PLATESECRET"');
  });

  it("writes null as an empty cell and escapes quotes, commas and newlines", () => {
    const csv = openSessionsToCsv([
      { ...row, vehicle_class: 'CAR, "large"\ncovered', pass_id: null },
    ]);
    expect(csv).toContain('"CAR, ""large""\ncovered"');
    expect(csv).toContain(`,"",${'"2026-11-03T06:30:00+05:30"'}`);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("returns a header-only CSV for an empty result", () => {
    const csv = openSessionsToCsv([]);
    expect(csv.trim().split("\r\n")).toHaveLength(1);
  });
});
