import { test } from "node:test";
import assert from "node:assert/strict";
import { RunnerError } from "./test-db.mjs";
import { assertLocalTarget, compareOracle } from "./seed-demo.mjs";

const expected = [
  {
    name: "Demo Mall (synthetic)",
    stable: { vehicles: 10, exits: 9, overrides: 1, cash: 500, upi: 300, revenue: 800 },
  },
];
const goodRow = {
  name: "Demo Mall (synthetic)",
  vehicles: "10",
  exits: "9",
  overrides: "1",
  cash: "500",
  upi: "300",
  revenue: "800",
};
const goodConflicts = [
  { name: "Demo Mall (synthetic)", type: "DUPLICATE_EXIT", n: 1 },
  { name: "Demo Mall (synthetic)", type: "ORPHAN_EXIT", n: 1 },
];

test("compareOracle accepts matching numbers", () => {
  assert.deepEqual(compareOracle(expected, [goodRow], goodConflicts, { missing: 0 }), []);
});

test("compareOracle reports a wrong total, a missing conflict, an extra conflict and a closed fixture", () => {
  const problems = compareOracle(
    expected,
    [{ ...goodRow, revenue: "799" }],
    [goodConflicts[0], { name: "Demo Mall (synthetic)", type: "CLOCK_SKEW", n: 2 }],
    { missing: 1 },
  );
  assert.equal(problems.length, 4);
  assert.match(problems.join("\n"), /revenue is 799, oracle says 800/);
  assert.match(problems.join("\n"), /0 open ORPHAN_EXIT/);
  assert.match(problems.join("\n"), /unexpected 2 CLOCK_SKEW/);
  assert.match(problems.join("\n"), /1 over-threshold fixture/);
});

test("compareOracle reports a facility with no rows", () => {
  assert.match(compareOracle(expected, [], goodConflicts, { missing: 0 })[0], /no events found/);
});

test("assertLocalTarget refuses a production environment before touching Docker", () => {
  for (const env of [{ NODE_ENV: "production" }, { PMP_ENV: "prod" }]) {
    assert.throws(() => assertLocalTarget(env, "supabase_db_x", "x"), RunnerError);
  }
});

test("assertLocalTarget refuses a remote Docker host", () => {
  assert.throws(
    () => assertLocalTarget({ DOCKER_HOST: "tcp://example:2375" }, "supabase_db_x", "x"),
    RunnerError,
  );
});
