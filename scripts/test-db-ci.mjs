#!/usr/bin/env node
// CI database tests (needs a plain PostgreSQL 16 with the pgTAP package and a superuser reachable through the standard
// libpq environment: PGHOST, PGPORT, PGUSER, PGPASSWORD). Usage: CI=true GITHUB_ACTIONS=true node scripts/test-db-ci.mjs
// Creates a throwaway database, applies a minimal Supabase stub and every migration in order, runs every
// supabase/tests/*.test.sql (same TAP rules as `pnpm test:db`), then the two-connection concurrency test, and drops the
// database. It DROPS AND CREATES a database named pmp_ci, so it refuses to run unless both CI=true and
// GITHUB_ACTIONS=true are set (the latter is set automatically by the real runner, not something a developer would
// export locally, so the two together are a much harder guard to trip by accident than CI=true alone).
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
  // CI=true alone is too easy to trigger by accident (many tools and shells set it for unrelated reasons).
  // GITHUB_ACTIONS=true is set automatically by the runner itself and is not something a developer would export
  // locally, so both must be set together before this drops and recreates a database.
  if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") {
    throw new Error(
      "refusing to run: this drops and recreates the database pmp_ci; " +
        "set CI=true and GITHUB_ACTIONS=true (GitHub Actions only)",
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
    // CI only. On a plain Postgres pgTAP installs its two views (pg_all_foreign_keys, tap_funky) into `public`, and the
    // stub's default privileges then give anon and authenticated ALL on them, which the catalog assertions in
    // rls_policies.test.sql rightly reject. On Supabase pgTAP lives in the `extensions` schema, which those assertions
    // do not scan. Only relations that belong to the pgTAP extension are touched: a table or view created by a
    // migration keeps whatever its migration grants, so a missing revoke in a migration still fails the assertions.
    await must(
      db,
      `do $$
       declare r record;
       begin
         for r in
           select c.oid::regclass as rel
           from pg_depend d
           join pg_class c on c.oid = d.objid and d.classid = 'pg_class'::regclass
           join pg_extension e on e.oid = d.refobjid and d.refclassid = 'pg_extension'::regclass
           where e.extname = 'pgtap' and c.relnamespace = 'public'::regnamespace
         loop
           execute format('revoke all on %s from anon, authenticated', r.rel);
         end loop;
       end
       $$;`,
      "removing default privileges from pgTAP's own relations in public",
    );
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
      if (status === "FAILED") {
        failed = true;
        if (t.name.startsWith("rls_policies")) {
          console.log("--- Full rls_policies PostgreSQL output ---");
          console.log(r.out);
        }
      }
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
