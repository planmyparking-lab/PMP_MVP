import { describe, expect, it } from "vitest";
import { demoReport } from "../src/lib/reports/demoData";
import { buildReportWorkbook } from "../src/lib/reports/excel";
import { FEATURES } from "../src/lib/features";
import { renderReportHtml } from "../src/reports/render";

describe("labelled report demo", () => {
  it("renders and exports, and says it is a demo", async () => {
    const data = demoReport("2026-10-26T01:00:00Z");
    const html = renderReportHtml(data);
    expect(html).toContain("DEMO SAMPLE");
    expect((await buildReportWorkbook(data)).byteLength).toBeGreaterThan(1000);
  });
});

describe("feature status list", () => {
  it("never claims a feature is complete and names what is missing", () => {
    for (const f of FEATURES) {
      expect(["partial", "blocked"]).toContain(f.state);
      expect(f.needs.length).toBeGreaterThan(0);
    }
  });
});
