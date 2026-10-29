import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import {
  RunnerError,
  appliedWithoutFile,
  assertLocalEnvironment,
  collectFiles,
  SUPABASE_POSTGRES_IMAGE_PREFIXES,
  containerIdentityProblem,
  duplicateVersions,
  migrationHazard,
  migrationProblems,
  readSql,
  schemaChanges,
  scanSql,
  buildPendingSql,
  checkPrerequisites,
  evaluate,
  execute,
  parseProjectId,
  parseTap,
  pendingMigrations,
  runSuite,
  unsafeTransactionControl,
} from "./test-db.mjs";

const files = ["0001_a.sql", "0002_b.sql", "0003_c.sql"].map((name) => ({
  name,
  sql: `-- ${name}`,
}));
const tapOf = (lines) => parseTap(lines.join("\n"));
const TEST_SQL = "begin;\nselect plan(2);\nrollback;\n";
const CLEAN = ["1..2", "ok 1 - a", "ok 2 - b"];

// A fake `docker` that answers by looking at the arguments or the SQL sent on stdin. Nothing real is touched.
function fakeDocker(opts = {}) {
  const o = { versions: "0001,0002", rows: ["public.a=0"], tap: CLEAN, ...opts };
  const calls = [];
  const run = (args, input = "") => {
    calls.push({ args, input });
    if (args[0] === "--version") {
      if (o.noDocker) return { code: 1, out: "", error: new Error("spawn docker ENOENT") };
      return { code: 0, out: "Docker version 29", error: undefined };
    }
    if (args[0] === "context") {
      return {
        code: 0,
        out: o.remoteContext ? "tcp://203.0.113.9:2375" : "npipe:////./pipe/docker",
        error: undefined,
      };
    }
    if (args[0] === "inspect" && args.some((a) => a.includes("Config.Image"))) {
      const image = o.image ?? "public.ecr.aws/supabase/postgres:17";
      return { code: 0, out: `${image}|${o.label ?? "x"}\n`, error: undefined };
    }
    if (args[0] === "inspect") {
      const code = o.stopped ? 1 : 0;
      return { code, out: o.stopped ? "No such object" : "true\n", error: undefined };
    }
    if (input.includes("pg_get_functiondef")) {
      const n = calls.filter((c) => c.input.includes("pg_get_functiondef")).length;
      const s = o.schemas ?? ["functions=aaa,views=bbb"];
      return { code: 0, out: s[Math.min(n - 1, s.length - 1)], error: undefined };
    }
    if (input.includes("pg_extension"))
      return { code: 0, out: o.noPgtap ? "0" : "1", error: undefined };
    if (input.includes("to_regclass"))
      return { code: 0, out: o.noHistory ? "f" : "t", error: undefined };
    if (input.includes("string_agg(version")) return { code: 0, out: o.versions, error: undefined };
    if (input.includes("query_to_xml")) {
      const n = calls.filter((c) => c.input.includes("query_to_xml")).length;
      return { code: 0, out: o.rows[Math.min(n - 1, o.rows.length - 1)], error: undefined };
    }
    return { code: o.exitCode ?? 0, out: o.tap.join("\n"), error: undefined };
  };
  return { run, calls };
}

function runAll(opts = {}, extra = {}) {
  const { run, calls } = fakeDocker(opts);
  const logs = [];
  const args = {
    run,
    container: "supabase_db_x",
    projectId: "x",
    migrations: files.slice(0, 2),
    tests: [{ name: "t.test.sql", sql: TEST_SQL }],
    strict: false,
    log: (line) => logs.push(line),
    ...extra,
  };
  const code = execute(args);
  return { code, logs, calls };
}

test("project id is read from config.toml and comments are ignored", () => {
  assert.equal(parseProjectId('# project_id = "other"\nproject_id = "pmp-mvp"\n'), "pmp-mvp");
  assert.equal(parseProjectId("[api]\nport = 1\n"), null);
});

test("pending migrations are the files not in history, in order", () => {
  const pending = pendingMigrations([files[2], files[0], files[1]], ["0001", "0002"]);
  assert.deepEqual(
    pending.map((f) => f.name),
    ["0003_c.sql"],
  );
  assert.deepEqual(pendingMigrations(files, ["0001", "0002", "0003"]), []);
});

test("an applied version without a file is detected", () => {
  assert.deepEqual(appliedWithoutFile(files, ["0001", "0009"]), ["0009"]);
});

test("a clean run passes", () => {
  assert.deepEqual(evaluate(tapOf(CLEAN)), { status: "PASSED", reasons: [] });
});

test("a TODO failure is blocked, not passed and not failed", () => {
  const tap = tapOf(["1..2", "ok 1 - a", "not ok 2 - b # TODO blocked: reason"]);
  assert.equal(tap.todo.length, 1);
  assert.equal(evaluate(tap).status, "PASSED_WITH_TODO");
});

test("a TODO assertion that now passes fails the run so the wrapper is removed", () => {
  const result = evaluate(tapOf(["1..2", "ok 1 - a", "ok 2 - b # TODO blocked: reason"]));
  assert.equal(result.status, "FAILED");
  assert.ok(result.reasons.some((r) => r.includes("now pass")));
});

test("a skipped assertion fails the run", () => {
  const result = evaluate(tapOf(["1..2", "ok 1 - a", "ok 2 # SKIP not now"]));
  assert.equal(result.status, "FAILED");
  assert.ok(result.reasons.some((r) => r.includes("skipped")));
});

test("a failed assertion fails the run", () => {
  const result = evaluate(tapOf(["1..2", "ok 1 - a", "not ok 2 - b"]));
  assert.equal(result.status, "FAILED");
  assert.ok(result.reasons.some((r) => r.includes("1 assertion(s) failed")));
});

test("a SQL error fails the run even if every assertion passed", () => {
  assert.equal(evaluate(tapOf(["ERROR:  relation does not exist", ...CLEAN])).status, "FAILED");
  assert.equal(evaluate(tapOf(["FATAL:  database is shutting down", ...CLEAN])).status, "FAILED");
});

test("a missing, late or mismatched plan fails the run", () => {
  assert.equal(evaluate(tapOf(["ok 1 - a"])).status, "FAILED");
  assert.equal(evaluate(tapOf(["1..3", "ok 1 - a", "ok 2 - b"])).status, "FAILED");
  assert.equal(evaluate(tapOf(["1..1", "ok 1 - a", "ok 2 - b"])).status, "FAILED");
  assert.equal(evaluate(parseTap("")).status, "FAILED");
});

test("TAP with Windows line endings is parsed", () => {
  const tap = parseTap("1..2\r\nok 1 - a\r\nnot ok 2 - b # TODO x\r\n");
  assert.deepEqual([tap.plan, tap.ok, tap.todo.length], [2, 1, 1]);
});

test("transaction control that would make pending migrations permanent is rejected", () => {
  assert.match(unsafeTransactionControl("begin;\nselect 1;\ncommit;\n"), /must not commit/);
  assert.match(unsafeTransactionControl("begin;\nEND;\n"), /must not commit/);
  assert.match(unsafeTransactionControl("select plan(1);"), /begin;/);
  assert.equal(unsafeTransactionControl(TEST_SQL), null);
});

test("pending migrations are wrapped in one transaction that ends in a rollback", () => {
  const sql = buildPendingSql([files[2]], TEST_SQL);
  assert.ok(
    sql.startsWith(
      "begin;\n\\echo >> applying 0003_c.sql\n-- 0003_c.sql\n\\echo >> running test\nbegin;",
    ),
  );
  assert.match(sql, /rollback;\s+rollback;\s*$/);
});

test("prerequisite: Docker missing", () => {
  assert.throws(
    () => checkPrerequisites(fakeDocker({ noDocker: true }).run, "supabase_db_x", "x"),
    (e) => e instanceof RunnerError && /Docker is not installed/.test(e.message),
  );
});

test("prerequisite: container not running", () => {
  assert.throws(
    () => checkPrerequisites(fakeDocker({ stopped: true }).run, "supabase_db_x", "x"),
    (e) => e instanceof RunnerError && /supabase_db_x is not running/.test(e.message),
  );
});

test("prerequisite: pgTAP not enabled", () => {
  assert.throws(
    () => checkPrerequisites(fakeDocker({ noPgtap: true }).run, "supabase_db_x", "x"),
    (e) => e instanceof RunnerError && /pgtap extension is not enabled/.test(e.message),
  );
});

test("prerequisite: no migration history", () => {
  assert.throws(
    () => checkPrerequisites(fakeDocker({ noHistory: true }).run, "supabase_db_x", "x"),
    (e) => e instanceof RunnerError && /no migration history/.test(e.message),
  );
});

test("all prerequisites present", () => {
  assert.doesNotThrow(() => checkPrerequisites(fakeDocker().run, "supabase_db_x", "x"));
});

test("a clean run exits 0 and reports unchanged state", () => {
  const { code, logs } = runAll();
  assert.equal(code, 0);
  assert.ok(logs.includes("PASSED t.test.sql: 2 ok, 0 failed, 0 todo of 2"));
  assert.ok(logs.some((l) => l.startsWith("state unchanged")));
});

test("with nothing pending the test SQL is sent unchanged", () => {
  const { calls } = runAll();
  const sent = calls.filter((c) => c.input.includes("select plan"));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].input, TEST_SQL);
});

test("pending migrations are sent ahead of the test, inside a rolled-back transaction", () => {
  const { calls, logs } = runAll({}, { migrations: files });
  const sent = calls.filter((c) => c.input.includes("select plan"));
  assert.equal(sent[0].input, buildPendingSql([files[2]], TEST_SQL, "t.test.sql"));
  assert.ok(logs[0].includes("temporary, rolled back: 0003_c.sql"));
});

test("a TODO run exits 0 normally, reports NOT FULLY PASSING, and exits 1 with --strict", () => {
  const tap = ["1..2", "ok 1 - a", "not ok 2 - b # TODO blocked"];
  const normal = runAll({ tap });
  assert.equal(normal.code, 0);
  assert.ok(normal.logs.some((l) => l.startsWith("PASSED_WITH_TODO")));
  assert.ok(normal.logs.some((l) => l.startsWith("NOT FULLY PASSING: 1")));
  assert.equal(runAll({ tap }, { strict: true }).code, 1);
});

test("a failed assertion exits 1", () => {
  assert.equal(runAll({ tap: ["1..2", "ok 1 - a", "not ok 2 - b"] }).code, 1);
});

test("a SQL error in the test or a migration exits 1", () => {
  assert.equal(runAll({ tap: ["ERROR:  syntax error", ...CLEAN] }).code, 1);
});

test("a non-zero psql exit exits 1 even when the TAP output looks clean", () => {
  const { code, logs } = runAll({ exitCode: 2 });
  assert.equal(code, 1);
  assert.ok(logs.some((l) => l.includes("psql exited with code 2")));
});

test("an empty or planless output exits 1", () => {
  assert.equal(runAll({ tap: [] }).code, 1);
  assert.equal(runAll({ tap: ["ok 1 - a"] }).code, 1);
});

test("leaked table contents are detected and fail the run", () => {
  const { code, logs } = runAll({ rows: ["public.a=0", "public.a=3"] });
  assert.equal(code, 1);
  assert.ok(logs.some((l) => l.startsWith("LEAKED STATE")));
});

test("a changed migration history is detected as a leak", () => {
  const { run } = fakeDocker();
  let n = 0;
  const wrapped = (args, input = "") => {
    if (input.includes("string_agg(version"))
      return { code: 0, out: ++n === 1 ? "0001" : "0001,0002" };
    return run(args, input);
  };
  const logs = [];
  const code = execute({
    run: wrapped,
    container: "supabase_db_x",
    projectId: "x",
    migrations: files.slice(0, 2),
    tests: [{ name: "t.test.sql", sql: TEST_SQL }],
    strict: false,
    log: (l) => logs.push(l),
  });
  assert.equal(code, 1);
  assert.ok(logs.some((l) => l.startsWith("LEAKED STATE")));
});

test("an applied migration with no file stops the run before any test", () => {
  const { run, calls } = fakeDocker({ versions: "0001,0002,0009" });
  const args = {
    run,
    container: "supabase_db_x",
    projectId: "x",
    migrations: files.slice(0, 2),
    log: () => {},
  };
  const tests = [{ name: "t.test.sql", sql: TEST_SQL }];
  assert.throws(
    () => execute({ ...args, tests, strict: false }),
    (e) => e instanceof RunnerError && /without a file: 0009/.test(e.message),
  );
  assert.equal(calls.filter((c) => c.input.includes("select plan")).length, 0);
});

test("no test files is an error", () => {
  const { run } = fakeDocker();
  assert.throws(
    () =>
      execute({
        run,
        container: "supabase_db_x",
        projectId: "x",
        migrations: [],
        tests: [],
        strict: false,
        log: () => {},
      }),
    (e) => e instanceof RunnerError && /no supabase\/tests/.test(e.message),
  );
});

test("a test that commits is refused, with or without pending migrations", () => {
  const { run } = fakeDocker();
  const bad = { name: "bad.test.sql", sql: "begin;\nselect plan(1);\ncommit;\n" };
  for (const pending of [[files[2]], []]) {
    assert.throws(
      () => runSuite(run, "c", bad, pending),
      (e) => e instanceof RunnerError && /bad.test.sql must not commit/.test(e.message),
    );
  }
});

test("a pending migration that commits is refused and nothing is sent to the database", () => {
  const { run, calls } = fakeDocker();
  const migration = { name: "0003_c.sql", sql: "create table t (id int);\nCOMMIT;\n" };
  const test_ = { name: "t.test.sql", sql: TEST_SQL };
  assert.throws(
    () => runSuite(run, "c", test_, [migration]),
    (e) => e instanceof RunnerError && /0003_c.sql commits/.test(e.message),
  );
  assert.equal(calls.length, 0);
});

test("a test that does not start a transaction is refused when migrations are pending", () => {
  const { run } = fakeDocker();
  const bad = { name: "bad.test.sql", sql: "select plan(1);\n" };
  assert.throws(() => runSuite(run, "c", bad, [files[2]]), RunnerError);
});

test("a docker failure while running a suite is reported as an error", () => {
  const run = () => ({ code: 1, out: "", error: new Error("spawn docker ENOENT") });
  const tap = runSuite(run, "c", { name: "t.test.sql", sql: TEST_SQL }, []);
  assert.ok(tap.errors.some((e) => e.includes("could not run docker")));
  assert.equal(evaluate(tap).status, "FAILED");
});

test("running from the wrong directory fails clearly without touching Docker", () => {
  const script = fileURLToPath(new URL("./test-db.mjs", import.meta.url));
  const r = spawnSync(process.execPath, [script], { cwd: tmpdir(), encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /run this from the repository root/);
});

test("a version used by two files is reported (proposed file collides with a real migration)", () => {
  const files = [
    { name: "0008_a.sql" },
    { name: "0010_b.sql" },
    { name: "0008_device_heartbeats.sql" },
  ];
  assert.deepEqual(duplicateVersions(files), ["0008: 0008_a.sql, 0008_device_heartbeats.sql"]);
  assert.deepEqual(duplicateVersions([{ name: "0001_a.sql" }, { name: "0002_b.sql" }]), []);
});

test("execute refuses to run when two migration files share a version", () => {
  const migrations = [
    { name: "0001_a.sql", sql: "" },
    { name: "0001_b.sql", sql: "" },
  ];
  assert.throws(() => runAll({}, { migrations }), /more than one migration file/);
});

const NAMES = (list, extra = {}) => list.map((name) => ({ name, sql: "", ...extra }));

test("malformed migration file names are rejected instead of ignored, naming the directory", () => {
  const f = [
    { name: "0001_ok.sql", dir: "supabase/migrations" },
    { name: "8_x.sql", dir: "supabase/proposed-migrations", proposed: true },
    { name: "0009_Bad.sql", dir: "supabase/migrations" },
    { name: "0010_x.SQL", dir: "supabase/migrations" },
    { name: "notes.sql", dir: "supabase/migrations" },
  ];
  const [msg] = migrationProblems(f, []);
  assert.match(msg, /malformed migration file name/);
  for (const bad of [
    "proposed-migrations/8_x.sql",
    "migrations/0009_Bad.sql",
    "0010_x.SQL",
    "notes.sql",
  ]) {
    assert.ok(msg.includes(bad), bad);
  }
  assert.ok(!msg.includes("0001_ok.sql"));
  assert.deepEqual(migrationProblems(NAMES(["0001_ok.sql", "0002_b.sql"]), []), []);
});

test("execute refuses malformed names before any test SQL is sent", () => {
  const migrations = [...files.slice(0, 2), { name: "3_x.sql", sql: "" }];
  const { run, calls } = fakeDocker();
  assert.throws(
    () =>
      execute({
        run,
        container: "supabase_db_x",
        projectId: "x",
        migrations,
        tests: [{ name: "t.test.sql", sql: TEST_SQL }],
        strict: false,
        log: () => {},
      }),
    /malformed migration file name/,
  );
  assert.equal(calls.filter((c) => c.input.includes("select plan")).length, 0);
});

test("a proposed migration cannot mask an already-applied version", () => {
  const f = [
    ...NAMES(["0001_a.sql", "0002_b.sql"]),
    ...NAMES(["0002_other.sql"], { proposed: true }),
  ];
  assert.ok(
    migrationProblems(f, ["0001", "0002"]).some((p) => /more than one migration file/.test(p)),
  );
  const solo = [...NAMES(["0001_a.sql"]), ...NAMES(["0008_p.sql"], { proposed: true })];
  assert.ok(
    migrationProblems(solo, ["0001", "0008"]).some((p) => /already applied.*skipped/.test(p)),
  );
  assert.throws(
    () =>
      runAll(
        { versions: "0001,0002" },
        { migrations: [files[0], { name: "0002_p.sql", sql: "", proposed: true }] },
      ),
    /already applied/,
  );
});

test("out-of-order migrations are rejected: pending below the highest applied, proposed below a real one", () => {
  const below = migrationProblems(NAMES(["0001_a.sql", "0002_b.sql", "0003_c.sql"]), [
    "0001",
    "0003",
  ]);
  assert.ok(
    below.some((p) =>
      /0002_b.sql is not applied but is numbered below the highest applied version 0003/.test(p),
    ),
  );
  const f = [
    ...NAMES(["0001_a.sql", "0009_real.sql"]),
    ...NAMES(["0008_p.sql"], { proposed: true }),
  ];
  assert.ok(
    migrationProblems(f, ["0001"]).some((p) =>
      /proposed migration 0008_p.sql is numbered below the real migration 0009/.test(p),
    ),
  );
  assert.deepEqual(migrationProblems(NAMES(["0001_a.sql", "0002_b.sql"]), ["0001"]), []);
});

test("readSql lists malformed .sql names in a migration directory but keeps .test.sql filtering for tests", () => {
  const dir = mkdtempSync(join(tmpdir(), "migs-"));
  for (const n of ["0001_a.sql", "bad.SQL", "README.md", "x.test.sql"])
    writeFileSync(join(dir, n), "select 1;");
  assert.deepEqual(
    readSql(dir).map((f) => f.name),
    ["0001_a.sql", "bad.SQL", "x.test.sql"],
  );
  assert.deepEqual(
    readSql(dir, /\.test\.sql$/).map((f) => f.name),
    ["x.test.sql"],
  );
  assert.deepEqual(readSql(join(dir, "missing")), []);
  assert.equal(readSql(dir, /\.sql$/i, { proposed: true })[0].proposed, true);
});

test("transaction guard: one-line COMMIT and other terminators are caught", () => {
  const bad = [
    "select 1; COMMIT;",
    "select 1;commit",
    "x; END;",
    "x; END TRANSACTION;",
    "x; ABORT;",
    "x; ROLLBACK;",
    "x; commit and chain;",
    "x; PREPARE TRANSACTION 'a';",
    "x; COMMIT PREPARED 'a';",
  ];
  for (const sql of bad) assert.match(migrationHazard(sql) ?? "", /ends the transaction/, sql);
  assert.match(unsafeTransactionControl("begin; select 1; commit;"), /must not commit or end/);
  assert.match(
    unsafeTransactionControl("begin; rollback; select 1; rollback;"),
    /must not commit or end/,
  );
  assert.match(
    unsafeTransactionControl("begin; select plan(1);\n\\c other\nrollback;"),
    /psql commands/,
  );
  assert.match(migrationHazard("select 1;\n\\c postgres\n"), /psql command/);
  assert.match(migrationHazard("select 1 \\gexec"), /psql command/);
});

test("transaction guard: no false positives on PL/pgSQL, strings, comments and savepoints", () => {
  const fn =
    "create function f() returns void language plpgsql as $$ begin if true then null; end if; commit_x(); end; $$;";
  const clean = [
    fn,
    "create function g() returns int language plpgsql as $body$ begin return 1; end; $body$;",
    "select 'commit;' as a, \"end\" from t; -- commit;\n/* nested /* commit; */ end; */ select 2;",
    "do $$ begin perform 1; end $$;",
    "savepoint a; rollback to savepoint a; release savepoint a;",
    "select E'it\\'s; commit;';",
    "comment on table t is 'rollback;';",
  ];
  for (const sql of clean) assert.equal(migrationHazard(sql), null, sql);
  assert.equal(
    unsafeTransactionControl("-- header\nbegin;\n" + fn + "\nselect plan(1);\nrollback;\n"),
    null,
  );
  assert.deepEqual(scanSql("select 1; -- x\nselect 2;").statements, ["select 1", "select 2"]);
});

test("transaction guard is wired into the runner for pending migrations", () => {
  const { run, calls } = fakeDocker();
  const bad = { name: "0003_c.sql", sql: "create table t (id int); commit;" };
  assert.throws(
    () => runSuite(run, "c", { name: "t.test.sql", sql: TEST_SQL }, [bad]),
    /0003_c.sql commits/,
  );
  assert.equal(calls.length, 0);
});

test("a DDL leak (function, policy or privilege change) fails the run even when counts are unchanged", () => {
  const { code, logs } = runAll({
    schemas: ["functions=aaa,policies=p1", "functions=bbb,policies=p1"],
  });
  assert.equal(code, 1);
  assert.ok(logs.some((l) => l.startsWith("LEAKED STATE")));
  assert.ok(logs.some((l) => /schema categories changed: functions$/.test(l)));
  assert.deepEqual(schemaChanges("a=1,b=2", "a=1,b=3,c=4"), ["b", "c"]);
  assert.equal(runAll({ schemas: ["functions=aaa", "functions=aaa"] }).code, 0);
});

test("Docker safeguards: DOCKER_HOST and DOCKER_CONTEXT are refused, as is a non-local context", () => {
  assert.throws(() => assertLocalEnvironment({ DOCKER_HOST: "tcp://x:2375" }), /DOCKER_HOST/);
  assert.throws(() => assertLocalEnvironment({ DOCKER_CONTEXT: "prod" }), /DOCKER_CONTEXT/);
  assert.doesNotThrow(() => assertLocalEnvironment({}));
  assert.throws(() => runAll({ remoteContext: true }), /not a local socket/);
});

test("container identity: wrong name, non-Supabase image and wrong project label are refused", () => {
  const ok = fakeDocker().run;
  assert.equal(containerIdentityProblem(ok, "supabase_db_x", "x"), null);
  assert.match(containerIdentityProblem(ok, "prod_db", "x"), /unexpected container name/);
  const notSupabase = fakeDocker({ image: "postgres:16" }).run;
  assert.match(
    containerIdentityProblem(notSupabase, "supabase_db_x", "x"),
    /not a supabase\/postgres image/,
  );
  const otherProject = fakeDocker({ label: "other" }).run;
  assert.match(
    containerIdentityProblem(otherProject, "supabase_db_x", "x"),
    /not labelled as Supabase CLI project x/,
  );
  assert.throws(() => runAll({ label: "other" }), /not labelled/);
});

test("migration failures are reported with the failing file and the psql context", () => {
  const out = [
    "1..2",
    ">> applying 0003_c.sql",
    'ERROR:  syntax error at or near "x"',
    "LINE 3: create tabel x",
    "HINT:  did you mean table?",
  ];
  const tap = parseTap(out.join("\n"));
  assert.equal(tap.stage, "applying 0003_c.sql");
  assert.equal(tap.errors.length, 1);
  assert.equal(tap.context.length, 2);
  const { logs, code } = runAll({ tap: out, exitCode: 3 }, { migrations: files });
  assert.equal(code, 1);
  assert.ok(logs.some((l) => /stopped at the first SQL error while: applying 0003_c.sql/.test(l)));
  assert.ok(logs.some((l) => l.includes("LINE 3: create tabel x")));
});

test("DOCKER_HOST is refused before any database access, with or without --proposed", () => {
  const dir = mkdtempSync(join(tmpdir(), "dockerhost-"));
  mkdirSync(join(dir, "supabase"), { recursive: true });
  writeFileSync(join(dir, "supabase/config.toml"), 'project_id = "x"\n');
  const script = fileURLToPath(new URL("./test-db.mjs", import.meta.url));
  const env = { ...process.env, DOCKER_HOST: "tcp://203.0.113.9:2375" };
  for (const args of [[], ["--proposed"]]) {
    const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8", env });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to run with DOCKER_HOST/);
  }
});

test("--proposed adds the proposed folders (flagged proposed) and leaves the default lists unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "wiring-"));
  for (const d of ["migrations", "tests", "proposed-migrations", "proposed-tests"]) {
    mkdirSync(join(dir, "supabase", d), { recursive: true });
  }
  writeFileSync(join(dir, "supabase/migrations/0001_a.sql"), "select 1;");
  writeFileSync(join(dir, "supabase/tests/a.test.sql"), TEST_SQL);
  writeFileSync(join(dir, "supabase/proposed-migrations/0002_p.sql"), "select 2;");
  writeFileSync(join(dir, "supabase/proposed-tests/p.test.sql"), TEST_SQL);
  const base = collectFiles(false, dir);
  assert.deepEqual(
    base.migrations.map((f) => f.name),
    ["0001_a.sql"],
  );
  assert.deepEqual(
    base.tests.map((f) => f.name),
    ["a.test.sql"],
  );
  assert.ok(base.migrations.every((f) => !f.proposed));
  const withProposed = collectFiles(true, dir);
  assert.deepEqual(
    withProposed.migrations.map((f) => f.name),
    ["0001_a.sql", "0002_p.sql"],
  );
  assert.deepEqual(
    withProposed.migrations.map((f) => Boolean(f.proposed)),
    [false, true],
  );
  assert.deepEqual(
    withProposed.tests.map((f) => f.name),
    ["a.test.sql", "p.test.sql"],
  );
});

test("transaction guard: a $ inside an identifier is not a dollar-quote opener (regression: hidden COMMIT)", () => {
  const hidden = [
    "create table t (a$x$ int); commit; create table u (b$x$ int);",
    "select 1 as a$q$; commit; select 2 as b$q$;",
    "select 1 as a$$; commit; select 2 as b$$;",
    "create table t1$x$ (id int); END; create table t2$x$ (id int);",
  ];
  for (const sql of hidden) assert.match(migrationHazard(sql) ?? "", /ends the transaction/, sql);
  assert.match(
    unsafeTransactionControl("begin; select 1 as a$x$; commit; select 2 as b$x$;") ?? "",
    /must not commit or end/,
  );
  assert.match(
    migrationHazard("select 1 as é$x$; commit; select 2 as ü$x$;") ?? "",
    /ends the transaction/,
  );
});

test("transaction guard: real dollar quotes still hide their body, including after punctuation and keywords", () => {
  const clean = [
    "create function f() returns void language plpgsql as $$ begin null; commit_x(); end; $$;",
    "create function f() returns void language plpgsql as $x$ begin null; end; $x$;",
    "select ($$commit;$$);",
    "select 1,$t$commit; rollback;$t$;",
    "do $d$ begin perform 1; end $d$;\nselect a$b$ from t;",
  ];
  for (const sql of clean) assert.equal(migrationHazard(sql), null, sql);
  assert.match(migrationHazard("select $$ x $$; commit;") ?? "", /ends the transaction/);
});

test("container identity: the image must start with a Supabase Postgres registry prefix", () => {
  const accepted = [
    "public.ecr.aws/supabase/postgres:17.11.0.006",
    "supabase/postgres:15.1",
    "docker.io/supabase/postgres:17",
    "ghcr.io/supabase/postgres:17",
  ];
  for (const image of accepted) {
    assert.equal(
      containerIdentityProblem(fakeDocker({ image }).run, "supabase_db_x", "x"),
      null,
      image,
    );
  }
  const refused = [
    "evil/supabase/postgres:17",
    "registry.example.com/supabase/postgres:17",
    "supabase/postgres-clone:1",
    "postgres:16",
    "my-supabase/postgres:1",
    "",
  ];
  for (const image of refused) {
    assert.match(
      containerIdentityProblem(fakeDocker({ image }).run, "supabase_db_x", "x") ?? "",
      /not a supabase\/postgres image/,
      image,
    );
  }
  assert.ok(
    SUPABASE_POSTGRES_IMAGE_PREFIXES.every(
      (p) => p.endsWith("supabase/postgres:") || p.endsWith("/supabase/postgres:"),
    ),
  );
  assert.throws(
    () => runAll({ image: "evil/supabase/postgres:17" }),
    /not a supabase\/postgres image/,
  );
});

test("projectId is required: execute and checkPrerequisites fail closed without it and touch nothing", () => {
  const { run, calls } = fakeDocker();
  const base = {
    run,
    container: "supabase_db_x",
    migrations: files.slice(0, 2),
    tests: [{ name: "t.test.sql", sql: TEST_SQL }],
    strict: false,
    log: () => {},
  };
  for (const projectId of [undefined, "", null]) {
    assert.throws(
      () => execute({ ...base, projectId }),
      (e) => e instanceof RunnerError && /projectId is required/.test(e.message),
    );
    assert.throws(
      () => checkPrerequisites(run, "supabase_db_x", projectId),
      /projectId is required/,
    );
  }
  assert.equal(calls.length, 0);
});
