#!/usr/bin/env node
// Structural checks: required files exist, no committed secrets/.env, every package has a README.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const required = [
  "README.md",
  "CONTRIBUTING.md",
  "CLAUDE.md",
  ".gitignore",
  ".env.example",
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  ".github/workflows/ci.yml",
  "docs/team/README.md",
  "docs/team/feature-traceability.md",
  "docs/team/open-questions-and-assumptions.md",
  "docs/team/member-01-afzal.md",
  "docs/team/member-02-nikhil.md",
  "docs/team/member-03-anamika.md",
  "docs/team/member-04-akanksha.md",
  "supabase/README.md",
];

const errors = [];
for (const f of required) if (!existsSync(f)) errors.push(`missing required file: ${f}`);

for (const parent of ["apps", "packages"]) {
  if (!existsSync(parent)) continue;
  for (const d of readdirSync(parent)) {
    const p = join(parent, d);
    if (statSync(p).isDirectory() && !existsSync(join(p, "README.md")))
      errors.push(`missing README.md in ${p}`);
  }
}

try {
  const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
  for (const f of tracked) {
    if (/(^|\/)\.env($|\.)/.test(f) && !f.endsWith(".env.example"))
      errors.push(`env file tracked by git: ${f}`);
  }
  for (const f of tracked) {
    if (!/\.(ts|tsx|js|mjs|json|ya?ml|env|example)$/.test(f) || !existsSync(f)) continue;
    const txt = readFileSync(f, "utf8");
    if (
      /-----BEGIN (RSA |EC )?PRIVATE KEY-----/.test(txt) ||
      /\bsk_live_[A-Za-z0-9]{10,}/.test(txt)
    )
      errors.push(`possible secret in ${f}`);
  }
} catch {
  /* not a git checkout; skip tracked-file checks */
}

// CODEOWNERS placeholders are allowed but reported.
const co = readFileSync(".github/CODEOWNERS", "utf8");
if (co.includes("@TODO-"))
  console.warn("WARN: .github/CODEOWNERS still contains @TODO-* placeholder handles.");

if (errors.length) {
  console.error(errors.map((e) => `ERROR: ${e}`).join("\n"));
  process.exit(1);
}
console.log("check-repo: OK");
