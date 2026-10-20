// Headless-Chrome desk-ownership audit (DW-071 follow-up). Needs the memory server (`cd server && npm run serve`),
// the Vite dev server (`cd web && npm run dev`), Google Chrome, and `puppeteer-core` in web/node_modules.
// Run: `node web/scripts/desk-audit.mjs`. Builds the class config (7 firms × 8 rounds, team mode, laborMarket +
// consumerDrift + marketConduct + sustainability), seats CEO/CMO/COO/CHRO/CFO at firm_1 (API join, session injected
// into localStorage "dw_mp"; every FORM edit + SUBMIT is real UI) and proves:
//  (1) each seat's DEFAULT desk view shows every lever its desk owns — and hides every lever it doesn't
//      (visibility via getClientRects, not DOM presence);
//  (2) each seat's edit lands in the composed plan AND the resolved round, with no untouched default clobbering
//      it — round 1 the CEO submits LAST untouched, round 2 FIRST;
//  (3) the cover path: firm_2 with only CEO + CFO, the CFO hires from the People tab and it lands.
// Prints PASS/FAIL per check. Leaves the servers + other games alone.
import puppeteer from "puppeteer-core";
import { autoConfirm } from "./confirm-dialog.mjs";
import { describeModules, moduleIds, modulesBlock } from "./modules-env.mjs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const API = (process.env.API ?? "http://localhost:8787").replace(/\/$/, ""), WEB = (process.env.WEB ?? "http://localhost:5173").replace(/\/$/, "") + "/"; // ports via env (defaults unchanged)
// DW-076: MODULES=<preset id | comma list> swaps the class config (default = Sprint 1's four modules).
const MODS = moduleIds(["laborMarket", "consumerDrift", "marketConduct", "sustainability"]);
const INS = { "content-type": "application/json", "x-instructor-pass": "letmein" };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const ok = (c, l, d = "") => { const line = `${c ? "PASS" : "FAIL"}  ${l}${d ? " — " + d : ""}`; results.push(line); console.log(line); };
const logs = [];
const api = async (path, body, method = body ? "POST" : "GET") => { const r = await fetch(API + path, { method, headers: INS, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j)}`); return j; };
const waitText = (page, re, t = 15000) => page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), { timeout: t }, re.source);
const has = (page, re) => page.evaluate((src) => new RegExp(src, "i").test(document.body.innerText), re.source);
const view = (tok) => fetch(`${API}/view?token=${tok}`).then((r) => r.json());

// ── lever locators, run in-page. Each returns the CONTROL element (input/button) for a lever, or null. ──
// Kept as one string so the same locator drives the visibility probe AND the edits.
const LOCATE = `(() => {
  const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\\s+/g, " ").trim();
  const labels = (re, sel = "label,span,div,b") => [...document.querySelectorAll(sel)].filter((e) => re.test(own(e)));
  const near = (el, sel, up = 4) => { let p = el; for (let i = 0; i <= up && p; i++) { const c = p.querySelector(sel); if (c) return c; p = p.parentElement; } return null; };
  const first = (re, sel, tags, up) => { for (const l of labels(re, tags)) { const c = near(l, sel, up); if (c) return c; } return null; };
  const roleBtn = (label) => { const row = labels(new RegExp("^" + label + "$"), "div").find((d) => d.closest(".grid")); return row ? near(row, "button", 3) : null; };
  return {
    price: () => [...document.querySelectorAll('input[type=number][step="0.25"]')],
    presence: () => labels(/^Capacity allocation/, "label")[0] ?? null,
    run_rate: () => first(/^Run the line at$/, "input[type=range]", "label", 3),
    invest_cap: () => first(/^Invest in tank capacity/, "input[type=number]", "label", 2),
    invest_Q: () => first(/^Recipe quality$/, "input[type=range]", "label", 2),
    invest_B: () => first(/^Brand$/, "input[type=range]", "label", 2),
    invest_process: () => first(/^Brewing operations$/, "input[type=range]", "label", 2),
    invest_T_emp: () => first(/^Taproom community$/, "input[type=range]", "label", 2),
    invest_T_inv: () => first(/^Investors & lenders$/, "input[type=range]", "label", 2),
    invest_T_gov: () => first(/^Distributors & regulators$/, "input[type=range]", "label", 2),
    invest_water_efficiency: () => first(/^Water efficiency$/, "input[type=range]", "span", 3),
    hire_roles: () => roleBtn("Head brewer"),
    hire_ops: () => roleBtn("Operations manager"),
    key_people: () => labels(/^Key people$/, "span")[0] ?? null,
    debt_draw: () => first(/^Draw debt \\(cash in\\)$/, "input[type=number]", "label", 1),
    debt_repay: () => first(/^Repay debt \\(cash out\\)$/, "input[type=number]", "label", 1),
    equity_raise: () => first(/^Raise equity \\(cash in\\)$/, "input[type=number]", "label", 1),
    equity_cap_line: () => [...document.querySelectorAll("div")].find((d) => /^Investors will fund up to/.test(d.innerText ?? d.textContent)) ?? null,
    dividend: () => first(/^Pay dividend \\(cash out\\)$/, "input[type=number]", "label", 1),
    buy_info: () => { const l = [...document.querySelectorAll("label")].find((x) => /Buy market research/.test(x.textContent)); return l?.querySelector("input[type=checkbox]") ?? null; },
    // DW-076 (employees module, Sprint 2): the Team card replaces Key people — the talent market, its first hireable candidate, and the raid list
    talent_market: () => labels(/^Talent market$/, "span")[0] ?? null,
    hire_employee: () => [...document.querySelectorAll("button")].find((b) => /\\/rd\\s*Hire$/.test(b.innerText.replace(/\\s+/g, " ").trim()) && !b.disabled) ?? null,
    raid_talent: () => labels(/^Raid rival talent$/, "span")[0] ?? null,
    beliefs: () => { const l = [...document.querySelectorAll("label")].find((x) => /Predict your finish rank/.test(x.textContent)); return l?.querySelector("input") ?? null; },
  };
})()`;
// lever → owning desk, for the levers this config enables (DESK_LEVERS ∩ what the form renders here).
// DW-076: with the employees module on, the named-roster Team card supersedes the labor-market Key people
// card (DecisionForm: "Talent is ONE system"), so hire_roles / key_people are not rendered and the people
// desk is checked on the Team card's surfaces instead (see `empOn` below).
const OWNER = {
  price: "commercial", buy_info: "commercial", invest_B: "commercial", beliefs: "commercial",
  presence: "operations", run_rate: "operations", invest_cap: "operations", invest_process: "operations", invest_Q: "operations", invest_water_efficiency: "operations",
  hire_roles: "people", key_people: "people", invest_T_emp: "people",
  debt_draw: "finance", debt_repay: "finance", equity_raise: "finance", equity_cap_line: "finance", dividend: "finance", invest_T_inv: "finance",
  invest_T_gov: "strategy",
};
const probe = (page) => page.evaluate((LOC, keys) => {
  const L = eval(LOC); const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const out = {};
  for (const k of keys) { const el = L[k](); out[k] = Array.isArray(el) ? (el.length ? (el.every(vis) ? true : el.some(vis) ? "partial" : false) : null) : el ? vis(el) : null; }
  return out;
}, LOCATE, Object.keys(OWNER));
const handle = (page, key, idx = 0) => page.evaluateHandle((LOC, k, i) => { const el = eval(LOC)[k](); return Array.isArray(el) ? el[i] : el; }, LOCATE, key, idx);
const typeInto = async (page, key, value, idx = 0) => { const h = await handle(page, key, idx); await h.click(); await h.evaluate((e) => e.select()); await page.keyboard.press("Backspace"); await h.type(String(value)); await sleep(150); return h.evaluate((e) => e.value); };
const setRange = async (page, key, value) => { const h = await handle(page, key); await h.evaluate((e, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, String(v)); e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, value); await sleep(150); return h.evaluate((e) => +e.value); };
const clickKey = async (page, key) => { const h = await handle(page, key); await h.click(); await sleep(200); };
const submit = async (page, tag) => {
  const before = logs.length;
  const btn = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => /my desk/i.test(b.textContent) && b.getClientRects().length > 0 && !b.disabled));
  if (!btn || !(await btn.evaluate((b) => !!b))) throw new Error(`${tag}: no visible submit button`);
  await btn.click();
  await waitText(page, /Your desk is in/, 20000);
  return logs.slice(before).filter((l) => l.startsWith(`[${tag} dialog]`));
};

const mk = async (tag, sess) => {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 1000 });
  p.on("pageerror", (e) => logs.push(`[${tag} pageerror] ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/404|validateDOMNesting/.test(m.text())) logs.push(`[${tag} error] ${m.text().slice(0, 200)}`); });
  p.on("dialog", async (d) => { logs.push(`[${tag} dialog] ${d.message().replace(/\s+/g, " ").slice(0, 300)}`); await d.accept(); });
  await autoConfirm(p, (t) => logs.push(`[${tag} dialog] ${t.replace(/\s+/g, " ").slice(0, 400)}`));
  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => localStorage.setItem("dw_mp", JSON.stringify(s)), sess);
  await p.goto(WEB, { waitUntil: "networkidle0" });
  await waitText(p, /What locks at round end|Commit the round/, 20000);
  await sleep(600);
  return p;
};
const join = async (code, teamId, role, name) => {
  const r = await fetch(`${API}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name, teamId, role, teamName: role === "ceo" ? `Audit ${teamId.slice(-4)}` : undefined }) });
  const j = await r.json(); if (!r.ok) throw new Error(`join ${role}: ${JSON.stringify(j)}`);
  return { token: j.token, config: j.config, firmId: j.firmId, nRounds: j.nRounds, firmMode: j.firmMode, role: j.role, claim: j.claim, claimIssued: false };
};
const resolve = async (gameId) => { await api(`/instructor/games/${gameId}/lock`, {}); return api(`/instructor/games/${gameId}/resolve`, { force: true }); };
const near = (a, b, tol = 1e-6) => a != null && b != null && Math.abs(a - b) <= tol;

try {
// ── Thursday's game ──
const g = await api("/instructor/games", { nFirms: 7, nRounds: 8, firmMode: "team", title: "desk audit", modules: modulesBlock(MODS) });
const st = await api(`/instructor/games/${g.gameId}/status`);
const t1 = st.teams.find((t) => t.firmId === "firm_1"), t2 = st.teams.find((t) => t.firmId === "firm_2");
ok(!!t1 && !!t2, `class config created (7 firms, 8 rounds, team, ${MODS.length} module${MODS.length === 1 ? "" : "s"})`, `${g.joinCode} ${g.gameId.slice(0, 8)} · ${describeModules(MODS)}`);
const ROLES = ["ceo", "cmo", "coo", "chro", "cfo"];
const DESK = { ceo: "all", cmo: "commercial", coo: "operations", chro: "people", cfo: "finance" };
const sess = {}; for (const r of ROLES) sess[r] = await join(g.joinCode, t1.teamId, r, `Audit ${r.toUpperCase()}`);
const P = {}; for (const r of ROLES) P[r] = await mk(r, sess[r]);
// DW-078: the chair is the seat plate now (the "You're the CEO" banner is gone)
ok((await Promise.all(ROLES.map((r) => P[r].evaluate((role) => document.querySelector("[data-seat-plate]")?.getAttribute("data-seat-plate") === role, r)))).every(Boolean), "all five seats land in their chair at firm_1");

// ── (1) default-desk visibility matrix ──
const v0 = await view(sess.cfo.token);
const invOn = !!v0.config?.modules?.inventory?.enabled || !!v0.inventoryEnabled;
const empOn = !!sess.cfo.config?.modules?.employees?.enabled;
if (empOn) { delete OWNER.hire_roles; delete OWNER.key_people; Object.assign(OWNER, { talent_market: "people", hire_employee: "people", raid_talent: "people" }); }
logs.push(`[info] employees module on: ${empOn} (people desk checked on the ${empOn ? "Team card" : "Key people card"})`);
for (const r of ROLES) {
  const vis = await probe(P[r]);
  const desk = DESK[r];
  const missing = [], leaked = [], absent = [];
  for (const [k, owner] of Object.entries(OWNER)) {
    if (k === "run_rate" && !invOn) { if (vis[k] != null) leaked.push(`${k}(inventory off but rendered)`); continue; }
    if (vis[k] == null) { absent.push(k); continue; }
    const should = desk === "all" || desk === owner;
    if (should && vis[k] !== true) missing.push(`${k}=${vis[k]}`);
    if (!should && vis[k] !== false) leaked.push(`${k}=${vis[k]}`);
  }
  ok(absent.length === 0, `${r.toUpperCase()}: every lever control this config enables exists in the form`, absent.join(", "));
  ok(missing.length === 0, `${r.toUpperCase()} (${desk}) sees every lever its desk owns`, missing.join(", ") || Object.entries(OWNER).filter(([k, o]) => (desk === "all" || o === desk) && vis[k] === true).map(([k]) => k).join(" "));
  if (desk !== "all") ok(leaked.length === 0, `${r.toUpperCase()} (${desk}) sees NO other desk's levers`, leaked.join(", "));
}
logs.push(`[info] inventory module on: ${invOn} (run_rate ${invOn ? "checked" : "not in this config"})`);

// ── (2a) round 1: specialists edit through the form, CEO submits LAST untouched ──
const seg = Object.keys(v0.standing?.price ?? v0.teamPlan?.composed?.price ?? {})[0];
const segIdx = 0;
const E1 = { price: 9.35, invest_B: 23000, beliefs: 2, invest_Q: 37000, invest_water_efficiency: 7000, invest_cap: 15000, invest_T_emp: 13000, debt_draw: 45000, invest_T_inv: 11000 };
// CMO
const cmoPriceShown = await typeInto(P.cmo, "price", E1.price, segIdx);
await setRange(P.cmo, "invest_B", E1.invest_B);
await clickKey(P.cmo, "buy_info");
await typeInto(P.cmo, "beliefs", E1.beliefs);
// COO
await setRange(P.coo, "invest_Q", E1.invest_Q);
await setRange(P.coo, "invest_water_efficiency", E1.invest_water_efficiency);
await typeInto(P.coo, "invest_cap", E1.invest_cap);
// CHRO — a key-role hire (labor market) or, with employees on, the first candidate off the talent market
const hireKey = empOn ? "hire_employee" : "hire_roles";
const hiredName1 = empOn ? await (await handle(P.chro, "hire_employee")).evaluate((b) => b.querySelector("span.truncate")?.textContent?.trim() ?? "") : null; // the name span (the first text line is the avatar initial)
await clickKey(P.chro, hireKey);
const hireBtn = empOn ? await P.chro.evaluate((n) => [...document.querySelectorAll("button")].find((b) => b.querySelector("span.truncate")?.textContent?.trim() === n)?.innerText.replace(/\s+/g, " ") ?? "", hiredName1) : await (await handle(P.chro, "hire_roles")).evaluate((b) => b.textContent.trim());
await setRange(P.chro, "invest_T_emp", E1.invest_T_emp);
// CFO — equity above the investors' cap
const capTxt = await (await handle(P.cfo, "equity_cap_line")).evaluate((e) => e?.innerText ?? "");
const cap = Number((capTxt.match(/up to \$([\d,]+)/) ?? [])[1]?.replace(/,/g, ""));
const ask = Math.ceil((cap + 60000) / 5000) * 5000;
await typeInto(P.cfo, "debt_draw", E1.debt_draw);
await typeInto(P.cfo, "equity_raise", ask);
await setRange(P.cfo, "invest_T_inv", E1.invest_T_inv);
const capWarn = await (await handle(P.cfo, "equity_cap_line")).evaluate((e) => e?.innerText ?? "");
ok(cap > 0 && /only that much will be raised/.test(capWarn), "CFO sees 'Investors will fund up to' and the over-ask warning", `cap $${cap}, asked $${ask}: "${capWarn.slice(0, 110)}"`);
ok(+cmoPriceShown === E1.price && (empOn ? /✓\s*$/.test(hireBtn) : /Hiring ✓/.test(hireBtn)), `form edits took (price field, Hire toggles to '${empOn ? "✓" : "Hiring ✓"}')`, `price=${cmoPriceShown} hire="${hireBtn}"`);
const dlg1 = {};
for (const r of ["cmo", "coo", "chro", "cfo"]) dlg1[r] = await submit(P[r], r);
ok(Object.values(dlg1).every((d) => d.length === 0), "specialists editing only their own desk get NO pre-submit confirm", JSON.stringify(dlg1).slice(0, 300));
await sleep(1200);
dlg1.ceo = await submit(P.ceo, "ceo"); // untouched, stale form — the classic clobber
logs.push(`[info] CEO r1 dialogs: ${JSON.stringify(dlg1.ceo)}`);
const expectPlan = (c, E, hire, eq, tag) => {
  const checks = [
    ["CMO price", near(c.price?.[seg], E.price), c.price?.[seg]], ["CMO brand", c.invest_B === E.invest_B, c.invest_B], ["CMO research", c.buy_info === true, c.buy_info], ["CMO rank call", c.beliefs?.own_rank === E.beliefs, c.beliefs?.own_rank],
    ["COO quality", c.invest_Q === E.invest_Q, c.invest_Q], ["COO water", c.invest_water_efficiency === E.invest_water_efficiency, c.invest_water_efficiency], ["COO tanks", c.invest_cap === E.invest_cap, c.invest_cap],
    ["CHRO hire", empOn ? (c.hire_employees ?? []).length >= 1 : (c.hire_roles ?? []).includes(hire), JSON.stringify(empOn ? c.hire_employees : c.hire_roles)], ["CHRO employee relations", c.invest_T_emp === E.invest_T_emp, c.invest_T_emp],
    ["CFO debt draw", c.debt_draw === E.debt_draw, c.debt_draw], ["CFO equity ask", c.equity_raise === eq, c.equity_raise], ["CFO investor relations", c.invest_T_inv === E.invest_T_inv, c.invest_T_inv],
  ];
  for (const [l, pass, got] of checks) ok(pass, `${tag}: ${l} survives in the composed plan`, `got ${got}`);
};
const c1 = (await view(sess.ceo.token)).teamPlan?.composed ?? {};
expectPlan(c1, E1, "head_brewer", ask, "r1 (CEO last, untouched)");
const debt0 = v0.own?.debt ?? 0;
await resolve(g.gameId);
let dash = await api(`/instructor/games/${g.gameId}/dashboard`);
const row1 = dash.panel.find((p) => p.round === 0 && p.firmId === "firm_1") ?? dash.panel.filter((p) => p.firmId === "firm_1").at(-1);
const ev1 = (dash.events.find((e) => e.round === row1?.round)?.events ?? []);
const eng1 = dash.engagement.find((e) => e.round === row1?.round && e.firmId === "firm_1");
ok(near(row1?.segments?.[seg]?.price, E1.price), "resolved r1: firm_1 sold at the CMO's price", `${seg} $${row1?.segments?.[seg]?.price}`);
ok(eng1?.infoPurchased === true && eng1?.predictedRank === E1.beliefs, "resolved r1: research bought + CMO's rank call recorded", JSON.stringify({ info: eng1?.infoPurchased, rank: eng1?.predictedRank }));
ok(ev1.some((e) => (empOn ? /^(HIRE|SIGNED): firm_1 /.test(e) : /^HIRE: firm_1 brings on a head brewer/.test(e))), `resolved r1: HIRE event for the CHRO's ${empOn ? `hire (${hiredName1})` : "head brewer"}`, ev1.filter((e) => /firm_1/.test(e)).slice(0, 4).join(" | "));
const eqEv = ev1.find((e) => /^EQUITY: investors fund only .* firm_1 sought/.test(e));
ok(!!eqEv && eqEv.includes(`$${ask.toLocaleString("en-US")}`), "resolved r1: equity trimmed to the cap (EQUITY event names the CFO's ask)", eqEv ?? ev1.filter((e) => /EQUITY|firm_1/.test(e)).join(" | ").slice(0, 200));
ok(row1 && row1.debt - debt0 > E1.debt_draw * 0.9, "resolved r1: debt rose by ~the CFO's draw", `debt ${Math.round(debt0)} → ${Math.round(row1?.debt)}`);
const staffRe = empOn ? new RegExp(`${hiredName1}[\\s\\S]{0,80}tenure`) : /On staff now:\s*Head brewer/; // Team card: "<name> … 0r tenure"
await waitText(P.chro, staffRe, 25000).catch(() => {});
// after resolve the screen flips to Review; go back to Decide to see the Key people / Team card
if (!(await has(P.chro, staffRe))) { const d = await P.chro.$("xpath/.//button[contains(normalize-space(.), 'Decide')]"); if (d) { await d.click(); await sleep(800); } }
ok(await has(P.chro, staffRe), empOn ? `CHRO's Team card lists ${hiredName1} on staff after resolve` : "CHRO sees 'On staff now: Head brewer' after resolve", (await P.chro.evaluate((src) => document.body.innerText.match(new RegExp(src))?.[0]?.slice(0, 80), staffRe.source)) ?? "no line");

// ── (2b) round 2: CEO submits FIRST untouched, specialists after ──
for (const r of ROLES) { await waitText(P[r], /Round open/, 25000).catch(() => {}); const d = await P[r].$("xpath/.//button[contains(normalize-space(.), 'Decide')]"); if (d) await d.click(); }
await sleep(1500);
for (const r of ROLES) await waitText(P[r], /What locks at round end|Commit the round/, 15000);
dlg1.ceo2 = await submit(P.ceo, "ceo");
logs.push(`[info] CEO r2 dialogs: ${JSON.stringify(dlg1.ceo2)}`);
await sleep(1200);
const E2 = { price: 8.65, invest_B: 19000, beliefs: 3, invest_Q: 29000, invest_water_efficiency: 9000, invest_cap: 25000, invest_T_emp: 17000, debt_draw: 35000, invest_T_inv: 7000 };
await typeInto(P.cmo, "price", E2.price, segIdx); await setRange(P.cmo, "invest_B", E2.invest_B); await typeInto(P.cmo, "beliefs", E2.beliefs);
if (!(await (await handle(P.cmo, "buy_info")).evaluate((e) => e.checked))) await clickKey(P.cmo, "buy_info");
await setRange(P.coo, "invest_Q", E2.invest_Q); await setRange(P.coo, "invest_water_efficiency", E2.invest_water_efficiency); await typeInto(P.coo, "invest_cap", E2.invest_cap);
await clickKey(P.chro, empOn ? "hire_employee" : "hire_ops"); await setRange(P.chro, "invest_T_emp", E2.invest_T_emp);
const cap2 = Number(((await (await handle(P.cfo, "equity_cap_line")).evaluate((e) => e?.innerText ?? "")).match(/up to \$([\d,]+)/) ?? [])[1]?.replace(/,/g, ""));
const ask2 = Math.ceil((cap2 + 40000) / 5000) * 5000;
await typeInto(P.cfo, "debt_draw", E2.debt_draw); await typeInto(P.cfo, "equity_raise", ask2); await setRange(P.cfo, "invest_T_inv", E2.invest_T_inv);
for (const r of ["cmo", "coo", "chro", "cfo"]) dlg1[r + "2"] = await submit(P[r], r);
const d2 = ["cmo2", "coo2", "chro2", "cfo2"].flatMap((k) => dlg1[k]);
ok(d2.every((l) => !/Theirs will be used/.test(l) && /Yours will be used — it's your desk/.test(l)), "r2: any pre-submit confirm tells the owner their value wins over the CEO's stale default", `${d2.length} confirm(s)`);
const c2 = (await view(sess.ceo.token)).teamPlan?.composed ?? {};
expectPlan(c2, E2, "ops_manager", ask2, "r2 (CEO first)");
const debt1 = row1?.debt ?? 0;
await resolve(g.gameId);
dash = await api(`/instructor/games/${g.gameId}/dashboard`);
const row2 = dash.panel.filter((p) => p.firmId === "firm_1").at(-1);
const ev2 = dash.events.find((e) => e.round === row2?.round)?.events ?? [];
ok(row2?.round !== row1?.round && near(row2?.segments?.[seg]?.price, E2.price), "resolved r2: firm_1 sold at the CMO's new price", `${seg} $${row2?.segments?.[seg]?.price}`);
ok(ev2.some((e) => (empOn ? /^(HIRE|SIGNED): firm_1 /.test(e) : /^HIRE: firm_1 brings on a operations manager/.test(e))), `resolved r2: HIRE event for the CHRO's ${empOn ? "second hire" : "operations manager"}`, ev2.filter((e) => /firm_1/.test(e)).slice(0, 4).join(" | "));
ok(ev2.some((e) => /^EQUITY: investors fund only .* firm_1 sought/.test(e) && e.includes(`$${ask2.toLocaleString("en-US")}`)), "resolved r2: equity trimmed to the cap", ev2.filter((e) => /EQUITY/.test(e)).join(" | ").slice(0, 200));
ok(row2 && row2.debt - debt1 > E2.debt_draw * 0.9, "resolved r2: debt rose by ~the CFO's draw", `debt ${Math.round(debt1)} → ${Math.round(row2?.debt)}`);

// ── (3) cover: firm_2 has only CEO + CFO; the CFO hires from the People tab ──
const s2 = { ceo: await join(g.joinCode, t2.teamId, "ceo", "Cover CEO"), cfo: await join(g.joinCode, t2.teamId, "cfo", "Cover CFO") };
const Q = { ceo: await mk("ceo2", s2.ceo), cfo: await mk("cfo2", s2.cfo) };
await submit(Q.ceo, "ceo2"); // CEO first, untouched (hire_roles: [])
await sleep(1200);
const peopleTab = await Q.cfo.$("xpath/.//button[normalize-space(.)='People']");
await peopleTab.click(); await sleep(400);
const cv = await probe(Q.cfo);
ok((empOn ? cv.hire_employee === true : cv.hire_roles === true) && cv.debt_draw === false, `CFO on the People tab sees ${empOn ? "the talent market" : "Key people"} (and not Finance)`, JSON.stringify({ hire: empOn ? cv.hire_employee : cv.hire_roles, debt: cv.debt_draw }));
await clickKey(Q.cfo, empOn ? "hire_employee" : "hire_ops");
const dlgCover = await submit(Q.cfo, "cfo2");
ok(true, "CFO cover submit went through", dlgCover.join(" | ").slice(0, 260) || "no confirm");
const cc = (await view(s2.ceo.token)).teamPlan?.composed ?? {};
ok(empOn ? (cc.hire_employees ?? []).length >= 1 : (cc.hire_roles ?? []).includes("ops_manager"), "cover: composed plan carries the CFO's hire for the empty CHRO chair", JSON.stringify(empOn ? cc.hire_employees : cc.hire_roles));
await resolve(g.gameId);
dash = await api(`/instructor/games/${g.gameId}/dashboard`);
const ev3 = dash.events.at(-1)?.events ?? [];
ok(ev3.some((e) => (empOn ? /^(HIRE|SIGNED): firm_2 /.test(e) : /^HIRE: firm_2 brings on a operations manager/.test(e))), `cover: resolved round hires firm_2's ${empOn ? "candidate" : "operations manager"}`, ev3.filter((e) => /firm_2/.test(e)).slice(0, 3).join(" | "));
await api(`/instructor/games/${g.gameId}/end`, {}).catch(() => {});
} catch (e) { results.push("ABORT " + e.message); console.log("ABORT " + e.message.split("\n")[0]); }
const fails = results.filter((l) => !l.startsWith("PASS"));
console.log(`DONE ${results.length} checks — ${results.length - fails.length} pass, ${fails.length} fail/abort`);
console.log("--- logs ---\n" + logs.slice(0, 20).join("\n"));
await browser.close();
