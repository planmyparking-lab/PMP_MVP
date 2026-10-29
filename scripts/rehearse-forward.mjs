#!/usr/bin/env node
// Synthetic-row count-preservation rehearsal (CLD-02, T-CLD-02-I2 / D.11). Usage: node scripts/rehearse-forward.mjs [--proposed]
// Inserts SYNTHETIC rows into the LOCAL database, applies only the migrations that are not yet in local history
// (plus supabase/proposed-migrations with --proposed), and checks that no public table that existed before the
// migrations lost or gained a row. Everything runs in one transaction that is rolled back.
//
// This is NOT a staging-fidelity rehearsal. It does not use a copy of real or staging data, it seeds only six tables
// (organizations, facilities, zones, passes, staff, devices), and it compares row counts only: a migration that
// rewrites values, changes a column type, or fails a constraint on rows this script never inserts would still pass.
// It is a cheap guard against a forward migration deleting or duplicating rows of the seeded tables.
//
// Safeguards: local container only, via `docker exec`; refuses DOCKER_HOST / DOCKER_CONTEXT and a non-local Docker
// context; checks the container is this project's Supabase Postgres; refuses migration files that could end the
// transaction (lexical guard, see scripts/test-db.mjs for its limits). After the rollback it re-counts the seeded
// tables and fails if they differ from the counts taken BEFORE the run (it does not assume empty tables).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  RunnerError,
  assertLocalEnvironment,
  containerIdentityProblem,
  localDockerProblem,
  migrationHazard,
  migrationProblems,
  parseProjectId,
  pendingMigrations,
  readSql,
} from "./test-db.mjs";

export const SEED_TABLES = ["organizations", "facilities", "zones", "passes", "staff", "devices"];

const SYNTHETIC = `
insert into public.organizations (name) select 'Rehearsal org ' || g from generate_series(1, 3) g;
insert into public.facilities (org_id, name, timezone, slot_count)
  select o.id, 'Facility ' || g, 'Asia/Kolkata', 50 from public.organizations o, generate_series(1, 2) g;
insert into public.zones (facility_id, name, capacity, vehicle_class)
  select f.id, 'Zone ' || g, 10, 'car' from public.facilities f, generate_series(1, 50) g;
insert into public.passes (facility_id, vehicle_no, valid_to, dues)
  select f.id, 'MH01' || lpad(g::text, 4, '0'), current_date + g, g * 100 from public.facilities f, generate_series(1, 100) g;
insert into public.staff (facility_id, name, pin_hash, pin_salt)
  select f.id, 'Guard ' || g, 'h', 's' from public.facilities f, generate_series(1, 5) g;
insert into public.devices (facility_id, name)
  select f.id, 'Device ' || g from public.facilities f, generate_series(1, 3) g;
`;

const COUNT = (alias) =>
  `(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', ${alias}.schemaname, ${alias}.tablename), false, true, '')))[1]::text::bigint`;

// Prefixes make every parsed line unambiguous: NOTICE/WARNING text and \echo markers can never be read as counts.
export function seedCountsSql() {
  return (
    SEED_TABLES.map((t) => `select 'SEED|${t}|' || count(*) from public.${t}`).join(
      "\nunion all ",
    ) + ";\n"
  );
}

export function parseSeedCounts(out) {
  const counts = new Map();
  for (const line of out.split(/\r?\n/)) {
    const m = /^SEED\|([a-z_]+)\|(\d+)$/.exec(line);
    if (m) counts.set(m[1], Number(m[2]));
  }
  return counts;
}

export function buildRehearsalSql(pending) {
  return [
    "begin;",
    SYNTHETIC,
    `create temp table rehearsal_before as select schemaname, tablename, ${COUNT("p")} as c from pg_tables p where schemaname = 'public';`,
    ...pending.flatMap((f) => [`\\echo >> applying ${f.name}`, f.sql]),
    `select 'REHEARSAL|' || b.tablename || '|' || b.c || '|' || ${COUNT("b")} from rehearsal_before b order by b.tablename;`,
    "rollback;",
    "",
  ].join("\n");
}

// Returns [{ table, before, after }] from tagged lines only; everything else in the output is ignored.
export function parseRehearsal(out) {
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^REHEARSAL\|([a-z_0-9]+)\|(\d+)\|(\d+)$/.exec(line);
    if (m) rows.push({ table: m[1], before: Number(m[2]), after: Number(m[3]) });
  }
  return rows;
}

// Tables whose row count changed across the migrations.
export function changedTables(rows) {
  return rows
    .filter((r) => r.before !== r.after)
    .map((r) => `${r.table} (${r.before} -> ${r.after})`);
}

// Seeded tables whose count after the run differs from the count taken before the run.
export function seedLeaks(baseline, after) {
  return SEED_TABLES.filter((t) => baseline.get(t) !== after.get(t)).map(
    (t) => `${t} (${baseline.get(t)} -> ${after.get(t)})`,
  );
}

const lastStage = (out) =>
  [...out.matchAll(/^>> (applying .+)$/gm)].at(-1)?.[1] ?? "seeding the synthetic rows";

// psql(sql) -> { code, out (stdout only), err (stderr) }. files: [{ name, sql, dir?, proposed? }].
// Returns the exit code (0 or 1); throws RunnerError for anything that makes the result untrustworthy.
export function rehearse({ psql, files, log }) {
  const fail = (m) => {
    throw new RunnerError(m);
  };
  const history = psql(
    "select coalesce(string_agg(version, ',' order by version), '') from supabase_migrations.schema_migrations",
  );
  if (history.code !== 0)
    fail(`cannot read local migration history (is the local stack running?)\n${history.err}`);
  const applied = history.out.trim() ? history.out.trim().split(",") : [];
  const problems = migrationProblems(files, applied);
  if (problems.length) fail(problems.join("\n"));
  const pending = pendingMigrations(files, applied);
  if (!pending.length) {
    log("rehearse-forward: no pending migrations, nothing to rehearse");
    return 0;
  }
  for (const f of pending) {
    const hazard = migrationHazard(f.sql);
    if (hazard) fail(`${f.name} could make itself permanent (${hazard}); refusing to rehearse it`);
  }

  const baselineRun = psql(seedCountsSql());
  const baseline = parseSeedCounts(baselineRun.out);
  if (baselineRun.code !== 0 || baseline.size !== SEED_TABLES.length) {
    fail(`cannot read the baseline row counts of the seeded tables\n${baselineRun.err}`);
  }

  const run = psql(buildRehearsalSql(pending));
  if (run.code !== 0 || /^ERROR:/m.test(run.err + run.out)) {
    fail(
      `rehearsal failed while ${lastStage(run.out)}; stopped at the first error, nothing was kept:\n${run.err.trim() || run.out.trim()}`,
    );
  }
  const rows = parseRehearsal(run.out);
  if (rows.length === 0)
    fail("no valid table-comparison rows were produced; refusing to report a result");
  const missing = SEED_TABLES.filter((t) => !rows.some((r) => r.table === t));
  if (missing.length) fail(`no comparison row for seeded table(s): ${missing.join(", ")}`);

  const afterRun = psql(seedCountsSql());
  const leaks = seedLeaks(baseline, parseSeedCounts(afterRun.out));
  if (afterRun.code !== 0 || leaks.length) {
    fail(
      `synthetic rows may have been kept: seeded tables differ from their counts before the run: ${leaks.join(", ") || "unreadable"}`,
    );
  }

  const total = rows.reduce((n, r) => n + r.before, 0);
  log(
    `rehearse-forward: applied ${pending.map((f) => f.name).join(", ")}; ${rows.length} tables, ${total} rows incl. synthetic`,
  );
  for (const r of rows) log(`  ${r.table}  ${r.before}  ${r.after}`);
  const changed = changedTables(rows);
  if (changed.length) {
    log(`rehearse-forward: FAILED, row counts changed: ${changed.join(", ")}`);
    return 1;
  }
  log(
    "rehearse-forward: PASSED (synthetic-row count preservation only); transaction rolled back, seeded tables back to their original counts",
  );
  return 0;
}

function splitDocker(args, input) {
  const r = spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return {
    code: r.status ?? 1,
    out: r.stdout ?? "",
    err: `${r.stderr ?? ""}${r.error ? r.error.message : ""}`,
    error: r.error,
  };
}

export function main(argv = process.argv, env = process.env) {
  try {
    assertLocalEnvironment(env);
    const projectId = parseProjectId(readFileSync("supabase/config.toml", "utf8"));
    if (!projectId)
      throw new RunnerError(
        "project_id not found in supabase/config.toml (run from the repo root)",
      );
    const container = `supabase_db_${projectId}`;
    const ctx = localDockerProblem(splitDocker);
    if (ctx) throw new RunnerError(ctx);
    const identity = containerIdentityProblem(splitDocker, container, projectId);
    if (identity) throw new RunnerError(identity);
    const files = [
      ...readSql("supabase/migrations"),
      ...(argv.includes("--proposed")
        ? readSql("supabase/proposed-migrations", /\.sql$/i, { proposed: true })
        : []),
    ];
    const psql = (sql) =>
      splitDocker(
        [
          "exec",
          "-i",
          container,
          "psql",
          "-U",
          "postgres",
          "-X",
          "-q",
          "-At",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        sql,
      );
    process.exitCode = rehearse({ psql, files, log: console.log });
  } catch (e) {
    if (!(e instanceof RunnerError)) throw e;
    console.error(`rehearse-forward: ${e.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith("rehearse-forward.mjs")) main();
