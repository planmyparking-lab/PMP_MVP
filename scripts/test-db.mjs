#!/usr/bin/env node
// Local SQL test runner (CLD-02). Usage: node scripts/test-db.mjs [--strict]
// Runs every supabase/tests/*.test.sql against the LOCAL Supabase database container. Migrations that are not
// yet in the local migration history are applied inside the same transaction as the test and rolled back with
// it, so nothing is applied permanently. It then checks that migration history, public table contents and
// auth.users are unchanged. Fails (non-zero) on a missing prerequisite, an SQL error, a non-zero psql exit, a
// failed or skipped assertion, a plan mismatch or leaked state. Assertions marked TODO are reported as blocked
// and do not fail the run unless --strict is given; a TODO assertion that now passes fails the run.
// It only talks to the local container through `docker exec`; it never connects to a hosted project.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export class RunnerError extends Error {}

function fail(message) {
  throw new RunnerError(message);
}

const versionOf = (file) => /^(\d+)_/.exec(file.name)?.[1];

export function parseProjectId(toml) {
  const m = /^project_id\s*=\s*"([^"]+)"/m.exec(toml);
  return m ? m[1] : null;
}

// files: [{ name, sql }] named NNNN_x.sql; applied: version strings. Returns files not yet applied, in order.
export function pendingMigrations(files, applied) {
  const known = new Set(applied);
  const pending = files.filter((f) => versionOf(f) && !known.has(versionOf(f)));
  return pending.sort((a, b) => versionOf(a).localeCompare(versionOf(b)));
}

export function appliedWithoutFile(files, applied) {
  const versions = new Set(files.map(versionOf));
  return applied.filter((v) => !versions.has(v));
}

export function parseTap(output) {
  const tap = { plan: null, ok: 0, failed: [], todo: [], todoPassed: [], skipped: [], errors: [] };
  for (const line of output.split(/\r?\n/)) {
    const plan = /^1\.\.(\d+)$/.exec(line);
    if (plan) tap.plan = Number(plan[1]);
    else if (/^not ok \d+/.test(line)) (/# TODO/.test(line) ? tap.todo : tap.failed).push(line);
    else if (/^ok \d+/.test(line)) {
      if (/# SKIP/i.test(line)) tap.skipped.push(line);
      else if (/# TODO/.test(line)) tap.todoPassed.push(line);
      else tap.ok += 1;
    } else if (/^(ERROR|FATAL|psql: error):/.test(line)) tap.errors.push(line);
  }
  return tap;
}

// Returns { status: "PASSED" | "PASSED_WITH_TODO" | "FAILED", reasons: string[] }.
export function evaluate(tap) {
  const reasons = [];
  if (tap.plan === null) reasons.push("no pgTAP plan line was printed");
  const ran = tap.ok + tap.failed.length + tap.todo.length;
  const total = ran + tap.todoPassed.length + tap.skipped.length;
  if (tap.plan !== null && total !== tap.plan) reasons.push(`plan ${tap.plan} but ${total} ran`);
  if (tap.failed.length) reasons.push(`${tap.failed.length} assertion(s) failed`);
  if (tap.skipped.length) reasons.push(`${tap.skipped.length} assertion(s) skipped`);
  if (tap.todoPassed.length) {
    reasons.push(`${tap.todoPassed.length} TODO assertion(s) now pass: remove the todo wrapper`);
  }
  if (tap.errors.length) reasons.push(`${tap.errors.length} SQL error(s)`);
  if (reasons.length) return { status: "FAILED", reasons };
  return { status: tap.todo.length ? "PASSED_WITH_TODO" : "PASSED", reasons };
}

// A test that commits would make the temporarily applied migrations permanent.
export const commitsTransaction = (sql) => /^\s*(commit|end)\s*;/im.test(sql);

export function unsafeTransactionControl(sql) {
  if (commitsTransaction(sql)) return "must not commit (its changes would become permanent)";
  if (!/^\s*begin\s*;/im.test(sql)) return "must start its own transaction (begin;)";
  return null;
}

export function buildPendingSql(pending, testSql) {
  return ["begin;", ...pending.map((f) => f.sql), testSql, "rollback;", ""].join("\n");
}

function psql(run, container, sql) {
  return run(["exec", "-i", container, "psql", "-U", "postgres", "-X", "-q", "-At"], sql);
}

function query(run, container, sql) {
  const r = psql(run, container, sql);
  if (r.code !== 0 || /^ERROR:/m.test(r.out)) fail(`query failed: ${sql}\n${r.out}`);
  return r.out.trim();
}

export function checkPrerequisites(run, container) {
  const version = run(["--version"]);
  if (version.error || version.code !== 0) fail("Docker is not installed or not on PATH");
  const state = run(["inspect", "-f", "{{.State.Running}}", container]);
  if (state.code !== 0 || state.out.trim() !== "true") {
    fail(`database container ${container} is not running. Start it: npx supabase@2.122.0 start`);
  }
  const pgtap = query(run, container, "select count(*) from pg_extension where extname = 'pgtap'");
  if (pgtap !== "1") fail("the pgtap extension is not enabled in the local database");
  const history = "select to_regclass('supabase_migrations.schema_migrations') is not null";
  if (query(run, container, history) !== "t")
    fail("no migration history: run supabase start first");
}

const VERSIONS_SQL =
  "select coalesce(string_agg(version, ',' order by version), '') " +
  "from supabase_migrations.schema_migrations";
const COUNT_SQL = "format('select count(*) as c from %I.%I', schemaname, tablename)";
const ROWS_SQL =
  "select coalesce(string_agg(t || '=' || c, ',' order by t), '') from (" +
  "select schemaname || '.' || tablename as t, " +
  `(xpath('/row/c/text()', query_to_xml(${COUNT_SQL}, false, true, '')))[1]::text as c ` +
  "from pg_tables where schemaname = 'public' or (schemaname = 'auth' and tablename = 'users')) s";

export function snapshot(run, container) {
  return {
    versions: query(run, container, VERSIONS_SQL),
    rows: query(run, container, ROWS_SQL),
  };
}

export function runSuite(run, container, test, pending) {
  const problem = unsafeTransactionControl(test.sql);
  if (problem) fail(`${test.name} ${problem}`);
  for (const file of pending) {
    if (commitsTransaction(file.sql)) {
      fail(`${file.name} commits, which would make a temporarily applied migration permanent`);
    }
  }
  const sql = pending.length ? buildPendingSql(pending, test.sql) : test.sql;
  const r = psql(run, container, sql);
  const tap = parseTap(r.out);
  if (r.error) tap.errors.push(`could not run docker: ${r.error.message}`);
  else if (r.code !== 0) tap.errors.push(`psql exited with code ${r.code}`);
  return tap;
}

// Runs everything and returns the exit code (0 or 1). Throws RunnerError for a missing prerequisite.
export function execute({ run, container, migrations, tests, strict, log }) {
  checkPrerequisites(run, container);
  if (!tests.length) fail("no supabase/tests/*.test.sql files found");
  const before = snapshot(run, container);
  const applied = before.versions ? before.versions.split(",") : [];
  const missing = appliedWithoutFile(migrations, applied);
  if (missing.length) fail(`applied migrations without a file: ${missing.join(", ")}`);
  const pending = pendingMigrations(migrations, applied);
  const names = pending.map((f) => f.name).join(", ") || "none";
  log(`applied: ${before.versions || "none"}; temporary, rolled back: ${names}`);

  let failed = false;
  let blocked = 0;
  for (const test of tests) {
    const tap = runSuite(run, container, test, pending);
    const { status, reasons } = evaluate(tap);
    const counts = `${tap.ok} ok, ${tap.failed.length} failed, ${tap.todo.length} todo of ${tap.plan}`;
    log(`${status} ${test.name}: ${counts}`);
    const detail = [...tap.failed, ...tap.errors, ...tap.todo, ...tap.skipped, ...tap.todoPassed];
    for (const line of detail) log(`  ${line}`);
    for (const reason of reasons) log(`  reason: ${reason}`);
    if (status === "FAILED") failed = true;
    blocked += tap.todo.length;
  }

  const after = snapshot(run, container);
  if (after.versions !== before.versions || after.rows !== before.rows) {
    log("LEAKED STATE: migration history or table contents changed during the run");
    log(`  before: ${before.versions} | ${before.rows}`);
    log(`  after:  ${after.versions} | ${after.rows}`);
    failed = true;
  } else {
    log("state unchanged: migration history and table contents are as before");
  }
  if (blocked) log(`NOT FULLY PASSING: ${blocked} assertion(s) blocked by a TODO`);
  return failed || (strict && blocked > 0) ? 1 : 0;
}

function dockerRun(args, input) {
  const r = spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, error: r.error };
}

function readSql(dir, suffix) {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).filter((f) => f.endsWith(suffix));
  names.sort();
  return names.map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

function main() {
  try {
    if (!existsSync("supabase/config.toml")) fail("run this from the repository root");
    const projectId = parseProjectId(readFileSync("supabase/config.toml", "utf8"));
    if (!projectId) fail("project_id not found in supabase/config.toml");
    process.exitCode = execute({
      run: dockerRun,
      container: `supabase_db_${projectId}`,
      migrations: readSql("supabase/migrations", ".sql"),
      tests: readSql("supabase/tests", ".test.sql"),
      strict: process.argv.includes("--strict"),
      log: console.log,
    });
  } catch (e) {
    if (!(e instanceof RunnerError)) throw e;
    console.error(`test-db: ${e.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith("test-db.mjs")) main();
