// Failure-path tests (see ops/runbook.md for exactly what the drill fingerprint does and does not verify)
// Failure-path tests for tools/restore/restore_drill.sh. Synthetic data only, local Docker only. They need the local
// Supabase stack (`npx supabase@2.122.0 start`) and bash, so they are NOT part of `pnpm test:scripts` or CI.
// Run: pnpm test:restore
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const stack = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", "supabase_db_pmp-mvp"], {
  encoding: "utf8",
});
const up = stack.status === 0 && stack.stdout.trim() === "true";
const skip = up ? false : "local Supabase stack is not running";

// On Windows, `bash` resolved from PowerShell or cmd is usually the WSL launcher (WindowsApps\bash.exe), not Git Bash. WSL
// does NOT hand Windows environment variables to Linux unless they are listed in WSLENV, so the control variables used
// by these tests would silently vanish and the script would run a real drill and exit 0 instead of the failure path under
// test. WSLENV is ignored by Git Bash, Linux and macOS, so naming the variables there is harmless.
const FORWARDED = [
  "RESTORE_DRILL_CONTAINER",
  "RESTORE_DRILL_TAMPER",
  "RESTORE_DRILL_PROBE",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "MSYS_NO_PATHCONV",
];
const bashEnv = (extra = {}) => {
  const entries = (process.env.WSLENV ?? "").split(":").filter(Boolean);
  const named = new Set(entries.map((e) => e.split("/")[0]));
  const wslenv = [...entries, ...FORWARDED.filter((n) => !named.has(n))].join(":");
  return { ...process.env, MSYS_NO_PATHCONV: "1", WSLENV: wslenv, ...extra };
};
let reaches;
const envReachesBash = () =>
  (reaches ??=
    spawnSync("bash", ["-c", 'printf %s "$RESTORE_DRILL_PROBE"'], {
      encoding: "utf8",
      env: bashEnv({ RESTORE_DRILL_PROBE: "reached" }),
    }).stdout === "reached");
const drill = (args = [], env = {}) => {
  // Fail loudly rather than run a real drill when the variables under test cannot reach the script.
  if (Object.keys(env).length > 0 && !envReachesBash()) {
    throw new Error(
      "environment variables do not reach the bash that runs the script (WSL needs them in WSLENV); refusing to run the drill without them",
    );
  }
  return spawnSync("bash", ["tools/restore/restore_drill.sh", ...args], {
    encoding: "utf8",
    env: bashEnv(env),
  });
};
const leftovers = () =>
  spawnSync(
    "docker",
    [
      "exec",
      "supabase_db_pmp-mvp",
      "sh",
      "-c",
      "psql -U postgres -Atc \"select datname from pg_database where datname like 'restore_drill%'\"; ls /tmp/restore_drill 2>/dev/null",
    ],
    { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
  ).stdout.trim();

test(
  "a synthetic drill matches (rows, plus policy/function/view names only: not privileges or definitions) and cleans up",
  { skip },
  () => {
    const r = drill(["--synthetic"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /result=MATCH/);
    assert.match(r.stdout, /schema:policies/);
    // The source is built from supabase/migrations, so the event log and the trigger-derived tables of 0005/0006 carry
    // rows: 40 sessions in each of 6 facilities enter (240 events); 25 per facility exit, plus one duplicate exit each
    // (156 events, 396 in total); 15 per facility stay open (90); each duplicate exit raises one DUPLICATE_EXIT (6).
    assert.match(r.stdout, /public\.events\s+rows=396\s/);
    assert.match(r.stdout, /public\.open_sessions\s+rows=90\s/);
    assert.match(r.stdout, /public\.sync_conflicts\s+rows=6\s/);
    assert.equal(leftovers(), "");
  },
);

test(
  "a corrupted restored row is reported as MISMATCH with a non-zero exit, and still cleans up",
  { skip },
  () => {
    const r = drill(["--synthetic"], { RESTORE_DRILL_TAMPER: "1" });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /result=MISMATCH/);
    assert.equal(leftovers(), "");
  },
);

test("a missing container fails with exit 2 and touches nothing", () => {
  const r = drill([], { RESTORE_DRILL_CONTAINER: "supabase_db_does_not_exist" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not running/);
});

test("a container name outside supabase_db_* is refused", () => {
  const r = drill([], { RESTORE_DRILL_CONTAINER: "prod-postgres" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /must start with supabase_db_/);
});

test("a remote Docker host is refused", () => {
  const r = drill([], { DOCKER_HOST: "tcp://203.0.113.1:2375" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /refusing to run/);
});

test("validation order: the Docker environment refusal comes first, then the container name, then the running check", () => {
  for (const env of [{ DOCKER_HOST: "tcp://203.0.113.1:2375" }, { DOCKER_CONTEXT: "prod" }]) {
    const r = drill([], { ...env, RESTORE_DRILL_CONTAINER: "prod-postgres" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /refusing to run/);
    assert.doesNotMatch(r.stderr, /must start with|not running/);
  }
  const bad = drill([], { RESTORE_DRILL_CONTAINER: "prod-postgres" });
  assert.match(bad.stderr, /must start with supabase_db_/);
  assert.doesNotMatch(bad.stderr, /not running/);
  const missing = drill([], { RESTORE_DRILL_CONTAINER: "supabase_db_does_not_exist" });
  assert.match(missing.stderr, /not running/);
});

test("harness: environment variables set for the drill reach the bash that runs it", () => {
  assert.equal(envReachesBash(), true);
});
