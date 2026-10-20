#!/usr/bin/env node
// Every headless-Chrome audit in one go (DW-076): starts the memory server and the Vite dev
// server on their own ports, waits for both, runs the audits in sequence, then kills exactly the
// processes it started (by PID group — never by command line). Needs Google Chrome + puppeteer-core.
//
//   node web/scripts/audit-all.mjs                      desk, ui, probe-covers, class-rehearsal, layout
//   AUDITS=desk,class node web/scripts/audit-all.mjs    a subset (desk | ui | probe | class | expansion | layout)
//   PORT=8797 WEB_PORT=5183 …                           ports (defaults 8797 / 5183, so a dev server you
//                                                       have open on 8787 / 5173 is left alone)
//   MODULES=<preset|comma list>                         forwarded to the scripts that take it
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(WEB_DIR, "..");
const PORT = process.env.PORT ?? "8797", WEB_PORT = process.env.WEB_PORT ?? "5183";
const API = `http://localhost:${PORT}`, WEB = `http://localhost:${WEB_PORT}`;
const ALL = { desk: "desk-audit.mjs", ui: "ui-audit.mjs", probe: "probe-covers.mjs", class: "class-rehearsal.mjs", expansion: "expansion-rehearsal.mjs", layout: "layout-audit.mjs" };
const want = (process.env.AUDITS ?? "desk,ui,probe,class,layout").split(",").map((s) => s.trim()).filter((k) => ALL[k] && existsSync(path.join(WEB_DIR, "scripts", ALL[k])));

const kids = [];
const start = (cmd, args, cwd, env = {}) => {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", () => {}); p.stderr.on("data", () => {});
  kids.push(p);
  return p;
};
const stopAll = () => { for (const p of kids) { try { process.kill(-p.pid, "SIGTERM"); } catch { /* already gone */ } } };
process.on("exit", stopAll); process.on("SIGINT", () => { stopAll(); process.exit(130); });

const up = async (url, ms = 60_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 400)); }
  return false;
};

start("npm", ["run", "serve"], path.join(ROOT, "server"), { PORT });
start("npx", ["vite", "--port", WEB_PORT, "--strictPort"], WEB_DIR, { VITE_ENABLE_MP: "1", VITE_TRANSPORT_URL: API });
if (!(await up(`${API}/health`)) || !(await up(WEB))) { console.error(`servers did not come up (${API}, ${WEB})`); process.exit(2); }

let failed = 0;
for (const k of want) {
  const t0 = Date.now();
  const r = await new Promise((res) => {
    const p = spawn("node", [path.join("scripts", ALL[k])], { cwd: WEB_DIR, env: { ...process.env, API, WEB }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
    p.on("close", (code) => res({ code, out }));
  });
  const counts = r.out.match(/(\d+) pass(?:ed)?,? (\d+) fail/i)?.[0] ?? `${(r.out.match(/^PASS/gm) ?? []).length} pass, ${(r.out.match(/^FAIL/gm) ?? []).length} fail`;
  // A script that aborted mid-run can still exit 0 — trust its own tally over the exit code.
  const bad = r.code !== 0 || /^(FAIL|ABORT)/m.test(r.out) || Number(counts.match(/(\d+) fail/)?.[1] ?? 0) > 0;
  if (bad) failed++;
  console.log(`${bad ? "FAIL" : "PASS"}  ${ALL[k].padEnd(26)} ${(((Date.now() - t0) / 1000).toFixed(0) + "s").padEnd(5)} ${counts}`);
  if (bad) console.log(r.out.split("\n").filter((l) => /^FAIL|^ABORT|Error|error/.test(l)).slice(0, 30).join("\n"));
}
stopAll();
console.log(`\n${want.length - failed}/${want.length} audits green${failed ? ` — ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
