import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { FIXTURES_DIR, OUTPUT_FILE, generate } from "./gen-event-parity.mjs";

test("the committed event parity test matches the shared fixtures", () => {
  assert.equal(
    readFileSync(OUTPUT_FILE, "utf8"),
    generate(),
    "supabase/tests/event_parity.test.sql is out of date: run `node scripts/gen-event-parity.mjs --write`",
  );
});

test("the generated test covers every fixture file", () => {
  const sql = generate();
  for (const dir of ["valid", "invalid"]) {
    for (const file of readdirSync(join(FIXTURES_DIR, dir)).filter((f) => f.endsWith(".json"))) {
      assert.ok(
        sql.includes(`'${dir}/${file}'`),
        `${dir}/${file} is missing from the generated test`,
      );
    }
  }
});
