import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";
import {
  REQUIRED_SETTINGS,
  isReleaseTag,
  missingSettings,
  preflight,
} from "./deploy-preflight.mjs";

// Placeholder values only; they look nothing like credentials and are never sent anywhere.
const complete = Object.fromEntries(
  REQUIRED_SETTINGS.map((name) => [name, `value-of-${name.toLowerCase()}`]),
);

test("the required settings are the ones named in ops/secrets-inventory.md", () => {
  assert.deepEqual(REQUIRED_SETTINGS, [
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_PROJECT_REF",
  ]);
});

test("missingSettings reports unset and blank settings by name", () => {
  assert.deepEqual(missingSettings(complete), []);
  assert.deepEqual(missingSettings({}), REQUIRED_SETTINGS);
  assert.deepEqual(missingSettings({ ...complete, SUPABASE_DB_PASSWORD: "   " }), [
    "SUPABASE_DB_PASSWORD",
  ]);
});

test("release tags: vMAJOR.MINOR.PATCH with an optional pre-release suffix", () => {
  for (const tag of ["v0.0.0-test", "v1.2.3", "v10.0.1", "v1.0.0-rc.1"])
    assert.equal(isReleaseTag(tag), true, tag);
  for (const tag of [
    "1.2.3",
    "v1",
    "v1.2",
    "vNext",
    "v1.2.3.4",
    "v01.2.3",
    "v1.2.3-",
    "refs/tags/v1.2.3",
    "",
    undefined,
  ]) {
    assert.equal(isReleaseTag(tag), false, String(tag));
  }
});

test("staging is ready when every setting is present", () => {
  assert.deepEqual(preflight({ environment: "staging", env: complete }), { ok: true, errors: [] });
});

test("production also needs a release tag", () => {
  assert.equal(preflight({ environment: "production", tag: "v1.2.3", env: complete }).ok, true);
  const noTag = preflight({ environment: "production", env: complete });
  assert.equal(noTag.ok, false);
  assert.match(noTag.errors[0], /release tag/);
  assert.equal(
    preflight({ environment: "production", tag: "feature-branch", env: complete }).ok,
    false,
  );
});

test("missing settings are named, and their values never appear in an error", () => {
  const partial = { SUPABASE_PROJECT_REF: complete.SUPABASE_PROJECT_REF };
  const { ok, errors } = preflight({ environment: "staging", env: partial });
  assert.equal(ok, false);
  assert.deepEqual(errors, [
    "missing staging setting: SUPABASE_ACCESS_TOKEN",
    "missing staging setting: SUPABASE_DB_PASSWORD",
  ]);
  assert.ok(!errors.join("\n").includes(complete.SUPABASE_PROJECT_REF));
});

test("an unknown environment is rejected", () => {
  assert.equal(preflight({ environment: "prod", env: complete }).ok, false);
});

// ---- command line ------------------------------------------------------------------------------------------------

const SCRIPT = fileURLToPath(new URL("./deploy-preflight.mjs", import.meta.url));
const run = (args, env = {}) => {
  const clean = { ...process.env };
  for (const name of REQUIRED_SETTINGS) delete clean[name];
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...clean, ...env },
  });
};

test("CLI: exit 0 when ready, 1 with names only when not, 2 on bad usage", () => {
  const ready = run(["--environment", "staging"], complete);
  assert.equal(ready.status, 0, ready.stderr);
  assert.match(ready.stdout, /deploy-preflight: OK \(staging\)/);

  const missing = run(["--environment", "production", "--tag", "v1.2.3"], {
    SUPABASE_ACCESS_TOKEN: complete.SUPABASE_ACCESS_TOKEN,
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /missing production setting: SUPABASE_DB_PASSWORD/);
  assert.match(missing.stderr, /missing production setting: SUPABASE_PROJECT_REF/);
  assert.ok(
    !missing.stderr.includes(complete.SUPABASE_ACCESS_TOKEN),
    "a value must never be printed",
  );

  assert.equal(run([]).status, 2);
  assert.equal(run(["--environment"]).status, 2);
  assert.equal(run(["--bogus", "x"]).status, 2);
});

test("CLI --tag-only checks the tag without needing any setting", () => {
  assert.equal(run(["--tag-only", "v1.2.3"]).status, 0);
  assert.equal(run(["--tag-only", "vNext"]).status, 1);
  assert.equal(run(["--tag-only"]).status, 2);
});
