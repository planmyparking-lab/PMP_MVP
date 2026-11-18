import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ConflictsView opens a dialog that imports a server action; it is not called when rendering.
vi.mock("../app/conflicts/actions", () => ({ addConflictNote: vi.fn() }));
import { ConflictsView } from "../src/components/ConflictsView";
import { parseSyncConflictRow } from "../src/lib/conflicts";

const NOW = "2026-11-03T12:00:00Z";
const row = parseSyncConflictRow({
  id: "00000000-0000-4000-8000-000000000021",
  facility_id: "00000000-0000-4000-8000-000000000022",
  type: "CLOCK_SKEW",
  event_ids: ["00000000-0000-4000-8000-000000000023"],
  session_id: null,
  dedupe_key: "00000000-0000-4000-8000-000000000023",
  status: "OPEN",
  detail: { skew_seconds: 301 },
  created_at: "2026-11-02T11:59:59Z",
  resolved_by: null,
  resolved_at: null,
});

describe("ConflictsView row props", () => {
  it("renders supplied rows and keeps all resolution actions unavailable", () => {
    const html = renderToStaticMarkup(<ConflictsView rows={[row]} nowIso={NOW} />);
    expect(html).toContain(row.facility_id);
    expect(html).toContain("Over 24 hours");
    expect(html).toContain("Add note");
    expect(html).toContain("Acknowledge");
    expect(html).not.toContain("Keep first");
    expect(html).toContain('aria-disabled="true"');
  });

  it("renders an honest disconnected state for an empty supplied result", () => {
    const html = renderToStaticMarkup(<ConflictsView rows={[]} nowIso={NOW} />);
    expect(html).toContain("Live conflict query is not connected yet");
    expect(html).toContain("no conflicts are invented");
  });
});
