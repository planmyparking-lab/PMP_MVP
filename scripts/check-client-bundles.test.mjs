import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { keyValueFromEnv, position, scanTargets, scanText } from "./check-client-bundles.mjs";

// Key-shaped fixtures are assembled at run time from low-entropy parts, so no JWT, secret key or random-looking
// string is committed (the repository's gitleaks scan would rightly flag one).
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const jwt = (payload) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.${b64("signature")}`;
const SERVICE_JWT = jwt({
  iss: "supabase",
  ref: "abcdefghijklmnop",
  role: "service_role",
  exp: 1999999999,
});
const ANON_JWT = jwt({ iss: "supabase", ref: "abcdefghijklmnop", role: "anon", exp: 1999999999 });
const SECRET_KEY = ["sb", "secret", "x".repeat(32)].join("_");
// Stands in for a real key value supplied through the environment; deliberately not random.
const KEY_VALUE = "z".repeat(40);
const rules = (text, opts) => scanText(text, opts).map((f) => f.rule);

test("clean client code has no findings", () => {
  assert.deepEqual(rules('const url="https://x.supabase.co";fetch(url,{headers:{apikey:k}})'), []);
});

test("the anon key is allowed in client output (it is public and RLS-bound)", () => {
  assert.deepEqual(rules(`const k="${ANON_JWT}"`), []);
});

test("a service-role JWT is reported", () => {
  assert.deepEqual(rules(`const k="${SERVICE_JWT}"`), ["service-role-jwt"]);
});

test("a malformed JWT-shaped string is ignored, not a crash", () => {
  assert.deepEqual(rules("eyJhbGciOi.eyJub3QganNvbg.sig eyJ!!.eyJ??.x"), []);
});

test("the variable name and the role literal are reported in code", () => {
  assert.deepEqual(rules("process.env.SUPABASE_SERVICE_ROLE_KEY"), ["service-role-env-name"]);
  assert.deepEqual(rules('if(r==="service_role")x()'), ["service-role-literal"]);
});

test("source maps are checked for keys only, not for names in library comments", () => {
  const map = `{"sourcesContent":["// Never expose your \`service_role\` key; SUPABASE_SERVICE_ROLE_KEY"]}`;
  assert.deepEqual(rules(map, { sourceMap: true }), []);
  assert.deepEqual(rules(`{"sourcesContent":["${SERVICE_JWT}"]}`, { sourceMap: true }), [
    "service-role-jwt",
  ]);
});

test("a Supabase secret key is reported, the library's bare prefix check is not", () => {
  assert.deepEqual(rules(`k="${SECRET_KEY}"`), ["supabase-secret-key"]);
  assert.deepEqual(
    rules('let a=e=>e.startsWith("sb_publishable_")||e.startsWith("sb_secret_")'),
    [],
  );
});

test("the configured key value is found wherever it appears", () => {
  const keyValue = KEY_VALUE;
  const found = scanText(`a ${keyValue} b ${keyValue}`, { keyValue });
  assert.deepEqual(
    found.map((f) => f.rule),
    ["service-role-key-value", "service-role-key-value"],
  );
});

test("keyValueFromEnv ignores unset, short and placeholder values", () => {
  assert.equal(keyValueFromEnv({}), undefined);
  assert.equal(keyValueFromEnv({ SUPABASE_SERVICE_ROLE_KEY: "short" }), undefined);
  assert.equal(keyValueFromEnv({ SUPABASE_SERVICE_ROLE_KEY: "replace-me" }), undefined);
  assert.equal(
    keyValueFromEnv({ SUPABASE_SERVICE_ROLE_KEY: "  a-real-looking-key-of-length-30  " }),
    "a-real-looking-key-of-length-30",
  );
});

test("position is 1-based line and column", () => {
  assert.deepEqual(position("ab\ncd\nef", 0), { line: 1, column: 1 });
  assert.deepEqual(position("ab\ncd\nef", 4), { line: 2, column: 2 });
  assert.deepEqual(position("ab\ncd\nef", 6), { line: 3, column: 1 });
});

// ---- directory scans ---------------------------------------------------------------------------------------------

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "pmp-bundles-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const CONSOLE_OK = {
  "apps/console/.next/static/chunks/a.js": "console.log(1)",
  "apps/console/.next/server/app/index.html": "<html></html>",
};

test("clean console output passes and counts the files it scanned", () => {
  const root = fixture(CONSOLE_OK);
  try {
    assert.deepEqual(scanTargets(["console"], { root }), { errors: [], findings: [], scanned: 2 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("server bundles are not scanned, prerendered pages are", () => {
  const root = fixture({
    ...CONSOLE_OK,
    "apps/console/.next/server/app/page.js": "process.env.SUPABASE_SERVICE_ROLE_KEY", // server code: allowed
    "apps/console/.next/server/chunks/x.js": "process.env.SUPABASE_SERVICE_ROLE_KEY",
    "apps/console/.next/server/app/report.rsc": `0:{"k":"${SERVICE_JWT}"}`,
  });
  try {
    const { findings } = scanTargets(["console"], { root });
    assert.deepEqual(findings, [
      {
        file: "apps/console/.next/server/app/report.rsc",
        line: 1,
        column: 9,
        rule: "service-role-jwt",
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a key inside binary gate output is found with its line and column", () => {
  const bytes = Buffer.concat([
    Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0x00, 0x0a, 0xff]),
    Buffer.from(`xx${SECRET_KEY}`, "latin1"),
    Buffer.from([0x00, 0x01]),
  ]);
  const root = fixture({ "apps/gate/dist/_expo/static/js/android/entry.hbc": bytes });
  try {
    const { findings } = scanTargets(["gate"], { root });
    assert.deepEqual(findings, [
      {
        file: "apps/gate/dist/_expo/static/js/android/entry.hbc",
        line: 2,
        column: 4,
        rule: "supabase-secret-key",
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing build output is an error, never a silent pass", () => {
  const root = fixture({});
  try {
    const { errors, scanned } = scanTargets(["console", "gate"], { root });
    assert.equal(scanned, 0);
    assert.ok(errors.some((e) => e.includes("apps/console/.next/static not found")));
    assert.ok(errors.some((e) => e.includes("apps/console/.next/server/app not found")));
    assert.ok(errors.some((e) => e.includes("apps/gate/dist not found")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an existing but empty output directory is an error", () => {
  const root = fixture({});
  mkdirSync(join(root, "apps/gate/dist"), { recursive: true });
  try {
    assert.deepEqual(scanTargets(["gate"], { root }).errors, [
      "gate: no files to scan (run `pnpm --filter @pmp/gate run bundle:android` first)",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- command line ------------------------------------------------------------------------------------------------

const SCRIPT = fileURLToPath(new URL("./check-client-bundles.mjs", import.meta.url));
const run = (cwd, args, env = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: "", ...env },
  });

test("CLI: exit 0 on clean output, 1 on a finding without printing the value, 2 on bad input", () => {
  const root = fixture(CONSOLE_OK);
  try {
    const ok = run(root, ["console"]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /check-client-bundles: OK \(console; 2 files scanned\)/);

    const keyValue = KEY_VALUE;
    writeFileSync(join(root, "apps/console/.next/static/chunks/b.js"), `const k="${keyValue}"`);
    const leak = run(root, ["console"], { SUPABASE_SERVICE_ROLE_KEY: keyValue });
    assert.equal(leak.status, 1);
    assert.match(
      leak.stderr,
      /apps\/console\/\.next\/static\/chunks\/b\.js:1:10 service-role-key-value/,
    );
    assert.ok(!leak.stderr.includes(keyValue), "the key value must never be printed");

    assert.equal(run(root, ["gate"]).status, 2); // no gate output in this fixture
    assert.equal(run(root, ["toString"]).status, 2); // not a target, even though it is an object key
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
