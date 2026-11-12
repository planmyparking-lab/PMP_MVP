#!/usr/bin/env node
// CLD-09 deploy preflight. Usage (in a deploy workflow, after the environment's secrets and variables are mapped to env):
//   node scripts/deploy-preflight.mjs --environment staging
//   node scripts/deploy-preflight.mjs --environment production --tag v1.2.3
//   node scripts/deploy-preflight.mjs --tag-only v1.2.3     (tag format only; needs no settings)
// Fails early, before anything touches a hosted project, when a required setting is missing (CLD-09 C step 10: "a missing
// secret fails CI early with the missing name, not value") or when a production run is not for a release tag.
// It prints setting NAMES only, never values. Exit codes: 0 ready, 1 not ready, 2 usage error.
// The names follow ops/secrets-inventory.md: SUPABASE_PROJECT_REF is an environment variable (not a credential);
// the other two are environment-scoped secrets.

export const REQUIRED_SETTINGS = [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_PROJECT_REF",
];
export const ENVIRONMENTS = ["staging", "production"];

// vMAJOR.MINOR.PATCH with an optional pre-release suffix (the CLD-09 sandbox test uses v0.0.0-test). The trigger in
// deploy-prod.yml is `v*`; this check rejects tags such as `vNext` or `v1` that the trigger alone would accept.
// The tagging convention itself belongs to REL-01 (docs/release.md, not written yet).
const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

/** Names from `names` whose value in `env` is unset or blank. */
export function missingSettings(env, names = REQUIRED_SETTINGS) {
  return names.filter((name) => typeof env[name] !== "string" || env[name].trim() === "");
}

/** True for a release tag name such as v1.2.3 or v0.0.0-test (not a ref path). */
export function isReleaseTag(tag) {
  return typeof tag === "string" && RELEASE_TAG.test(tag);
}

/**
 * Checks one deploy request. Returns { ok, errors } where errors are human-readable lines that contain setting
 * names, the environment and the tag, but never a setting's value.
 */
export function preflight({ environment, tag, env }) {
  const errors = [];
  if (!ENVIRONMENTS.includes(environment)) {
    errors.push(`unknown environment "${environment}" (expected ${ENVIRONMENTS.join(" or ")})`);
    return { ok: false, errors };
  }
  if (environment === "production" && !isReleaseTag(tag)) {
    errors.push(`production deploys only run for a release tag like v1.2.3; got "${tag ?? ""}"`);
  }
  for (const name of missingSettings(env)) {
    errors.push(`missing ${environment} setting: ${name}`);
  }
  return { ok: errors.length === 0, errors };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!["--environment", "--tag"].includes(key) || value === undefined) return null;
    args[key.slice(2)] = value;
  }
  return args.environment ? args : null;
}

if (process.argv[1] && process.argv[1].endsWith("deploy-preflight.mjs")) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--tag-only") {
    if (argv.length !== 2) {
      console.error("Usage: node scripts/deploy-preflight.mjs --tag-only vX.Y.Z");
      process.exit(2);
    }
    if (!isReleaseTag(argv[1])) {
      console.error(`ERROR: not a release tag like v1.2.3: "${argv[1]}"`);
      process.exit(1);
    }
    console.log(`deploy-preflight: release tag OK (${argv[1]})`);
    process.exit(0);
  }
  const args = parseArgs(argv);
  if (!args) {
    console.error(
      "Usage: node scripts/deploy-preflight.mjs --environment staging|production [--tag vX.Y.Z]",
    );
    process.exit(2);
  }
  const { ok, errors } = preflight({
    environment: args.environment,
    tag: args.tag,
    env: process.env,
  });
  if (!ok) {
    console.error(errors.map((e) => `ERROR: ${e}`).join("\n"));
    process.exit(1);
  }
  console.log(`deploy-preflight: OK (${args.environment}${args.tag ? `, ${args.tag}` : ""})`);
}
