import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateBaseline, median, paisePerMonth, staffHoursPerDay } from "./roi.mjs";

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
