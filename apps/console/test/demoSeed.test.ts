import { describe, expect, it } from "vitest";
import { parseEvent, parseTariff } from "@pmp/contracts";
import { fare } from "@pmp/domain";
// T-CON-11: the demo seed generator (supabase/seed). Plain JavaScript so the loader runs on Node without a build.
import {
  FACILITIES,
  STABLE_DAYS,
  fareFor,
  generate,
  oracle,
  oracleMarkdown,
  toSql,
} from "../../../supabase/seed/generate.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const data = generate();
const iso = (ms: number) => new Date(ms).toISOString();

describe("CON-11 demo seed generator", () => {
  it("is deterministic: the same seed gives identical SQL", () => {
    expect(toSql(generate())).toBe(toSql(data));
  });

  it("matches the committed ORACLE.md (regenerate it when the generator changes)", () => {
    const path = fileURLToPath(new URL("../../../supabase/seed/ORACLE.md", import.meta.url));
    expect(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).toBe(oracleMarkdown(data));
  });

  it("builds three facilities: a mall, a market and a hospital", () => {
    expect(data.facilities.map((f: { spec: { key: string } }) => f.spec.key)).toEqual([
      "mall",
      "market",
      "hospital",
    ]);
  });

  it("uses only clearly synthetic plates (XX- prefix)", () => {
    for (const e of data.events) {
      const plate = (e.payload as { vehicle_no?: string }).vehicle_no;
      if (plate !== undefined) expect(plate).toMatch(/^XX-[A-Z]{2}-[A-Z0-9]{4}$/);
    }
    for (const f of data.facilities) for (const p of f.passes) expect(p.vehicleNo).toMatch(/^XX-/);
  });

  it("every event passes the IC-01 contract", () => {
    const failures = data.events
      .map((e: Record<string, unknown> & { minute: number; delayS: number }) => ({
        e,
        r: parseEvent({
          id: e.id,
          facility_id: e.facility,
          device_id: e.device,
          staff_id: e.staff,
          type: e.type,
          session_id: e.session,
          payload: e.payload,
          device_time: iso(Date.parse("2026-10-06T18:30:00Z") + e.minute * 60_000),
          source: "LIVE",
          schema_version: 1,
        }),
      }))
      .filter((x: { r: { ok: boolean } }) => !x.r.ok);
    expect(failures.slice(0, 3)).toEqual([]);
  });

  it("every tariff rule passes the IC-04 contract", () => {
    for (const f of data.facilities)
      for (const t of Object.values(f.tariffs) as { rule: unknown }[])
        expect(parseTariff(t.rule).ok).toBe(true);
  });

  it("fares agree with @pmp/domain fare() for every demo tariff", () => {
    const entry = "2026-11-02T04:30:00.000Z";
    const durations = [
      0, 1, 5, 10, 15, 16, 30, 31, 59, 60, 61, 120, 121, 179, 180, 181, 600, 1439, 1440, 1441, 1800,
      3000,
    ];
    for (const spec of FACILITIES) {
      for (const [cls, rule] of Object.entries(spec.tariffs)) {
        const tariff = {
          id: "0192f0a0-0000-7000-9000-00000000a001",
          facilityId: spec.key,
          vehicleClass: cls,
          effectiveFrom: "2026-01-01",
          ...(rule as object),
        };
        for (const d of durations) {
          const exit = iso(Date.parse(entry) + d * 60_000);
          expect([spec.key, cls, d, fareFor(tariff, d)]).toEqual([
            spec.key,
            cls,
            d,
            fare(tariff as never, entry, exit, cls),
          ]);
        }
      }
    }
  });

  it("contains each edge fixture once per facility", () => {
    const kinds = data.fixtures.map(
      (x: { facility: string; kind: string }) => `${x.facility}:${x.kind}`,
    );
    for (const f of ["mall", "market", "hospital"]) {
      expect(kinds.filter((k: string) => k === `${f}:DUPLICATE_EXIT`)).toHaveLength(1);
      expect(kinds.filter((k: string) => k === `${f}:ORPHAN_EXIT`)).toHaveLength(1);
      expect(kinds.filter((k: string) => k === `${f}:BAD_SHIFT_VARIANCE`)).toHaveLength(1);
      expect(
        kinds.filter((k: string) => k === `${f}:OPEN_OVER_THRESHOLD`).length,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("has overrides and integer-paise revenue in the oracle window of every facility", () => {
    for (const f of oracle(data)) {
      expect(f.stable.vehicles).toBeGreaterThan(STABLE_DAYS.to - STABLE_DAYS.from);
      expect(f.stable.overrides).toBeGreaterThan(0);
      expect(Number.isSafeInteger(f.stable.revenue)).toBe(true);
    }
  });

  it("refuses to run unless the loader set the local-only flag", () => {
    const sql = toSql(data);
    expect(sql).toContain("current_setting('pmp.demo_seed', true)");
    expect(sql.indexOf("demo seed refused")).toBeLessThan(
      sql.indexOf("insert into public.organizations"),
    );
  });
});
