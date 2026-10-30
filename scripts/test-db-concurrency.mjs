#!/usr/bin/env node
// Concurrency regression tests for open_sessions and the conflict detector (SYNC-02 / SYNC-05).
// Usage: node scripts/test-db-concurrency.mjs   (needs the local Supabase database: npx supabase@2.122.0 start)
// pgTAP tests run in one rolled-back transaction, so they cannot race two connections. This script commits its own
// fixtures under random ids, runs two transactions that overlap (the first one holds its transaction open for a
// while), checks the end state, and deletes everything it created. It only talks to the local container.
// PMP_TEST_PSQL="psql -h host -U user -d db" overrides the docker exec command (used to run against any Postgres).
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseProjectId } from "./test-db.mjs";

function psqlCommand() {
  if (process.env.PMP_TEST_PSQL) return process.env.PMP_TEST_PSQL.split(" ");
  const id = parseProjectId(readFileSync("supabase/config.toml", "utf8"));
  if (!id) throw new Error("project_id not found in supabase/config.toml");
  return ["docker", "exec", "-i", `supabase_db_${id}`, "psql", "-U", "postgres"];
}

function run(sql) {
  const [cmd, ...args] = psqlCommand();
  return new Promise((resolve) => {
    const p = spawn(cmd, [...args, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out: out.trim() }));
    p.stdin.end(sql);
  });
}
const evId = () => `018f0000-0000-7000-8000-${randomBytes(6).toString("hex")}`;

const ORG = randomUUID();
const FAC = randomUUID();
const STAFF = randomUUID();
const DEV = randomUUID();
const ZONE = randomUUID();
const HOLD_SECONDS = 1.5; // the first transaction stays open this long; the second starts 0.4 s after it

const entry = (id, session, plate, code) =>
  `insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version, payload)
   values ('${id}', '${FAC}', '${DEV}', '${STAFF}', 'ENTRY', '${session}', now(), 1,
   '{"vehicle_class":"CAR","zone_id":"${ZONE}","short_code":"${code}","vehicle_no":"${plate}"}');`;
const exit = (id, session) =>
  `insert into public.events (id, facility_id, device_id, staff_id, type, session_id, device_time, schema_version, payload)
   values ('${id}', '${FAC}', '${DEV}', '${STAFF}', 'EXIT', '${session}', now(), 1,
   '{"fare_paise":5000,"exit_method":"SCAN"}');`;

const open = (s) =>
  `(select count(*) from public.open_sessions where facility_id='${FAC}' and session_id='${s}')`;
const conflicts = (t, s, status = "OPEN") =>
  `(select count(*) from public.sync_conflicts where facility_id='${FAC}' and type='${t}' and dedupe_key='${s}' and status='${status}')`;

// first = SQL of the transaction that goes first and stays open, second = SQL of the one that overlaps it.
const scenarios = [
  {
    name: "ENTRY racing EXIT leaves no open session",
    sessions: 1,
    first: (s) => entry(evId(), s[0], "UP11AA0001", "AAAA1"),
    second: (s) => exit(evId(), s[0]),
    expect: (s) => ({ sql: open(s[0]), want: "0" }),
  },
  {
    name: "EXIT racing ENTRY leaves no open session and no open orphan",
    sessions: 1,
    first: (s) => exit(evId(), s[0]),
    second: (s) => entry(evId(), s[0], "UP11AA0002", "AAAA2"),
    expect: (s) => ({
      sql: `${open(s[0])} || '/' || ${conflicts("ORPHAN_EXIT", s[0])}`,
      want: "0/0",
    }),
  },
  {
    name: "two EXITs racing create exactly one open DUPLICATE_EXIT",
    sessions: 1,
    first: (s) => exit(evId(), s[0]),
    second: (s) => exit(evId(), s[0]),
    expect: (s) => ({ sql: conflicts("DUPLICATE_EXIT", s[0]), want: "1" }),
  },
  {
    name: "two ENTRYs of one plate in different sessions racing create one DUPLICATE_ENTRY",
    sessions: 2,
    first: (s) => entry(evId(), s[0], "UP11AA0003", "AAAA3"),
    second: (s) => entry(evId(), s[1], "UP11AA0003", "AAAA4"),
    expect: (s) => ({
      sql: `(select count(*) from public.sync_conflicts where facility_id='${FAC}' and type='DUPLICATE_ENTRY'
              and dedupe_key in ('${s[0]}','${s[1]}') and status='OPEN')`,
      want: "1",
    }),
  },
];

async function main() {
  const setup = await run(`
    insert into public.organizations (id, name) values ('${ORG}', 'concurrency-test');
    insert into public.facilities (id, org_id, name, timezone, slot_count) values ('${FAC}', '${ORG}', 'C', 'Asia/Kolkata', 10);
    insert into public.staff (id, facility_id, name, pin_hash, pin_salt) values ('${STAFF}', '${FAC}', 'g', 'h', 's');
    insert into public.devices (id, facility_id, name, auth_user_id) values ('${DEV}', '${FAC}', 'Gate', null);`);
  if (setup.code !== 0) throw new Error(`fixture setup failed: ${setup.out}`);

  let failed = 0;
  try {
    for (const sc of scenarios) {
      const s = Array.from({ length: sc.sessions }, () => evId());
      const a = run(`begin; ${sc.first(s)} select pg_sleep(${HOLD_SECONDS}); commit;`);
      await delay(400);
      const b = run(`begin; ${sc.second(s)} commit;`);
      const [ra, rb] = await Promise.all([a, b]);
      const { sql, want } = sc.expect(s);
      const got = await run(`select ${sql};`);
      const ok = ra.code === 0 && rb.code === 0 && got.out === want;
      console.log(
        `${ok ? "ok" : "NOT OK"} - ${sc.name}${ok ? "" : ` (got ${got.out}, want ${want}; ${ra.out} ${rb.out})`}`,
      );
      if (!ok) failed += 1;
    }
  } finally {
    const clean = await run(`
      delete from public.sync_conflicts where facility_id='${FAC}';
      delete from public.open_sessions where facility_id='${FAC}';
      delete from public.events where facility_id='${FAC}';
      delete from public.devices where facility_id='${FAC}';
      delete from public.staff where facility_id='${FAC}';
      delete from public.facilities where id='${FAC}';
      delete from public.organizations where id='${ORG}';`);
    if (clean.code !== 0) {
      console.log(`cleanup failed, remove facility ${FAC} by hand: ${clean.out}`);
      failed += 1;
    }
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(`test-db-concurrency: ${e.message}`);
  process.exitCode = 1;
});
