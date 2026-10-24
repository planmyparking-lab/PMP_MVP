#!/usr/bin/env node
// Usage: node scripts/check-branch-name.mjs [branch]   (defaults to the current git branch)
import { execSync } from "node:child_process";

export const BRANCH_RE = /^(feature|fix|chore|docs|test|refactor|spike)\/[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidBranch(name) {
  return name === "main" || BRANCH_RE.test(name);
}

const arg = process.argv[2];
if (process.argv[1] && process.argv[1].endsWith("check-branch-name.mjs")) {
  const name = arg ?? execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
  if (!isValidBranch(name)) {
    console.error(
      `Invalid branch name "${name}". Use <type>/<slug>, e.g. feature/gate-05-token-entry.\n` +
        `Types: feature|fix|chore|docs|test|refactor|spike. Lowercase letters, digits and hyphens only.`,
    );
    process.exit(1);
  }
  console.log(`Branch name OK: ${name}`);
}
