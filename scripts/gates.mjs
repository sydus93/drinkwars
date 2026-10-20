#!/usr/bin/env node
// One command for the runbook §0 "green locally" gate (DW-076): every workspace's tests,
// typecheck and build, the edge bundle, and the engine fuzzer — in order, one summary line each,
// full output only for what failed. Exit 1 on any failure.
//
//   npm run gates                 tests + typecheck + builds + fuzz
//   npm run gates -- --balance    + balance and calibrate (slow; honours DW_MODULES)
//   npm run gates -- --audits     + the headless-Chrome audits (starts its own servers; see web/scripts/audit-all.mjs)
//   DW_MODULES=<preset|list>      forwarded to fuzz / balance / calibrate
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const mods = process.env.DW_MODULES;

const steps = [
  ["engine", "npm test"], ["engine", "npm run typecheck"],
  ["server", "npm test"], ["server", "npx tsc --noEmit"], ["server", "npm run build:edge"],
  ["web", "npm test"], ["web", "npx tsc --noEmit"], ["web", "npm run build"],
  ["engine", "npm run fuzz"],
  ...(mods ? [["engine", "npm run fuzz", { DW_MODULES: mods }]] : []),
  ...(args.has("--balance") ? [["engine", "npm run balance", mods ? { DW_MODULES: mods } : {}], ["engine", "npm run calibrate", mods ? { DW_MODULES: mods } : {}]] : []),
  ...(args.has("--audits") ? [[".", "node web/scripts/audit-all.mjs"]] : []),
];

const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
let failed = 0;
const lines = [];
for (const [ws, cmd, env = {}] of steps) {
  const t0 = Date.now();
  const r = spawnSync(cmd, { cwd: path.join(ROOT, ws), shell: true, encoding: "utf8", env: { ...process.env, ...env, FORCE_COLOR: "0" }, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  // Fuzz / balance / calibrate report in prose; take their verdict from the text, not just exit code.
  const verdict = /npm run fuzz/.test(cmd) ? /clean/.test(out) && r.status === 0
    : /balance|calibrate/.test(cmd) ? !/✗ FAIL/.test(out)
    : r.status === 0;
  const tally = (out.match(/^(?:ℹ|#) (pass|fail|skipped) \d+/gm) ?? []).map((x) => x.replace(/^(?:ℹ|#) /, "")).filter((x) => !/^skipped 0$/.test(x)).join(", ")
    || (out.match(/\d+ checks: .*$/m) ?? [])[0]
    || (out.match(/(\d+) PASS.*?(\d+) FAIL/)?.[0] ?? "");
  const line = `${verdict ? "PASS" : "FAIL"}  ${pad(ws, 7)} ${pad(cmd + (env.DW_MODULES ? ` [${env.DW_MODULES}]` : ""), 44)} ${pad(((Date.now() - t0) / 1000).toFixed(0) + "s", 5)} ${tally}`;
  console.log(line);
  lines.push(line);
  if (!verdict) { failed++; console.log(out.split("\n").slice(-40).join("\n")); }
}
console.log(`\n${steps.length - failed}/${steps.length} gates green${failed ? ` — ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
