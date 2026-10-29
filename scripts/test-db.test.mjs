import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { URL, fileURLToPath } from "node:url";
import {
  RunnerError,
  appliedWithoutFile,
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
    if (args[0] === "inspect") {
      const code = o.stopped ? 1 : 0;
      return { code, out: o.stopped ? "No such object" : "true\n", error: undefined };
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
  assert.ok(sql.startsWith("begin;\n-- 0003_c.sql\nbegin;"));
  assert.match(sql, /rollback;\s+rollback;\s*$/);
});

test("prerequisite: Docker missing", () => {
  assert.throws(
    () => checkPrerequisites(fakeDocker({ noDocker: true }).run, "c"),
    (e) => e instanceof RunnerError && /Docker is not installed/.test(e.message),
  );
});

test("prerequisite: container not running", () => {
  assert.throws(
    () => checkPrerequisites(fakeDocker({ stopped: true }).run, "supabase_db_x"),
    (e) => e instanceof RunnerError && /supabase_db_x is not running/.test(e.message),
  );
});

test("prerequisite: pgTAP not enabled", () => {
  assert.throws(
    () => checkPrerequisites(fakeDocker({ noPgtap: true }).run, "c"),
    (e) => e instanceof RunnerError && /pgtap extension is not enabled/.test(e.message),
  );
});

test("prerequisite: no migration history", () => {
  assert.throws(
    () => checkPrerequisites(fakeDocker({ noHistory: true }).run, "c"),
    (e) => e instanceof RunnerError && /no migration history/.test(e.message),
  );
});

test("all prerequisites present", () => {
  assert.doesNotThrow(() => checkPrerequisites(fakeDocker().run, "c"));
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
  assert.equal(sent[0].input, buildPendingSql([files[2]], TEST_SQL));
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
    container: "c",
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
  const args = { run, container: "c", migrations: files.slice(0, 2), log: () => {} };
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
    () => execute({ run, container: "c", migrations: [], tests: [], strict: false, log: () => {} }),
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
