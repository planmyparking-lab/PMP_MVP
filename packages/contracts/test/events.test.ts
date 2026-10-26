import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVENT_TYPES,
  SCHEMA_VERSION,
  SESSION_EVENT_TYPES,
  newId,
  parseEvent,
  type EventType,
} from "../src/index";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Fixture = { name: string; json: Json };

const root = fileURLToPath(new URL("../fixtures/events", import.meta.url));
const load = (dir: string): Fixture[] =>
  readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ name: f, json: JSON.parse(readFileSync(join(root, dir, f), "utf8")) as Json }));

describe("valid fixtures (T-SYNC-01-U1)", () => {
  const valid = load("valid");

  it("has two samples for every event type", () => {
    for (const t of EVENT_TYPES) {
      expect(valid.filter((v) => v.json.type === t).length, t).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(valid.map((v): [string, Json] => [v.name, v.json]))(
    "%s parses and round-trips",
    (_n, json) => {
      const r = parseEvent(json);
      expect(r.ok).toBe(true);
      if (r.ok) expect(JSON.parse(JSON.stringify(r.value))).toEqual(json);
    },
  );
});

describe("invalid fixtures (T-SYNC-01-U2, N1)", () => {
  const invalid = load("invalid");

  it("has at least 10 samples", () => {
    expect(invalid.length).toBeGreaterThanOrEqual(10);
  });

  it.each(invalid.map((v): [string, Json] => [v.name, v.json]))(
    "%s is rejected with the failing path",
    (_n, json) => {
      const r = parseEvent(json.event);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.issues.length).toBeGreaterThan(0);
        expect(r.issues.map((i) => i.path)).toContain(json.expect_path);
        expect("value" in r).toBe(false); // never a partial object
      }
    },
  );
});

describe("rules (T-SYNC-01-U3, U4, N1)", () => {
  const entry = load("valid").find((v) => v.name === "entry-1.json")!.json;
  const payment = load("valid").find((v) => v.name === "payment-1.json")!.json;
  const override = load("valid").find((v) => v.name === "override-1.json")!.json;

  it("upi_attested is only valid with mode UPI", () => {
    const p = { ...payment, payload: { ...payment.payload, upi_attested: true } };
    expect(parseEvent(p).ok).toBe(false);
    expect(parseEvent({ ...p, payload: { ...p.payload, mode: "UPI" } }).ok).toBe(true);
  });

  it("OTHER requires a note; with a note it is accepted", () => {
    const o = { ...override, payload: { ...override.payload, reason_code: "OTHER" } };
    expect(parseEvent(o).ok).toBe(false);
    expect(parseEvent({ ...o, payload: { ...o.payload, note: "x" } }).ok).toBe(true);
    expect(parseEvent({ ...o, payload: { ...o.payload, note: "   " } }).ok).toBe(false);
  });

  it("session_id is required for session events and null for the others", () => {
    const ok = new Set<EventType>();
    for (const v of load("valid")) {
      const e = v.json;
      const needs = (SESSION_EVENT_TYPES as readonly string[]).includes(e.type);
      expect(e.session_id === null, v.name).toBe(!needs);
      ok.add(e.type);
    }
    expect(ok.size).toBe(EVENT_TYPES.length);
  });

  it("unknown extra keys are rejected, not stripped (documented rule)", () => {
    expect(parseEvent({ ...entry, extra: 1 }).ok).toBe(false);
    expect(parseEvent({ ...entry, payload: { ...entry.payload, extra: 1 } }).ok).toBe(false);
  });

  it("non-object input returns an issue, not a throw", () => {
    for (const bad of [null, undefined, 5, "x", []]) {
      const r = parseEvent(bad);
      expect(r.ok).toBe(false);
    }
  });

  it("accepts freshly generated UUIDv7 ids", () => {
    const r = parseEvent({ ...entry, id: newId() });
    expect(r.ok).toBe(true);
  });

  it("schema_version must be a positive integer within bounds", () => {
    expect(parseEvent({ ...entry, schema_version: SCHEMA_VERSION }).ok).toBe(true);
    expect(parseEvent({ ...entry, schema_version: 32768 }).ok).toBe(false);
    expect(parseEvent({ ...entry, schema_version: 1.5 }).ok).toBe(false);
  });

  it("PAYMENT_CORRECTION is not an accepted type (OQ-30 open)", () => {
    expect((EVENT_TYPES as readonly string[]).includes("PAYMENT_CORRECTION")).toBe(false);
    expect(parseEvent({ ...entry, type: "PAYMENT_CORRECTION" }).ok).toBe(false);
  });
});
