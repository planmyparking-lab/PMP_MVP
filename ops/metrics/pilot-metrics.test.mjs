import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PACK_SECTIONS,
  adherence,
  checkPackCompleteness,
  drawAuditHours,
  facilityAccuracy,
  rowError,
  sustainedPass,
  weeklyOccupancySummary,
  zoneAccuracy,
} from "./pilot-metrics.mjs";

const row = (visit_id, moment, zone_id, physical_count, system_count) => ({
  visit_id,
  moment,
  zone_id,
  physical_count,
  system_count,
});

describe("T-MET-01-U1 accuracy formulas (hand-computed)", () => {
  // Visit v1, moment 1: zone A physical 100 system 95; zone B physical 50 system 50; zone C physical 0 system 2
  const rows = [row("v1", 1, "A", 100, 95), row("v1", 1, "B", 50, 50), row("v1", 1, "C", 0, 2)];
  it("computes per-row error", () => {
    assert.deepEqual(rowError(rows[0]), { absError: 5, pctError: 0.05, accuracy: 0.95 });
    // physical 0: denominator is max(0, 1) = 1, so 2 vehicles of error gives 200% and accuracy floors at 0
    assert.deepEqual(rowError(rows[2]), { absError: 2, pctError: 2, accuracy: 0 });
  });
  it("computes zone accuracy as the mean of row accuracy", () => {
    assert.equal(zoneAccuracy([row("v1", 1, "A", 100, 95), row("v2", 1, "A", 100, 100)]), 0.975);
  });
  it("computes facility accuracy as 1 - sum(abs error) / sum(physical)", () => {
    // errors 5 + 0 + 2 = 7 over physical 150 -> 1 - 7/150
    assert.ok(Math.abs(facilityAccuracy(rows) - (1 - 7 / 150)) < 1e-12);
  });
  it("averages facility accuracy over rounds", () => {
    const two = [row("v1", 1, "A", 100, 90), row("v1", 2, "A", 100, 100)];
    assert.ok(Math.abs(facilityAccuracy(two) - 0.95) < 1e-12);
  });
  it("keeps rounds apart when visit_id or moment contain a '|' (no key collisions)", () => {
    // A plain "visit|moment" join would give "a|b|1" for both rows and merge them into one round.
    const rows = [
      { visit_id: "a|b", moment: "1", zone_id: "A", physical_count: 100, system_count: 100 },
      { visit_id: "a", moment: "b|1", zone_id: "A", physical_count: 10, system_count: 0 },
    ];
    // two separate rounds: accuracy 1 and 0, mean 0.5 (a merged round would give 1 - 10/110)
    assert.equal(facilityAccuracy(rows), 0.5);
    // the same pair of rows with ordinary ids behaves identically
    const plain = [
      { visit_id: "x", moment: "1", zone_id: "A", physical_count: 100, system_count: 100 },
      { visit_id: "y", moment: "1", zone_id: "A", physical_count: 10, system_count: 0 },
    ];
    assert.equal(facilityAccuracy(plain), facilityAccuracy(rows));
  });
  it("still groups the same visit and moment together, whether moment is 1 or '1'", () => {
    const rows = [
      { visit_id: "v1", moment: 1, zone_id: "A", physical_count: 100, system_count: 90 },
      { visit_id: "v1", moment: "1", zone_id: "B", physical_count: 50, system_count: 50 },
    ];
    // one round: 1 - 10 / 150 (two rounds would give a mean of 0.95)
    assert.ok(Math.abs(facilityAccuracy(rows) - (1 - 10 / 150)) < 1e-12);
  });
  it("scores an empty round as correct only when the system is also empty", () => {
    assert.equal(facilityAccuracy([row("v1", 1, "A", 0, 0)]), 1);
    assert.equal(facilityAccuracy([row("v1", 1, "A", 0, 3)]), 0);
  });
  it("rejects missing or negative counts", () => {
    assert.throws(() => rowError(row("v1", 1, "A", "", 5)), RangeError);
    assert.throws(() => rowError(row("v1", 1, "A", 5, -1)), RangeError);
  });
  it("rejects fractional vehicle counts from numbers and CSV strings", () => {
    for (const value of [5.5, "5.5"]) {
      assert.throws(
        () => rowError(row("v1", 1, "A", value, 5)),
        /physical_count must be a non-negative integer/,
      );
      assert.throws(
        () => rowError(row("v1", 1, "A", 5, value)),
        /system_count must be a non-negative integer/,
      );
    }
  });
});

describe("weekly summary and sustained pass bar", () => {
  const good = weeklyOccupancySummary([row("v1", 1, "A", 100, 98), row("v1", 1, "B", 100, 99)]);
  const bad = weeklyOccupancySummary([row("v1", 1, "A", 100, 80), row("v1", 1, "B", 100, 100)]);
  it("summarises zones and facility", () => {
    assert.equal(good.zoneMin, 0.98);
    assert.equal(good.facility, 1 - 3 / 200);
  });
  it("requires both of the last two weeks to meet both bars", () => {
    assert.equal(sustainedPass([bad, good, good], "min"), true);
    assert.equal(sustainedPass([good, good, bad], "min"), false);
    assert.equal(sustainedPass([good], "min"), false);
  });
  it("makes the zone basis an explicit choice", () => {
    assert.throws(() => sustainedPass([good, good]), RangeError);
    // bad has min zone 0.80 but mean 0.90 and facility 0.90, so it fails either way
    assert.equal(sustainedPass([bad, bad], "mean"), false);
  });
  it("rejects rows with a missing or invalid zone_id instead of inventing a zone", () => {
    const ok = row("v1", 1, "A", 100, 98);
    for (const zone of [undefined, null, "", "   ", 5, {}]) {
      assert.throws(
        () => weeklyOccupancySummary([ok, row("v1", 1, zone, 50, 50)]),
        /zone_id must be a non-blank string \(row 1\)/,
      );
    }
    const noKey = { visit_id: "v1", moment: 1, physical_count: 5, system_count: 5 };
    assert.throws(() => weeklyOccupancySummary([noKey]), RangeError);
  });
  it("lists only zones that have rows and never creates an 'undefined' zone", () => {
    const s = weeklyOccupancySummary([row("v1", 1, "A", 100, 98), row("v2", 1, "A", 100, 100)]);
    assert.deepEqual(Object.keys(s.zones), ["A"]);
    assert.equal("undefined" in s.zones, false);
    assert.equal(s.zones.A, 0.99);
  });
  it("returns nulls for an empty week (no zones are back-filled)", () => {
    assert.deepEqual(weeklyOccupancySummary([]), {
      zones: {},
      zoneMin: null,
      zoneMean: null,
      facility: null,
    });
  });
});

describe("T-MET-02-U1 adherence formula and cap", () => {
  it("reports 92% for 100 independent and 92 system", () => {
    assert.deepEqual(adherence({ independentEntries: 100, systemEntries: 92 }), {
      adherencePct: 92,
      overcount: 0,
    });
  });
  it("caps at 100% and reports the overcount of 5", () => {
    assert.deepEqual(adherence({ independentEntries: 80, systemEntries: 85 }), {
      adherencePct: 100,
      overcount: 5,
    });
  });
  it("has no percentage when nothing was counted independently", () => {
    assert.deepEqual(adherence({ independentEntries: 0, systemEntries: 2 }), {
      adherencePct: null,
      overcount: 2,
    });
  });
  it("accepts numeric strings, as read from a CSV cell", () => {
    assert.deepEqual(adherence({ independentEntries: "100", systemEntries: "92" }), {
      adherencePct: 92,
      overcount: 0,
    });
    assert.deepEqual(adherence({ independentEntries: "80", systemEntries: "85" }), {
      adherencePct: 100,
      overcount: 5,
    });
  });
  it("rejects empty, non-numeric and negative values", () => {
    assert.throws(() => adherence({ independentEntries: "", systemEntries: 5 }), RangeError);
    assert.throws(() => adherence({ independentEntries: "abc", systemEntries: 5 }), RangeError);
    assert.throws(() => adherence({ independentEntries: 10, systemEntries: -1 }), RangeError);
    assert.throws(
      () => adherence({ independentEntries: 10, systemEntries: undefined }),
      RangeError,
    );
  });
  it("rejects fractional entry counts from numbers and CSV strings", () => {
    for (const value of [5.5, "5.5"]) {
      assert.throws(
        () => adherence({ independentEntries: value, systemEntries: 5 }),
        /independent_entries must be a non-negative integer/,
      );
      assert.throws(
        () => adherence({ independentEntries: 5, systemEntries: value }),
        /system_entries must be a non-negative integer/,
      );
    }
  });
});

describe("blank cell regression: whitespace-only is not zero", () => {
  const blanks = ["", " ", "   ", "\t", "\n", " \t "];
  it("rejects blank strings in adherence and rowError alike", () => {
    for (const blank of blanks) {
      assert.throws(() => adherence({ independentEntries: blank, systemEntries: 5 }), RangeError);
      assert.throws(() => adherence({ independentEntries: 10, systemEntries: blank }), RangeError);
      assert.throws(() => rowError(row("v1", 1, "A", blank, 5)), RangeError);
      assert.throws(() => rowError(row("v1", 1, "A", 5, blank)), RangeError);
    }
  });
  it("keeps valid zero as 0 for both number and string input", () => {
    assert.deepEqual(adherence({ independentEntries: 0, systemEntries: 0 }), {
      adherencePct: null,
      overcount: 0,
    });
    assert.deepEqual(adherence({ independentEntries: "0", systemEntries: "0" }), {
      adherencePct: null,
      overcount: 0,
    });
    assert.deepEqual(rowError(row("v1", 1, "A", 0, 0)), { absError: 0, pctError: 0, accuracy: 1 });
    assert.deepEqual(rowError(row("v1", 1, "A", "0", "0")), {
      absError: 0,
      pctError: 0,
      accuracy: 1,
    });
  });
  it("keeps valid numeric strings working, including padded ones", () => {
    assert.deepEqual(adherence({ independentEntries: "100", systemEntries: "92" }), {
      adherencePct: 92,
      overcount: 0,
    });
    assert.deepEqual(adherence({ independentEntries: " 100 ", systemEntries: "92" }), {
      adherencePct: 92,
      overcount: 0,
    });
    assert.deepEqual(rowError(row("v1", 1, "A", "100", "95")), {
      absError: 5,
      pctError: 0.05,
      accuracy: 0.95,
    });
  });
  it("rejects booleans instead of converting them to 1 and 0", () => {
    for (const flag of [true, false]) {
      assert.throws(() => adherence({ independentEntries: flag, systemEntries: 5 }), RangeError);
      assert.throws(() => adherence({ independentEntries: 10, systemEntries: flag }), RangeError);
      assert.throws(() => rowError(row("v1", 1, "A", flag, 5)), RangeError);
      assert.throws(() => rowError(row("v1", 1, "A", 5, flag)), RangeError);
      assert.throws(() => facilityAccuracy([row("v1", 1, "A", flag, 5)]), RangeError);
    }
    assert.throws(() => rowError(row("v1", 1, "A", true, 5)), /physical_count.*true/);
    assert.throws(() => rowError(row("v1", 1, "A", 5, false)), /system_count.*false/);
  });
  it("accepts only plain non-negative integer text from a CSV cell", () => {
    const accepted = ["0", "7", "92", " 100 ", "007"];
    for (const text of accepted) {
      assert.equal(rowError(row("v1", 1, "A", text, text)).absError, 0, JSON.stringify(text));
    }
    const rejected = [
      "0x10",
      "1e3",
      "1E3",
      "+5",
      "-1",
      "-0",
      ".5",
      "5.",
      "5.5",
      "0.0",
      "1,000",
      "Infinity",
      "NaN",
      "12abc",
      "٣",
    ];
    for (const text of rejected) {
      assert.throws(
        () => rowError(row("v1", 1, "A", text, 5)),
        /physical_count must be a non-negative integer/,
        JSON.stringify(text),
      );
    }
  });
  it("rejects arrays, objects, functions and dates that Number() would convert", () => {
    for (const value of [[9], [], {}, () => 9, new Date(9)]) {
      assert.throws(() => adherence({ independentEntries: value, systemEntries: 5 }), RangeError);
    }
  });
  it("applies the same contract to adherence and rowError", () => {
    for (const value of ["0x10", "1e3", "+5", true, null, undefined, " ", NaN, Infinity, -1]) {
      assert.throws(() => adherence({ independentEntries: value, systemEntries: 5 }), RangeError);
      assert.throws(() => rowError(row("v1", 1, "A", value, 5)), RangeError);
    }
  });
  it("still rejects non-numeric strings and negatives", () => {
    assert.throws(() => rowError(row("v1", 1, "A", "abc", 5)), RangeError);
    assert.throws(() => rowError(row("v1", 1, "A", "-1", 5)), RangeError);
  });
});

describe("T-MET-02-N1 random hour draw", () => {
  const candidates = [];
  for (const date of ["2026-11-02", "2026-11-03", "2026-11-04"]) {
    for (let hour = 8; hour <= 20; hour++) candidates.push({ date, hour });
  }
  it("draws only open hours, across at least two days, including a peak hour", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const picked = drawAuditHours({ candidates, seed, peakHours: [11, 12, 17, 18] });
      assert.equal(picked.length, 3);
      assert.ok(picked.every((p) => p.hour >= 8 && p.hour <= 20));
      assert.ok(new Set(picked.map((p) => p.date)).size >= 2);
      assert.ok(picked.some((p) => [11, 12, 17, 18].includes(p.hour)));
    }
  });
  it("is reproducible for the same seed", () => {
    assert.deepEqual(
      drawAuditHours({ candidates, seed: 7 }),
      drawAuditHours({ candidates, seed: 7 }),
    );
  });
  it("refuses impossible draws", () => {
    assert.throws(
      () =>
        drawAuditHours({ candidates: candidates.filter((c) => c.date === "2026-11-02"), seed: 1 }),
      RangeError,
    );
  });
  it("never draws the same hour twice when candidates contain duplicates", () => {
    const duplicated = [...candidates, ...candidates, { date: "2026-11-02", hour: 8 }];
    for (let seed = 1; seed <= 200; seed++) {
      const picked = drawAuditHours({ candidates: duplicated, seed, count: 5 });
      const keys = picked.map((p) => `${p.date}|${p.hour}`);
      assert.equal(new Set(keys).size, 5);
    }
  });
  it("gives the same draw for a duplicated list as for the de-duplicated list", () => {
    const duplicated = [...candidates, ...candidates];
    for (const seed of [1, 7, 42]) {
      assert.deepEqual(
        drawAuditHours({ candidates: duplicated, seed }),
        drawAuditHours({ candidates, seed }),
      );
    }
  });
  it("fails clearly when fewer distinct hours remain than the count", () => {
    const dup = [
      { date: "2026-11-02", hour: 9 },
      { date: "2026-11-02", hour: 9 },
      { date: "2026-11-03", hour: 9 },
      { date: "2026-11-03", hour: 9 },
    ];
    assert.throws(
      () => drawAuditHours({ candidates: dup, seed: 1 }),
      /not enough distinct open hours/,
    );
  });
  it("checks the two-day rule after removing duplicates", () => {
    const oneDay = [
      { date: "2026-11-02", hour: 9 },
      { date: "2026-11-02", hour: 10 },
      { date: "2026-11-02", hour: 11 },
      { date: "2026-11-03", hour: 9 },
      { date: "2026-11-03", hour: 9 },
    ];
    const picked = drawAuditHours({ candidates: oneDay, seed: 3 });
    assert.equal(new Set(picked.map((p) => `${p.date}|${p.hour}`)).size, 3);
    assert.ok(new Set(picked.map((p) => p.date)).size >= 2);
  });
});

describe("drawAuditHours input validation", () => {
  const good = [
    { date: "2026-11-02", hour: 9 },
    { date: "2026-11-02", hour: 10 },
    { date: "2026-11-03", hour: 9 },
    { date: "2026-11-03", hour: 10 },
  ];
  const draw = (over) => () => drawAuditHours({ candidates: good, seed: 1, ...over });

  it("rejects an unsupported count with a clear message", () => {
    for (const count of [
      0,
      1,
      -1,
      -3,
      2.5,
      3.0000001,
      NaN,
      Infinity,
      -Infinity,
      "3",
      null,
      true,
      {},
    ]) {
      assert.throws(draw({ count }), /count must be an integer of at least 2/, String(count));
    }
  });
  it("accepts the default of 3 and the smallest supported count of 2", () => {
    assert.equal(drawAuditHours({ candidates: good, seed: 1 }).length, 3);
    assert.equal(drawAuditHours({ candidates: good, seed: 1, count: 2 }).length, 2);
    assert.equal(drawAuditHours({ candidates: good, seed: 1, count: 4 }).length, 4);
  });
  it("still fails when count exceeds the distinct hours available", () => {
    assert.throws(draw({ count: 5 }), /not enough distinct open hours/);
  });

  it("rejects candidates that are not an array", () => {
    for (const candidates of [undefined, null, "2026-11-02", 5, {}]) {
      assert.throws(draw({ candidates }), /candidates must be an array/);
    }
  });
  it("rejects candidate entries that are not objects", () => {
    for (const bad of [null, undefined, 5, "2026-11-02|9", [], ["2026-11-02", 9], true]) {
      assert.throws(draw({ candidates: [...good, bad] }), /candidates\[4\] must be an object/);
    }
  });
  it("rejects missing, malformed and impossible dates, naming the candidate", () => {
    const badDates = [
      undefined,
      null,
      "",
      20261102,
      "2026-1-5",
      "26-11-02",
      "2026/11/02",
      " 2026-11-02",
      "2026-11-02T00:00:00Z",
      "2026-13-01",
      "2026-00-10",
      "2026-11-31",
      "2026-02-29",
      "2026-02-30",
      new Date("2026-11-02"),
    ];
    for (const date of badDates) {
      assert.throws(
        draw({ candidates: [...good, { date, hour: 9 }] }),
        /candidates\[4\]\.date must be a real yyyy-mm-dd date/,
        String(date),
      );
    }
    assert.throws(draw({ candidates: [...good, { hour: 9 }] }), /candidates\[4\]\.date/);
  });
  it("accepts real calendar boundaries, including a leap day and a year end", () => {
    const edges = [
      { date: "2024-02-29", hour: 0 },
      { date: "2026-12-31", hour: 23 },
      { date: "2027-01-01", hour: 12 },
    ];
    const picked = drawAuditHours({ candidates: edges, seed: 5 });
    assert.equal(picked.length, 3);
  });
  it("rejects missing and invalid hours, naming the candidate", () => {
    const badHours = [undefined, null, -1, 24, 25, 8.5, NaN, Infinity, "9", "09", true, [9]];
    for (const hour of badHours) {
      assert.throws(
        draw({ candidates: [...good, { date: "2026-11-03", hour }] }),
        /candidates\[4\]\.hour must be an integer from 0 to 23/,
        String(hour),
      );
    }
    assert.throws(draw({ candidates: [...good, { date: "2026-11-03" }] }), /candidates\[4\]\.hour/);
  });
  it("applies the century leap-year rule to dates", () => {
    const withDate = (date) => ({
      candidates: [...good, { date, hour: 9 }],
    });
    assert.doesNotThrow(draw(withDate("2000-02-29")));
    assert.doesNotThrow(draw(withDate("2024-02-29")));
    assert.throws(draw(withDate("2100-02-29")), /candidates\[4\]\.date/);
    assert.throws(draw(withDate("2026-02-29")), /candidates\[4\]\.date/);
  });
  it("accepts hour 0 and hour 23", () => {
    const picked = drawAuditHours({
      candidates: [
        { date: "2026-11-02", hour: 0 },
        { date: "2026-11-02", hour: 23 },
        { date: "2026-11-03", hour: 0 },
        { date: "2026-11-03", hour: 23 },
      ],
      seed: 2,
    });
    assert.equal(picked.length, 3);
    assert.ok(picked.every((p) => p.hour === 0 || p.hour === 23));
  });
  it("validates before drawing, so one bad candidate fails the whole draw", () => {
    assert.throws(
      () => drawAuditHours({ candidates: [{ date: "2026-11-02", hour: 25 }], seed: 1 }),
      /hour must be an integer from 0 to 23/,
    );
  });
  it("keeps seeded results identical for valid input", () => {
    const first = drawAuditHours({ candidates: good, seed: 11 });
    assert.deepEqual(drawAuditHours({ candidates: good, seed: 11 }), first);
    assert.deepEqual(drawAuditHours({ candidates: [...good, good[0]], seed: 11 }), first);
  });
});

describe("T-MET-03-U1 / N1 pack completeness", () => {
  const full = PACK_SECTIONS.map((t, i) => `## ${i + 1}. ${t}\n\nContent for ${t}.\n`).join("\n");
  it("accepts a pack with all 10 sections filled", () => {
    assert.deepEqual(checkPackCompleteness(full), { complete: true, problems: [] });
  });
  it("flags a missing section", () => {
    const r = checkPackCompleteness(full.replace("## 5. Conflicts", "## Conflicts"));
    assert.equal(r.complete, false);
    assert.match(r.problems[0], /section 5/);
  });
  it("flags an empty section and a TODO, but accepts 'Missing: reason'", () => {
    const empty = checkPackCompleteness(full.replace("Content for Cloud.", ""));
    assert.match(empty.problems.join(), /section 8/);
    const todo = checkPackCompleteness(full.replace("Content for Cloud.", "TODO: fill"));
    assert.match(todo.problems.join(), /TODO/);
    const missing = checkPackCompleteness(
      full.replace("Content for Cloud.", "Missing: Supabase bill not available yet."),
    );
    assert.equal(missing.complete, true);
  });
});
