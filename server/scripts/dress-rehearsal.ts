/**
 * Dress rehearsal provisioner — creates a small human-playable game via the transport
 * API and prints the join code + claim codes, then leaves it running. No simulated
 * load (that's prod-rehearsal.ts); this one is for playing chairs yourself in a few
 * browser tabs and trying to break things (see runbook §0b).
 *
 * Layout: 3 firms. Group 1 fully seated (all 5 chairs), Group 2 partial (CEO + CMO,
 * so empty-desk covers happen), Group 3 empty (a move target for member-move tests),
 * plus one unseated bench student for late-add/seat-move tests.
 *
 *   cd server && npx tsx scripts/dress-rehearsal.ts                  # local (:8787, pass letmein)
 *   cd server && DW_INSTRUCTOR_PASS=… npx tsx scripts/dress-rehearsal.ts --prod
 *
 * Options (env): ROUNDS=12 BASE=<url> MODULES=<preset id | comma list, e.g. laborMarket,sustainability;
 * default full>. Re-runs reuse the "dress" cohort (idempotent)
 * but create a fresh game each time — end old ones from the instructor console.
 */
import { PRESETS } from "drinkwars-engine";

const PROD = "https://kikmdmldfgakdabbsdcq.supabase.co/functions/v1/drinkwars";
const BASE = process.argv.includes("--prod") ? (process.env.BASE ?? PROD) : (process.env.BASE ?? "http://localhost:8787");
// Test tier (server/.env DW_INSTRUCTOR_PASS_TEST) is scoped to its own games; your primary pass still sees them.
const PASS = process.env.DW_INSTRUCTOR_PASS_TEST || process.env.DW_INSTRUCTOR_PASS || "letmein";
const ROUNDS = Math.max(3, Number(process.env.ROUNDS ?? 12));

if (process.argv.includes("--prod") && !process.env.DW_INSTRUCTOR_PASS && !process.env.DW_INSTRUCTOR_PASS_TEST) {
  console.error("Refusing to hit prod with the default passcode. Run:  DW_INSTRUCTOR_PASS=<your pass> npx tsx scripts/dress-rehearsal.ts --prod");
  process.exit(2);
}

const SEATS = [
  { ext: "dress01", name: "G1 CEO", team: "Group 1", role: "ceo" },
  { ext: "dress02", name: "G1 CFO", team: "Group 1", role: "cfo" },
  { ext: "dress03", name: "G1 CMO", team: "Group 1", role: "cmo" },
  { ext: "dress04", name: "G1 COO", team: "Group 1", role: "coo" },
  { ext: "dress05", name: "G1 CHRO", team: "Group 1", role: "chro" },
  { ext: "dress06", name: "G2 CEO", team: "Group 2", role: "ceo" },
  { ext: "dress07", name: "G2 CMO", team: "Group 2", role: "cmo" },
] as const;
const BENCH = { ext: "dress08", name: "Bench (unseated)" };

async function call(method: string, path: string, body?: unknown, instructor = false): Promise<any> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(instructor ? { "x-instructor-pass": PASS } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200) { console.error(`✗ ${method} ${path} → ${res.status} ${JSON.stringify(json)?.slice(0, 200)}`); process.exit(1); }
  return json;
}

async function main() {
  console.log(`Provisioning dress rehearsal vs ${BASE}\n`);
  // MODULES = a preset id ("full", "base", …) or a comma list of module ids — rehearse the class's exact config.
  const want = process.env.MODULES ?? "full";
  const ids = PRESETS.find((p) => p.id === want)?.modules ?? want.split(",").map((x) => x.trim()).filter(Boolean);
  const modules = Object.fromEntries(ids.map((id) => [id, { enabled: true }]));
  console.log(`Modules: ${ids.length ? ids.join(", ") : "(strategy core only)"}`);

  const game = await call("POST", "/instructor/games", { nFirms: 3, nRounds: ROUNDS, firmMode: "team", modules, configOverride: { classroom: { forecasts: { enabled: true } } } /* DW-077: calls on, as the create form defaults */, title: `DRESS REHEARSAL ${new Date().toISOString().slice(0, 10)}` }, true);
  const roster = await call("POST", "/instructor/roster", { cohort: "dress", roster: [...SEATS.map((s) => ({ external_id: s.ext, name: s.name })), { external_id: BENCH.ext, name: BENCH.name }] }, true);
  const claim = (ext: string) => roster?.students?.find((r: any) => r.external_id === ext)?.claim_code ?? "??";
  await call("POST", `/instructor/games/${game.gameId}/seats`, { plan: SEATS.map((s) => ({ external_id: s.ext, team: s.team, role: s.role })) }, true);

  console.log(`Join code:  ${game.joinCode}`);
  console.log(`Game id:    ${game.gameId}   (${ROUNDS} rounds, team mode, ${want})\n`);
  console.log(`${"seat".padEnd(10)} ${"firm".padEnd(9)} claim code`);
  for (const s of SEATS) console.log(`${s.role.toUpperCase().padEnd(10)} ${s.team.padEnd(9)} ${claim(s.ext)}`);
  console.log(`${"(bench)".padEnd(10)} ${"—".padEnd(9)} ${claim(BENCH.ext)}   ← unseated; use for late-add / seat-move tests`);
  console.log(`\nGroup 2 has no CFO/COO/CHRO (cover tests); Group 3 is empty (move target).`);
  const web = process.env.WEB ?? (process.argv.includes("--prod") ? "devinstein.me/drinkwars" : BASE.replace(/:\d+\/?$/, ":5173")); // local: the vite dev server
  console.log(`Play at ${web} → join with code + claim. Instructor console resumes with the join code.`);
  console.log(`The game is left running — end it from the console (or rerun with a fresh game) when done.`);
}

main().catch((e) => { console.error("fatal:", e instanceof Error ? e.message : e); process.exit(1); });
