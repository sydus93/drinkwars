// Headless-Chrome SPRINT-2 EXPANSION rehearsal (DW-076). Needs the memory server (`cd server && npm run serve`),
// the Vite dev server (`cd web && npm run dev`), Google Chrome and `puppeteer-core`.
// Run: `node web/scripts/expansion-rehearsal.mjs`   (ports: API=… WEB=… env, defaults :8787 / :5173;
//       MODULES=<preset id | comma list> swaps the module set — the checks need geography, facilities, employees)
//
// Sprint 2 (Nov 3) adds geography, international, facilities and employees to Sprint 1's four modules. With
// geography on the Decide form drops the markets card: markets, siting and upkeep live on the City & Globe tab
// and are queued as City View actions; poaches are queued from a rival's dossier. Every one of those is a
// SPECIALIST lever that reaches the server through a different path than the form — this script drives each
// through the real UI on a 7-firm team game and holds the stored plan to what the screen promised.
//
//   ALPHA  (a) the CMO enters a domestic market on City & Globe and submits;
//          (b) the COO sites a facility and submits;
//          (c) the CHRO hires from the talent market with a signing bid; next round gives a raise and poaches a
//              rival's employee (research bought by the CMO that round);
//          (d) the CEO submits an UNTOUCHED form after all of them — nothing of theirs is erased;
//          (e) each specialist reloads mid-round and resubmits unchanged — the entry / build / raid still stand
//              (the "reload-then-resubmit drops this round's City View entry / poaches" bug);
//          (f) lock → the stored decision (instructor decisions endpoint) and the resolved round carry every entry;
//          (g) next round the CEO enters a market while the CMO is silent → it lands;
//          (h) DW-073 on `market_presence`: CMO untouched + CEO changed → the CEO's wins (ALPHA);
//   BRAVO      CMO changed → the CMO's wins, even after the CEO entered a different market first;
//          (j) the Trade tab says when exports open (export_unlock_round passed through the tuning-override path);
//          (k) DW-082d: a build the CEO cancelled for an empty desk reads "not in the team plan" on the CMO's map,
//              and the CMO can withdraw it there;
//          (l) DW-082e: a build the CMO sends AFTER that cancel reads "Waiting on … (CEO)", not "cancelled it";
//   ALPHA  (m) DW-082e: the CEO's map draws the COO's planned build (as a teammate's) before the round resolves;
//          (n) a build the COO sent and then withdrew leaves the COO's map at once (not redrawn as a teammate's);
//          (o) r3, playtest 10-29: the COO updates without touching builds, the CHRO sites one → the CEO's map points
//              to Cancel it, the What locks row has it, one submit drops the build, the CHRO's map names both calls;
//          (i) no pageerror / console error on any page, all game long.
// Assertions are about OUTCOMES (what the composed plan holds, what resolved, what the screen says).
// Prints PASS/FAIL per check; exits 1 on any FAIL. NOTE: a hidden tab does not poll — every read brings
// its page to the front first (same convention as class-rehearsal.mjs).
import puppeteer from "puppeteer-core";
import { autoConfirm } from "./confirm-dialog.mjs";
import { describeModules, moduleIds, modulesBlock } from "./modules-env.mjs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const API = (process.env.API ?? "http://localhost:8787").replace(/\/$/, ""), WEB = (process.env.WEB ?? "http://localhost:5173").replace(/\/$/, "") + "/";
const SPRINT2 = ["geography", "international", "facilities", "employees", "laborMarket", "consumerDrift", "marketConduct", "sustainability"];
const MODS = moduleIds(SPRINT2);
const EXPORT_UNLOCK = 3; // engine (0-based) → the screen says "round 4"; ≠ the default 4 so the override path is proven
const PASS = process.env.DW_INSTRUCTOR_PASS ?? "letmein";
const INS = { "content-type": "application/json", "x-instructor-pass": PASS };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const ok = (c, l, d = "") => { const line = `${c ? "PASS" : "FAIL"}  ${l}${d !== "" && d != null ? " — " + d : ""}`; results.push(line); console.log(line); return !!c; };
const logs = [];
const api = async (path, body, method = body ? "POST" : "GET") => { const r = await fetch(API + path, { method, headers: INS, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j)}`); return j; };
const view = (tok) => fetch(`${API}/view?token=${tok}`).then((r) => r.json());
const waitText = (page, re, t = 20000) => page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), { timeout: t }, re.source);
const has = (page, re) => page.evaluate((src) => new RegExp(src, "i").test(document.body.innerText), re.source);
const front = async (page) => { await page.bringToFront(); await sleep(250); };
const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }); }; // SHOTS=<dir>: eyeball (l)/(m)
const usd = (n) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const J = (o) => JSON.stringify(o ?? null);
const keysOn = (mp) => Object.entries(mp ?? {}).filter(([, w]) => (w ?? 0) > 0).map(([k]) => k).sort();

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
/** An UNTOUCHED CEO submit through the API (the standing plan, one-shots reset), with an optional patch. */
const apiCeo = async (s, patch = {}) => {
  const v = await view(s.token);
  const st = { ...v.standing, hire_roles: [], hire_employees: [], hire_bids: {}, raise_employees: {}, fire_employees: [], poach_employees: [], build_facilities: [], debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, ...patch };
  const r = await fetch(`${API}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: s.token, decision: st }) });
  if (!r.ok) throw new Error(`api submit ceo@${s.firmId}: ${r.status} ${await r.text()}`);
  return v;
};
const composed = async (s) => (await view(s.token)).teamPlan?.composed ?? {};
const myStamp = async (tok) => (await view(tok)).teamPlan?.seats?.find((s) => s.me)?.updated_at ?? null;
/** Click the real submit button, then wait until the SERVER holds a newer slice for this seat. */
const submit = async (page, tag, tok) => {
  await goTab(page, "Decide");
  const before = await myStamp(tok), n0 = logs.length;
  const btn = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => /my desk/i.test(b.textContent) && b.getClientRects().length > 0 && !b.disabled));
  if (!(await btn.evaluate((b) => !!b))) throw new Error(`${tag}: no visible submit button`);
  await btn.click();
  for (let i = 0; i < 60; i++) { await sleep(300); if ((await myStamp(tok)) !== before) break; if (i === 59) throw new Error(`${tag}: submit never reached the server`); }
  await waitText(page, /Your desk is in/, 20000);
  return logs.slice(n0).filter((l) => l.startsWith(`[${tag} dialog]`));
};
/** The three caps pill tabs under the HUD: Decide · Review · City & Globe. */
const goTab = async (page, label) => {
  await front(page);
  const already = await page.evaluate((l) => !![...document.querySelectorAll("button.tt-tab.is-active")].find((b) => b.textContent.includes(l)), label);
  if (already) return;
  const b = await page.evaluateHandle((l) => [...document.querySelectorAll("button.tt-tab")].find((x) => x.textContent.includes(l)), label);
  if (!(await b.evaluate((x) => !!x))) throw new Error(`no "${label}" tab`);
  await b.click(); await sleep(500);
  if (label === "Decide") await waitText(page, /What locks at round end|Commit the round/, 20000);
  if (label === "City") await waitText(page, /Your cities/, 20000);
};
const toDecide = async (page, wireRound) => {
  await front(page);
  await page.waitForFunction((n) => new RegExp(`Round\\s*${n}\\s*/`).test(document.body.innerText), { timeout: 30000 }, wireRound + 1);
  await goTab(page, "Decide"); await sleep(700);
};
const reload = async (page) => { await front(page); await page.reload({ waitUntil: "networkidle0" }); await waitText(page, /What locks at round end|Commit the round/, 25000); await sleep(4500); };

// ── City & Globe drivers ──
/** Click the nth not-yet-entered city in "Your cities" (its row reads "Enter · $…"), then confirm in the modal. */
const enterMarketUI = async (page, nth = 0) => {
  await goTab(page, "City");
  const row = await page.evaluateHandle((n) => [...document.querySelectorAll("button")].filter((b) => /Enter · \$/.test(b.innerText) && /site|Enter/.test(b.innerText))[n] ?? null, nth);
  if (!(await row.evaluate((x) => !!x))) throw new Error("no not-yet-entered city row");
  const name = await row.evaluate((x) => x.innerText.split("\n")[0].trim());
  await row.click(); await sleep(400);
  await waitText(page, /new market/, 8000);
  const go = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Enter market" && !b.disabled));
  if (!(await go.evaluate((x) => !!x))) throw new Error(`entry modal has no enabled "Enter market" (not enough cash?)`);
  await go.click(); await sleep(400);
  return name;
};
/** Site the cheapest permitted facility on the first open parcel of the selected (home) market. */
const siteFacilityUI = async (page) => {
  await goTab(page, "City");
  await waitText(page, /Site a facility/, 10000);
  const lot = await page.evaluateHandle(() => { const h = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === "Site a facility"); const sec = h?.closest("section"); return sec ? [...sec.querySelectorAll("button")].find((b) => /Blue ocean|Some competition|Crowded/i.test(b.innerText)) ?? null : null; }); // innerText follows CSS text-transform (uppercase chips)
  if (!(await lot.evaluate((x) => !!x))) throw new Error("no open parcel to lease");
  await lot.evaluate((x) => x.click()); await sleep(400); // DOM click: the rail scrolls internally, so a mouse click can land on a covering element
  const pick = await page.evaluateHandle(() => {
    const h = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === "Site a facility"); const sec = h?.closest("section");
    const types = sec ? [...sec.querySelectorAll("button")].filter((b) => !b.disabled && /\$[\d,]+/.test(b.innerText) && /Output/i.test(b.innerText)) : [];
    types.sort((a, b) => Number(a.innerText.match(/\$([\d,]+)/)[1].replace(/,/g, "")) - Number(b.innerText.match(/\$([\d,]+)/)[1].replace(/,/g, "")));
    return types[0] ?? null;
  });
  if (!(await pick.evaluate((x) => !!x))) throw new Error("no permitted facility type on this parcel");
  const label = await pick.evaluate((x) => x.innerText.split("\n")[0].trim());
  await pick.evaluate((x) => x.click()); await sleep(300);
  const build = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => /^Build · \$/.test(b.textContent.trim()) && !b.disabled));
  if (!(await build.evaluate((x) => !!x))) { const t = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter((x) => /Build|Pick|permitted|cash/.test(x)).join(" | ")); throw new Error(`build button not enabled: ${t}`); }
  await build.evaluate((x) => x.click()); await sleep(400);
  return label;
};
/** Decide › Team: hire the first candidate and type a signing bonus. Returns the candidate's display name. */
const hireUI = async (page, bid) => {
  await goTab(page, "Decide");
  await waitText(page, /Talent market/, 10000);
  const cand = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => /\/rd\s*Hire$/.test(b.innerText.replace(/\s+/g, " ").trim()) && !b.disabled));
  if (!(await cand.evaluate((x) => !!x))) throw new Error("no hireable candidate button");
  // the button's first text line is the avatar's initial — the name sits in its `span.truncate`
  const name = await cand.evaluate((x) => x.querySelector("span.truncate")?.textContent?.trim() ?? "");
  await cand.evaluate((x) => x.click()); await sleep(300);
  const inp = await page.evaluateHandle((n) => { const b = [...document.querySelectorAll("button")].find((x) => x.querySelector("span.truncate")?.textContent?.trim() === n); const box = b?.parentElement; return box?.querySelector('input[type=number][step="500"]') ?? null; }, name);
  if (!(await inp.evaluate((x) => !!x))) throw new Error("no signing-bonus input after picking the candidate");
  await inp.click(); await inp.evaluate((e) => e.select()); await page.keyboard.press("Backspace"); await inp.type(String(bid)); await sleep(200);
  return name;
};
/** Decide › Team: "Raise to $" for the first employee on staff. */
const raiseUI = async (page, amount) => {
  await goTab(page, "Decide");
  const inp = await page.evaluateHandle(() => { const l = [...document.querySelectorAll("label")].find((x) => /Raise to \$/.test(x.innerText)); return l?.querySelector("input[type=number]") ?? null; });
  if (!(await inp.evaluate((x) => !!x))) throw new Error("no 'Raise to $' input (no employee on staff?)");
  await inp.click(); await inp.evaluate((e) => e.select()); await page.keyboard.press("Backspace"); await inp.type(String(amount)); await sleep(200);
};
/** Review › Field & Intel › click the rival's row → dossier → "offer $" on their first employee → Escape. */
const poachUI = async (page, rivalName, offer) => {
  await goTab(page, "Review");
  const tab = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => /Field & Intel/.test(b.textContent)));
  await tab.click(); await sleep(500);
  // wait for the row — under a full audit run the Field table can paint well after the tab click
  const row = await page.waitForFunction((n) => [...document.querySelectorAll("tr")].find((r) => r.children[0]?.innerText.trim() === n) ?? null, { timeout: 10000 }, rivalName).catch(() => null);
  if (!row) throw new Error(`no Field row for ${rivalName}`);
  await row.evaluate((x) => x.click()); await sleep(500);
  await waitText(page, /talent raid/, 8000);
  const inp = await page.$('input[placeholder="offer $"]');
  if (!inp) throw new Error("dossier shows no 'offer $' input (research not active?)");
  await inp.click(); await inp.type(String(offer)); await sleep(200);
  await page.keyboard.press("Escape"); await sleep(300);
};

let gameId = null;
try {
// ════ set-up ════
const need = ["geography", "facilities", "employees"].filter((m) => !MODS.includes(m));
if (need.length) throw new Error(`MODULES must include ${need.join(", ")} for these checks`);
const g = await api("/instructor/games", { nFirms: 7, nRounds: 6, firmMode: "team", title: "expansion rehearsal", modules: modulesBlock(MODS), configOverride: { modules: { international: { export_unlock_round: EXPORT_UNLOCK } } } });
gameId = g.gameId;
logs.push(`[info] modules: ${describeModules(MODS)} · game ${gameId.slice(0, 8)} ${g.joinCode}`);
const st0 = await api(`/instructor/games/${gameId}/status`);
const T = Object.fromEntries(st0.teams.map((t) => [t.firmId, t.teamId]));
const A = { ceo: await join(g.joinCode, T.firm_1, "ceo", "Alpha CEO", "Alpha Expansion"), cmo: await join(g.joinCode, T.firm_1, "cmo", "Alpha CMO"), coo: await join(g.joinCode, T.firm_1, "coo", "Alpha COO"), chro: await join(g.joinCode, T.firm_1, "chro", "Alpha CHRO") };
const B = { ceo: await join(g.joinCode, T.firm_2, "ceo", "Bravo CEO", "Bravo Rival"), cmo: await join(g.joinCode, T.firm_2, "cmo", "Bravo CMO") };
const REST = []; for (const f of ["firm_3", "firm_4", "firm_5", "firm_6", "firm_7"]) REST.push(await join(g.joinCode, T[f], "ceo", `${f} CEO`, `Firm ${f.slice(-1)}`));
const P = { a_ceo: await mk("a_ceo", A.ceo), a_cmo: await mk("a_cmo", A.cmo), a_coo: await mk("a_coo", A.coo), a_chro: await mk("a_chro", A.chro), b_cmo: await mk("b_cmo", B.cmo) };
const v0 = await view(A.cmo.token);
const domestic = (v0.markets ?? []).filter((m) => m.kind === "domestic").map((m) => m.id);
ok(domestic.length >= 2 && (v0.markets ?? []).every((m) => m.kind !== "export"), "set-up: 7 firms, team mode, Sprint-2 modules; two domestic markets open, exports still hidden", `${describeModules(MODS)} · markets ${(v0.markets ?? []).map((m) => m.id).join(", ")}`);
const home0 = ["home", ...(v0.own?.markets_entered ?? [])]; // round 1 has no standing plan yet — the firm's entered set is the baseline
const cands = v0.hiringMarket ?? [];
ok(cands.length >= 2, "set-up: the talent market has candidates to hire", `${cands.length} candidates`);
const rest = async (patches = {}) => { for (const s of REST) await apiCeo(s, patches[s.firmId] ?? {}); };
const resolve = async () => { await api(`/instructor/games/${gameId}/lock`, {}); return api(`/instructor/games/${gameId}/resolve`, { force: true }); };
const evts = (dash, round) => dash.events.find((e) => e.round === round)?.events ?? [];
const panelRow = (dash, firm, round) => dash.panel.find((p) => p.firmId === firm && p.round === round);

// ════ ROUND 1 (wire 0) — ALPHA ════
// (a) CMO enters a domestic market on City & Globe
const cityA = await enterMarketUI(P.a_cmo, 0);
await submit(P.a_cmo, "a_cmo", A.cmo.token);
let c = await composed(A.ceo);
const enteredA = keysOn(c.market_presence).filter((k) => !home0.includes(k));
ok(enteredA.length === 1 && domestic.includes(enteredA[0]), "(a) CMO's City & Globe entry lands in the composed plan (market_presence gains the market)", `${cityA} → ${J(c.market_presence)}`);
const mktA = enteredA[0];
// (b) COO sites a facility
const facLabel = await siteFacilityUI(P.a_coo);
await submit(P.a_coo, "a_coo", A.coo.token);
c = await composed(A.ceo);
ok((c.build_facilities ?? []).length === 1 && c.build_facilities[0].market === "home" && !!c.build_facilities[0].lot, "(b) COO's siting lands in the composed plan (one build, home market, on a parcel)", `${facLabel} → ${J(c.build_facilities)}`);
const buildA = c.build_facilities?.[0];
// (c) CHRO hires with a signing bid
const BID = 2000;
const hiredName = await hireUI(P.a_chro, BID);
const hiredId = cands.find((x) => x.name === hiredName)?.id;
await submit(P.a_chro, "a_chro", A.chro.token);
c = await composed(A.ceo);
ok(!!hiredId && (c.hire_employees ?? []).includes(hiredId) && c.hire_bids?.[hiredId] === BID, "(c) CHRO's hire + signing bonus land in the composed plan", `${hiredName} (${hiredId}) bid ${usd(c.hire_bids?.[hiredId])} · hires ${J(c.hire_employees)}`);
// (d) CEO submits an UNTOUCHED form after all three
await front(P.a_ceo); await sleep(4500);
// (m) DW-082e: the CEO's map draws the COO's planned build too — the CEO's form never copies a teammate's (DW-081), so it
// showed nothing until the round resolved (playtest 10-28). It is the COO's, so the CEO's popover offers no Withdraw.
await goTab(P.a_ceo, "City");
// the CEO's tab polls every 4 s (8 s once submitted) — wait for the plan to arrive rather than race it
const pendingSel = '[data-dw="fac-marker"][title*="breaking ground"]';
await P.a_ceo.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, { timeout: 15000 }, pendingSel).catch(() => {});
await shot(P.a_ceo, "m-ceo-map");
const ceoSees = await P.a_ceo.evaluate((sel) => document.querySelectorAll(sel).length, pendingSel);
let ceoTeammate = false;
if (ceoSees === 1) {
  await P.a_ceo.$eval('[data-dw="fac-marker"][title*="breaking ground"]', (b) => b.click()); await sleep(400);
  await shot(P.a_ceo, "m-ceo-teammate-build");
  ceoTeammate = (await has(P.a_ceo, /On the team plan from .+\(COO\)\. .+\(COO\) set this round's builds — it's their desk/)) && !(await has(P.a_ceo, /Withdraw this build/)); // playtest 10-29: names the sender, and that the chair's call stands
  await P.a_ceo.keyboard.press("Escape"); await sleep(200);
}
const ceoMap = ceoSees === 1 ? "" : await P.a_ceo.evaluate(() => { const t = [...document.querySelectorAll('[data-dw="fac-marker"]')].map((b) => b.getAttribute("title")); const h = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === "Your facilities here"); return ` · markers ${JSON.stringify(t)} · here: ${(h?.closest("section")?.innerText ?? "?").replace(/\s+/g, " ").slice(0, 160)}`; });
ok(ceoSees === 1 && ceoTeammate, "(m) DW-082e: the CEO's map shows the COO's planned build before the round resolves, as a teammate's (no Withdraw)", `${ceoSees} marker(s) · teammate popover ${ceoTeammate}${ceoMap} · plan ${J((await composed(A.ceo)).build_facilities ?? [])}`);
const dlgD = await submit(P.a_ceo, "a_ceo", A.ceo.token);
logs.push(`[info] ALPHA CEO r1 confirm: ${dlgD.join(" | ").slice(0, 300) || "none"}`);
c = await composed(A.ceo);
const allR1 = (c) => keysOn(c.market_presence).includes(mktA) && (c.build_facilities ?? []).length === 1 && (c.hire_employees ?? []).includes(hiredId) && c.hire_bids?.[hiredId] === BID;
ok(allR1(c), "(d) CEO's untouched submit AFTER the specialists erases none of the entry / build / hire / bid", `${J({ markets: keysOn(c.market_presence), builds: (c.build_facilities ?? []).length, hires: c.hire_employees, bids: c.hire_bids })}`);
// (e) each specialist reloads and resubmits UNCHANGED
await reload(P.a_cmo);
const cmoRows = await P.a_cmo.evaluate(async () => { const b = [...document.querySelectorAll("button.tt-tab")].find((x) => x.textContent.includes("City")); b.click(); await new Promise((r) => setTimeout(r, 600)); return [...document.querySelectorAll("button")].filter((x) => /Enter · \$/.test(x.innerText)).length; });
ok(cmoRows === domestic.length - 1, "(e) after a reload the CMO's City & Globe still shows this round's entry (one fewer 'Enter ·' city)", `${cmoRows} not-yet-entered of ${domestic.length} domestic`);
await submit(P.a_cmo, "a_cmo", A.cmo.token);
await reload(P.a_coo);
const markers = await P.a_coo.evaluate(async () => { const b = [...document.querySelectorAll("button.tt-tab")].find((x) => x.textContent.includes("City")); b.click(); await new Promise((r) => setTimeout(r, 800)); return document.querySelectorAll('[title*="breaking ground"]').length; });
ok(markers === 1, "(e) after a reload the COO's map shows the queued build exactly once (no double marker)", `${markers} pending marker(s)`);
await submit(P.a_coo, "a_coo", A.coo.token);
await reload(P.a_chro);
await submit(P.a_chro, "a_chro", A.chro.token);
c = await composed(A.ceo);
ok(allR1(c), "(e) CMO, COO and CHRO reload + resubmit unchanged — the entry, build, hire and bid all still stand", `${J({ markets: keysOn(c.market_presence), builds: c.build_facilities, hires: c.hire_employees, bids: c.hire_bids })}`);
// the rest of the room: BRAVO's CEO hires a different candidate (next round's poach target); others untouched
const rivalCand = cands.find((x) => x.id !== hiredId);
await apiCeo(B.ceo, { hire_employees: [rivalCand.id] });
await rest();
// (f) lock → the stored decision carries every entry; resolve → it all happened
await api(`/instructor/games/${gameId}/lock`, {});
const dec1 = await api(`/instructor/games/${gameId}/decisions`);
const tA1 = dec1.teams.find((t) => t.firmId === "firm_1");
ok(tA1?.locked === true && allR1(tA1.composed ?? {}), "(f) instructor decisions endpoint: ALPHA's LOCKED decision carries the entry, build, hire and bid", `locked ${tA1?.locked} · ${J({ markets: keysOn(tA1?.composed?.market_presence), builds: (tA1?.composed?.build_facilities ?? []).length, hires: tA1?.composed?.hire_employees, bids: tA1?.composed?.hire_bids })}`);
await api(`/instructor/games/${gameId}/resolve`, { force: true });
let dash = await api(`/instructor/games/${gameId}/dashboard`);
const e1 = evts(dash, 0).filter((e) => /firm_1/.test(e));
const mktLabel = (v0.markets ?? []).find((m) => m.id === mktA)?.label ?? mktA;
ok(e1.some((e) => new RegExp(`^EXPANSION: firm_1 enters ${mktLabel}`).test(e)) && e1.some((e) => /^FACILITY BUILT: firm_1/.test(e)) && e1.some((e) => new RegExp(`^(HIRE|SIGNED): firm_1 .*${hiredName}`).test(e)), "(f) resolved r1: EXPANSION + FACILITY BUILT + HIRE events for ALPHA", e1.slice(0, 5).join(" | ").slice(0, 300));
const a1 = panelRow(dash, "firm_1", 0);
ok(a1 && (a1.cfLines?.investing?.facilities ?? 0) < 0 && (a1.opexLines?.distribution ?? 0) > 0, "(f) resolved r1: the build is a facilities capex line and the entry cost is in distribution opex (DW-070 lines)", J({ facilities: a1?.cfLines?.investing?.facilities, distribution: a1?.opexLines?.distribution }));
const vA = await view(A.chro.token);
ok((vA.own.markets_entered ?? []).includes(mktA) && (vA.own.employees ?? []).some((e) => e.id === hiredId || e.name === hiredName) && (vA.own.facilities ?? []).length >= 1, "(f) ALPHA's state next round: in the market, the hire on staff, the facility on the books", J({ markets: vA.own.markets_entered, staff: (vA.own.employees ?? []).map((e) => e.name), sites: (vA.own.facilities ?? []).length }));
const vB = await view(B.ceo.token);
ok((vB.own.employees ?? []).length >= 1, "set-up r2: BRAVO has an employee to poach", J((vB.own.employees ?? []).map((e) => e.name)));

// ════ ROUND 2 (wire 1) ════
for (const p of Object.values(P)) await toDecide(p, 1);
// (g) ALPHA's CEO enters the remaining domestic market while the CMO is silent
const std1 = (await view(A.ceo.token)).standing;
const cityG = await enterMarketUI(P.a_ceo, 0);
await submit(P.a_ceo, "a_ceo", A.ceo.token);
c = await composed(A.ceo);
const enteredG = keysOn(c.market_presence).filter((k) => !keysOn(std1.market_presence).includes(k));
ok(enteredG.length === 1 && domestic.includes(enteredG[0]) && enteredG[0] !== mktA, "(g) CEO enters a market on City & Globe while the CMO is silent → it lands", `${cityG} → ${J(keysOn(c.market_presence))}`);
const mktG = enteredG[0];
// (h) ALPHA: the CMO submits with market_presence UNTOUCHED (buys research for the CHRO's raid) → the CEO's entry stands
await front(P.a_cmo); await sleep(4500);
const buyBox = await P.a_cmo.evaluateHandle(() => { const l = [...document.querySelectorAll("label")].find((x) => /Buy market research/.test(x.textContent)); return l?.querySelector("input[type=checkbox]") ?? null; });
if (!(await buyBox.evaluate((x) => !!x))) throw new Error("CMO: no 'Buy market research' checkbox");
if (!(await buyBox.evaluate((x) => x.checked))) await buyBox.click();
await sleep(300);
const dlgH = await submit(P.a_cmo, "a_cmo", A.cmo.token);
c = await composed(A.ceo);
ok(keysOn(c.market_presence).includes(mktG) && c.buy_info === true, "(h) DW-073: CMO untouched on markets + CEO changed → the CEO's entry stands (and the CMO's research buy lands)", `${J(keysOn(c.market_presence))} · buy_info ${c.buy_info} · confirm: ${dlgH.join(" | ").slice(0, 120) || "none"}`);
// (h) BRAVO: the CEO enters one market first (API), then the CMO enters a DIFFERENT one on City & Globe → the CMO's wins
const vB1 = await view(B.ceo.token);
const otherB = domestic[1], firstB = domestic[0];
await apiCeo(B.ceo, { market_presence: { ...vB1.standing.market_presence, [otherB]: 0.6 } });
await front(P.b_cmo); await sleep(4500);
const cityB = await enterMarketUI(P.b_cmo, 0); // the first not-yet-entered row = domestic[0]
const dlgB = await submit(P.b_cmo, "b_cmo", B.cmo.token);
c = await composed(B.ceo);
ok(keysOn(c.market_presence).includes(firstB) && !keysOn(c.market_presence).includes(otherB), "(h) DW-073: CMO CHANGED markets after the CEO did → the CMO's set wins (CEO's other market is not in the plan)", `${cityB} → ${J(keysOn(c.market_presence))} · CEO had ${otherB} · confirm: ${dlgB.join(" | ").slice(0, 120) || "none"}`);
// (k) DW-082d: BRAVO's COO chair is empty. The CMO sites a facility for it and submits; the CEO cancels it (a
// deliberate "none"). On an empty desk the CEO has the final say — so the CMO's map must stop drawing the build
// as breaking ground: mark it, say whose call it was, and let the CMO withdraw it (which frees the parcel).
const siteB = await siteFacilityUI(P.b_cmo); // the tab remounts on its home city
await submit(P.b_cmo, "b_cmo", B.cmo.token);
const builtB = (await composed(B.ceo)).build_facilities ?? [];
const vBk = await view(B.ceo.token);
const cancelB = { ...vBk.standing, hire_roles: [], hire_employees: [], hire_bids: {}, raise_employees: {}, fire_employees: [], poach_employees: [], build_facilities: [], debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false };
const rk = await fetch(`${API}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: B.ceo.token, decision: cancelB, touched: ["build_facilities"] }) });
if (!rk.ok) throw new Error(`api cancel ceo@firm_2: ${rk.status} ${await rk.text()}`);
const afterCancel = (await composed(B.ceo)).build_facilities ?? [];
await front(P.b_cmo); await sleep(4500);
await goTab(P.b_cmo, "City");
const lostSel = '[data-dw="fac-marker"][title*="not in the team plan"]';
await P.b_cmo.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, { timeout: 15000 }, lostSel).catch(() => {}); // poll, don't race it (a 4.5 s sleep missed the CMO's poll once, 10-29)
const nLost = await P.b_cmo.evaluate((sel) => document.querySelectorAll(sel).length, lostSel);
ok(builtB.length === 1 && afterCancel.length === 0 && nLost === 1, "(k) DW-082d: the CEO cancels the CMO's build for the empty COO desk → the CMO's map marks it \"not in the team plan\"", `${siteB}: plan ${builtB.length} → ${afterCancel.length} · marked ${nLost}`);
if (nLost === 1) {
  await P.b_cmo.$eval(lostSel, (b) => b.click()); await sleep(400);
  const says = await has(P.b_cmo, /cancelled it\. The CEO's word on builds is final/);
  const wd = await P.b_cmo.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Withdraw my proposal") ?? null);
  if (await wd.evaluate((x) => !!x)) { await wd.evaluate((x) => x.click()); await sleep(400); }
  const left = await P.b_cmo.evaluate(() => document.querySelectorAll('[data-dw="fac-marker"][title*="not in the team plan"], [data-dw="fac-marker"][title*="breaking ground"]').length);
  ok(says && left === 0, "(k) its popover names the CEO's final say, and Withdraw takes it off the CMO's map (the parcel is free again)", `explains ${says} · queued markers left ${left}`);
  await submit(P.b_cmo, "b_cmo", B.cmo.token);
  const mineB = (await view(B.cmo.token)).teamPlan?.seats?.find((x) => x.me)?.partial?.build_facilities ?? [];
  ok(mineB.length === 0 && ((await composed(B.ceo)).build_facilities ?? []).length === 0, "(k) the CMO's next submit no longer proposes it; the plan stays without it", `slice ${mineB.length} · plan ${((await composed(B.ceo)).build_facilities ?? []).length}`);
}
// (l) DW-082e (playtest 10-28): builds are one lever, so after that cancel the CEO's word on them is final and a build
// the CMO sends LATER waits for the CEO. Its popover must say so (it read "cancelled it", which the CEO never did), and
// the banner over the map must count it. Withdrawn again after, so the plan ends where (k) left it.
await siteFacilityUI(P.b_cmo);
await submit(P.b_cmo, "b_cmo", B.cmo.token);
await front(P.b_cmo); await sleep(4500);
await goTab(P.b_cmo, "City");
await P.b_cmo.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, { timeout: 15000 }, lostSel).catch(() => {}); // poll, don't race it
const nWait = await P.b_cmo.evaluate((sel) => document.querySelectorAll(sel).length, lostSel);
const bannerL = await has(P.b_cmo, /One of your builds isn't in the team plan/);
let waitsL = false;
await shot(P.b_cmo, "l-cmo-map-waiting");
if (nWait === 1) {
  await P.b_cmo.$eval(lostSel, (b) => b.click()); await sleep(400);
  await shot(P.b_cmo, "l-cmo-popover-waiting");
  waitsL = (await has(P.b_cmo, /Waiting on .+\(CEO\)\. The CEO set this round's builds before you sent this one/)) && !(await has(P.b_cmo, /cancelled it/));
  const wd = await P.b_cmo.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Withdraw my proposal") ?? null);
  if (await wd.evaluate((x) => !!x)) { await wd.evaluate((x) => x.click()); await sleep(400); }
}
await submit(P.b_cmo, "b_cmo", B.cmo.token);
const planL = ((await composed(B.ceo)).build_facilities ?? []).length;
ok(nWait === 1 && bannerL && waitsL && planL === 0, "(l) DW-082e: a build the CMO sends AFTER the CEO's cancel reads \"Waiting on … (CEO)\", not \"cancelled it\", and the banner over the map counts it", `marked ${nWait} · banner ${bannerL} · waiting copy ${waitsL} · plan after withdraw ${planL}`);
// (c) ALPHA's CHRO: a raise for the hire, and a poach from BRAVO's dossier (research is live once the CMO's buy composed)
await front(P.a_chro);
for (let i = 0; i < 20 && !(await view(A.chro.token)).infoActive; i++) await sleep(1000);
const vC = await view(A.chro.token);
ok(vC.infoActive === true, "r2: research is live for ALPHA (the CMO's buy_info composed)", `infoActive ${vC.infoActive}`);
const emp = (vC.own.employees ?? [])[0];
const RAISE = Math.round(emp.salary) + 1000;
await sleep(4500); // let the CHRO's page poll the research in
await raiseUI(P.a_chro, RAISE);
const rival = (vC.firms ?? []).find((f) => f.firm_id === "firm_2");
const rivalEmp = rival?.employees?.[0];
ok(!!rivalEmp, "r2: BRAVO's crew is visible to ALPHA under research", J(rival?.employees?.map((e) => `${e.name} ${usd(e.salary)}`)));
const OFFER = Math.round(rivalEmp.salary) + 2000;
await poachUI(P.a_chro, rival.name, OFFER);
await goTab(P.a_chro, "Decide");
ok(await has(P.a_chro, new RegExp(`${rivalEmp.name}[\\s\\S]{0,80}${usd(OFFER).replace("$", "\\$")}`)), "(c) the CHRO's Decide tab lists the queued raid with the offer", (await P.a_chro.evaluate(() => document.body.innerText.match(/Raid rival talent[\s\S]{0,160}/)?.[0]?.replace(/\n+/g, " | "))) ?? "");
await submit(P.a_chro, "a_chro", A.chro.token);
c = await composed(A.ceo);
const raidOk = (c) => Math.abs((c.raise_employees?.[emp.id] ?? 0) - RAISE) < 1 && (c.poach_employees ?? []).some((p) => p.firm === "firm_2" && p.employee === rivalEmp.id && Math.abs(p.offer - OFFER) < 1);
ok(raidOk(c), "(c) CHRO's raise + poach offer land in the composed plan", J({ raise: c.raise_employees, poach: c.poach_employees }));
// (e) the CHRO reloads and resubmits unchanged — the raise and the raid must survive (the logged bug)
await reload(P.a_chro);
ok(await has(P.a_chro, new RegExp(`${rivalEmp.name}[\\s\\S]{0,80}${usd(OFFER).replace("$", "\\$")}`)), "(e) after a reload the CHRO's Decide tab still lists the queued raid", "");
await submit(P.a_chro, "a_chro", A.chro.token);
c = await composed(A.ceo);
ok(raidOk(c), "(e) CHRO reload + resubmit unchanged — the raise and the poach offer still stand", J({ raise: c.raise_employees, poach: c.poach_employees }));
// (d) CEO and COO submit untouched after
await front(P.a_ceo); await sleep(4500); await submit(P.a_ceo, "a_ceo", A.ceo.token);
await front(P.a_coo); await sleep(4500); await submit(P.a_coo, "a_coo", A.coo.token);
c = await composed(A.ceo);
ok(raidOk(c) && keysOn(c.market_presence).includes(mktG) && c.buy_info === true, "(d) CEO + COO untouched submits after the CHRO: raise, poach, the CEO's entry and the research buy all stand", J({ markets: keysOn(c.market_presence), raise: c.raise_employees, poach: (c.poach_employees ?? []).length, buy: c.buy_info }));
// (n) pre-ship review (10-29): a build this seat SENT that the plan carries, withdrawn on its own map, must leave that map.
// DW-082e also drew the plan's builds, so it came back as "a teammate's" (no Withdraw, its lot held) until the next
// submit. ALPHA's COO sites one in r2, sends it, withdraws it and sends again: the plan ends without it, as before (n).
try {
  await siteFacilityUI(P.a_coo);
  await submit(P.a_coo, "a_coo", A.coo.token);
  const builtN = ((await composed(A.ceo)).build_facilities ?? []).length;
  await goTab(P.a_coo, "City");
  const pendSel = '[data-dw="fac-marker"][title*="breaking ground"]';
  const nN = await P.a_coo.evaluate((sel) => document.querySelectorAll(sel).length, pendSel);
  let leftN = -1;
  if (nN === 1) {
    await P.a_coo.$eval(pendSel, (b) => b.click()); await sleep(400);
    const wd = await P.a_coo.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Withdraw this build") ?? null);
    if (await wd.evaluate((x) => !!x)) { await wd.evaluate((x) => x.click()); await sleep(600); }
    leftN = await P.a_coo.evaluate(() => document.querySelectorAll('[data-dw="fac-marker"][title*="breaking ground"], [data-dw="fac-marker"][title*="not in the team plan"]').length);
  }
  await submit(P.a_coo, "a_coo", A.coo.token);
  const planN = ((await composed(A.ceo)).build_facilities ?? []).length;
  ok(builtN === 1 && nN === 1 && leftN === 0 && planN === 0, "(n) a build the COO sent and then withdrew leaves the COO's map at once (not redrawn as a teammate's), and the next submit drops it", `plan ${builtN} · marked ${nN} · left after withdraw ${leftN} · plan after resubmit ${planN}`);
} catch (e) { ok(false, "(n) withdraw a build already sent", e.message.split("\n")[0]); }
// (j) the Trade tab names the export unlock (export_unlock_round came through the tuning-override path)
await goTab(P.a_ceo, "City");
await (await P.a_ceo.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Trade"))).click(); await sleep(400);
ok(await has(P.a_ceo, new RegExp(`Exports open in round ${EXPORT_UNLOCK + 1}`)), `(j) City & Globe › Trade says "Exports open in round ${EXPORT_UNLOCK + 1}" (override ${EXPORT_UNLOCK} → 1-based)`, (await P.a_ceo.evaluate(() => document.body.innerText.match(/Exports open[^\n]*/)?.[0])) ?? "no line");
await rest();
await api(`/instructor/games/${gameId}/lock`, {});
const dec2 = await api(`/instructor/games/${gameId}/decisions`);
const tA2 = dec2.teams.find((t) => t.firmId === "firm_1");
ok(tA2?.locked === true && raidOk(tA2.composed ?? {}) && keysOn(tA2?.composed?.market_presence).includes(mktG), "(f) instructor decisions endpoint: ALPHA's LOCKED r2 decision carries the raise, the poach and the CEO's entry", J({ markets: keysOn(tA2?.composed?.market_presence), raise: tA2?.composed?.raise_employees, poach: tA2?.composed?.poach_employees }));
await api(`/instructor/games/${gameId}/resolve`, { force: true });
dash = await api(`/instructor/games/${gameId}/dashboard`);
const e2 = evts(dash, 1);
const mktGLabel = (v0.markets ?? []).find((m) => m.id === mktG)?.label ?? mktG;
ok(e2.some((e) => new RegExp(`^EXPANSION: firm_1 enters ${mktGLabel}`).test(e)) && e2.some((e) => new RegExp(`^(POACHED: firm_1 lures ${rivalEmp.name}|POACH REBUFFED: ${rivalEmp.name} spurns firm_1)`).test(e)), "(f) resolved r2: ALPHA's second EXPANSION and the poach offer (won or rebuffed) both resolved", e2.filter((e) => /firm_1|firm_2/.test(e)).slice(0, 5).join(" | ").slice(0, 300));
const vA2 = await view(A.chro.token);
const empAfter = (vA2.own.employees ?? []).find((e) => e.id === emp.id);
// The market can poach (or a hire can quit) at random any round — then there's no roster entry to
// read the raise off; the raise itself is already proven in the LOCKED plan by the check above.
const left = e2.find((e) => e.startsWith(`POACHED: a rival hires ${emp.name} `) || e.startsWith(`DEPARTURE: ${emp.name} `));
ok(left ? true : !!empAfter && Math.abs(empAfter.salary - RAISE) < 1, left ? `(f) resolved r2: ${emp.name} left this round ("${left.slice(0, 48)}…") — the raise stands in the locked plan` : "(f) resolved r2: the raise took — the employee's salary is the new number", `${emp.name} ${usd(emp.salary)} → ${usd(empAfter?.salary)}`);
for (const [tag, p] of Object.entries(P)) { await front(p); const at3 = await p.waitForFunction(() => /Round\s*3\s*\//.test(document.body.innerText), { timeout: 30000 }).then(() => true, () => false); if (!at3) ok(false, `${tag}: page followed the game to round 3`); }
ok(true, "every browser chair followed the game to round 3");
// (o) playtest 10-29: ALPHA's COO chair is SEATED and updates without touching builds; the CHRO sites one. The merge
// lets the CEO's word stand over a peer's once that chair stays silent, but the CEO's row read "the COO decides" with
// no button, and the CEO's map popover only said "answer it on Decide" — she had no way to cancel it.
try {
  await toDecide(P.a_coo, 2); await submit(P.a_coo, "a_coo", A.coo.token); // silent on builds
  await toDecide(P.a_chro, 2); await siteFacilityUI(P.a_chro);
  const dlgO = (await submit(P.a_chro, "a_chro", A.chro.token)).join(" ");
  ok(/Build facilities is the COO's desk \(.+\)\. You set 1 build .+ Yours goes into the plan unless .+ changes it or the CEO cancels it/.test(dlgO), "(o) the CHRO's submit check: the build goes in unless the COO changes it or the CEO cancels it (it said \"the COO decides\")", dlgO.slice(0, 260));
  const bO = ((await composed(A.ceo)).build_facilities ?? []);
  await front(P.a_ceo); await sleep(4500);
  await goTab(P.a_ceo, "City");
  const clickBtn = async (page, pred, arg) => { const h = await page.evaluateHandle(pred, arg); const there = await h.evaluate((x) => !!x); if (there) { await h.evaluate((x) => x.click()); await sleep(400); } return there; };
  await clickBtn(P.a_ceo, () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Map") ?? null); // (j) left it on Trade
  if (bO[0]?.market === "home") await clickBtn(P.a_ceo, () => [...document.querySelectorAll("button")].find((x) => x.querySelector("span.display")?.textContent?.trim() === "Front Range") ?? null); // (g) left it on the city it entered
  const pendO = '[data-dw="fac-marker"][title*="breaking ground"]';
  await P.a_ceo.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, { timeout: 15000 }, pendO).catch(() => {});
  let points = false;
  if (await P.a_ceo.evaluate((sel) => document.querySelectorAll(sel).length === 1, pendO)) {
    await P.a_ceo.$eval(pendO, (b) => b.click()); await sleep(400);
    await shot(P.a_ceo, "o-ceo-popover");
    points = await has(P.a_ceo, /On the team plan from .+\(CHRO\)\. To drop it: Decide › What locks › Build facilities › Cancel it/);
    await P.a_ceo.keyboard.press("Escape"); await sleep(200);
  }
  await goTab(P.a_ceo, "Decide");
  await shot(P.a_ceo, "o-ceo-row");
  const hasCancel = await clickBtn(P.a_ceo, () => { const box = [...document.querySelectorAll('[data-testid="plan-differs"]')].find((x) => x.getClientRects().length > 0); const r = box && [...box.querySelectorAll("div.grid")].find((d) => d.querySelector("b")?.textContent?.trim() === "Build facilities"); return r?.querySelector('button[data-dw-action="cancel"]') ?? null; });
  await submit(P.a_ceo, "a_ceo", A.ceo.token);
  const planO = ((await composed(A.ceo)).build_facilities ?? []).length;
  ok(bO.length === 1 && points && hasCancel && planO === 0, "(o) playtest 10-29: the COO stays silent, the CHRO sites a build → the CEO's map points to Cancel it, the row has it, one submit drops the build", `plan ${bO.length} → ${planO} · popover ${points} · Cancel it ${hasCancel}`);
  await front(P.a_chro); await sleep(4500);
  await goTab(P.a_chro, "City");
  const lostO = '[data-dw="fac-marker"][title*="not in the team plan"]';
  await P.a_chro.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, { timeout: 15000 }, lostO).catch(() => {});
  let saysO = false;
  if (await P.a_chro.evaluate((sel) => document.querySelectorAll(sel).length === 1, lostO)) {
    await P.a_chro.$eval(lostO, (b) => b.click()); await sleep(400);
    await shot(P.a_chro, "o-chro-popover");
    saysO = await has(P.a_chro, /\(CEO\) cancelled it\. The CEO's word on builds is final, unless .+\(COO\), whose desk it is, sets them: the CEO can bring it back with Use theirs/);
  }
  ok(saysO, "(o) the CHRO's map: the CEO cancelled it, and it stands unless the COO, whose desk it is, sets the builds (Use theirs brings it back)");
} catch (e) { ok(false, "(o) the CEO cancels a peer's build after the COO stayed silent", e.message.split("\n")[0]); }
await api(`/instructor/games/${gameId}/end`, {}).catch(() => {});
} catch (e) { results.push("ABORT " + e.message); console.log("ABORT " + e.message.split("\n")[0]); if (gameId) await api(`/instructor/games/${gameId}/end`, {}).catch(() => {}); }
// (i) nothing broke on any page
const errs = logs.filter((l) => /pageerror\]|error\]/.test(l));
ok(errs.length === 0, "(i) no pageerror / console error on any page", errs.slice(0, 4).join(" | "));
const fails = results.filter((l) => !l.startsWith("PASS"));
console.log(`DONE ${results.length} checks — ${results.length - fails.length} pass, ${fails.length} fail/abort`);
console.log("--- logs ---\n" + logs.filter((l) => !/dialog\]/.test(l) || /info/.test(l)).slice(0, 30).join("\n"));
await browser.close();
process.exit(fails.length ? 1 : 0);
