#!/usr/bin/env node
// Generates supabase/tests/event_parity.test.sql (T-IC01-C1): the shared event fixtures in
// packages/contracts/fixtures/events run through public.ingest_events. Every valid fixture must be ACCEPTED and every
// invalid fixture REJECTED, so SQL and zod cannot drift apart unnoticed.
//   node scripts/gen-event-parity.mjs --write   regenerate the file
//   node scripts/gen-event-parity.mjs --check   fail if the committed file is out of date (also run by `pnpm test:scripts`)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURES_DIR = join(root, "packages/contracts/fixtures/events");
export const OUTPUT_FILE = join(root, "supabase/tests/event_parity.test.sql");

// The valid fixtures all use this facility, device and staff member; the generated test creates them.
const FACILITY = "5f1d2c3e-0000-4000-8000-000000000001";
const DEVICE = "5f1d2c3e-0000-4000-8000-000000000002";
const STAFF = "5f1d2c3e-0000-4000-8000-000000000003";
const DEVICE_USER = "5f1d2c3e-0000-4000-8000-0000000000a1";

// Fixtures that fail today because the SQL-side payload validators (supabase/proposed-migrations/0013_*) are
// staged but not yet promoted to a real migration (OQ-52: the migration number is still unsettled). ingest_events
// only validates the envelope until 0013 is promoted, so these payload-only disagreements are expected.
// Remove this list (and the `todo_start`/`todo_end` wrapping it drives) once 0013 is promoted and 0004 validates
// payloads for real.
const BLOCKED_ON_OQ_52 = new Set([
  "valid/entry-1.json",
  "valid/exit-1.json",
  "valid/override-1.json",
  "valid/payment-1.json",
  "valid/zone-count-1.json",
  "invalid/bad-short-code.json",
  "invalid/fractional-amount.json",
  "invalid/fractional-count.json",
  "invalid/negative-amount.json",
  "invalid/other-without-note.json",
]);
const BLOCKED_REASON =
  "blocked: OQ-52, the 0013 payload validation migration is staged but not yet promoted (number unsettled)";

const q = (text) => `'${String(text).replaceAll("'", "''")}'`;

function load(dir, pick) {
  const path = join(FIXTURES_DIR, dir);
  if (!existsSync(path)) throw new Error(`missing fixtures directory ${path}`);
  return readdirSync(path)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const json = JSON.parse(readFileSync(join(path, file), "utf8"));
      return { name: `${dir}/${file}`, ...pick(json) };
    });
}

export function generate() {
  const valid = load("valid", (json) => ({ valid: true, event: json, path: "" }));
  const invalid = load("invalid", (json) => ({
    valid: false,
    event: json.event,
    path: json.expect_path ?? "",
  }));
  const all = [...valid, ...invalid];
  if (valid.length === 0 || invalid.length === 0) throw new Error("fixtures not found");

  const rows = all
    .map((f) => {
      const literal = JSON.stringify(f.event);
      if (literal.includes("$fx$"))
        throw new Error(`fixture ${f.name} contains the dollar-quote tag`);
      return `  (${q(f.name)}, ${f.valid}, $fx$${literal}$fx$::jsonb)`;
    })
    .join(",\n");

  const assertions = all
    .map((f) => {
      const assertion = f.valid
        ? `select is((select status from public.parity_fixtures where name = ${q(f.name)}), 'ACCEPTED', ${q(`${f.name}: zod accepts it, so ingest_events accepts it`)});`
        : `select is((select status from public.parity_fixtures where name = ${q(f.name)}), 'REJECTED', ${q(`${f.name}: zod rejects it (${f.path || "envelope"}), so ingest_events rejects it`)});`;
      if (!BLOCKED_ON_OQ_52.has(f.name)) return assertion;
      return `select todo_start(${q(BLOCKED_REASON)});\n${assertion}\nselect todo_end();`;
    })
    .join("\n");

  return `-- GENERATED FILE, do not edit. Source: packages/contracts/fixtures/events.
-- Regenerate with \`node scripts/gen-event-parity.mjs --write\`; \`pnpm test:scripts\` fails when this file is out of date.
-- T-IC01-C1: the zod fixtures run through public.ingest_events. Valid fixtures must be ACCEPTED, invalid ones REJECTED.
begin;
select plan(${all.length + 2});

insert into auth.users (id) values ('${DEVICE_USER}');
insert into public.organizations (id, name) values ('5f1d2c3e-0000-4000-8000-0000000000f0', 'Parity org');
insert into public.facilities (id, org_id, name, timezone, slot_count)
  values ('${FACILITY}', '5f1d2c3e-0000-4000-8000-0000000000f0', 'Parity facility', 'Asia/Kolkata', 10);
insert into public.staff (id, facility_id, name, pin_hash, pin_salt, active)
  values ('${STAFF}', '${FACILITY}', 'Parity guard', 'h', 's', true);
insert into public.devices (id, facility_id, name, auth_user_id)
  values ('${DEVICE}', '${FACILITY}', 'Parity gate', '${DEVICE_USER}');

create table public.parity_fixtures (
  name text primary key, expect_valid boolean not null, event jsonb not null,
  status text, reason text, detail text);
grant all on public.parity_fixtures to authenticated;
insert into public.parity_fixtures (name, expect_valid, event) values
${rows};

-- Each fixture is sent alone, invalid ones first, as the enrolled device.
select set_config('request.jwt.claim.sub', '${DEVICE_USER}', true);
set local role authenticated;
do $run$
declare r record; res jsonb;
begin
  for r in select name, event from public.parity_fixtures order by expect_valid, name loop
    res := public.ingest_events(jsonb_build_array(r.event));
    update public.parity_fixtures
       set status = res -> 'results' -> 0 ->> 'status',
           reason = res -> 'results' -> 0 ->> 'reason',
           detail = res -> 'results' -> 0 ->> 'detail'
     where name = r.name;
  end loop;
end
$run$;
reset role;

${assertions}

select is((select count(*)::int from public.events), ${valid.length}, 'exactly the ${valid.length} valid fixtures were stored');
select is((select count(*)::int from public.parity_fixtures where status is null), 0, 'every fixture got a result');

select * from finish();
rollback;
`;
}

const arg = process.argv[2];
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = generate();
  if (arg === "--write") {
    writeFileSync(OUTPUT_FILE, text);
    console.log(`wrote ${OUTPUT_FILE}`);
  } else if (arg === "--check") {
    const current = existsSync(OUTPUT_FILE) ? readFileSync(OUTPUT_FILE, "utf8") : "";
    if (current !== text) {
      console.error(
        "supabase/tests/event_parity.test.sql is out of date: run `node scripts/gen-event-parity.mjs --write`",
      );
      process.exit(1);
    }
    console.log("event parity test is up to date");
  } else {
    console.error("usage: node scripts/gen-event-parity.mjs --write | --check");
    process.exit(2);
  }
}
