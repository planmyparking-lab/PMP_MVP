#!/usr/bin/env node
// CI database tests (needs a plain PostgreSQL 16 with the pgTAP package and a superuser reachable through the standard
// libpq environment: PGHOST, PGPORT, PGUSER, PGPASSWORD). Usage: CI=true node scripts/test-db-ci.mjs
// Creates a throwaway database, applies a minimal Supabase stub and every migration in order, runs every
// supabase/tests/*.test.sql (same TAP rules as `pnpm test:db`), then the two-connection concurrency test, and drops the
// database. It DROPS AND CREATES a database named pmp_ci, so it refuses to run unless CI=true is set.
// The real local stack (`pnpm test:db`, needs Docker) stays the authority for Supabase-specific behaviour.
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate, parseTap } from "./test-db.mjs";

const DB = "pmp_ci";

function psql(args, sql) {
  return new Promise((resolve) => {
    const p = spawn("psql", ["-X", "-q", "-At", ...args]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", (e) => resolve({ code: 1, out: `could not run psql: ${e.message}` }));
    p.on("close", (code) => resolve({ code: code ?? 1, out }));
    p.stdin.end(sql);
  });
}

const sqlFiles = (dir, suffix) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));

async function must(args, sql, what) {
  const r = await psql([...args, "-v", "ON_ERROR_STOP=1"], sql);
  if (r.code !== 0) throw new Error(`${what} failed:\n${r.out}`);
}

async function main() {
  if (process.env.CI !== "true") {
    throw new Error(
      "refusing to run: this drops and recreates the database pmp_ci; set CI=true (CI only)",
    );
  }
  const admin = ["-d", "postgres"];
  const db = ["-d", DB];
  let failed = false;
  await must(admin, `drop database if exists ${DB};`, "dropping the old test database");
  await must(admin, `create database ${DB};`, "creating the test database");
  try {
    await must(
      db,
      readFileSync("scripts/ci-supabase-stub.sql", "utf8"),
      "applying the Supabase stub",
    );
    await must(db, "create extension pgtap;", "enabling pgTAP (is the pgtap package installed?)");
    for (const m of sqlFiles("supabase/migrations", ".sql")) {
      await must(db, m.sql, `migration ${m.name}`);
      console.log(`applied ${m.name}`);
    }

    for (const t of sqlFiles("supabase/tests", ".test.sql")) {
      const r = await psql(db, t.sql);
      const tap = parseTap(r.out);
      if (r.code !== 0) tap.errors.push(`psql exited with code ${r.code}`);
      const { status, reasons } = evaluate(tap);
      console.log(
        `${status} ${t.name}: ${tap.ok} ok, ${tap.failed.length} failed, ${tap.todo.length} todo of ${tap.plan}`,
      );
      for (const line of [...tap.failed, ...tap.errors, ...tap.skipped, ...tap.todoPassed])
        console.log(`  ${line}`);
      for (const reason of reasons) console.log(`  reason: ${reason}`);
      if (status === "FAILED") failed = true;
    }

    const conc = await new Promise((resolve) => {
      const p = spawn("node", ["scripts/test-db-concurrency.mjs"], {
        env: { ...process.env, PMP_TEST_PSQL: `psql -d ${DB}` },
        stdio: "inherit",
      });
      p.on("close", (code) => resolve(code ?? 1));
    });
    if (conc !== 0) failed = true;
  } finally {
    await must(admin, `drop database if exists ${DB};`, "dropping the test database");
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(`test-db-ci: ${e.message}`);
  process.exitCode = 1;
});
