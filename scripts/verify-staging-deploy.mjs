#!/usr/bin/env node
// Release gate (REL-01, deployment.md "Requirement that a tag first ran on staging"): a release tag may only deploy
// production once the exact tagged commit already has a successful "staging-deploy" commit status, posted by
// deploy-staging.yml itself (its last step) against github.event.workflow_run.head_sha.
//
// Not GitHub's own environment Deployment record: for a workflow_run-triggered job, the Deployment GitHub creates
// automatically for an `environment:` job is recorded against GITHUB_SHA, which for workflow_run events is the
// default branch's tip at the moment THIS workflow runs, not github.event.workflow_run.head_sha (the commit CI
// actually tested and that the job checks out). Those two can differ when two merges to main queue close together
// behind deploy-staging.yml's own concurrency group, which would let the gate below check the wrong commit (found in
// review, PR #79, Nikhil). An explicit commit status posted against head_sha has no such ambiguity.
//
// Reads the commit's statuses as newline-delimited JSON on stdin (one object per line, as `gh api
// repos/OWNER/REPO/commits/SHA/statuses --jq '.[]'` produces, newest first). Usage:
//   gh api repos/OWNER/REPO/commits/SHA/statuses --jq '.[]' | node scripts/verify-staging-deploy.mjs
import { readFileSync } from "node:fs";

export const CONTEXT = "staging-deploy";

export function parseStatuses(text) {
  const statuses = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    try {
      statuses.push(JSON.parse(line));
    } catch {
      throw new Error(`input line ${index + 1} is not valid JSON`);
    }
  }
  return statuses;
}

/** Only the most recent `staging-deploy` status decides it (a retry can supersede an earlier failure). */
export function evaluateStagingDeploy(statuses) {
  const mine = statuses.filter((s) => s && s.context === CONTEXT);
  if (mine.length === 0) {
    return { ok: false, detail: `no "${CONTEXT}" status found for this commit` };
  }
  const latest = mine.reduce((a, b) => (new Date(b.created_at) > new Date(a.created_at) ? b : a));
  if (latest.state !== "success") {
    return { ok: false, detail: `latest "${CONTEXT}" status is "${latest.state}", not "success"` };
  }
  return { ok: true, detail: `"${CONTEXT}" succeeded at ${latest.created_at}` };
}

if (process.argv[1] && process.argv[1].endsWith("verify-staging-deploy.mjs")) {
  try {
    const result = evaluateStagingDeploy(parseStatuses(readFileSync(0, "utf8")));
    console.log(result.ok ? `ok   staging: ${result.detail}` : `FAIL staging: ${result.detail}`);
    if (!result.ok) {
      console.error(
        `::error::${result.detail} — a release tag may only be cut once this commit has already deployed to ` +
          "staging (docs/development/deployment.md)",
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(`::error::verify-staging-deploy: ${error.message}`);
    process.exit(2);
  }
}
