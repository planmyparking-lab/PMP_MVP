#!/usr/bin/env node
// Local SQL test runner (CLD-02). Usage: node scripts/test-db.mjs [--strict] [--proposed]
// Runs every supabase/tests/*.test.sql against the LOCAL Supabase database container. Migrations that are not
// yet in the local migration history are applied inside the same transaction as the test and rolled back with
// it, so nothing is applied permanently. It then checks that migration history, public table contents and a
// schema fingerprint are unchanged. Fails (non-zero) on a missing prerequisite, an SQL error, a non-zero psql
// exit, a failed or skipped assertion, a plan mismatch or leaked state. Assertions marked TODO are reported as
// blocked and do not fail the run unless --strict is given; a TODO assertion that now passes fails the run.
// --proposed also applies supabase/proposed-migrations and runs supabase/proposed-tests, in the same rolled-back
// transaction. Without it the behaviour is exactly the default.
// It only talks to the local container through `docker exec`; it never connects to a hosted project. It refuses
// to run when DOCKER_HOST or DOCKER_CONTEXT is set, when the active Docker context is not a local socket or named
// pipe, or when the container is not the Supabase Postgres container of this project (name supabase_db_<project_id>,
// an image starting with a known Supabase Postgres registry prefix, and the CLI project label). The label and the
// context type are self-reported: a socket forwarded to a remote Docker looks local.
//
// LIMITS (what the guards do NOT prove):
// - The commit guard is a lexical scan (comments, quoted strings and dollar-quoted bodies are skipped), not a SQL
//   parser. It flags top-level COMMIT/END/ABORT/ROLLBACK/PREPARE TRANSACTION and any psql backslash command.
//   It does not analyse psql variables or what dynamic SQL could do. A transaction that escapes anyway is caught
//   only by the post-run snapshot below.
// - The snapshot compares, before and after the run: the migration history; row COUNTS of public tables and
//   auth.users; and one md5 per category of the public schema. Measured: function/procedure definitions (not
//   extension-owned, not aggregates); view and materialized-view definitions; policies (table, name, permissive,
//   roles, command, USING, WITH CHECK); per table its name, RLS and FORCE RLS flags and each column's name, type and
//   NOT NULL; constraint definitions; index definitions; non-internal trigger definitions; the ACLs of tables, views,
//   materialized views and sequences, of functions/procedures, and of the public schema; extension names.
//   NOT measured: column defaults and identity/generated expressions; column-level privileges; custom types, enums
//   and domains; rules; comments; ownership; ALTER DEFAULT PRIVILEGES; sequence definitions and values; aggregates;
//   event triggers and publications; changed row values with unchanged counts; any schema other than public (auth,
//   storage, extensions, ...) apart from auth.users counts; roles; data in other tables.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FILE_RE } from "./check-migrations.mjs";

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

// Versions used by more than one file (for example a proposed migration whose number a real migration has since taken).
export function duplicateVersions(files) {
  const seen = new Map();
  for (const f of files) {
    const v = versionOf(f);
    if (v) seen.set(v, [...(seen.get(v) ?? []), f.name]);
  }
  return [...seen]
    .filter(([, names]) => names.length > 1)
    .map(([v, names]) => `${v}: ${names.join(", ")}`);
}

export function appliedWithoutFile(files, applied) {
  const versions = new Set(files.map(versionOf));
  return applied.filter((v) => !versions.has(v));
}

// Problems that must stop the run before any SQL is sent. files: [{ name, dir?, proposed? }].
// Returns a list of messages (empty when the layout is sound).
export function migrationProblems(files, applied) {
  const problems = [];
  const bad = files.filter((f) => !FILE_RE.test(f.name));
  if (bad.length) {
    const list = bad.map((f) => (f.dir ? `${f.dir}/${f.name}` : f.name)).join(", ");
    problems.push(
      `malformed migration file name(s): ${list}. Expected four digits, an underscore, lowercase words and .sql, for example 0008_device_heartbeats.sql. A malformed file would be silently skipped otherwise.`,
    );
  }
  const dup = duplicateVersions(files);
  if (dup.length) {
    problems.push(
      `more than one migration file for a version (${dup.join("; ")}); renumber the proposed file`,
    );
  }
  const known = new Set(applied);
  for (const f of files.filter((x) => x.proposed && known.has(versionOf(x)))) {
    problems.push(
      `proposed migration ${f.name} has version ${versionOf(f)}, which is already applied in the local database; it would be treated as applied and skipped while the tests run against different SQL. Renumber it or reset the local database deliberately.`,
    );
  }
  const maxApplied = [...applied].sort().at(-1);
  if (maxApplied) {
    for (const f of pendingMigrations(files, applied)) {
      if (versionOf(f) < maxApplied) {
        problems.push(
          `${f.name} is not applied but is numbered below the highest applied version ${maxApplied}; migrations must be applied in order`,
        );
      }
    }
  }
  const realMax = files
    .filter((f) => !f.proposed)
    .map(versionOf)
    .filter(Boolean)
    .sort()
    .at(-1);
  if (realMax) {
    for (const f of files.filter((x) => x.proposed && versionOf(x) && versionOf(x) < realMax)) {
      problems.push(
        `proposed migration ${f.name} is numbered below the real migration ${realMax}; it would run out of order`,
      );
    }
  }
  return problems;
}

export function parseTap(output) {
  const tap = {
    plan: null,
    ok: 0,
    failed: [],
    todo: [],
    todoPassed: [],
    skipped: [],
    errors: [],
    context: [],
    stage: null,
  };
  for (const line of output.split(/\r?\n/)) {
    const plan = /^1\.\.(\d+)$/.exec(line);
    const stage = /^>> (applying .+|running .+)$/.exec(line);
    if (plan) tap.plan = Number(plan[1]);
    else if (stage) tap.stage = stage[1];
    else if (/^not ok \d+/.test(line)) (/# TODO/.test(line) ? tap.todo : tap.failed).push(line);
    else if (/^ok \d+/.test(line)) {
      if (/# SKIP/i.test(line)) tap.skipped.push(line);
      else if (/# TODO/.test(line)) tap.todoPassed.push(line);
      else tap.ok += 1;
    } else if (/^(ERROR|FATAL|psql: error):/.test(line)) tap.errors.push(line);
    else if (/^(DETAIL|HINT|CONTEXT|QUERY|STATEMENT):|^LINE \d+:/.test(line))
      tap.context.push(line);
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

// ---- transaction-control guard (lexical, see LIMITS above) -------------------------------------------------------

// Splits SQL into top-level statements (lower-cased, whitespace collapsed, quoted text blanked) and psql backslash
// commands. Skips -- and nested /* */ comments, '...' (and E'...' with backslash escapes), "...", and $tag$...$tag$.
export function scanSql(sql) {
  const statements = [];
  const metas = [];
  let cur = "";
  const push = () => {
    const s = cur.replace(/\s+/g, " ").trim().toLowerCase();
    if (s) statements.push(s);
    cur = "";
  };
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      cur += " ";
    } else if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      cur += " ";
    } else if (c === "'") {
      const escapes = /[eE]$/.test(cur) && !/[A-Za-z0-9_$]./.test(cur.slice(-2));
      i++;
      while (i < sql.length) {
        if (escapes && sql[i] === "\\") i += 2;
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i++;
      }
      i++;
      cur += "''";
      continue;
    } else if (c === '"') {
      i++;
      while (i < sql.length && !(sql[i] === '"' && sql[i + 1] !== '"')) i += sql[i] === '"' ? 2 : 1;
      i++;
      cur += '""';
      continue;
    } else if (c === "$") {
      // A $ that follows an identifier character is part of that identifier (a$x$), never a dollar-quote opener.
      const prev = sql[i - 1] ?? "";
      const inIdentifier = /[A-Za-z0-9_$]/.test(prev) || prev.charCodeAt(0) > 127; // letters beyond ASCII too
      const tag = inIdentifier ? null : /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        i = end === -1 ? sql.length : end + tag[0].length;
        cur += "$$";
        continue;
      }
      cur += c;
    } else if (c === "\\") {
      const eol = sql.indexOf("\n", i);
      metas.push(sql.slice(i, eol === -1 ? sql.length : eol).trim());
      i = eol === -1 ? sql.length : eol;
      continue;
    } else if (c === ";") {
      push();
    } else {
      cur += c;
    }
    i++;
  }
  push();
  return { statements, metas };
}

const TERMINATOR = /^(commit|end|abort|rollback|prepare transaction)\b/;
const isSavepointRollback = (s) => /^rollback\s+(?:work\s+|transaction\s+)?to\b/.test(s);
const terminators = (statements) =>
  statements.filter((s) => TERMINATOR.test(s) && !isSavepointRollback(s));

// Why a migration file must not be applied inside the runner's transaction, or null.
export function migrationHazard(sql) {
  const { statements, metas } = scanSql(sql);
  const t = terminators(statements);
  if (t.length) return `ends the transaction (${t[0].split(" ")[0].toUpperCase()})`;
  if (metas.length) return `uses a psql command (${metas[0].split(/\s/)[0]})`;
  return null;
}

// True when the SQL could end or leave the surrounding transaction.
export const commitsTransaction = (sql) => migrationHazard(sql) !== null;

// A test file must start with begin; and may end with one rollback;. Anything else that ends the transaction, or a
// psql backslash command (\c would switch to an autocommit session), could make changes permanent.
export function unsafeTransactionControl(sql) {
  const { statements, metas } = scanSql(sql);
  if (statements[0] !== "begin") return "must start its own transaction (begin;)";
  const last = statements.length - 1;
  // Only the very last statement may be a plain ROLLBACK; the same text anywhere earlier ends the transaction early.
  const bad = statements.filter(
    (s, i) => TERMINATOR.test(s) && !isSavepointRollback(s) && !(s === "rollback" && i === last),
  );
  if (bad.length) {
    return `must not commit or end its transaction early (${bad[0].split(" ")[0].toUpperCase()}; its changes could become permanent)`;
  }
  if (metas.length) return `must not use psql commands (${metas[0].split(/\s/)[0]})`;
  return null;
}

// Markers (psql \echo) let a failure be attributed to the file that was running.
export function buildPendingSql(pending, testSql, testName = "test") {
  return [
    "begin;",
    ...pending.flatMap((f) => [`\\echo >> applying ${f.name}`, f.sql]),
    `\\echo >> running ${testName}`,
    testSql,
    "rollback;",
    "",
  ].join("\n");
}

// ---- local-only safeguards ------------------------------------------------------------------------------------

export function assertLocalEnvironment(env = process.env) {
  for (const name of ["DOCKER_HOST", "DOCKER_CONTEXT"]) {
    if (env[name]) fail(`refusing to run with ${name} set (local Docker only)`);
  }
}

// Registries the Supabase CLI pulls its Postgres image from. The image must START with one of these (a substring match
// would accept any image whose path merely contains "supabase/postgres").
export const SUPABASE_POSTGRES_IMAGE_PREFIXES = [
  "public.ecr.aws/supabase/postgres:",
  "docker.io/supabase/postgres:",
  "supabase/postgres:",
  "ghcr.io/supabase/postgres:",
];

// Returns an error message, or null when the container is this project's local Supabase Postgres.
export function containerIdentityProblem(run, container, projectId) {
  if (container !== `supabase_db_${projectId}`) {
    return `unexpected container name ${container} (expected supabase_db_${projectId})`;
  }
  const fmt = '{{.Config.Image}}|{{index .Config.Labels "com.supabase.cli.project"}}';
  const r = run(["inspect", "-f", fmt, container]);
  const [image = "", label = ""] = r.out.trim().split("|");
  if (r.code !== 0) return `cannot inspect container ${container}`;
  if (!SUPABASE_POSTGRES_IMAGE_PREFIXES.some((p) => image.startsWith(p))) {
    return `${container} is not a supabase/postgres image (image: ${image || "unknown"}; expected one of ${SUPABASE_POSTGRES_IMAGE_PREFIXES.join(", ")})`;
  }
  if (label !== projectId) {
    return `${container} is not labelled as Supabase CLI project ${projectId} (label: ${label || "none"})`;
  }
  return null;
}

// Error message when the active Docker context is not a local socket or named pipe (for example tcp:// or ssh://).
export function localDockerProblem(run) {
  const ctx = run(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
  const host = ctx.out.trim();
  if (ctx.code !== 0 || !/^(npipe|unix):/.test(host)) {
    return `the active Docker context is not a local socket or named pipe (${host || "unknown"})`;
  }
  return null;
}

function psql(run, container, sql) {
  return run(
    ["exec", "-i", container, "psql", "-U", "postgres", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"],
    sql,
  );
}

function query(run, container, sql) {
  const r = psql(run, container, sql);
  if (r.code !== 0 || /^ERROR:/m.test(r.out)) {
    const why = r.error ? `\n${r.error.message}` : "";
    fail(`query failed: ${sql}\n${r.out}${why}`);
  }
  return r.out.trim();
}

export function checkPrerequisites(run, container, projectId) {
  if (!projectId) fail("projectId is required so the container identity can be verified");
  const version = run(["--version"]);
  if (version.error || version.code !== 0) fail("Docker is not installed or not on PATH");
  const contextProblem = localDockerProblem(run);
  if (contextProblem) fail(contextProblem);
  const state = run(["inspect", "-f", "{{.State.Running}}", container]);
  if (state.code !== 0 || state.out.trim() !== "true") {
    fail(`database container ${container} is not running. Start it: npx supabase@2.122.0 start`);
  }
  const problem = containerIdentityProblem(run, container, projectId);
  if (problem) fail(problem);
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

// One md5 per category of the public schema, in a fixed order. Bounded output, deterministic.
export const SCHEMA_SQL = `
select concat_ws(',',
  'functions=' || coalesce((select md5(string_agg(pg_get_functiondef(p.oid), chr(10) order by p.oid::regprocedure::text))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')), 'none'),
  'views=' || coalesce((select md5(string_agg(c.relname || ':' || pg_get_viewdef(c.oid), chr(10) order by c.relname))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v', 'm')), 'none'),
  'policies=' || coalesce((select md5(string_agg(concat_ws('|', tablename, policyname, permissive, roles::text, cmd, qual, with_check), chr(10) order by tablename, policyname))
     from pg_policies where schemaname = 'public'), 'none'),
  'tables=' || coalesce((select md5(string_agg(c.relname || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity || ':' ||
       coalesce((select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull, ',' order by a.attnum)
                 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), ''), chr(10) order by c.relname))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')), 'none'),
  'constraints=' || coalesce((select md5(string_agg(conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid), chr(10) order by conrelid::regclass::text, conname))
     from pg_constraint where connamespace = 'public'::regnamespace), 'none'),
  'indexes=' || coalesce((select md5(string_agg(indexdef, chr(10) order by indexname)) from pg_indexes where schemaname = 'public'), 'none'),
  'triggers=' || coalesce((select md5(string_agg(pg_get_triggerdef(t.oid), chr(10) order by t.tgrelid::regclass::text, t.tgname))
     from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relnamespace = 'public'::regnamespace and not t.tgisinternal), 'none'),
  'relation_privileges=' || coalesce((select md5(string_agg(c.relkind::text || ':' || c.relname || ':' || coalesce(c.relacl::text, 'default'), chr(10) order by c.relkind::text, c.relname))
     from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S')), 'none'),
  'function_privileges=' || coalesce((select md5(string_agg(p.oid::regprocedure::text || ':' || coalesce(p.proacl::text, 'default'), chr(10) order by p.oid::regprocedure::text))
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')), 'none'),
  'schema_privileges=' || md5(coalesce((select nspacl::text from pg_namespace where nspname = 'public'), 'default')),
  'extensions=' || coalesce((select md5(string_agg(extname, ',' order by extname)) from pg_extension), 'none'))`;

export function snapshot(run, container) {
  return {
    versions: query(run, container, VERSIONS_SQL),
    rows: query(run, container, ROWS_SQL),
    schema: query(run, container, SCHEMA_SQL),
  };
}

// Names of the schema categories whose fingerprint differs.
export function schemaChanges(before, after) {
  const parse = (s) => new Map(s.split(",").map((kv) => kv.split(/=(.*)/s).slice(0, 2)));
  const a = parse(before);
  const b = parse(after);
  return [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
}

export function runSuite(run, container, test, pending) {
  const problem = unsafeTransactionControl(test.sql);
  if (problem) fail(`${test.name} ${problem}`);
  for (const file of pending) {
    const hazard = migrationHazard(file.sql);
    if (hazard) {
      fail(
        `${file.name} commits or leaves the runner's transaction (${hazard}), which would make a temporarily applied migration permanent`,
      );
    }
  }
  const sql = pending.length ? buildPendingSql(pending, test.sql, test.name) : test.sql;
  const r = psql(run, container, sql);
  const tap = parseTap(r.out);
  if (r.error) tap.errors.push(`could not run docker: ${r.error.message}`);
  else if (r.code !== 0) tap.errors.push(`psql exited with code ${r.code}`);
  return tap;
}

// Runs everything and returns the exit code (0 or 1). Throws RunnerError for a missing prerequisite.
// projectId is required: without it the container identity cannot be verified and the run fails closed.
export function execute({ run, container, projectId, migrations, tests, strict, log }) {
  if (!projectId) fail("projectId is required so the container identity can be verified");
  checkPrerequisites(run, container, projectId);
  if (!tests.length) fail("no supabase/tests/*.test.sql files found");
  const before = snapshot(run, container);
  const applied = before.versions ? before.versions.split(",") : [];
  const problems = migrationProblems(migrations, applied);
  if (problems.length) fail(problems.join("\n"));
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
    if (tap.errors.length) {
      for (const line of tap.context) log(`    ${line}`);
      log(`  stopped at the first SQL error while: ${tap.stage ?? "running the test file"}`);
    }
    for (const reason of reasons) log(`  reason: ${reason}`);
    if (status === "FAILED") failed = true;
    blocked += tap.todo.length;
  }

  const after = snapshot(run, container);
  const changedSchema = schemaChanges(before.schema, after.schema);
  if (after.versions !== before.versions || after.rows !== before.rows || changedSchema.length) {
    log(
      "LEAKED STATE: migration history, table contents or the public schema changed during the run",
    );
    if (after.versions !== before.versions || after.rows !== before.rows) {
      log(`  before: ${before.versions} | ${before.rows}`);
      log(`  after:  ${after.versions} | ${after.rows}`);
    }
    if (changedSchema.length) log(`  schema categories changed: ${changedSchema.join(", ")}`);
    failed = true;
  } else {
    log(
      "state unchanged: migration history, table contents and the public schema fingerprint are as before",
    );
  }
  if (blocked) log(`NOT FULLY PASSING: ${blocked} assertion(s) blocked by a TODO`);
  return failed || (strict && blocked > 0) ? 1 : 0;
}

export function dockerRun(args, input) {
  const r = spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, error: r.error };
}

// Reads *.sql files of a directory. Migration directories list every .sql file (any case) so that a malformed
// name is reported by migrationProblems instead of being skipped; suffix narrows the listing for test files.
export function readSql(dir, suffix = /\.sql$/i, extra = {}) {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).filter((f) => suffix.test(f));
  names.sort();
  return names.map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8"), dir, ...extra }));
}

// The migration and test files a run uses. Default: the real folders only. withProposed adds the proposed folders.
export function collectFiles(withProposed, root = ".") {
  const p = (d) => join(root, d);
  return {
    migrations: [
      ...readSql(p("supabase/migrations")),
      ...(withProposed
        ? readSql(p("supabase/proposed-migrations"), /.sql$/i, { proposed: true })
        : []),
    ],
    tests: [
      ...readSql(p("supabase/tests"), /.test.sql$/),
      ...(withProposed ? readSql(p("supabase/proposed-tests"), /.test.sql$/) : []),
    ],
  };
}

export function main(argv = process.argv, env = process.env) {
  try {
    assertLocalEnvironment(env);
    if (!existsSync("supabase/config.toml")) fail("run this from the repository root");
    const projectId = parseProjectId(readFileSync("supabase/config.toml", "utf8"));
    if (!projectId) fail("project_id not found in supabase/config.toml");
    const { migrations, tests } = collectFiles(argv.includes("--proposed"));
    process.exitCode = execute({
      run: dockerRun,
      container: `supabase_db_${projectId}`,
      projectId,
      migrations,
      tests,
      strict: argv.includes("--strict"),
      log: console.log,
    });
  } catch (e) {
    if (!(e instanceof RunnerError)) throw e;
    console.error(`test-db: ${e.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith("test-db.mjs")) main();
