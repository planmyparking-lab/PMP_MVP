import { describe, expect, it } from "vitest";
import { analyse, draftToJson, emptyDraft, exampleDraft } from "../src/lib/setupDraft";

const TODAY = "2026-10-29";

describe("setup wizard analysis", () => {
  it("accepts the example configuration with no errors or warnings", () => {
    const a = analyse(exampleDraft(TODAY), TODAY);
    expect(a.stepErrors).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 });
    expect(a.capacityWarning).toBeNull();
    expect(a.classProblems).toEqual([]);
    expect(a.classWarnings).toEqual([]);
  });

  it("reports a slab gap and an overlap in plain words", () => {
    const d = exampleDraft(TODAY);
    d.tariffs[0].slabs = [
      { from: "0", to: "45", price: "40" },
      { from: "60", to: "180", price: "70" },
    ];
    expect(analyse(d, TODAY).tariffs[0].slabProblems).toEqual([
      "Gap between minute 45 and minute 60.",
    ]);
    d.tariffs[0].slabs[0].to = "90";
    expect(analyse(d, TODAY).tariffs[0].slabProblems[0]).toMatch(/Overlap/);
  });

  it("flags a bad price, a day cap below a slab, and a missing tariff class", () => {
    const d = exampleDraft(TODAY);
    d.tariffs[0].slabs[0].price = "abc";
    expect(analyse(d, TODAY).tariffs[0].slabs[0]).toMatch(/rupees/);
    const e = exampleDraft(TODAY);
    e.tariffs[0].dayCap = "50";
    expect(analyse(e, TODAY).tariffs[0].dayCap).toMatch(/below the highest/);
    const f = exampleDraft(TODAY);
    f.tariffs = f.tariffs.slice(0, 1);
    expect(analyse(f, TODAY).classProblems).toEqual([
      "Zones allow Two-wheeler, but there is no tariff for it.",
    ]);
  });

  it("treats a capacity mismatch as a warning, not an error", () => {
    const d = exampleDraft(TODAY);
    d.slotCount = "200";
    const a = analyse(d, TODAY);
    expect(a.capacityWarning).toMatch(/180/);
    expect(a.stepErrors[1]).toBe(0);
  });

  it("checks grace, night window, start date and overstay", () => {
    const d = exampleDraft(TODAY);
    d.grace = "-1";
    d.nightStart = "22:00";
    d.nightEnd = "22:00";
    d.effectiveFrom = "2026-10-01";
    d.overstay = "10";
    const a = analyse(d, TODAY);
    expect(a.grace).toBeDefined();
    expect(a.night).toBeDefined();
    expect(a.effectiveFrom).toMatch(/past/);
    expect(a.overstay).toMatch(/30/);
    expect(a.stepErrors[3]).toBe(3);
    expect(a.stepErrors[4]).toBe(1);
  });

  it("an empty draft has errors but crashes on nothing", () => {
    const a = analyse(emptyDraft(), TODAY);
    expect(a.stepErrors[1]).toBeGreaterThan(0);
    expect(a.effectiveFrom).toMatch(/Choose/);
  });

  it("the downloadable draft has no PIN and says it is not saved", () => {
    const json = JSON.stringify(draftToJson(exampleDraft(TODAY)));
    expect(json).toContain("Not saved to any facility");
    expect(json.toLowerCase()).not.toContain("pin");
  });
});
