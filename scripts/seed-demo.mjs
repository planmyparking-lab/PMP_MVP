#!/usr/bin/env node
// CON-11 demo seed loader. Usage: pnpm seed:demo [--print]
// Loads the synthetic demo data (supabase/seed/generate.mjs) into the LOCAL Supabase database and then checks the
// oracle numbers (supabase/seed/ORACLE.md) with SQL. Re-running replaces the demo rows only (by facility, organisation
// and demo user id); other rows are left alone.
//   --print   write the SQL to stdout and touch no database.
// Guards: the same local-only checks as scripts/test-db.mjs (no DOCKER_HOST/DOCKER_CONTEXT, a local Docker context, the
// container is this project's Supabase Postgres). It never reads a database URL or a key, so it cannot reach a hosted
// project. The SQL itself refuses to run unless this script set pmp.demo_seed for the session.
// Not part of `supabase db reset` on purpose: the SQL tests count rows on an empty database.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  RunnerError,
  assertLocalEnvironment,
  containerIdentityProblem,
  localDockerProblem,
  parseProjectId,
} from "./test-db.mjs";
import {
  DEMO_PASSWORD,
  DEMO_USERS,
  ORACLE_SQL,
  generate,
  oracle,
  toSql,
} from "../supabase/seed/generate.mjs";

function fail(message) {
  throw new RunnerError(message);
}

function docker(args, input) {
  const r = spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return {
    code: r.status ?? 1,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
    stdout: r.stdout ?? "",
    error: r.error,
  };
}

function psql(container, sql) {
  const r = docker(
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
      "-F",
      "|",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    sql,
  );
  if (r.code !== 0 || /^ERROR:/m.test(r.out)) fail(`psql failed:\n${r.out.slice(-4000)}`);
  return r;
}

/** Refuses anything that is not this project's local Supabase Postgres container. */
export function assertLocalTarget(env, container, projectId) {
  if (/^prod/i.test(env.NODE_ENV ?? "") || /^prod/i.test(env.PMP_ENV ?? "")) {
    fail("refusing to seed demo data with a production environment set (NODE_ENV/PMP_ENV)");
  }
  assertLocalEnvironment(env);
  if (docker(["--version"]).code !== 0) fail("Docker is not installed or not on PATH");
  const contextProblem = localDockerProblem(docker);
  if (contextProblem) fail(contextProblem);
  const state = docker(["inspect", "-f", "{{.State.Running}}", container]);
  if (state.code !== 0 || state.out.trim() !== "true") {
    fail(`database container ${container} is not running. Start it: npx supabase@2.122.0 start`);
  }
  const problem = containerIdentityProblem(docker, container, projectId);
  if (problem) fail(problem);
}

/** Compares database rows with the generator's oracle. Returns a list of mismatches (empty when all match). */
export function compareOracle(expected, dbRows, conflicts, stuckOpen) {
  const problems = [];
  for (const f of expected) {
    const row = dbRows.find((r) => r.name === f.name);
    if (!row) {
      problems.push(`${f.name}: no events found in the oracle window`);
      continue;
    }
    for (const k of ["vehicles", "exits", "overrides", "cash", "upi", "revenue"]) {
      if (Number(row[k]) !== f.stable[k])
        problems.push(`${f.name}: ${k} is ${row[k]}, oracle says ${f.stable[k]}`);
    }
    for (const type of ["DUPLICATE_EXIT", "ORPHAN_EXIT"]) {
      const n = conflicts
        .filter((c) => c.name === f.name && c.type === type)
        .reduce((s, c) => s + c.n, 0);
      if (n !== 1) problems.push(`${f.name}: ${n} open ${type} conflicts, expected 1`);
    }
    const other = conflicts.filter(
      (c) => c.name === f.name && !["DUPLICATE_EXIT", "ORPHAN_EXIT"].includes(c.type),
    );
    for (const c of other) problems.push(`${f.name}: unexpected ${c.n} ${c.type} conflict(s)`);
  }
  if (stuckOpen.missing > 0)
    problems.push(`${stuckOpen.missing} over-threshold fixture session(s) are not open`);
  return problems;
}

function rowsOf(out, cols) {
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => Object.fromEntries(line.split("|").map((v, i) => [cols[i], v])));
}

export function main(argv = process.argv, env = process.env) {
  const data = generate();
  const sql = toSql(data);
  if (argv.includes("--print")) {
    process.stdout.write(sql);
    return;
  }
  try {
    const projectId = parseProjectId(readFileSync("supabase/config.toml", "utf8"));
    const container = `supabase_db_${projectId}`;
    assertLocalTarget(env, container, projectId);
    const ready = psql(
      container,
      "select to_regclass('public.events') is not null and to_regclass('public.sync_conflicts') is not null;",
    );
    if (ready.stdout.trim() !== "t")
      fail("migrations 0001-0006 are not applied: run npx supabase@2.122.0 db reset");

    console.log(`seed-demo: loading ${data.events.length} generated events into ${container} ...`);
    const load = psql(container, `set pmp.demo_seed = 'local-only';\n${sql}`);
    const notice = /demo seed: .*/.exec(load.out);
    if (notice) console.log(`seed-demo: ${notice[0]}`);

    const dbRows = rowsOf(psql(container, ORACLE_SQL).stdout, [
      "name",
      "vehicles",
      "exits",
      "overrides",
      "cash",
      "upi",
      "revenue",
    ]);
    const facIds = data.facilities.map((f) => `'${f.id}'`).join(", ");
    const conflicts = rowsOf(
      psql(
        container,
        `select f.name, c.type, count(*) from public.sync_conflicts c join public.facilities f on f.id = c.facility_id
        where c.facility_id in (${facIds}) and c.status = 'OPEN' group by 1, 2 order by 1, 2;`,
      ).stdout,
      ["name", "type", "n"],
    ).map((r) => ({ ...r, n: Number(r.n) }));
    const stuckIds = data.fixtures
      .filter((x) => x.kind === "OPEN_OVER_THRESHOLD")
      .map((x) => `'${x.session}'`);
    const openCount = Number(
      psql(
        container,
        `select count(*) from public.open_sessions where session_id in (${stuckIds.join(", ")})
        and entry_time <= now() - interval '240 minutes';`,
      ).stdout.trim(),
    );
    const problems = compareOracle(oracle(data), dbRows, conflicts, {
      missing: stuckIds.length - openCount,
    });
    if (problems.length > 0) fail(`oracle check failed:\n  ${problems.join("\n  ")}`);

    console.log("seed-demo: oracle numbers match (supabase/seed/ORACLE.md).");
    console.log(`seed-demo: demo logins (local only), password ${DEMO_PASSWORD}:`);
    for (const u of DEMO_USERS)
      console.log(
        `  ${u.email}  ${u.role}${u.facility ? ` of the ${u.facility}` : " of all three facilities"}`,
      );
  } catch (e) {
    if (e instanceof RunnerError) {
      console.error(`seed-demo: ${e.message}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
}

if (process.argv[1] && process.argv[1].endsWith("seed-demo.mjs")) main();
