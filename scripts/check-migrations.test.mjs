import { test } from "node:test";
import assert from "node:assert/strict";
import { URL, fileURLToPath } from "node:url";
import { lintDirectory, lintMigrations, lintSql } from "./check-migrations.mjs";

const GOOD = [
  "create table public.a (id uuid primary key);",
  "alter table public.a enable row level security;",
  "",
].join("\n");
const file = (name, sql = GOOD) => ({ name, sql });

test("a clean, contiguous set passes", () => {
  assert.deepEqual(lintMigrations([file("0001_a.sql"), file("0002_b_c.sql")]), []);
});

test("an empty set passes", () => {
  assert.deepEqual(lintMigrations([]), []);
});

test("duplicate migration numbers are reported", () => {
  const errors = lintMigrations([file("0001_a.sql"), file("0002_b.sql"), file("0002_c.sql")]);
  assert.ok(errors.some((e) => e.includes("duplicate migration number 0002")));
});

test("a gap in the numbering is reported", () => {
  const errors = lintMigrations([file("0001_a.sql"), file("0003_c.sql")]);
  assert.ok(errors.some((e) => e.includes("expected 0002, found 0003")));
});

test("numbering must start at 0001", () => {
  const errors = lintMigrations([file("0002_b.sql")]);
  assert.ok(errors.some((e) => e.includes("expected 0001, found 0002")));
});

test("bad file names are reported", () => {
  const errors = lintMigrations([file("1_a.sql"), file("0002-b.sql"), file("0003_Upper.sql")]);
  assert.equal(errors.filter((e) => e.includes("file name must look like")).length, 3);
});

test("a public table without RLS in the same file is reported", () => {
  const errors = lintSql("0001_a.sql", "create table public.a (id uuid primary key);");
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("table public.a must enable row level security"));
});

test("an unqualified table name counts as public", () => {
  assert.equal(lintSql("0001_a.sql", "create table a (id int);").length, 1);
});

test("RLS enabled in a different file does not count", () => {
  const later = "alter table public.a enable row level security;";
  const first = file("0001_a.sql", "create table public.a (id int);");
  const errors = lintMigrations([first, file("0002_b.sql", later)]);
  assert.equal(errors.length, 1);
});

test("tables outside the public schema are not checked", () => {
  assert.deepEqual(lintSql("0001_a.sql", "create table private.a (id int);"), []);
});

test("quoted table names are checked", () => {
  assert.equal(lintSql("0001_a.sql", 'create table public."Odd" (id int);').length, 1);
});

test("a quoted schema name does not hide the table", () => {
  const errors = lintSql("0001_a.sql", 'create table "public"."x" (id int);');
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("public.x"));
  const secured =
    'create table "public"."x" (id int);\nalter table "public"."x" enable row level security;';
  assert.deepEqual(lintSql("0001_a.sql", secured), []);
});

test("commented-out statements are ignored", () => {
  const sql = "-- create table public.a (id int);\n/* create table public.b (id int); */\n";
  assert.deepEqual(lintSql("0001_a.sql", sql), []);
});

test("a literally true policy is reported", () => {
  const using = `${GOOD}create policy p on public.a for select using (true);`;
  const check = `${GOOD}create policy p on public.a for insert with check ( TRUE );`;
  assert.equal(lintSql("0001_a.sql", using).length, 1);
  assert.equal(lintSql("0001_a.sql", check).length, 1);
});

test("a real policy condition is accepted", () => {
  const sql = `${GOOD}create policy p on public.a for select using (id = auth.uid());`;
  assert.deepEqual(lintSql("0001_a.sql", sql), []);
});

test("a missing directory is not an error", () => {
  assert.deepEqual(lintDirectory("no-such-directory"), []);
});

test("the repository migrations pass", () => {
  const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
  assert.deepEqual(lintDirectory(dir), []);
});
