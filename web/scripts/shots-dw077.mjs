// DW-077 built shots — the commit panel ("What locks at round end") in the design's three states
// (None / One / Many differences) from a CFO seat and a CEO seat, at 1440 and 390, light and dark.
// Reproduces the firm 1 shape: COO + CFO submit their desks untouched, the CEO changes tanks and
// the loan; then a CFO who changed the dividend. Needs the memory server + vite dev + Chrome:
//   API=http://localhost:8793 WEB=http://localhost:5184 node web/scripts/shots-dw077.mjs
// Writes .scratch/design-round-ux-2026-10/built/seat--{State}_{Seat}-view_{width}_{mode}.png (gitignored — 25 MB of
// derived screenshots don't belong in the public repo; DW-080)
import puppeteer from "puppeteer-core";
import { autoConfirm } from "./confirm-dialog.mjs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const API = (process.env.API ?? "http://localhost:8787").replace(/\/$/, ""), WEB = (process.env.WEB ?? "http://localhost:5173").replace(/\/$/, "") + "/";
const PASS = process.env.DW_INSTRUCTOR_PASS ?? "letmein";
const INS = { "content-type": "application/json", "x-instructor-pass": PASS };
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../.scratch/design-round-ux-2026-10/built");
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, body) => { const r = await fetch(API + path, { method: body ? "POST" : "GET", headers: INS, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j)}`); return j; };
const view = (tok) => fetch(`${API}/view?token=${tok}`).then((r) => r.json());
const waitText = (page, re, t = 20000) => page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), { timeout: t }, re.source);
const join_ = async (code, teamId, role, name, teamName) => {
  const r = await fetch(`${API}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name, teamId, role, teamName }) });
  const j = await r.json(); if (!r.ok) throw new Error(`join ${name}: ${JSON.stringify(j)}`);
  return { token: j.token, config: j.config, firmId: j.firmId, nRounds: j.nRounds, firmMode: j.firmMode, role: j.role, claim: j.claim, claimIssued: false };
};
const DESK_KEYS = { operations: ["presence", "invest_cap", "invest_process", "invest_Q"], finance: ["debt_draw", "debt_repay", "equity_raise", "dividend", "invest_T_inv"] };
/** A seat's slice through the API, exactly as an untouched client would send it, plus a patch. */
const apiSubmit = async (s, desk, patch = {}) => {
  const v = await view(s.token);
  const st = { ...v.standing, debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false };
  const decision = desk === "all" ? { ...st, ...patch } : { firm_id: st.firm_id, ...Object.fromEntries(DESK_KEYS[desk].map((k) => [k, st[k]])), ...patch };
  const r = await fetch(`${API}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: s.token, decision }) });
  if (!r.ok) throw new Error(`api submit ${s.role}: ${r.status} ${await r.text()}`);
};
const mk = async (sess) => {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 1100 });
  p.on("dialog", async (d) => d.accept());
  await autoConfirm(p, () => {});
  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => localStorage.setItem("dw_mp", JSON.stringify(s)), sess);
  await p.goto(WEB, { waitUntil: "networkidle0" });
  await waitText(p, /What locks at round end/, 25000);
  await sleep(400);
  return p;
};
const typeInto = async (page, labelRe, value) => {
  const idx = await page.evaluate((src) => { const re = new RegExp(src, "i"); return [...document.querySelectorAll("input[type=number]")].findIndex((i) => re.test((i.closest("label")?.innerText || i.parentElement?.parentElement?.innerText || "").slice(0, 120))); }, labelRe.source);
  if (idx < 0) throw new Error(`no number input ${labelRe}`);
  const hs = await page.$$("input[type=number]");
  // a number input ignores select(): set it through React's own value setter and fire the events
  await hs[idx].evaluate((e, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, String(v)); e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, value); await sleep(200);
};
/** Wait until this page's panel reflects a teammate's submit (its own poll clock). */
const settle = async (page, re) => { await page.bringToFront(); await waitText(page, re, 25000).catch(() => {}); await sleep(600); };
const shoot = async (page, state, seat) => {
  await page.bringToFront();
  for (const mode of ["dark", "light"]) {
    await page.evaluate((m) => { document.documentElement.dataset.mode = m === "dark" ? "night" : "foolscap"; }, mode);
    await sleep(250);
    // 1440: the commit panel itself (its sticky column), scrolled into view
    await page.setViewport({ width: 1440, height: 1100 });
    await sleep(250);
    const rail = await page.evaluateHandle(() => { const k = [...document.querySelectorAll("span")].find((s) => /What locks at round end/i.test(s.textContent ?? "")); return k?.closest("div.overflow-hidden") ?? null; });
    if (!(await rail.evaluate((e) => !!e))) throw new Error("no commit panel on the page");
    await rail.evaluate((e) => e.scrollIntoView({ block: "start" }));
    await sleep(200);
    await rail.screenshot({ path: join(OUT, `seat--${state}_${seat}-view_1440_${mode}.png`) });
    // 390: the phone — the desk's levers with their captions above the pinned sheet
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await sleep(350);
    await page.evaluate(() => { const i = [...document.querySelectorAll("input[type=number]")].find((x) => /(Draw debt|Invest in tank capacity)/i.test(x.closest(".card")?.innerText ?? "")); const card = i?.closest(".card"); if (card) window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 72); });
    await sleep(250);
    await page.screenshot({ path: join(OUT, `seat--${state}_${seat}-view_390_${mode}.png`) });
    await page.setViewport({ width: 1440, height: 1100 });
  }
  await page.evaluate(() => { document.documentElement.dataset.mode = "foolscap"; });
  console.log(`shot ${state} · ${seat}`);
};

try {
  const g = await api("/instructor/games", { nFirms: 4, nRounds: 8, firmMode: "team", title: "DW-077 shots" });
  const st0 = await api(`/instructor/games/${g.gameId}/status`);
  const teamId = st0.teams[0].teamId;
  const ceo = await join_(g.joinCode, teamId, "ceo", "Ana Reyes", "Alpha Ales");
  const coo = await join_(g.joinCode, teamId, "coo", "Cy Tran");
  const cfo = await join_(g.joinCode, teamId, "cfo", "Ben Okafor");
  const P = { ceo: await mk(ceo), cfo: await mk(cfo) };

  // ── None: nobody has changed anything — both forms match the team's plan ──
  await shoot(P.cfo, "None", "CFO");
  await shoot(P.ceo, "None", "CEO");

  // ── One (CFO): the CEO changes the loan; the CFO left it at last round's value ──
  await apiSubmit(ceo, "all", { debt_draw: 100_000 });
  await settle(P.cfo, /1 lever locks at a teammate/);
  await shoot(P.cfo, "One", "CFO");
  // ── One (CEO): the COO changed tanks (their desk); the CEO typed a different number ──
  await apiSubmit(coo, "operations", { invest_cap: 80_000 });
  await P.ceo.bringToFront();
  await typeInto(P.ceo, /Invest in tank capacity/i, 200000);
  await settle(P.ceo, /1 lever locks at a teammate/);
  await shoot(P.ceo, "One", "CEO");

  // ── Many (CFO): the CEO also raises equity and sets a dividend; the CFO changes the dividend ──
  await apiSubmit(ceo, "all", { debt_draw: 100_000, equity_raise: 60_000, dividend: 5_000, invest_cap: 200_000 });
  await P.cfo.bringToFront();
  await typeInto(P.cfo, /Pay dividend/i, 20000);
  await settle(P.cfo, /3 differing levers|levers lock at a teammate/);
  await shoot(P.cfo, "Many", "CFO");
  // ── Many (CEO): the COO also changed quality; the CFO submits their changed dividend ──
  await apiSubmit(coo, "operations", { invest_cap: 80_000, invest_Q: 15_000 });
  await apiSubmit(cfo, "finance", { dividend: 20_000 });
  await settle(P.ceo, /3 levers lock at a teammate|differing levers/);
  await shoot(P.ceo, "Many", "CEO");
  console.log("DONE → " + OUT);
} catch (e) { console.log("ABORT " + e.message); }
await browser.close();
