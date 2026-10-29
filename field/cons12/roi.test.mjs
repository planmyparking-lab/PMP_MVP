import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateBaseline, median, medianPaise, paisePerMonth, staffHoursPerDay } from "./roi.mjs";

const validHours = {
  meanVehicleSeconds: 40,
  dailyVehicles: 600,
  meanShiftCloseSeconds: 1800,
  shiftsPerDay: 2,
  meanDisputeSeconds: 300,
  disputesPerDay: 3,
};

describe("staffHoursPerDay required inputs", () => {
  const fields = Object.keys(validHours);
  it("rejects each missing required field, naming it, and never returns NaN", () => {
    for (const field of fields) {
      const rest = { ...validHours };
      delete rest[field];
      assert.throws(
        () => staffHoursPerDay(rest),
        new RegExp(`${field} must be a non-negative number`),
      );
    }
  });
  it("rejects undefined, null, booleans, strings, NaN, infinities and negatives in every field", () => {
    const bad = [
      undefined,
      null,
      true,
      false,
      "40",
      "",
      " ",
      NaN,
      Infinity,
      -Infinity,
      -1,
      -0.5,
      [],
      {},
    ];
    for (const field of fields) {
      for (const value of bad) {
        assert.throws(
          () => staffHoursPerDay({ ...validHours, [field]: value }),
          new RegExp(`${field} must be a non-negative number`),
          `${field}=${String(value)}`,
        );
      }
    }
  });
  it("rejects a missing or non-object input", () => {
    for (const input of [undefined, null, 5, "x", true]) {
      assert.throws(() => staffHoursPerDay(input), /input must be an object/);
    }
    assert.throws(() => staffHoursPerDay({}), RangeError);
  });
  it("accepts zero in every field", () => {
    const zeros = Object.fromEntries(fields.map((f) => [f, 0]));
    assert.equal(staffHoursPerDay(zeros), 0);
  });
  it("ignores unrelated extra keys", () => {
    assert.equal(
      staffHoursPerDay({ ...validHours, note: "observer A" }),
      staffHoursPerDay(validHours),
    );
  });
  it("refuses a result that overflows to Infinity", () => {
    assert.throws(
      () => staffHoursPerDay({ ...validHours, meanVehicleSeconds: 1e308, dailyVehicles: 1e308 }),
      /not a finite number/,
    );
  });
  it("returns a finite number for valid input", () => {
    assert.ok(Number.isFinite(staffHoursPerDay(validHours)));
  });
});

describe("medianPaise keeps money in integer paise", () => {
  it("returns the middle value for an odd count", () => {
    assert.equal(medianPaise([30000]), 30000);
    assert.equal(medianPaise([10000, 30000, 20000]), 20000);
  });
  it("returns the exact average for an even count when it is a whole number", () => {
    assert.equal(medianPaise([10000, 10002]), 10001);
    assert.equal(medianPaise([7, 7]), 7);
  });
  it("rounds a half paisa up", () => {
    assert.equal(medianPaise([10000, 10001]), 10001);
    assert.equal(medianPaise([10001, 10002]), 10002);
    assert.equal(medianPaise([0, 1]), 1);
    assert.equal(medianPaise([1, 2, 3, 4]), 3);
    assert.equal(medianPaise([4, 1, 2, 3, 9, 8]), 4); // unsorted; sorted 1 2 3 4 8 9, (3 + 4) / 2 = 3.5
  });
  it("is always an integer, even for large amounts", () => {
    const big = Number.MAX_SAFE_INTEGER - 1;
    assert.equal(medianPaise([big, big + 1]), big + 1);
    for (const list of [
      [1, 2],
      [5, 6, 7, 8],
      [100001, 100002],
      [7, 7],
    ]) {
      assert.ok(Number.isInteger(medianPaise(list)));
    }
  });
  it("does not modify its input", () => {
    const input = [3, 1, 2, 4];
    medianPaise(input);
    assert.deepEqual(input, [3, 1, 2, 4]);
  });
  it("rejects empty, negative, fractional, non-numeric and unsafe values", () => {
    assert.throws(() => medianPaise([]), RangeError);
    assert.throws(() => medianPaise(undefined), RangeError);
    for (const bad of [
      -1,
      10.5,
      NaN,
      Infinity,
      "100",
      null,
      undefined,
      true,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      assert.throws(
        () => medianPaise([100, bad]),
        /must be a non-negative integer paise amount/,
        String(bad),
      );
    }
  });
  it("evaluateBaseline reports an integer median paise for an even number of facilities", () => {
    const r = evaluateBaseline({
      facilities: [
        { hoursPerDay: 2, paisePerMonth: 10000 },
        { hoursPerDay: 2, paisePerMonth: 10001 },
      ],
      proposedMonthlyPricePaise: 3000,
    });
    assert.equal(r.medianPaisePerMonth, 10001);
    assert.ok(Number.isInteger(r.medianPaisePerMonth));
  });
});

describe("T-CON-12-U1 computation", () => {
  it("matches the worked example: 6.67 + 1.0 + 0.25 = about 7.9 hours per day", () => {
    const h = staffHoursPerDay({
      meanVehicleSeconds: 40,
      dailyVehicles: 600,
      meanShiftCloseSeconds: 1800,
      shiftsPerDay: 2,
      meanDisputeSeconds: 300,
      disputesPerDay: 3,
    });
    assert.equal(h.toFixed(1), "7.9");
    assert.ok(Math.abs(h - (40 * 600 + 3600 + 900) / 3600) < 1e-12);
  });
  it("rejects negative or non-numeric inputs", () => {
    assert.throws(
      () =>
        staffHoursPerDay({
          meanVehicleSeconds: -1,
          dailyVehicles: 1,
          meanShiftCloseSeconds: 0,
          shiftsPerDay: 0,
          meanDisputeSeconds: 0,
          disputesPerDay: 0,
        }),
      RangeError,
    );
  });
  it("converts to integer paise", () => {
    // 2 hours/day x Rs 50/hour x 26 days = Rs 2,600
    assert.equal(
      paisePerMonth({ hoursPerDay: 2, wagePerHourPaise: 5000, operatingDays: 26 }),
      260000,
    );
    assert.throws(
      () => paisePerMonth({ hoursPerDay: 2, wagePerHourPaise: 50.5, operatingDays: 26 }),
      RangeError,
    );
  });
});

describe("median", () => {
  it("handles odd and even lists", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.throws(() => median([]), RangeError);
  });
});

describe("pass bar and kill criterion (D12)", () => {
  const price = 500000; // Rs 5,000, illustrative only
  const f = (hoursPerDay, paise) => ({ hoursPerDay, paisePerMonth: paise });
  it("passes when median hours >= 1.5 and median value >= 3x price", () => {
    const r = evaluateBaseline({
      facilities: [f(1.5, 1500000), f(2, 2000000), f(3, 3000000)],
      proposedMonthlyPricePaise: price,
    });
    assert.equal(r.result, "pass");
  });
  it("is 'neither' when hours pass but value is under 3x price", () => {
    const r = evaluateBaseline({
      facilities: [f(2, 1400000), f(2, 1400000), f(2, 1400000)],
      proposedMonthlyPricePaise: price,
    });
    assert.equal(r.result, "neither");
  });
  it("compares the exact half-paisa median with the threshold, not its rounded report", () => {
    const below = evaluateBaseline({
      facilities: [f(2, 29999), f(2, 30000)],
      proposedMonthlyPricePaise: 10000,
    });
    assert.equal(below.medianPaisePerMonth, 30000);
    assert.ok(Number.isInteger(below.medianPaisePerMonth));
    assert.equal(below.result, "neither");

    const above = evaluateBaseline({
      facilities: [f(2, 30000), f(2, 30001)],
      proposedMonthlyPricePaise: 10000,
    });
    assert.equal(above.medianPaisePerMonth, 30001);
    assert.ok(Number.isInteger(above.medianPaisePerMonth));
    assert.equal(above.result, "pass");
  });
  it("is 'neither' between 0.75 and 1.5 hours per day", () => {
    const r = evaluateBaseline({
      facilities: [f(1, 9000000), f(1, 9000000), f(1, 9000000)],
      proposedMonthlyPricePaise: price,
    });
    assert.equal(r.result, "neither");
  });
  it("kills when the median is under 0.75 hours per day", () => {
    const r = evaluateBaseline({
      facilities: [f(0.5, 9000000), f(0.7, 9000000), f(4, 9000000)],
      proposedMonthlyPricePaise: price,
    });
    assert.equal(r.result, "kill");
  });
  it("treats exactly 0.75 as not killed", () => {
    const r = evaluateBaseline({ facilities: [f(0.75, 0)], proposedMonthlyPricePaise: price });
    assert.equal(r.result, "neither");
  });
  it("rejects missing facilities or a bad price", () => {
    assert.throws(
      () => evaluateBaseline({ facilities: [], proposedMonthlyPricePaise: price }),
      RangeError,
    );
    assert.throws(
      () => evaluateBaseline({ facilities: [f(1, 1)], proposedMonthlyPricePaise: 0 }),
      RangeError,
    );
  });
  it("rejects malformed facility entries instead of returning 'neither'", () => {
    const bad = (facility) => () =>
      evaluateBaseline({ facilities: [f(2, 2000000), facility], proposedMonthlyPricePaise: price });
    assert.throws(bad({}), /facilities\[1\]\.hoursPerDay/);
    assert.throws(bad({ paisePerMonth: 100 }), /facilities\[1\]\.hoursPerDay/);
    assert.throws(bad({ hoursPerDay: "2", paisePerMonth: 100 }), /hoursPerDay/);
    assert.throws(bad({ hoursPerDay: NaN, paisePerMonth: 100 }), /hoursPerDay/);
    assert.throws(bad({ hoursPerDay: -1, paisePerMonth: 100 }), /hoursPerDay/);
    assert.throws(bad({ hoursPerDay: 2 }), /facilities\[1\]\.paisePerMonth/);
    assert.throws(bad({ hoursPerDay: 2, paisePerMonth: 10.5 }), /paisePerMonth/);
    assert.throws(bad({ hoursPerDay: 2, paisePerMonth: -5 }), /paisePerMonth/);
    assert.throws(bad(null), /facilities\[1\] must be an object/);
    assert.throws(bad(undefined), RangeError);
  });
  it("still returns the medians with valid input", () => {
    const r = evaluateBaseline({
      facilities: [f(1.5, 1500000), f(2, 2000000), f(3, 3000000)],
      proposedMonthlyPricePaise: price,
    });
    assert.deepEqual(r, { result: "pass", medianHoursPerDay: 2, medianPaisePerMonth: 2000000 });
  });
});
