#!/usr/bin/env node
// Release gate (REL-01, deployment.md "Requirement that a tag first ran on staging"): a release tag may only
// deploy production once this exact commit has already reached a successful deploy to `staging`. deploy-staging.yml's
// job runs with `environment: staging`, so GitHub Actions itself records a Deployment and its statuses for that
// commit — this script reads those back rather than keeping a separate record that could drift from the real one.
// Usage: node scripts/verify-staging-deploy.mjs --sha <full commit sha> --repo <owner/repo>
// Requires `gh` on PATH and authenticated (GH_TOKEN in the environment), same as verify-ci-checks.mjs.
import { execFileSync } from "node:child_process";

/** Pure decision: given the staging deployments for a commit and each one's statuses, did any of them succeed? */
export function evaluateDeployments(deployments, statusesByDeployment) {
  if (deployments.length === 0) {
    return { ok: false, detail: "no staging deployment found for this commit" };
  }
  for (const d of deployments) {
    const statuses = statusesByDeployment[d.id] ?? [];
    if (statuses.some((s) => s.state === "success")) {
      return { ok: true, detail: `staging deployment ${d.id} succeeded` };
    }
  }
  const states = deployments.flatMap((d) => (statusesByDeployment[d.id] ?? []).map((s) => s.state));
  return {
    ok: false,
    detail: `staging deployment(s) found but none succeeded (${[...new Set(states)].join(", ") || "no status recorded"})`,
  };
}

export function parseArgs(argv) {
  const args = { sha: null, repo: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sha" && argv[i + 1]) args.sha = argv[++i];
    else if (argv[i] === "--repo" && argv[i + 1]) args.repo = argv[++i];
    else throw new Error(`unexpected argument: ${argv[i]}`);
  }
  if (!args.sha || !args.repo)
    throw new Error("usage: --sha <full commit sha> --repo <owner/repo>");
  return args;
}

function ghApiJson(path) {
  return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" }));
}

if (process.argv[1] && process.argv[1].endsWith("verify-staging-deploy.mjs")) {
  try {
    const { sha, repo } = parseArgs(process.argv.slice(2));
    const deployments = ghApiJson(
      `repos/${repo}/deployments?sha=${sha}&environment=staging&per_page=100`,
    );
    const statusesByDeployment = {};
    for (const d of deployments) {
      statusesByDeployment[d.id] = ghApiJson(
        `repos/${repo}/deployments/${d.id}/statuses?per_page=100`,
      );
    }
    const result = evaluateDeployments(deployments, statusesByDeployment);
    console.log(result.ok ? `ok   staging: ${result.detail}` : `FAIL staging: ${result.detail}`);
    if (!result.ok) {
      console.error(
        `::error::no successful staging deployment found for commit ${sha} — a release tag may only be cut once ` +
          "this commit has already deployed to staging (docs/development/deployment.md)",
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(`::error::verify-staging-deploy: ${error.message}`);
    process.exit(2);
  }
}
