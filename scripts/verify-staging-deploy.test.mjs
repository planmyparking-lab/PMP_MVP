// Tests for the "a tag must first run on staging" release gate. evaluateDeployments is the pure decision function;
// the gh-api fetching around it is exercised for real only inside deploy-prod.yml itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateDeployments, parseArgs } from "./verify-staging-deploy.mjs";

test("fails when no staging deployment exists for the commit", () => {
  const r = evaluateDeployments([], {});
  assert.equal(r.ok, false);
  assert.match(r.detail, /no staging deployment found/);
});

test("passes when the (only) deployment succeeded", () => {
  const r = evaluateDeployments([{ id: 1 }], { 1: [{ state: "success" }] });
  assert.equal(r.ok, true);
  assert.match(r.detail, /deployment 1 succeeded/);
});

test("passes when an earlier deployment failed but a later one succeeded", () => {
  const r = evaluateDeployments([{ id: 1 }, { id: 2 }], {
    1: [{ state: "failure" }],
    2: [{ state: "success" }],
  });
  assert.equal(r.ok, true);
});

test("fails when every deployment's statuses are non-success", () => {
  const r = evaluateDeployments([{ id: 1 }], {
    1: [{ state: "in_progress" }, { state: "failure" }],
  });
  assert.equal(r.ok, false);
  assert.match(r.detail, /none succeeded/);
  assert.match(r.detail, /in_progress/);
  assert.match(r.detail, /failure/);
});

test("fails when a deployment exists but has no recorded status", () => {
  const r = evaluateDeployments([{ id: 1 }], {});
  assert.equal(r.ok, false);
  assert.match(r.detail, /no status recorded/);
});

test("parseArgs requires both --sha and --repo", () => {
  assert.deepEqual(parseArgs(["--sha", "abc123", "--repo", "owner/repo"]), {
    sha: "abc123",
    repo: "owner/repo",
  });
  assert.throws(() => parseArgs(["--sha", "abc123"]), /usage/);
  assert.throws(() => parseArgs(["--repo", "owner/repo"]), /usage/);
});

test("parseArgs rejects an unexpected argument", () => {
  assert.throws(() => parseArgs(["--bogus", "x"]), /unexpected argument/);
});
