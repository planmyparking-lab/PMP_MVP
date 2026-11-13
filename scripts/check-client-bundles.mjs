#!/usr/bin/env node
// T-CLD-01-N1: the Supabase service-role key must never reach code that runs on a guard's phone or in a browser.
// Scans BUILT client output (run the builds first) and fails when it finds service-role material.
//
// Usage: node scripts/check-client-bundles.mjs [console] [gate]   (no argument: both)
//   console  apps/console/.next/static (client chunks) and the prerendered pages Next.js serves verbatim
//            (.html, .rsc, .body under apps/console/.next/server/app). Needs `pnpm build`.
//   gate     apps/gate/dist (Hermes bytecode and assets). Needs `pnpm --filter @pmp/gate run bundle:android`.
//
// Findings name the file, line, column and rule, never the matched value. Exit codes: 0 clean, 1 findings,
// 2 usage error or missing/empty build output (a check that scanned nothing must not pass).
// Server output (the rest of apps/console/.next/server) is deliberately not scanned: server code may hold the key.
import { Buffer } from "node:buffer";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

export const TARGETS = {
  console: [
    { dir: "apps/console/.next/static" },
    { dir: "apps/console/.next/server/app", extensions: [".html", ".rsc", ".body"] },
  ],
  gate: [{ dir: "apps/gate/dist" }],
};

export const BUILD_HINT = {
  console: "run `pnpm build` first",
  gate: "run `pnpm --filter @pmp/gate run bundle:android` first",
};

// Rules that look for the key itself apply to every file, source maps included (a served map leaks what it holds).
// The two name rules apply to code only: source maps keep library comments such as "never expose your
// service_role key", which are not a leak.
const ENV_NAME = /SUPABASE_SERVICE_ROLE_KEY/g;
const ROLE_LITERAL = /service_role/g;
const JWT = /eyJ[A-Za-z0-9_-]{2,}\.eyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]*/g;
// New-format Supabase secret keys. A key body is required: supabase-js itself contains the bare prefix check
// `startsWith("sb_secret_")`, which is code, not a key.
const SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{20,}/g;

export const RULES = {
  "service-role-env-name": "references the SUPABASE_SERVICE_ROLE_KEY variable",
  "service-role-literal": "contains the text service_role",
  "service-role-jwt": "contains a JWT whose role claim is service_role",
  "supabase-secret-key": "contains a Supabase secret key (sb_secret_...)",
  "service-role-key-value":
    "contains the value of the SUPABASE_SERVICE_ROLE_KEY environment variable",
};

function decodeJwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? payload.role : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Finds service-role material in one file's text. `text` is the file read as latin1, so binary bundles (Hermes
 * bytecode) keep their ASCII strings at the same offsets. Returns [{ rule, index }], sorted by index.
 */
export function scanText(text, { sourceMap = false, keyValue } = {}) {
  const findings = [];
  const each = (re, rule, accept = () => true) => {
    for (const m of text.matchAll(re)) if (accept(m[0])) findings.push({ rule, index: m.index });
  };
  if (!sourceMap) {
    each(ENV_NAME, "service-role-env-name");
    each(ROLE_LITERAL, "service-role-literal");
  }
  each(JWT, "service-role-jwt", (token) => decodeJwtRole(token) === "service_role");
  each(SECRET_KEY, "supabase-secret-key");
  if (keyValue) {
    for (let i = text.indexOf(keyValue); i !== -1; i = text.indexOf(keyValue, i + 1)) {
      findings.push({ rule: "service-role-key-value", index: i });
    }
  }
  return findings.sort((a, b) => a.index - b.index || a.rule.localeCompare(b.rule));
}

/** 1-based line and column of a character offset. */
export function position(text, index) {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf("\n"); i !== -1 && i < index; i = text.indexOf("\n", i + 1)) {
    line += 1;
    lineStart = i + 1;
  }
  return { line, column: index - lineStart + 1 };
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p));
    else if (entry.isFile()) out.push(p); // symbolic links are not followed
  }
  return out;
}

/**
 * The value of SUPABASE_SERVICE_ROLE_KEY when it looks like a real key, else undefined. Short values and the
 * `.env.example` placeholder are ignored so that they cannot match ordinary text.
 */
export function keyValueFromEnv(env) {
  const v = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  return v.length >= 20 && v !== "replace-me" ? v : undefined;
}

/**
 * Scans the given target names below `root`. Returns { errors, findings, scanned }: errors are setup problems
 * (missing or empty output), findings are leaks as { file, line, column, rule }.
 */
export function scanTargets(names, { root = ".", keyValue } = {}) {
  const errors = [];
  const findings = [];
  let scanned = 0;
  for (const name of names) {
    let targetFiles = 0;
    for (const { dir, extensions } of TARGETS[name]) {
      const abs = join(root, dir);
      if (!existsSync(abs)) {
        errors.push(`${name}: build output ${dir} not found (${BUILD_HINT[name]})`);
        continue;
      }
      const files = listFiles(abs).filter((f) => !extensions || extensions.includes(extname(f)));
      for (const file of files) {
        const text = readFileSync(file).toString("latin1");
        for (const f of scanText(text, { sourceMap: file.endsWith(".map"), keyValue })) {
          findings.push({
            file: relative(root, file).replaceAll("\\", "/"),
            ...position(text, f.index),
            rule: f.rule,
          });
        }
      }
      targetFiles += files.length;
    }
    if (targetFiles === 0 && !errors.some((e) => e.startsWith(`${name}:`))) {
      errors.push(`${name}: no files to scan (${BUILD_HINT[name]})`);
    }
    scanned += targetFiles;
  }
  return { errors, findings, scanned };
}

if (process.argv[1] && process.argv[1].endsWith("check-client-bundles.mjs")) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !Object.hasOwn(TARGETS, a));
  if (unknown.length) {
    console.error(`Unknown target: ${unknown.join(", ")}. Use: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(2);
  }
  const names = args.length ? [...new Set(args)] : Object.keys(TARGETS);
  const { errors, findings, scanned } = scanTargets(names, {
    keyValue: keyValueFromEnv(process.env),
  });
  if (errors.length) {
    console.error(errors.map((e) => `ERROR: ${e}`).join("\n"));
    process.exit(2);
  }
  if (findings.length) {
    for (const f of findings)
      console.error(`${f.file}:${f.line}:${f.column} ${f.rule}: ${RULES[f.rule]}`);
    console.error(
      `check-client-bundles: ${findings.length} finding(s); the service-role key must stay server-side.`,
    );
    process.exit(1);
  }
  console.log(`check-client-bundles: OK (${names.join(", ")}; ${scanned} files scanned)`);
}
