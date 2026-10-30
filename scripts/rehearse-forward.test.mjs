import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEED_TABLES,
  buildRehearsalSql,
  changedTables,
  main,
  parseRehearsal,
  parseSeedCounts,
  rehearse,
  seedCountsSql,
  seedLeaks,
} from "./rehearse-forward.mjs";
import { RunnerError } from "./test-db.mjs";

const migration = { name: "0003_x.sql", sql: "create table t (id int);" };
const seedOut = (counts) => SEED_TABLES.map((t) => `SEED|${t}|${counts[t] ?? 0}`).join("\n");
const rowsOut = (rows) => rows.map(([t, b, a]) => `REHEARSAL|${t}|${b}|${a}`).join("\n");
const SAME = SEED_TABLES.map((t) => [t, 10, 10]);

// A fake psql: answers by looking at the SQL it is sent. Nothing real is touched.
function fakePsql(o = {}) {
  const calls = [];
  let seedCalls = 0;
  const psql = (sql) => {
    calls.push(sql);
    if (sql.includes("schema_migrations")) {
      return o.historyFails
        ? { code: 1, out: "", err: "no such container" }
        : { code: 0, out: o.applied ?? "0001,0002", err: "" };
    }
    if (sql.includes("SEED|")) {
      seedCalls += 1;
      const counts = seedCalls === 1 ? (o.baseline ?? {}) : (o.after ?? o.baseline ?? {});
      if (o.baselineUnreadable && seedCalls === 1) return { code: 1, out: "", err: "boom" };
      return { code: 0, out: seedOut(counts), err: "" };
    }
    return {
      code: o.runCode ?? 0,
      out: o.runOut ?? `${rowsOut(SAME)}\n`,
      err: o.runErr ?? "",
    };
  };
  return { psql, calls };
}

const run = (o = {}, files = [{ name: "0001_a.sql" }, { name: "0002_b.sql" }, migration]) => {
  const { psql, calls } = fakePsql(o);
  const logs = [];
  const code = rehearse({ psql, files, log: (l) => logs.push(l) });
  return { code, logs, calls };
};

test("a table whose count changed is reported, unchanged tables are not", () => {
  const rows = [
    { table: "zones", before: 10, after: 10 },
    { table: "staff", before: 5, after: 4 },
  ];
  assert.deepEqual(changedTables(rows), ["staff (5 -> 4)"]);
  assert.deepEqual(changedTables(rows.slice(0, 1)), []);
});

test("the rehearsal runs the pending migrations between the before and after counts and always rolls back", () => {
  const sql = buildRehearsalSql([{ name: "0003_x.sql", sql: "-- MIGRATION BODY" }]);
  const order = [
    "begin;",
    "rehearsal_before",
    ">> applying 0003_x.sql",
    "-- MIGRATION BODY",
    "from rehearsal_before b",
    "rollback;",
  ].map((s) => sql.indexOf(s));
  assert.ok(order.every((n) => n >= 0));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
  assert.doesNotMatch(sql, /^\s*commit\s*;/im);
});

test("only tagged lines are parsed: notices, warnings and markers are never read as counts", () => {
  const out = [
    "NOTICE:  zones|1|2",
    "WARNING|zones|1|2",
    ">> applying 0003_x.sql",
    "REHEARSAL|zones|300|300",
    "zones|9|9",
    "REHEARSAL|staff|5|x",
  ].join("\n");
  assert.deepEqual(parseRehearsal(out), [{ table: "zones", before: 300, after: 300 }]);
  const seeds = parseSeedCounts("SEED|zones|4\nNOTICE: SEED|staff|9\nSEED|staff|7\n");
  assert.deepEqual(
    [...seeds],
    [
      ["zones", 4],
      ["staff", 7],
    ],
  );
  assert.match(seedCountsSql(), /SEED\|organizations\|/);
});

test("a clean rehearsal passes and says what it does and does not prove", () => {
  const { code, logs } = run();
  assert.equal(code, 0);
  assert.ok(logs.some((l) => /PASSED \(synthetic-row count preservation only\)/.test(l)));
  assert.ok(logs.some((l) => /applied 0003_x.sql/.test(l)));
});

test("non-empty baseline tables are compared with their own original counts, not with zero", () => {
  const baseline = { organizations: 7, zones: 40, staff: 3 };
  assert.equal(run({ baseline }).code, 0);
  assert.throws(
    () => run({ baseline, after: { ...baseline, organizations: 10 } }),
    /synthetic rows may have been kept.*organizations \(7 -> 10\)/,
  );
  assert.deepEqual(seedLeaks(new Map([["zones", 1]]), new Map([["zones", 2]])), ["zones (1 -> 2)"]);
});

test("the rehearsal fails when no valid table-comparison row was produced", () => {
  for (const runOut of [
    "",
    "NOTICE: something\n",
    "REHEARSAL|zones|x|y\n",
    ">> applying 0003_x.sql\n",
  ]) {
    assert.throws(() => run({ runOut }), /no valid table-comparison rows/);
  }
});

test("a seeded table missing from the comparison is an error", () => {
  const rows = SAME.filter(([t]) => t !== "zones");
  assert.throws(
    () => run({ runOut: rowsOut(rows) }),
    /no comparison row for seeded table\(s\): zones/,
  );
});

test("notices mixed into the output do not change the verdict or the counts", () => {
  const runOut = `NOTICE:  table does not exist, skipping\n${rowsOut(SAME)}\nWARNING:  x|1|2\n`;
  const { code, logs } = run({ runOut });
  assert.equal(code, 0);
  assert.ok(!logs.some((l) => /NaN/.test(l)));
});

test("a changed row count fails the rehearsal with exit 1 and names the table", () => {
  const rows = SEED_TABLES.map((t) => [t, 10, t === "staff" ? 4 : 10]);
  const { code, logs } = run({ runOut: rowsOut(rows) });
  assert.equal(code, 1);
  assert.ok(logs.some((l) => /FAILED, row counts changed: staff \(10 -> 4\)/.test(l)));
});

test("a failing migration is reported with its file name and the psql error", () => {
  assert.throws(
    () =>
      run({
        runCode: 3,
        runOut: ">> applying 0003_x.sql\n",
        runErr: 'ERROR:  syntax error at or near "tabel"\nLINE 1: create tabel t\n',
      }),
    (e) =>
      e instanceof RunnerError &&
      /while applying 0003_x.sql/.test(e.message) &&
      /syntax error at or near "tabel"/.test(e.message),
  );
});

test("bad layouts and unsafe migrations stop the run before any rehearsal SQL is sent", () => {
  const sentRehearsal = (calls) => calls.some((c) => c.includes("rehearsal_before"));
  const cases = [
    [[{ name: "3_x.sql", sql: "" }], /malformed migration file name/],
    [[{ name: "0002_p.sql", sql: "", proposed: true }, { name: "0001_a.sql" }], /already applied/],
    [[migration, { name: "0003_y.sql", sql: "" }], /more than one migration file/],
    [
      [{ name: "0003_x.sql", sql: "create table t (id int); COMMIT;" }],
      /could make itself permanent/,
    ],
    [[{ name: "0003_x.sql", sql: "select 1;\n\\c other\n" }], /psql command/],
  ];
  for (const [files, pattern] of cases) {
    const { psql, calls } = fakePsql();
    assert.throws(() => rehearse({ psql, files, log: () => {} }), pattern);
    assert.equal(sentRehearsal(calls), false);
  }
});

test("nothing pending is a no-op, and an unreadable history or baseline is an error", () => {
  const { code, logs, calls } = run({ applied: "0001,0002,0003" });
  assert.equal(code, 0);
  assert.ok(logs.some((l) => /nothing to rehearse/.test(l)));
  assert.equal(
    calls.some((c) => c.includes("SEED|")),
    false,
  );
  assert.throws(() => run({ historyFails: true }), /cannot read local migration history/);
  assert.throws(() => run({ baselineUnreadable: true }), /cannot read the baseline row counts/);
});

test("DOCKER_HOST is refused before any Docker call", () => {
  const prev = process.exitCode;
  main(["node", "x"], { DOCKER_HOST: "tcp://203.0.113.9:2375" });
  assert.equal(process.exitCode, 1);
  process.exitCode = prev;
});
