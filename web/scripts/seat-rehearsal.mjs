// Seat rehearsal (DW-066) — the two classroom flows that broke in the 2026-09 dress rehearsal:
//   1. a specialist (COO) submits, then hard-refreshes → the form must render (it threw on
//      `price[...]` because a stored slice is only that desk's levers; the app boundary said
//      "Something broke.");
//   2. the instructor moves that player to another firm while their tab is open → the tab must
//      re-seat itself within a poll (~15 s) and a submit must land on the NEW firm, never the old.
// Needs the local transport (`cd server && npm run serve`), the Vite dev server (`cd web && npm run
// dev`), Google Chrome and puppeteer-core. Run: `node web/scripts/seat-rehearsal.mjs` (add `before`
// to stop after step 1). Screenshots land in $SHOTS (default: this directory).
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const T = "http://localhost:8787", W = "http://localhost:5173/";
const instr = { "content-type": "application/json", "x-instructor-pass": "letmein" };
const j = async (r) => { const b = await r.json(); if (!r.ok) throw new Error(`${r.status} ${b.error}`); return b; };
const post = (p, body, h = { "content-type": "application/json" }) => fetch(T + p, { method: "POST", headers: h, body: JSON.stringify(body) }).then(j);
const get = (p, h = {}) => fetch(T + p, { headers: h }).then(j);
const step = process.argv[2] ?? "all";
const SHOTS = process.env.SHOTS ?? new URL(".", import.meta.url).pathname;

const game = await post("/instructor/games", { nFirms: 3, nRounds: 4, firmMode: "team" }, instr);
const peek = await get(`/game?code=${game.joinCode}`);
const [t1, t2] = peek.teams;
const ceo = await post("/join", { code: game.joinCode, name: "Ana", role: "ceo", teamId: t1.teamId, teamName: "Foothills Ales" });
const coo = await post("/join", { code: game.joinCode, name: "Cy", role: "coo", teamId: t1.teamId });
const v0 = await get(`/view?token=${coo.token}`);
// The COO's client sends ONLY the operations desk (DW-051) — this is the slice that broke reloads.
const presence = Object.fromEntries(v0.segments.map((s) => [s.id, s.active ? 1 : 0]));
await post("/submit", { token: coo.token, decision: { firm_id: coo.firmId, presence, run_rate: 0.9, invest_cap: 5, invest_process: 0, invest_Q: 40, invest_water_efficiency: 0, invest_rnd: 0, buy_vertical: [], build_facilities: [], maintain_facilities: {}, mothball_facilities: [], reactivate_facilities: [], divest_facilities: [] } });
console.log(`game ${game.joinCode}: CEO Ana + COO Cy on ${t1.name}; COO slice submitted`);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const errors = [];
const page = await (await browser.createBrowserContext()).newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
page.on("console", (m) => { if (m.type() === "error" && /drinkwars\] render error/.test(m.text())) errors.push(`boundary: ${m.text().slice(0, 160)}`); });
// "Hard refresh" = the saved session is restored from localStorage on load (App.tsx).
await page.goto(W, { waitUntil: "networkidle0" });
await page.evaluate((s) => localStorage.setItem("dw_mp", JSON.stringify(s)), { token: coo.token, config: coo.config, firmId: coo.firmId, nRounds: coo.nRounds, firmMode: "team", role: "coo", claim: coo.claim });
await page.reload({ waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 2500));
const text = await page.evaluate(() => document.body.innerText);
const broke = /Something broke/.test(text);
const deskIn = /Your desk is in/.test(text);
await page.screenshot({ path: `${SHOTS}/seat-reload-${step}.png` });
console.log(`[1 reload after specialist submit] broke=${broke} bannerDeskIn=${deskIn} errors=${errors.length}${errors.length ? "\n   " + errors.join("\n   ") : ""}`);
if (step === "before") { await browser.close(); process.exit(0); }

// (2) instructor moves Cy to the empty firm t2 as CEO while his tab is open.
const roster = await get(`/instructor/games/${game.gameId}/roster`, instr);
const cy = roster.teams.find((t) => t.teamId === t1.teamId).members.find((m) => m.name === "Cy");
t2.firmId = roster.teams.find((t) => t.teamId === t2.teamId).firmId; // peek carries no firm ids
await post(`/instructor/games/${game.gameId}/members`, { op: "move", userId: cy.userId, toTeamId: t2.teamId, role: "ceo" }, instr);
const t0 = Date.now();
let saved = null;
while (Date.now() - t0 < 20000) {
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dw_mp") || "null"));
  if (saved?.firmId === t2.firmId) break;
  await new Promise((r) => setTimeout(r, 500));
}
const text2 = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: `${SHOTS}/seat-moved.png` });
console.log(`[2 move while tab open] re-seated in ${((Date.now() - t0) / 1000).toFixed(1)}s: firmId ${saved?.firmId === t2.firmId ? "→ new firm ✓" : "STILL OLD ✗"}, role=${saved?.role}, page shows "${t2.name}"=${text2.includes(t2.name)} broke=${/Something broke/.test(text2)} errors=${errors.length}`);
// A submit from the re-seated tab lands on the NEW firm (server truth via the instructor status).
const v2 = await get(`/view?token=${saved.token}`);
await post("/submit", { token: saved.token, decision: { ...v2.standing, firm_id: v2.own.id, invest_Q: 12 } });
const st = await get(`/instructor/games/${game.gameId}/status`, instr);
const sub = (id) => st.submissions.find((s) => s.team_id === id)?.submitted;
console.log(`[3 submit after move] view.own=${v2.own.id} (${v2.own.id === t2.firmId ? "new firm ✓" : "old ✗"}); submitted: old firm=${sub(t1.teamId)} new firm=${sub(t2.teamId)}`);
// The stale OLD token can no longer trade for the old firm.
// (The local transport re-seats the session IN PLACE, so the old token is the new session here;
// the edge's stateless token stays stale and hits the lifecycle guard — covered by the unit test.)
const stale = await fetch(T + "/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: coo.token, decision: { firm_id: coo.firmId, invest_Q: 99 } }) });
const st2 = await get(`/instructor/games/${game.gameId}/status`, instr);
console.log(`[4 old-token submit] ${stale.status}; old firm submitted=${st2.submissions.find((s) => s.team_id === t1.teamId)?.submitted} (must stay false)`);
await browser.close();
