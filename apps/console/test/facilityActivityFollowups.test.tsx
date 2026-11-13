import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityView } from "../src/components/ActivityView";
import { FacilityView } from "../src/components/FacilityView";
import type { ActivityLive } from "../src/lib/data/activity";
import type { FacilityConfigLive } from "../src/lib/data/facilityConfig";
import { localDate } from "../src/lib/data/localDay";
import { effectiveDateMismatch, tariffStatuses } from "../src/lib/facilityConfig";
import { probeLimit, referenceProblems, takeLimited } from "../src/lib/readLimits";

// Follow-ups from the PR #41 review (Akanksha): IST effective dates, pass ordering, truncation messages,
// reference-data errors and tariff version identification.

describe("truncation is only reported when rows were really cut", () => {
  it("asks for one extra row and keeps exactly the limit", () => {
    expect(probeLimit(500)).toBe(501);
    const exactly = takeLimited(
      Array.from({ length: 500 }, (_, i) => i),
      500,
    );
    expect(exactly).toMatchObject({ truncated: false });
    expect(exactly.rows).toHaveLength(500);
    const more = takeLimited(
      Array.from({ length: 501 }, (_, i) => i),
      500,
    );
    expect(more.truncated).toBe(true);
    expect(more.rows).toHaveLength(500);
    expect(more.rows.at(-1)).toBe(499);
    expect(takeLimited(null, 10)).toEqual({ rows: [], truncated: false });
  });
});

describe("failed name lookups are reported, not hidden", () => {
  it("lists only the lookups that failed", () => {
    expect(
      referenceProblems([
        ["guard names", { message: "permission denied for table staff" }],
        ["phone names", null],
        ["zone names", undefined],
      ]),
    ).toEqual(["guard names: permission denied for table staff"]);
    expect(referenceProblems([["guard names", null]])).toEqual([]);
  });
});

describe("tariff versions", () => {
  const now = "2026-11-13T06:00:00Z";
  const rows = [
    { id: "car-old", vehicleClass: "Car", effectiveFrom: "2026-01-01T00:00:00+05:30" },
    { id: "car-now", vehicleClass: "Car", effectiveFrom: "2026-11-01T00:00:00+05:30" },
    { id: "car-next", vehicleClass: "Car", effectiveFrom: "2026-12-01T00:00:00+05:30" },
    { id: "bike-now", vehicleClass: "Bike", effectiveFrom: "2026-06-01T00:00:00+05:30" },
    { id: "broken", vehicleClass: "Bike", effectiveFrom: "not a date" },
  ];

  it("marks per class which version is in force, which starts later and which was replaced", () => {
    expect(tariffStatuses(rows, now)).toEqual({
      "car-old": "replaced",
      "car-now": "current",
      "car-next": "scheduled",
      "bike-now": "current",
      broken: "unknown",
    });
  });

  it("a class whose only version starts later has nothing in force", () => {
    expect(tariffStatuses([rows[2]!], now)).toEqual({ "car-next": "scheduled" });
  });

  it("reads the start day in the facility's time zone, not from the UTC text", () => {
    // Midnight IST on 1 Nov is 31 Oct in UTC; slicing the ISO string would show the wrong day.
    expect(localDate("2026-10-31T18:30:00+00:00", "Asia/Kolkata")).toBe("2026-11-01");
  });

  it("warns when the rule and the row start on different days", () => {
    expect(effectiveDateMismatch("2026-11-01", "2026-11-01")).toBeNull();
    expect(effectiveDateMismatch("2026-10-31", "2026-11-01")).toBe(
      "The rule starts on 2026-11-01, the tariff row on 2026-10-31. The gate phones use the rule's date.",
    );
    expect(effectiveDateMismatch(null, "2026-11-01")).toBeNull();
  });
});

const facility = {
  id: "f1",
  orgId: "o1",
  name: "Demo Mall",
  timezone: "Asia/Kolkata",
  slotCount: 340,
};

function facilityLive(over: Partial<FacilityConfigLive> = {}): FacilityConfigLive {
  return {
    facility,
    asOf: "2026-11-13T06:00:00Z",
    zones: { ok: true, data: [] },
    tariffs: {
      ok: true,
      data: [
        {
          id: "0192f0a0-0000-7000-9000-00000000a001",
          vehicleClass: "Car",
          effectiveDate: "2026-11-01",
          status: "current",
          dateWarning: null,
          summary: {
            ok: true,
            model: "FLAT",
            lines: ["₹50.00 for every started 24 h"],
            effectiveFrom: "2026-11-01",
            effectiveTo: null,
          },
        },
        {
          id: "0192f0a0-0000-7000-9000-00000000a002",
          vehicleClass: "Car",
          effectiveDate: "2026-12-01",
          status: "scheduled",
          dateWarning:
            "The rule starts on 2026-12-02, the tariff row on 2026-12-01. The gate phones use the rule's date.",
          summary: {
            ok: true,
            model: "FLAT",
            lines: ["₹60.00 for every started 24 h"],
            effectiveFrom: "2026-12-02",
            effectiveTo: null,
          },
        },
      ],
    },
    passes: {
      ok: true,
      data: [
        { id: "p1", plate: "MH••••••34", validTo: "2026-11-15", duesPaise: 0, state: "expiring" },
        { id: "p2", plate: "KA••••••01", validTo: "2026-10-01", duesPaise: 5000, state: "expired" },
      ],
    },
    passCounts: { ok: true, data: { valid: 812, expired: 64 } },
    passesTruncated: false,
    expiredTruncated: false,
    ...over,
  };
}

describe("Facility page", () => {
  it("labels tariff versions, shows the short id and the date warning", () => {
    const html = renderToStaticMarkup(<FacilityView live={facilityLive()} />);
    expect(html).toContain("In force");
    expect(html).toContain("Starts later");
    // The random tail, not the timestamp head that two versions created together would share.
    expect(html).toContain("id …0000a001");
    expect(html).toContain("id …0000a002");
    expect(html).not.toContain(">id 0192f0a0");
    expect(html).toContain("The gate phones use the rule&#x27;s date.");
  });

  it("uses the exact pass counts from the database, not the rows shown", () => {
    const html = renderToStaticMarkup(<FacilityView live={facilityLive()} />);
    expect(html).toContain("812");
    expect(html).toContain("Valid today; 64 expired");
    expect(html).not.toContain("Not every pass is listed");
  });

  it("says which passes are left out when a list is cut", () => {
    const html = renderToStaticMarkup(
      <FacilityView live={facilityLive({ passesTruncated: true, expiredTruncated: true })} />,
    );
    expect(html).toContain("Not every pass is listed");
    expect(html).toContain("Only the 500 valid passes that expire soonest are listed.");
    expect(html).toContain("Only the 50 most recently expired passes are listed.");
    expect(html).toContain("Owed on the passes shown below");
  });

  it("does not invent counts when they could not be read", () => {
    const html = renderToStaticMarkup(
      <FacilityView
        live={facilityLive({ passCounts: { ok: false, error: "pass counts: denied" } })}
      />,
    );
    expect(html).toContain("Counts could not be read");
  });
});

describe("Activity page", () => {
  const live = (referenceErrors: string[], truncated = false): ActivityLive => ({
    facilityName: "Demo Mall",
    asOf: "2026-11-13T06:00:00Z",
    lines: { ok: true, data: [] },
    truncated,
    referenceErrors,
    staffNames: {},
    deviceNames: {},
    filter: { type: null, sessionId: null, eventIds: [] },
  });

  it("warns when guard, phone or zone names could not be read", () => {
    const html = renderToStaticMarkup(
      <ActivityView live={live(["guard names: permission denied for table staff"])} />,
    );
    expect(html).toContain("Some names could not be read");
    expect(html).toContain("guard names: permission denied for table staff");
    expect(renderToStaticMarkup(<ActivityView live={live([])} />)).not.toContain(
      "Some names could not be read",
    );
  });

  it("says more events matched only when the list was cut", () => {
    expect(renderToStaticMarkup(<ActivityView live={live([], true)} />)).toContain(
      "More than 500 events match",
    );
  });
});
