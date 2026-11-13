#!/usr/bin/env node
// Release gate for the production deploy (CLD-09). Reads GitHub check runs as newline-delimited JSON on stdin (one
// object per line, as produced by `gh api ... --jq '.check_runs[]'`) and succeeds only if EVERY required check passed.
// Usage: ... | node scripts/verify-ci-checks.mjs --require check --require db-tests
//
// A required check passes only when at least one run with that name exists and every run with that name has the
// conclusion "success". A missing run, a failed, cancelled, timed out, neutral or SKIPPED run, and a run that has not
// finished (conclusion null) all block the release. Empty input fails: if the API call that feeds this script breaks,
// the release is refused, never allowed. Prints check names and conclusions only.
import { readFileSync } from "node:fs";

export function parseRuns(text) {
  const runs = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    try {
      runs.push(JSON.parse(line));
    } catch {
      throw new Error(`input line ${index + 1} is not valid JSON`);
    }
  }
  return runs;
}

/** Returns one entry per required check: { name, ok, detail }. */
export function evaluateChecks(runs, required) {
  return required.map((name) => {
    const mine = runs.filter((r) => r && r.name === name);
    if (mine.length === 0) return { name, ok: false, detail: "no run found for this commit" };
    const bad = mine.filter((r) => r.conclusion !== "success");
    if (bad.length > 0) {
      const states = [...new Set(bad.map((r) => String(r.conclusion ?? r.status ?? "unknown")))];
      return { name, ok: false, detail: `not successful (${states.join(", ")})` };
    }
    return { name, ok: true, detail: "success" };
  });
}

export function parseArgs(argv) {
  const required = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--require" && argv[i + 1]) required.push(argv[++i]);
    else throw new Error(`unexpected argument: ${argv[i]}`);
  }
  if (required.length === 0) throw new Error("give at least one --require <check name>");
  return required;
}

if (process.argv[1] && process.argv[1].endsWith("verify-ci-checks.mjs")) {
  try {
    const required = parseArgs(process.argv.slice(2));
    const results = evaluateChecks(parseRuns(readFileSync(0, "utf8")), required);
    for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}: ${r.detail}`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error(
        `::error::required CI job(s) not passed for this commit: ${failed.map((f) => f.name).join(", ")}; ` +
          "deploy only commits that passed CI on main",
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(`::error::verify-ci-checks: ${error.message}`);
    process.exit(2);
  }
}
