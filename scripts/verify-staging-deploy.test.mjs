// Tests for the "a tag must first run on staging" release gate. The behavioural tests run the real script with
// commit statuses on stdin, same pattern as verify-ci-checks.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";
import { CONTEXT, evaluateStagingDeploy, parseStatuses } from "./verify-staging-deploy.mjs";

const script = fileURLToPath(new URL("./verify-staging-deploy.mjs", import.meta.url));
const status = (state, created_at, context = CONTEXT) => ({ context, state, created_at });
const other = (context, state = "success", created_at = "2026-11-28T00:00:00Z") =>
  status(state, created_at, context);
const lines = (...statuses) => statuses.map((s) => JSON.stringify(s)).join("\n") + "\n";
const gate = (stdin) => spawnSync(process.execPath, [script], { input: stdin, encoding: "utf8" });

test("passes when the staging-deploy status succeeded", () => {
  const r = gate(lines(status("success", "2026-11-28T10:00:00Z")));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ok\s+staging: "staging-deploy" succeeded/);
});

test("blocks when the staging-deploy status failed", () => {
  const r = gate(lines(status("failure", "2026-11-28T10:00:00Z")));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL staging:.*not "success"/);
  assert.match(r.stderr, /release tag may only be cut/);
});

test("blocks when no staging-deploy status exists for the commit", () => {
  const r = gate(lines(other("check"), other("db-tests")));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no "staging-deploy" status found/);
});

test("only the most recent staging-deploy status counts (a later success supersedes an earlier failure)", () => {
  const r = gate(
    lines(
      status("failure", "2026-11-28T09:00:00Z"),
      status("success", "2026-11-28T10:00:00Z"),
      status("failure", "2026-11-28T08:00:00Z"),
    ),
  );
  assert.equal(r.status, 0, r.stderr);
});

test("the reverse also blocks: a later failure supersedes an earlier success", () => {
  const r = gate(
    lines(status("success", "2026-11-28T08:00:00Z"), status("failure", "2026-11-28T10:00:00Z")),
  );
  assert.equal(r.status, 1);
});

test("a differently-named context (e.g. CI's own checks) never satisfies the gate", () => {
  const r = gate(lines(other("check", "success"), other("db-tests", "success")));
  assert.equal(r.status, 1);
});

test("empty input fails closed", () => {
  const r = gate("");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no "staging-deploy" status found/);
});

test("malformed input is an error, never a pass", () => {
  const r = gate("not json\n");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not valid JSON/);
});

test("library helpers", () => {
  assert.deepEqual(parseStatuses(""), []);
  assert.deepEqual(parseStatuses("\n\n"), []);
  assert.throws(() => parseStatuses("{bad json"), /not valid JSON/);
  assert.equal(evaluateStagingDeploy([]).ok, false);
});
