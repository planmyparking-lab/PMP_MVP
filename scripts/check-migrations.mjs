#!/usr/bin/env node
// Static migration lint (CLD-02). Usage: node scripts/check-migrations.mjs [migrations-dir]
// Rules: names look like 0001_short_name.sql; numbers are unique and contiguous from 0001;
// every table created in the public schema enables row level security in the same file;
// no policy is literally true. It reads files only and never connects to a database;
// pgTAP (supabase/tests) checks the real catalog.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const FILE_RE = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

const NAME = String.raw`(?:"?(\w+)"?\.)?"?(\w+)"?`;
const CREATE_TABLE = new RegExp(String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?${NAME}`, "g");
const ENABLE_RLS = new RegExp(
  String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${NAME}\s+enable\s+row\s+level\s+security`,
  "g",
);
const TRUE_POLICY = /\b(?:using|with\s+check)\s*\(\s*true\s*\)/;

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function publicTables(text, pattern) {
  const tables = new Set();
  for (const m of text.matchAll(pattern)) {
    if ((m[1] ?? "public") === "public") tables.add(m[2]);
  }
  return tables;
}

export function lintSql(name, sql) {
  const errors = [];
  const text = stripComments(sql).toLowerCase();
  const secured = publicTables(text, ENABLE_RLS);
  for (const table of publicTables(text, CREATE_TABLE)) {
    if (!secured.has(table)) {
      errors.push(`${name}: table public.${table} must enable row level security in this file`);
    }
  }
  if (TRUE_POLICY.test(text)) errors.push(`${name}: a policy is literally true`);
  return errors;
}

const pad = (n) => String(n).padStart(4, "0");

// files: [{ name, sql }]. Returns a list of error strings (empty when clean).
export function lintMigrations(files) {
  const errors = [];
  const byNumber = new Map();
  for (const { name, sql } of files) {
    const m = FILE_RE.exec(name);
    if (m) byNumber.set(m[1], [...(byNumber.get(m[1]) ?? []), name]);
    else errors.push(`${name}: file name must look like 0001_short_name.sql`);
    errors.push(...lintSql(name, sql));
  }
  for (const [number, names] of byNumber) {
    if (names.length > 1) errors.push(`duplicate migration number ${number}: ${names.join(", ")}`);
  }
  const numbers = [...byNumber.keys()].map(Number).sort((a, b) => a - b);
  const gap = numbers.findIndex((n, i) => n !== i + 1);
  if (gap !== -1) {
    errors.push(`numbers must be contiguous: expected ${pad(gap + 1)}, found ${pad(numbers[gap])}`);
  }
  return errors;
}

export function lintDirectory(dir) {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  names.sort();
  const files = names.map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
  return lintMigrations(files);
}

if (process.argv[1] && process.argv[1].endsWith("check-migrations.mjs")) {
  const errors = lintDirectory(process.argv[2] ?? "supabase/migrations");
  if (errors.length) {
    console.error(errors.map((e) => `ERROR: ${e}`).join("\n"));
    process.exit(1);
  }
  console.log("check-migrations: OK");
}
