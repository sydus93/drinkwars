// Headless-Chrome FULL-CLASS rehearsal (DW-073). Needs the memory server (`cd server && npm run serve`),
// the Vite dev server (`cd web && npm run dev`), Google Chrome and `puppeteer-core`.
// Run: `node web/scripts/class-rehearsal.mjs`   (ports: API=… WEB=… env, defaults :8787 / :5173)
// Best run against a production build, which is what students get:
//   cd web && VITE_ENABLE_MP=1 VITE_TRANSPORT_URL=<API> npx vite build --outDir /tmp/dw-dist
//   python3 -m http.server 5190 --directory /tmp/dw-dist     →  WEB=http://localhost:5190
// (against `vite dev`, check (d) prints WARN instead of FAIL — see DEV below).
//
// One Sprint-shaped game — 7 firms, team mode, laborMarket + consumerDrift + marketConduct +
// sustainability, 4 rounds played, the instructor locks + resolves each one — scripted around the
// failures of Sprint 1 (game 42b80c61). 34 seats join; the eight chairs under test (and the
// instructor) are REAL browser pages where every edit and submit goes through the form, the other
// 26 chairs submit their desk slice through the API exactly as the client would send it untouched.
//
//   ALPHA   (a) the "firm 1" shape, CEO submits LAST: CEO types tanks / quality / borrowing /
//               equity, the COO and CFO submit WITHOUT touching those levers → the CEO's numbers run.
//           (c) next round a specialist's form opens on the firm's standing plan.
//           (d) a chair reloads mid-round after submitting, resubmits → nothing drops.
//           (g) the instructor's Decisions tab credits the CEO.   (h) Statements accordions add up.
//   BRAVO   (a) same shape, CEO submits FIRST.   (f) the instructor moves its CFO to CHARLIE mid-round.
//   CHARLIE (b) a COO who CHANGES their own lever beats the CEO, in both submission orders.
//           (c) next round the CEO's form opens on the standing plan, not last round's tab memory.
//   DELTA   (e) a seated CHRO who never submits: the CEO's people-desk entries cover the chair.
//   ECHO…GOLF  five chairs each, API only — the rest of the room.
//   (i) no pageerror / console error on any page, all game long.
//
// Assertions are about OUTCOMES (what the composed plan holds, what resolves, what the screen
// says) — never about how a slice is stored. Prints PASS/FAIL per check; exits 1 on any FAIL.
// NOTE: a hidden tab does not poll (MultiplayerPlay: document.hidden → no fetch), and only one
// page is "visible" at a time here — every read of a page brings it to the front first.
import puppeteer from "puppeteer-core";
import { autoConfirm } from "./confirm-dialog.mjs";
import { describeModules, moduleIds, modulesBlock } from "./modules-env.mjs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const API = (process.env.API ?? "http://localhost:8787").replace(/\/$/, ""), WEB = (process.env.WEB ?? "http://localhost:5173").replace(/\/$/, "") + "/";
// DW-076: MODULES=<preset id | comma list> swaps the class config (default = Sprint 1's four modules).
// The checks below are about the four fundamentals desks, so they hold under any module set.
const MODS = moduleIds(["laborMarket", "consumerDrift", "marketConduct", "sustainability"]);
const PASS = process.env.DW_INSTRUCTOR_PASS ?? "letmein";
const INS = { "content-type": "application/json", "x-instructor-pass": PASS };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const ok = (c, l, d = "") => { const line = `${c ? "PASS" : "FAIL"}  ${l}${d !== "" && d != null ? " — " + d : ""}`; results.push(line); console.log(line); return !!c; };
const logs = [];
// `vite dev` runs React StrictMode, which double-invokes the form-seeding effect; today that makes a
// RELOADED specialist form lose its own one-shot levers (see check (d)). A production build does not.
// Under the dev server that one known gap prints as WARN (and does not fail the run); against a
// build (`vite build` + any static server) it is a hard FAIL. Fix the seeding and it PASSes in both.
const DEV = await fetch(WEB + "@vite/client").then((r) => r.ok && /javascript/.test(r.headers.get("content-type") ?? ""), () => false);
const okProd = (c, l, d = "") => { if (c || !DEV) return ok(c, l, d); const line = `WARN  ${l} — ${d} [dev server only: StrictMode double-seeds the form; passes on a production build]`; warns.push(line); console.log(line); return false; };
const warns = [];
const api = async (path, body, method = body ? "POST" : "GET") => { const r = await fetch(API + path, { method, headers: INS, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j)}`); return j; };
const view = (tok) => fetch(`${API}/view?token=${tok}`).then((r) => r.json());
const waitText = (page, re, t = 20000) => page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), { timeout: t }, re.source);
const has = (page, re) => page.evaluate((src) => new RegExp(src, "i").test(document.body.innerText), re.source);
const near = (a, b, tol = 1) => a != null && b != null && Math.abs(a - b) <= tol;
const usd = (n) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

// ── lever locators (same as desk-audit.mjs) ──
const LOCATE = `(() => {
  const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\\s+/g, " ").trim();
  const labels = (re, sel = "label,span,div,b") => [...document.querySelectorAll(sel)].filter((e) => re.test(own(e)));
  const near = (el, sel, up = 4) => { let p = el; for (let i = 0; i <= up && p; i++) { const c = p.querySelector(sel); if (c) return c; p = p.parentElement; } return null; };
  const first = (re, sel, tags, up) => { for (const l of labels(re, tags)) { const c = near(l, sel, up); if (c) return c; } return null; };
  return {
    invest_cap: () => first(/^Invest in tank capacity/, "input[type=number]", "label", 2),
    invest_Q: () => first(/^Recipe quality$/, "input[type=range]", "label", 2),
    debt_draw: () => first(/^Draw debt \\(cash in\\)$/, "input[type=number]", "label", 1),
    equity_raise: () => first(/^Raise equity \\(cash in\\)$/, "input[type=number]", "label", 1),
    equity_cap_line: () => [...document.querySelectorAll("div")].find((d) => /^Investors will fund up to/.test(d.innerText ?? d.textContent)) ?? null,
    dividend: () => first(/^Pay dividend \\(cash out\\)$/, "input[type=number]", "label", 1),
  };
})()`;
const handle = (page, key) => page.evaluateHandle((LOC, k) => eval(LOC)[k](), LOCATE, key);
const front = async (page) => { await page.bringToFront(); await sleep(250); };
const typeInto = async (page, key, value) => { await front(page); const h = await handle(page, key); if (!(await h.evaluate((e) => !!e))) throw new Error(`no control for ${key}`); await h.click(); await h.evaluate((e) => e.select()); await page.keyboard.press("Backspace"); await h.type(String(value)); await sleep(150); return h.evaluate((e) => e.value); };
const setRange = async (page, key, value) => { await front(page); const h = await handle(page, key); await h.evaluate((e, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, String(v)); e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, value); await sleep(150); return h.evaluate((e) => +e.value); };
const shown = async (page, key) => { await front(page); const h = await handle(page, key); return h.evaluate((e) => (e ? Number(e.value) : null)); };
const dial = (page) => page.evaluate(() => { const m = document.body.innerText.match(/(?:Projected cash|Cash) · pre-sales\s*\n?\s*([−-]?\$-?[\d,]+)/i); return m ? Number(m[1].replace(/[$,]/g, "").replace("−", "-")) : null; });
const myStamp = async (tok) => (await view(tok)).teamPlan?.seats?.find((s) => s.me)?.updated_at ?? null;
/** Click the real submit button, then wait until the SERVER holds a newer slice for this seat. */
const submit = async (page, tag, tok) => {
  await front(page);
  const before = await myStamp(tok), n0 = logs.length;
  const btn = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => /my desk/i.test(b.textContent) && b.getClientRects().length > 0 && !b.disabled));
  if (!(await btn.evaluate((b) => !!b))) throw new Error(`${tag}: no visible submit button`);
  await btn.click();
  for (let i = 0; i < 60; i++) { await sleep(300); if ((await myStamp(tok)) !== before) break; if (i === 59) throw new Error(`${tag}: submit never reached the server`); }
  await waitText(page, /Your desk is in/, 20000);
  return logs.slice(n0).filter((l) => l.startsWith(`[${tag} dialog]`));
};
const watch = async (p, tag) => {
  p.on("pageerror", (e) => logs.push(`[${tag} pageerror] ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/404|validateDOMNesting/.test(m.text())) logs.push(`[${tag} error] ${m.text().slice(0, 200)}`); });
  p.on("dialog", async (d) => { logs.push(`[${tag} dialog] ${d.message().replace(/\s+/g, " ").slice(0, 400)}`); await d.accept(); });
  await autoConfirm(p, (t) => logs.push(`[${tag} dialog] ${t.replace(/\s+/g, " ").slice(0, 400)}`));
};
const mk = async (tag, sess) => {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 1000 });
  await watch(p, tag);
  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => localStorage.setItem("dw_mp", JSON.stringify(s)), sess);
  await p.goto(WEB, { waitUntil: "networkidle0" });
  await waitText(p, /What locks at round end|Commit the round/, 25000);
  await sleep(400);
  return p;
};
const join = async (code, teamId, role, name, teamName) => {
  const r = await fetch(`${API}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name, teamId, role, teamName }) });
  const j = await r.json(); if (!r.ok) throw new Error(`join ${name}: ${JSON.stringify(j)}`);
  return { token: j.token, config: j.config, firmId: j.firmId, nRounds: j.nRounds, firmMode: j.firmMode, role: j.role, claim: j.claim, claimIssued: false };
};
// What an UNTOUCHED client sends: the CEO's whole form (the standing plan), a specialist's own
// desk (seeded from the standing plan). Mirrors web/src/game/multiplayer.ts submit(); the lever
// lists are engine seats.ts DESK_LEVERS restricted to what this config's standing plan carries.
const DESK = { ceo: "all", cmo: "commercial", coo: "operations", chro: "people", cfo: "finance" };
const DESK_KEYS = {
  commercial: ["price", "buy_info", "invest_B"], operations: ["presence", "invest_cap", "invest_process", "invest_Q"],
  people: ["invest_T_emp", "hire_roles"], finance: ["debt_draw", "debt_repay", "equity_raise", "dividend", "invest_T_inv"],
};
const apiSubmit = async (s, patch = {}) => {
  const v = await view(s.token);
  const st = { ...v.standing, hire_roles: [], debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false };
  const desk = DESK[s.role];
  const decision = desk === "all" ? { ...st, ...patch } : { firm_id: st.firm_id, ...Object.fromEntries(DESK_KEYS[desk].map((k) => [k, st[k]])), ...patch };
  const r = await fetch(`${API}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: s.token, decision }) });
  if (!r.ok) throw new Error(`api submit ${s.role}@${s.firmId}: ${r.status} ${await r.text()}`);
};
const composed = async (s) => (await view(s.token)).teamPlan?.composed ?? {};
const toDecide = async (page, wireRound) => {
  await front(page);
  await page.waitForFunction((n) => new RegExp(`Round\\s*${n}\\s*/`).test(document.body.innerText), { timeout: 30000 }, wireRound + 1);
  const d = await page.$("xpath/.//button[contains(normalize-space(.), 'Decide')]"); if (d) await d.click();
  await waitText(page, /What locks at round end|Commit the round/, 20000); await sleep(700);
};

let gameId = null;
try {
// ════ set-up ════
const g = await api("/instructor/games", { nFirms: 7, nRounds: 6, firmMode: "team", title: "class rehearsal", modules: modulesBlock(MODS) });
logs.push(`[info] modules: ${describeModules(MODS)}`);
gameId = g.gameId;
const st0 = await api(`/instructor/games/${gameId}/status`);
const T = Object.fromEntries(st0.teams.map((t) => [t.firmId, t.teamId]));
const NAME = { firm_1: "Alpha Last", firm_2: "Bravo First", firm_3: "Charlie Clash", firm_4: "Delta Cover", firm_5: "Echo", firm_6: "Foxtrot", firm_7: "Golf" };
const ROLES = ["ceo", "cmo", "coo", "chro", "cfo"];
const S = {}; // S[firm][role] → session
for (const f of Object.keys(NAME)) {
  S[f] = {};
  for (const r of ROLES) {
    if (f === "firm_3" && r === "cfo") continue; // CHARLIE's finance chair stays empty until the instructor moves BRAVO's CFO in (f)
    S[f][r] = await join(g.joinCode, T[f], r, `${NAME[f].split(" ")[0]} ${r.toUpperCase()}`, r === "ceo" ? NAME[f] : undefined);
  }
}
const seats = Object.values(S).reduce((n, t) => n + Object.keys(t).length, 0);
ok(seats === 34, "class seated: 7 firms, 34 chairs (CHARLIE's CFO chair left empty for the mid-game move)", `${g.joinCode} ${gameId.slice(0, 8)}`);
const A = S.firm_1, B = S.firm_2, C = S.firm_3, D = S.firm_4;
const P = {
  a_ceo: await mk("a_ceo", A.ceo), a_coo: await mk("a_coo", A.coo), a_cfo: await mk("a_cfo", A.cfo),
  b_ceo: await mk("b_ceo", B.ceo), b_coo: await mk("b_coo", B.coo), b_cfo: await mk("b_cfo", B.cfo),
  c_ceo: await mk("c_ceo", C.ceo), c_coo: await mk("c_coo", C.coo),
};
// the instructor's dashboard in a real page (auto-resume: the same keys the console writes)
const ins = await (async () => {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 1000 });
  await watch(p, "ins");
  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((pass, gid, code) => { localStorage.setItem("dw_instr", JSON.stringify({ pass, gameId: gid, joinCode: code })); sessionStorage.setItem("dw_instr_open", JSON.stringify({ gameId: gid, joinCode: code })); sessionStorage.setItem("dw_instr_view", "dashboard"); }, PASS, gameId, g.joinCode);
  await p.goto(WEB, { waitUntil: "networkidle0" });
  return p;
})();
const rest = async (patches = {}) => { // every API-only chair submits its untouched desk
  for (const f of ["firm_5", "firm_6", "firm_7"]) for (const r of ["cmo", "coo", "chro", "cfo", "ceo"]) await apiSubmit(S[f][r], patches[`${f}.${r}`] ?? {});
};
const resolve = async () => { await api(`/instructor/games/${gameId}/lock`, {}); return api(`/instructor/games/${gameId}/resolve`, { force: true }); };
const panelRow = (dash, firm, round) => dash.panel.find((p) => p.firmId === firm && p.round === round);
const evts = (dash, round) => dash.events.find((e) => e.round === round)?.events ?? [];

// ════ ROUND 1 (wire 0) ════
const v0 = await view(A.ceo.token);
const cash0 = v0.own.cash, std0 = v0.standing;
// (a) ALPHA — specialists first, untouched; the CEO types and submits LAST
await apiSubmit(A.cmo); await apiSubmit(A.chro);
await submit(P.a_coo, "a_coo", A.coo.token);
await submit(P.a_cfo, "a_cfo", A.cfo.token);
const capLine = async (page) => { await front(page); const t = await (await handle(page, "equity_cap_line")).evaluate((e) => e?.innerText ?? ""); return Number((t.match(/up to \$([\d,]+)/) ?? [])[1]?.replace(/,/g, "")) || null; };
const eqCapA = await capLine(P.a_ceo);
const CEO_A = { invest_cap: 120000, invest_Q: 40000, debt_draw: 100000, equity_raise: eqCapA ? Math.floor((eqCapA * 0.5) / 1000) * 1000 : 50000 };
await typeInto(P.a_ceo, "invest_cap", CEO_A.invest_cap); await setRange(P.a_ceo, "invest_Q", CEO_A.invest_Q);
await typeInto(P.a_ceo, "debt_draw", CEO_A.debt_draw); await typeInto(P.a_ceo, "equity_raise", CEO_A.equity_raise);
await sleep(5000); // let this (front) page poll in the teammates' submits
const dialBefore = await dial(P.a_ceo);
const dlgA = await submit(P.a_ceo, "a_ceo", A.ceo.token);
logs.push(`[info] ALPHA CEO r1 confirm: ${dlgA.join(" | ").slice(0, 300) || "none"}`);
let c = await composed(A.ceo);
for (const k of Object.keys(CEO_A)) ok(c[k] === CEO_A[k], `(a) ALPHA, CEO last: the CEO's ${k} runs — untouched ${k.startsWith("invest") ? "COO" : "CFO"} slice does not erase it`, `composed ${usd(c[k])}, CEO typed ${usd(CEO_A[k])}, standing ${usd(std0[k] ?? 0)}`);
await sleep(4500); await front(P.a_ceo); await sleep(600);
const dialA = await dial(P.a_ceo);
const expectDial = cash0 - CEO_A.invest_cap - CEO_A.invest_Q + CEO_A.debt_draw + CEO_A.equity_raise;
// The dial nets the equity issue fee at the base rate (5%); the engine's exact rate moves a few tenths of a point with investor relations.
const expectNet = expectDial - 0.05 * CEO_A.equity_raise;
ok(near(dialBefore, expectNet, 1) && near(dialA, expectNet, 1), "(a) ALPHA CEO's commit dial = cash − the plan that will run, equity net of the issue fee (before and after submitting)", `dial ${usd(dialBefore)} → ${usd(dialA)}, expected ${usd(expectNet)}`);
// (j) DW-076 — the Round Table on BOTH screens says what runs and whose it is: the COO sees the
// CEO's tanks credited to the CEO with the reason ("you left this at last round's value"); the CEO
// sees "✎ you" on the same row; nobody is told an entry of theirs is unused (none is).
await front(P.a_coo);
// wait for the CEO's tanks to reach the COO's table (teammate writes coalesce up to ~10 s; a fixed 4.5 s sleep flaked under load)
await P.a_coo.waitForFunction((n) => { const t = document.body.innerText; const i = t.search(/what will run/i); return i >= 0 && new RegExp(`Capacity capex\\s*\\$?${n}[\\s\\S]{0,80}Alpha CEO · CEO`, "i").test(t.slice(i, i + 4000)); }, { timeout: 20000 }, CEO_A.invest_cap.toLocaleString("en-US")).catch(() => {});
// innerText carries CSS text-transform, so the uppercase chips read "WHAT WILL RUN" / "✎ YOU" — match case-insensitively.
const rt = (page) => page.evaluate(() => { const t = document.body.innerText; const i = t.search(/what will run/i); return i < 0 ? "" : t.slice(i, i + 4000); });
let rtCoo = await rt(P.a_coo);
ok(/what will run/i.test(rtCoo) && new RegExp(`Capacity capex\\s*\\$?${CEO_A.invest_cap.toLocaleString("en-US")}[\\s\\S]{0,80}Alpha CEO · CEO`, "i").test(rtCoo), "(j) ALPHA COO's Round Table: tanks row shows the CEO's number, credited to the CEO", rtCoo.replace(/\n/g, " | ").slice(0, 220));
ok(/You left this at last round's value, so the CEO's entry runs/.test(rtCoo), "(j) ALPHA COO's Round Table explains WHY the CEO's entry runs", rtCoo.match(/left this at last round's value[^|\n]*/)?.[0] ?? "no explanation");
ok(!/not used/.test(rtCoo), "(j) ALPHA COO's Round Table lists no unused entries (an untouched default is not an entry)");
await front(P.a_ceo); await sleep(4500);
const rtCeo = await rt(P.a_ceo);
ok(new RegExp(`Capacity capex\\s*\\$?${CEO_A.invest_cap.toLocaleString("en-US")}[\\s\\S]{0,40}✎ you`, "i").test(rtCeo), "(j) ALPHA CEO's Round Table: tanks row credited '✎ you'", rtCeo.replace(/\n/g, " | ").slice(0, 220));
ok(/Alpha COO · COO left this at last round's value, so the CEO's entry runs/i.test(rtCeo), "(j) ALPHA CEO's Round Table names the chair who yielded");
// (g) the instructor's Decisions tab credits the CEO
await front(ins);
await waitText(ins, /Decisions/, 30000);
await (await ins.waitForSelector("xpath/.//button[normalize-space(.)='Decisions']", { timeout: 15000 })).click();
await waitText(ins, /Team decisions · round 1/, 20000);
const fromOf = async (team, lever) => ins.evaluate((team, lever) => {
  const card = [...document.querySelectorAll("table")].map((t) => t.closest("div")?.parentElement).find((c) => c && c.innerText.includes(team));
  const head = card ? [...card.querySelectorAll("thead th")].map((th) => th.innerText.trim()) : [];
  // DW-080: the lever cell shows the students' label; the key rides in its title
  const tr = card ? [...card.querySelectorAll("tbody tr")].find((r) => r.children[0]?.getAttribute("title") === lever || r.children[0]?.innerText.trim() === lever) : null;
  return tr ? { will: tr.children[1].innerText.trim(), from: tr.children[2].innerText.trim(), col: head[2] } : null;
}, team, lever);
await ins.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 20000 }, NAME.firm_1);
for (const k of ["invest_cap", "invest_Q", "debt_draw", "equity_raise"]) { const r = await fromOf(NAME.firm_1, k); ok(r && /^from$/i.test(r.col) && r.from === "CEO", `(g) instructor Decisions tab: ALPHA ${k} — From = CEO`, JSON.stringify(r)); }

// (a) BRAVO — the CEO types and submits FIRST, then everyone else untouched
const eqCapB = await capLine(P.b_ceo);
const CEO_B = { invest_cap: 90000, invest_Q: 30000, debt_draw: 70000, equity_raise: eqCapB ? Math.floor((eqCapB * 0.4) / 1000) * 1000 : 40000 };
await typeInto(P.b_ceo, "invest_cap", CEO_B.invest_cap); await setRange(P.b_ceo, "invest_Q", CEO_B.invest_Q);
await typeInto(P.b_ceo, "debt_draw", CEO_B.debt_draw); await typeInto(P.b_ceo, "equity_raise", CEO_B.equity_raise);
await submit(P.b_ceo, "b_ceo", B.ceo.token);
await sleep(4500); // specialists' pages must see the CEO's submit the way a student's would
const dlgB = [...(await (async () => { await front(P.b_coo); await sleep(4500); return submit(P.b_coo, "b_coo", B.coo.token); })()), ...(await (async () => { await front(P.b_cfo); await sleep(4500); return submit(P.b_cfo, "b_cfo", B.cfo.token); })())];
logs.push(`[info] BRAVO specialists' confirms: ${dlgB.join(" | ").slice(0, 500) || "none"}`);
await apiSubmit(B.cmo); await apiSubmit(B.chro);
c = await composed(B.ceo);
for (const k of Object.keys(CEO_B)) ok(c[k] === CEO_B[k], `(a) BRAVO, CEO first: the CEO's ${k} still runs after untouched specialists submit`, `composed ${usd(c[k])}, CEO typed ${usd(CEO_B[k])}`);
ok(!dlgB.some((l) => /Yours will be used — it's your desk/.test(l)), "(a) BRAVO: no specialist is told an untouched default of theirs will beat the CEO", dlgB.join(" | ").slice(0, 240) || "no confirm shown");

// (b) CHARLIE — CEO first (200k), then the COO CHANGES tanks (60k) → the COO wins
await typeInto(P.c_ceo, "invest_cap", 200000); await submit(P.c_ceo, "c_ceo", C.ceo.token);
await front(P.c_coo); await sleep(4500);
await typeInto(P.c_coo, "invest_cap", 60000); await submit(P.c_coo, "c_coo", C.coo.token);
await apiSubmit(C.cmo); await apiSubmit(C.chro);
c = await composed(C.ceo);
ok(c.invest_cap === 60000, "(b) CHARLIE, CEO first: a COO who changes tanks beats the CEO", `composed ${usd(c.invest_cap)} (CEO 200,000 · COO 60,000)`);
// (j) …and the losing CEO is told so on the Round Table, in red, with the winner named
await front(P.c_ceo); await waitText(P.c_ceo, /Charlie COO · in/, 30000); await sleep(600); // a backgrounded page polls only once it is in front
const rtC = await rt(P.c_ceo);
ok(/✗ You entered \$200,000 — not used \(Charlie COO · COO's stands\)/i.test(rtC) && /1 entry not used/i.test(rtC), "(j) CHARLIE CEO's Round Table: '✗ You entered $200,000 — not used (Charlie COO · COO's stands)' + the count badge", rtC.replace(/\n/g, " | ").slice(0, 260));
ok(/of your entries will not run|One of your entries will not run/.test(rtC), "(j) CHARLIE CEO's Round Table: the 'one of your entries will not run' banner");

// (e) DELTA — the CHRO is seated and never submits; the CEO's people-desk entries cover the chair
await apiSubmit(D.cmo); await apiSubmit(D.coo); await apiSubmit(D.cfo);
await apiSubmit(D.ceo, { invest_T_emp: 9000, hire_roles: ["head_brewer"] });
c = await composed(D.ceo);
ok(c.invest_T_emp === 9000 && (c.hire_roles ?? []).includes("head_brewer"), "(e) DELTA: silent CHRO chair — the CEO's people spend and hire are in the plan", JSON.stringify({ T_emp: c.invest_T_emp, hires: c.hire_roles }));
await rest({ "firm_5.chro": { hire_roles: ["ops_manager"] } });

const st1 = await api(`/instructor/games/${gameId}/status`);
ok(st1.nonSubmitters.length === 0, "round 1: every firm has a decision before lock", JSON.stringify(st1.nonSubmitters));
await resolve();
let dash = await api(`/instructor/games/${gameId}/dashboard`);
const a1 = panelRow(dash, "firm_1", 0), b1 = panelRow(dash, "firm_2", 0), d1 = panelRow(dash, "firm_4", 0);
const sum = (o) => Object.values(o ?? {}).reduce((x, y) => x + y, 0);
ok(a1 && near(a1.cfLines?.investing?.tanks, -CEO_A.invest_cap) && near(a1.opexLines?.quality, CEO_A.invest_Q) && near(a1.cfLines?.financing?.debt_draw, CEO_A.debt_draw) && (a1.cfLines?.financing?.equity ?? 0) > 0,
  "(a) ALPHA resolved: tanks, quality, loan and equity all booked at the CEO's numbers", JSON.stringify({ tanks: a1?.cfLines?.investing?.tanks, quality: a1?.opexLines?.quality, debt: a1?.cfLines?.financing?.debt_draw, equity: Math.round(a1?.cfLines?.financing?.equity ?? 0) }));
ok(b1 && near(b1.cfLines?.investing?.tanks, -CEO_B.invest_cap) && near(b1.opexLines?.quality, CEO_B.invest_Q) && near(b1.cfLines?.financing?.debt_draw, CEO_B.debt_draw) && (b1.cfLines?.financing?.equity ?? 0) > 0,
  "(a) BRAVO resolved: tanks, quality, loan and equity all booked at the CEO's numbers", JSON.stringify({ tanks: b1?.cfLines?.investing?.tanks, quality: b1?.opexLines?.quality, debt: b1?.cfLines?.financing?.debt_draw }));
// the dial vs what the engine did to cash before sales: capex + financing + the discretionary opex lines
const FIXED = new Set(["overhead", "tank_upkeep", "regulatory"]);
const discretionary = Object.entries(a1?.opexLines ?? {}).filter(([k]) => !FIXED.has(k)).reduce((s, [, v]) => s + v, 0);
const engineDecisionCash = cash0 + sum(a1?.cfLines?.investing) + sum(a1?.cfLines?.financing) - discretionary;
const issueFee = CEO_A.equity_raise - (a1?.cfLines?.financing?.equity ?? 0);
ok(near(dialA, engineDecisionCash, 0.005 * CEO_A.equity_raise), "(a) ALPHA CEO's dial = the engine's pre-sales cash (capex + financing − discretionary spend), to within half a point of the equity raised", `dial ${usd(dialA)} · engine ${usd(engineDecisionCash)} · engine's issue fee ${usd(issueFee)}`);
ok(evts(dash, 0).some((e) => /^HIRE: firm_4 brings on a head brewer/.test(e)) && near(d1?.opexLines?.community, 9000), "(e) DELTA resolved: the CEO's hire lands and the people spend is booked", `${evts(dash, 0).filter((e) => /firm_4/.test(e)).join(" | ").slice(0, 120)} · opex ${JSON.stringify(d1?.opexLines)}`);

// (h) ALPHA CEO → Review › Statements: every accordion's items add up to its total
await front(P.a_ceo);
await waitText(P.a_ceo, /Income statement/i, 30000);
const acc = await P.a_ceo.evaluate(async () => {
  const num = (t) => { t = t.trim(); if (t === "—" || t === "") return 0; if (t === "·") return null; const neg = /^\(.*\)$/.test(t); const n = Number(t.replace(/[(),$]/g, "")); return Number.isFinite(n) ? (neg ? -n : n) : null; };
  for (const b of [...document.querySelectorAll("button[aria-expanded='false']")]) b.click();
  await new Promise((r) => setTimeout(r, 400));
  const out = [];
  for (const b of [...document.querySelectorAll("button[aria-expanded='true']")]) {
    const tr = b.closest("tr"); if (!tr) continue;
    const cells = (r) => [...r.children].slice(1).map((td) => td.innerText);
    const total = num(cells(tr)[0]);
    let items = 0, n = 0, bad = false;
    for (let r = tr.nextElementSibling; r && r.className.includes("text-[0.74rem]"); r = r.nextElementSibling) { const v = num(cells(r)[0]); if (v == null) bad = true; else { items += v; n++; } }
    out.push({ label: b.innerText.trim(), total, items, n, bad });
  }
  return out;
});
ok(acc.length >= 3 && acc.every((x) => x.n > 0 && !x.bad && Math.abs(x.total - x.items) <= x.n), "(h) Statements: each open accordion's line items sum to its total (±$1 rounding per line)", acc.map((x) => `${x.label} ${x.total} = Σ${x.n} ${x.items}`).join(" · "));
ok(acc.some((x) => /Operating expense/i.test(x.label)) && await has(P.a_ceo, /Recipe quality/), "(h) Operating expense opens into named lines (Recipe quality shown)", acc.map((x) => x.label).join(", "));

// ════ ROUND 2 (wire 1) ════
for (const p of Object.values(P)) await toDecide(p, 1);
// (c) forms open on the firm's standing plan, not this tab's memory of last round
const cCeoTanks = await shown(P.c_ceo, "invest_cap"), aCooTanks = await shown(P.a_coo, "invest_cap"), aCeoLoan = await shown(P.a_ceo, "debt_draw"), aCeoEq = await shown(P.a_ceo, "equity_raise");
ok(cCeoTanks === 60000, "(c) CHARLIE CEO's form opens on the standing plan (60,000), not the 200,000 they typed last round", `shows ${usd(cCeoTanks)}`);
ok(aCooTanks === CEO_A.invest_cap, "(c) ALPHA COO's form opens on the standing plan (the CEO's 120,000), not their own untouched 25,600", `shows ${usd(aCooTanks)}`);
ok(aCeoLoan === 0 && aCeoEq === 0, "(c) one-shot financing does not carry: ALPHA CEO's loan and equity fields open at 0", `debt ${aCeoLoan}, equity ${aCeoEq}`);
// (d) ALPHA — CFO changes the dividend and submits; CEO then types new tanks + a loan; CFO and COO reload and resubmit
await apiSubmit(A.cmo); await apiSubmit(A.chro);
await submit(P.a_coo, "a_coo", A.coo.token);
await typeInto(P.a_cfo, "dividend", 5000); await submit(P.a_cfo, "a_cfo", A.cfo.token);
await typeInto(P.a_ceo, "invest_cap", 150000); await typeInto(P.a_ceo, "debt_draw", 60000);
await sleep(4500); await submit(P.a_ceo, "a_ceo", A.ceo.token);
c = await composed(A.ceo);
ok(c.invest_cap === 150000 && c.debt_draw === 60000 && c.dividend === 5000, "(a) ALPHA r2: CEO's new tanks + loan run, and the CFO's own dividend change stands", JSON.stringify({ tanks: c.invest_cap, debt: c.debt_draw, dividend: c.dividend }));
for (const [page, tag, s] of [[P.a_cfo, "a_cfo", A.cfo], [P.a_coo, "a_coo", A.coo]]) {
  await front(page); await page.reload({ waitUntil: "networkidle0" }); await waitText(page, /What locks at round end|Commit the round/, 25000); await sleep(4500);
  await submit(page, tag, s.token);
}
c = await composed(A.ceo);
ok(c.invest_cap === 150000 && c.debt_draw === 60000, "(d) ALPHA: CFO and COO reload after submitting and resubmit — the CEO's tanks and loan still run", JSON.stringify({ tanks: c.invest_cap, debt: c.debt_draw }));
okProd(c.dividend === 5000, "(d) …and the CFO's own dividend survives their reload + resubmit", JSON.stringify({ tanks: c.invest_cap, debt: c.debt_draw, dividend: c.dividend }));
const planA2 = c; // what the server holds for ALPHA after the reloads — the round must resolve at exactly this
const cfoDiv = await shown(P.a_cfo, "dividend");
okProd(cfoDiv === 5000, "(d) the CFO's reloaded form still shows their own dividend", `shows ${usd(cfoDiv)}`);
// (a) BRAVO r2 — CEO first again
await typeInto(P.b_ceo, "invest_cap", 95000); await submit(P.b_ceo, "b_ceo", B.ceo.token);
await front(P.b_coo); await sleep(4500); await submit(P.b_coo, "b_coo", B.coo.token);
await front(P.b_cfo); await sleep(4500); await submit(P.b_cfo, "b_cfo", B.cfo.token);
await apiSubmit(B.cmo); await apiSubmit(B.chro);
c = await composed(B.ceo);
ok(c.invest_cap === 95000, "(a) BRAVO r2, CEO first: the CEO's tanks run", `composed ${usd(c.invest_cap)}`);
// (b) CHARLIE r2 — the COO changes tanks FIRST (80k), the CEO types 300k after → the COO still wins
await typeInto(P.c_coo, "invest_cap", 80000); await submit(P.c_coo, "c_coo", C.coo.token);
await front(P.c_ceo); await sleep(4500);
await typeInto(P.c_ceo, "invest_cap", 300000); const dlgC = await submit(P.c_ceo, "c_ceo", C.ceo.token);
await apiSubmit(C.cmo); await apiSubmit(C.chro);
c = await composed(C.ceo);
ok(c.invest_cap === 80000, "(b) CHARLIE r2, CEO last: a COO who changes tanks still beats the CEO", `composed ${usd(c.invest_cap)} (COO 80,000 · CEO 300,000)`);
ok(dlgC.some((l) => /Theirs will be used/.test(l)), "(b) the CEO is told before submitting that the COO's value will be used", dlgC.join(" | ").slice(0, 200) || "no confirm shown");
await sleep(4500); await front(P.c_ceo); await sleep(600);
const stdC = (await view(C.ceo.token));
const dialC = await dial(P.c_ceo);
ok(near(dialC, stdC.own.cash - 80000), "(b) CHARLIE CEO's dial prices the COO's 80,000, not the 300,000 on the CEO's own form", `dial ${usd(dialC)}, cash ${usd(stdC.own.cash)}`);
// DW-077: the gap is a row in the panel's differs block — the COO's number LOCKS, the CEO's 300,000 is the struck "you typed", and the form-alone cash is named under the team number.
ok(await has(P.c_ceo, /Capacity capex\s*\n\s*COO Charlie COO's desk — they changed it\s*\n\s*Locks\s*\n\s*\$80,000\s*\n\s*You typed\s*\n\s*\$300,000/i) && await has(P.c_ceo, /Your form alone would give/i), "(b) the CEO's commit panel names the gap: Capacity capex · COO's desk — they changed it · locks $80,000 · you typed $300,000, plus the form-alone cash", (await P.c_ceo.evaluate(() => document.body.innerText.match(/Capacity capex\s*\n[^\n]*\n[^\n]*\n[^\n]*/)?.[0]))?.replace(/\n/g, " | "));
for (const r of ["cmo", "coo", "cfo", "ceo"]) await apiSubmit(D[r]); // DELTA: CHRO silent again
await rest();
await resolve();
dash = await api(`/instructor/games/${gameId}/dashboard`);
const a2 = panelRow(dash, "firm_1", 1), c2 = panelRow(dash, "firm_3", 1);
ok(a2 && near(a2.cfLines?.investing?.tanks, -planA2.invest_cap) && near(a2.cfLines?.financing?.debt_draw, planA2.debt_draw) && near(-(a2.cfLines?.financing?.dividend ?? a2.cfLines?.financing?.dividends ?? 0), planA2.dividend ?? 0), "ALPHA r2 resolved exactly at the composed plan (tanks, loan, dividend)", JSON.stringify(a2?.cfLines?.financing) + " tanks " + a2?.cfLines?.investing?.tanks);
ok(c2 && near(c2.cfLines?.investing?.tanks, -80000), "CHARLIE r2 resolved at the COO's 80,000", JSON.stringify(c2?.cfLines?.investing));

// ════ ROUND 3 (wire 2) — (f) the instructor moves BRAVO's CFO to CHARLIE mid-round ════
for (const p of Object.values(P)) await toDecide(p, 2);
await typeInto(P.b_cfo, "dividend", 7000); await submit(P.b_cfo, "b_cfo", B.cfo.token);
c = await composed(B.ceo);
ok(c.dividend === 7000, "(f) before the move: BRAVO's plan carries its CFO's dividend", usd(c.dividend));
const roster = await api(`/instructor/games/${gameId}/roster`);
const mover = roster.teams.find((t) => t.firmId === "firm_2").members.find((m) => m.role === "cfo");
await api(`/instructor/games/${gameId}/members`, { op: "move", userId: mover.userId, toTeamId: T.firm_3, role: "cfo" });
await apiSubmit(B.ceo); // any BRAVO submit recomposes; the moved chair's slice must not trade for BRAVO
c = await composed(B.ceo);
ok((c.dividend ?? 0) === 0, "(f) after the move: the moved CFO's dividend no longer trades for BRAVO", usd(c.dividend));
await front(P.b_cfo);
const header = (page) => page.evaluate(() => (document.querySelector("header")?.innerText ?? document.body.innerText.slice(0, 300)).replace(/\n+/g, " | "));
const reseated = await P.b_cfo.waitForFunction((n) => (document.querySelector("header")?.innerText ?? "").toUpperCase().includes(n.toUpperCase()), { timeout: 30000 }, NAME.firm_3).then(() => true, () => false);
ok(reseated, "(f) the moved player's open tab re-seats itself at CHARLIE without a reload", (await header(P.b_cfo)).slice(0, 120));
if (!reseated) { await P.b_cfo.reload({ waitUntil: "networkidle0" }); }
await toDecide(P.b_cfo, 2); await sleep(1500);
ok((await shown(P.b_cfo, "dividend")) === 0, "(f) the re-seated form does not carry the dividend typed for the old firm", `dividend field ${await shown(P.b_cfo, "dividend")}`);
await typeInto(P.b_cfo, "debt_draw", 30000);
const moverTok = await P.b_cfo.evaluate(() => JSON.parse(localStorage.getItem("dw_mp")).token);
await submit(P.b_cfo, "b_cfo", moverTok);
c = await composed(C.ceo);
ok(c.debt_draw === 30000, "(f) the moved CFO's first submit lands in CHARLIE's plan", `CHARLIE debt_draw ${usd(c.debt_draw)}`);
ok(((await composed(B.ceo)).debt_draw ?? 0) === 0, "(f) …and not in BRAVO's", "");
for (const [page, tag, s] of [[P.a_ceo, "a_ceo", A.ceo], [P.c_ceo, "c_ceo", C.ceo]]) await submit(page, tag, s.token);
for (const r of ["cmo", "coo", "chro", "cfo"]) { await apiSubmit(A[r]); if (C[r]) await apiSubmit(C[r]); if (r !== "cfo") await apiSubmit(B[r]); if (r !== "chro") await apiSubmit(D[r]); }
await apiSubmit(D.ceo); await rest();
await resolve();
dash = await api(`/instructor/games/${gameId}/dashboard`);
ok(near(panelRow(dash, "firm_3", 2)?.cfLines?.financing?.debt_draw, 30000), "(f) CHARLIE r3 resolved with the moved CFO's loan", JSON.stringify(panelRow(dash, "firm_3", 2)?.cfLines?.financing));

// ════ ROUND 4 (wire 3) — a plain round: every browser chair submits untouched ════
for (const p of Object.values(P)) await toDecide(p, 3);
for (const [page, tag, tok] of [[P.a_coo, "a_coo", A.coo.token], [P.a_cfo, "a_cfo", A.cfo.token], [P.a_ceo, "a_ceo", A.ceo.token], [P.b_ceo, "b_ceo", B.ceo.token], [P.b_coo, "b_coo", B.coo.token], [P.c_coo, "c_coo", C.coo.token], [P.c_ceo, "c_ceo", C.ceo.token], [P.b_cfo, "b_cfo", moverTok]]) await submit(page, tag, tok);
for (const r of ["cmo", "chro"]) { await apiSubmit(A[r]); await apiSubmit(B[r]); await apiSubmit(C[r]); }
for (const r of ["cmo", "coo", "cfo", "ceo"]) await apiSubmit(D[r]);
await rest();
// with nobody touching anything, each plan = last round's standing levers
const stdA = (await view(A.ceo.token)).standing; c = await composed(A.ceo);
ok(c.invest_cap === stdA.invest_cap && c.invest_Q === stdA.invest_Q && (c.debt_draw ?? 0) === 0, "untouched round: ALPHA's plan is exactly its standing plan (nothing invented, no one-shot repeats)", JSON.stringify({ tanks: c.invest_cap, quality: c.invest_Q, debt: c.debt_draw }));
await resolve();
dash = await api(`/instructor/games/${gameId}/dashboard`);
const rows = dash.panel.filter((p) => p.round <= 3);
ok(rows.length === 28 && rows.every((p) => Number.isFinite(p.cash) && Number.isFinite(p.scoreCumulative)), "4 rounds × 7 firms resolved with finite cash and scores", `${rows.length} rows · bankrupt: ${rows.filter((p) => p.round === 3 && p.status !== "active").map((p) => p.firmId).join(", ") || "none"}`);
const gaps = rows.filter((p) => p.opexLines && Math.abs(sum(p.opexLines) - p.opex) > 1);
ok(gaps.length === 0, "every firm-round's opex lines sum to its opex total", gaps.map((p) => `${p.firmId} r${p.round}`).join(", "));
for (const [tag, p] of Object.entries(P)) { await front(p); const at5 = await p.waitForFunction(() => /Round\s*5\s*\//.test(document.body.innerText), { timeout: 30000 }).then(() => true, () => false); if (!at5) ok(false, `${tag}: page followed the game to round 5`); }
ok(true, "every browser chair followed the game to round 5");
await api(`/instructor/games/${gameId}/end`, {}).catch(() => {});
} catch (e) { results.push("ABORT " + e.message); console.log("ABORT " + e.message.split("\n")[0]); if (gameId) await api(`/instructor/games/${gameId}/end`, {}).catch(() => {}); }
// (i) nothing broke on any page
const errs = logs.filter((l) => /pageerror\]|error\]/.test(l));
ok(errs.length === 0, "(i) no pageerror / console error on any page", errs.slice(0, 4).join(" | "));
const fails = results.filter((l) => !l.startsWith("PASS"));
console.log(`DONE ${results.length} checks — ${results.length - fails.length} pass, ${fails.length} fail/abort${warns.length ? `, ${warns.length} warn (dev-server only)` : ""}  [${DEV ? "vite dev server" : "production build"}]`);
console.log("--- logs ---\n" + logs.filter((l) => !/dialog\]/.test(l) || /info/.test(l)).slice(0, 30).join("\n"));
await browser.close();
process.exit(fails.length ? 1 : 0);
