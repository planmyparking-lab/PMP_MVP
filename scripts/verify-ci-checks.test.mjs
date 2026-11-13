// Tests for the production release gate. The behavioural tests run the real script with check runs on stdin, so they
// show that production cannot be released when `db-tests` (or `check`) failed, was skipped, is missing or unfinished.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";
import { evaluateChecks, parseArgs, parseRuns } from "./verify-ci-checks.mjs";

const script = fileURLToPath(new URL("./verify-ci-checks.mjs", import.meta.url));
const REQUIRED = ["--require", "check", "--require", "db-tests"];
const run = (name, conclusion, status = "completed") => ({ name, conclusion, status });
const lines = (...runs) => runs.map((r) => JSON.stringify(r)).join("\n") + "\n";
const gate = (stdin, args = REQUIRED) =>
  spawnSync(process.execPath, [script, ...args], { input: stdin, encoding: "utf8" });

test("passes when check and db-tests both succeeded (other jobs are ignored)", () => {
  const r = gate(
    lines(run("check", "success"), run("db-tests", "success"), run("audit", "failure")),
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ok\s+check: success/);
  assert.match(r.stdout, /ok\s+db-tests: success/);
});

test("blocks when db-tests failed", () => {
  const r = gate(lines(run("check", "success"), run("db-tests", "failure")));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /db-tests/);
  assert.match(r.stdout, /FAIL db-tests: not successful \(failure\)/);
});

test("blocks when db-tests was skipped", () => {
  const r = gate(lines(run("check", "success"), run("db-tests", "skipped")));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL db-tests: not successful \(skipped\)/);
});

test("blocks when db-tests never ran for the commit", () => {
  const r = gate(lines(run("check", "success")));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL db-tests: no run found/);
});

test("blocks when db-tests has not finished (conclusion null)", () => {
  const r = gate(lines(run("check", "success"), run("db-tests", null, "in_progress")));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL db-tests: not successful \(in_progress\)/);
});

test("still blocks when only check failed or is missing", () => {
  assert.equal(gate(lines(run("check", "failure"), run("db-tests", "success"))).status, 1);
  assert.equal(gate(lines(run("db-tests", "success"))).status, 1);
});

test("blocks on cancelled, timed out and neutral conclusions", () => {
  for (const conclusion of ["cancelled", "timed_out", "neutral", "action_required"]) {
    assert.equal(gate(lines(run("check", "success"), run("db-tests", conclusion))).status, 1);
  }
});

test("one failing run blocks even if another run of the same job succeeded", () => {
  const r = gate(
    lines(run("check", "success"), run("db-tests", "success"), run("db-tests", "failure")),
  );
  assert.equal(r.status, 1);
});

test("empty input fails closed (a broken API call must not allow a release)", () => {
  assert.equal(gate("").status, 1);
  assert.equal(gate("\n\n").status, 1);
});

test("malformed input and bad arguments are errors, never a pass", () => {
  assert.equal(gate("not json\n").status, 2);
  assert.equal(gate(lines(run("check", "success")), []).status, 2);
  assert.equal(gate(lines(run("check", "success")), ["--bogus"]).status, 2);
});

test("a single required check can be asked for, and a name must match exactly", () => {
  assert.equal(gate(lines(run("check", "success")), ["--require", "check"]).status, 0);
  assert.equal(gate(lines(run("Check", "success")), ["--require", "check"]).status, 1);
});

test("library helpers", () => {
  assert.deepEqual(parseRuns('{"a":1}\n\n{"b":2}\n'), [{ a: 1 }, { b: 2 }]);
  assert.throws(() => parseRuns("{\n"), /line 1/);
  assert.deepEqual(parseArgs(["--require", "x", "--require", "y"]), ["x", "y"]);
  assert.deepEqual(evaluateChecks([run("a", "success")], ["a"]), [
    { name: "a", ok: true, detail: "success" },
  ]);
});
