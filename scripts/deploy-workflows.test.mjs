// Safety properties of the CLD-09 deploy workflows, checked as text so no YAML dependency is needed. These are the
// properties a careless edit could silently remove; the YAML syntax itself is checked by GitHub and by Prettier.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { REQUIRED_SETTINGS } from "./deploy-preflight.mjs";

const read = (name) =>
  readFileSync(fileURLToPath(new URL(`../.github/workflows/${name}`, import.meta.url)), "utf8");
const staging = read("deploy-staging.yml");
const production = read("deploy-prod.yml");
const ci = read("ci.yml");
const both = [
  ["deploy-staging.yml", staging],
  ["deploy-prod.yml", production],
];

test("every action is pinned to a full commit SHA", () => {
  for (const [name, text] of both) {
    const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    assert.ok(uses.length > 0, name);
    for (const ref of uses) assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${name}: ${ref}`);
  }
});

test("no deploy workflow can be triggered by a pull request", () => {
  for (const [name, text] of both) assert.doesNotMatch(text, /pull_request/, name);
});

test("the token is read-only at workflow level", () => {
  for (const [name, text] of both) assert.match(text, /^permissions:\n {2}contents: read$/m, name);
});

test("secrets are only mapped into env, by the names the preflight checks, never interpolated into a script", () => {
  // CONSOLE_URL (staging only, CLD-10 post-deploy health check) is the one addition beyond the three deploy
  // secrets/vars every workflow needs: it is not a secret, and the check it drives reads no data (health.ts).
  const expected = {
    "deploy-staging.yml": [
      "secrets.SUPABASE_ACCESS_TOKEN",
      "secrets.SUPABASE_DB_PASSWORD",
      "vars.CONSOLE_URL",
      "vars.SUPABASE_PROJECT_REF",
    ],
    "deploy-prod.yml": [
      "secrets.SUPABASE_ACCESS_TOKEN",
      "secrets.SUPABASE_DB_PASSWORD",
      "vars.SUPABASE_PROJECT_REF",
    ],
  };
  for (const [name, text] of both) {
    const refs = [...text.matchAll(/\$\{\{\s*(secrets|vars)\.(\w+)\s*\}\}/g)].map(
      (m) => `${m[1]}.${m[2]}`,
    );
    assert.deepEqual([...new Set(refs)].sort(), expected[name], name);
    for (const line of text.split("\n").filter((l) => l.includes("secrets."))) {
      assert.match(line, /^\s+(SUPABASE_\w+): \$\{\{ secrets\.\1 \}\}$/, `${name}: ${line.trim()}`);
    }
    for (const setting of REQUIRED_SETTINGS)
      assert.ok(text.includes(`${setting}:`), `${name} maps ${setting}`);
  }
});

test("both deploys are switched off until DEPLOY_ENABLED is true and run the preflight first", () => {
  assert.match(staging, /vars\.DEPLOY_ENABLED == 'true'/);
  assert.match(production, /vars\.DEPLOY_ENABLED == 'true'/);
  assert.match(staging, /deploy-preflight\.mjs --environment staging\n/);
  assert.match(
    production,
    /deploy-preflight\.mjs --environment production --tag "\$GITHUB_REF_NAME"/,
  );
});

test("staging deploys only after a successful CI run for a push to main in this repository", () => {
  assert.match(ci, /^name: CI$/m, "the workflow_run trigger refers to ci.yml by its name");
  assert.match(
    staging,
    /workflow_run:\n\s+workflows: \[CI\]\n\s+types: \[completed\]\n\s+branches: \[main\]/,
  );
  for (const condition of [
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
    "github.event.workflow_run.head_repository.full_name == github.repository",
  ]) {
    assert.ok(staging.includes(condition), condition);
  }
  assert.match(
    staging,
    /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/,
    "deploys the commit CI tested",
  );
  assert.match(staging, /environment: staging/);
  assert.doesNotMatch(staging, /environment: production/);
});

test("production deploys only for v* tags, after verification, through the production environment", () => {
  assert.match(production, /^on:\n {2}push:\n {4}tags: \["v\*"\]\n\n/m);
  assert.doesNotMatch(production, /branches:/, "no branch can trigger a production deploy");
  assert.doesNotMatch(production, /workflow_dispatch/, "no manual run of an arbitrary ref");
  assert.match(production, /--tag-only "\$GITHUB_REF_NAME"/);
  assert.match(production, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  assert.match(
    production,
    /node scripts\/verify-ci-checks\.mjs --require check --require db-tests\n/,
    "the release gate requires both CI jobs",
  );
  assert.match(production, /set -o pipefail/, "a failed API call must not pass the gate");
  assert.match(
    production,
    /--jq '\.check_runs\[\] \| select\(\.app\.slug == "github-actions"\)'/,
    "a check run posted under the same name by another app must not satisfy the gate",
  );
  assert.match(production, /check-runs\?filter=latest/, "only the latest run of each job counts");
  assert.match(production, /needs: verify/);
  assert.doesNotMatch(
    production,
    /^ {4}if: .*(always|failure|cancelled)\(\)/m,
    "no job-level condition may let deploy run after a failed verify",
  );
  assert.match(production, /environment: production/);
  assert.doesNotMatch(production, /environment: staging/);
});

test("deploys never overlap and are never cancelled midway", () => {
  assert.match(staging, /group: deploy-staging\n\s+cancel-in-progress: false/);
  assert.match(production, /group: deploy-production\n\s+cancel-in-progress: false/);
});

test("migrations are previewed before they are applied", () => {
  for (const [name, text] of both) {
    const dry = text.indexOf("db push --dry-run");
    const apply = text.indexOf("db push\n");
    assert.ok(dry > 0 && apply > dry, name);
  }
});
