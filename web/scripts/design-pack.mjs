// Design screenshot pack — the student app in a team game, for a design session.
// Needs the memory server + a web build or dev server + Chrome. Run:
//   API=http://localhost:8787 WEB=http://localhost:5173 OUT=.scratch/design-pack node web/scripts/design-pack.mjs
// Writes <name>-<1440|390>-<light|dark>.png (full page at 1440×900 and 390×844 viewports; "crop-"
// files are the single component) plus tokens.css (web/src/index.css). Scripted state:
//   round 1  a Recession is ANNOUNCED three rounds out; the CEO, CFO and COO disagree → Reconcile
//            card + the commit dial's "TEAM's plan" box;
//   round 3  a Water shortage is ACTIVE (fired last round) → header pill, The Dispatch, Statements.
import puppeteer from "puppeteer-core";
import { autoConfirm } from "./confirm-dialog.mjs";
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const API = (process.env.API ?? "http://localhost:8787").replace(/\/$/, ""), WEB = (process.env.WEB ?? "http://localhost:5173").replace(/\/$/, "") + "/";
const OUT = resolvePath(process.env.OUT ?? join(HERE, "..", "..", ".scratch", "design-pack"));
const INS = { "content-type": "application/json", "x-instructor-pass": process.env.DW_INSTRUCTOR_PASS ?? "letmein" };
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, body) => { const r = await fetch(API + path, { method: body ? "POST" : "GET", headers: INS, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j)}`); return j; };
const view = (tok) => fetch(`${API}/view?token=${tok}`).then((r) => r.json());
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox"] });
const waitText = (page, re, t = 25000) => page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), { timeout: t }, re.source);
const VPS = [{ w: 1440, h: 900, dpr: 1 }, { w: 390, h: 844, dpr: 2 }];
const MODES = [["light", "foolscap"], ["dark", "sectional"]];
const written = [];
/** One state → four PNGs (2 viewports × 2 modes). `crop(page)` returns an element handle to shoot instead of the page. */
const shoot = async (page, name, crop) => {
  await page.bringToFront();
  for (const [label, mode] of MODES) for (const vp of VPS) {
    await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr });
    await page.evaluate((m) => document.documentElement.setAttribute("data-mode", m), mode);
    await sleep(450);
    const file = join(OUT, `${crop ? "crop-" : ""}${name}-${vp.w}-${label}.png`);
    if (crop) {
      const el = await crop(page);
      const box = el && (await el.evaluate((e) => !!e)) ? await el.boundingBox() : null;
      if (!box || box.width < 2 || box.height < 2) { console.log(`skip  ${name} @${vp.w} ${label} (component not rendered at this width)`); continue; }
      await el.evaluate((e) => e.scrollIntoView({ block: "center" })); await sleep(200);
      await el.screenshot({ path: file });
    } else {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: file, fullPage: true });
    }
    written.push(file);
  }
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluate(() => document.documentElement.setAttribute("data-mode", "foolscap"));
  console.log(`shot  ${name}`);
};
const byText = (re, sel, up) => (page) => page.evaluateHandle((src, sel, up) => {
  const re = new RegExp(src, "i");
  let el = [...document.querySelectorAll(sel)].filter((e) => re.test(e.innerText ?? "") && e.getClientRects().length).sort((a, b) => a.innerText.length - b.innerText.length)[0] ?? null;
  for (let i = 0; el && i < up; i++) el = el.parentElement;
  return el;
}, re.source, sel, up);
const RECONCILE = byText(/levers? (lock|differ|set by teammates)|Your form matches the team's plan/, "[data-testid=plan-differs], div.rounded-lg.border", 0); // DW-077: the differs block replaced the Reconcile card
const COMMIT = byText(/What locks at round end|Commit the round/, "span", 2);
const HEADER = (page) => page.$("header");
const join_ = async (code, teamId, role, name, teamName) => {
  const j = await (await fetch(`${API}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name, teamId, role, teamName }) })).json();
  if (!j.token) throw new Error(`join ${name}: ${JSON.stringify(j)}`);
  return { token: j.token, config: j.config, firmId: j.firmId, nRounds: j.nRounds, firmMode: j.firmMode, role: j.role, claim: j.claim, claimIssued: false };
};
const mk = async (sess) => {
  const p = await (await browser.createBrowserContext()).newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.on("dialog", (d) => d.accept());
  await autoConfirm(p, () => {});
  await p.goto(WEB, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => localStorage.setItem("dw_mp", JSON.stringify(s)), sess);
  await p.goto(WEB, { waitUntil: "networkidle0" });
  await waitText(p, /What locks at round end|Commit the round/); await sleep(500);
  return p;
};
const field = (page, re) => page.evaluateHandle((src) => { const re = new RegExp(src); const l = [...document.querySelectorAll("label")].find((x) => re.test([...x.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim())); let p = l; for (let i = 0; i < 3 && p; i++) { const c = p.querySelector("input[type=number]"); if (c) return c; p = p.parentElement; } return null; }, re.source);
const type = async (page, re, v) => { await page.bringToFront(); const h = await field(page, re); await h.click(); await h.evaluate((e) => e.select()); await page.keyboard.press("Backspace"); await h.type(String(v)); await sleep(150); };
const submit = async (page) => { await page.bringToFront(); const b = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((x) => /my desk/i.test(x.textContent) && x.getClientRects().length && !x.disabled)); await b.click(); await sleep(3000); };
const apiSubmit = async (s, patch = {}, keys = null) => {
  const v = await view(s.token);
  const st = { ...v.standing, hire_roles: [], debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false };
  const decision = keys ? { firm_id: st.firm_id, ...Object.fromEntries(keys.map((k) => [k, st[k]])), ...patch } : { ...st, ...patch };
  const r = await fetch(`${API}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: s.token, decision }) });
  if (!r.ok) throw new Error(`submit: ${await r.text()}`);
};
const click = async (page, text) => { const b = await page.waitForSelector(`xpath/.//button[contains(normalize-space(.), ${JSON.stringify(text)})]`, { timeout: 10000 }); await b.click(); await sleep(900); };
const resolve = async (gid) => { await api(`/instructor/games/${gid}/lock`, {}); await api(`/instructor/games/${gid}/resolve`, { force: true }); };

const g = await api("/instructor/games", { nFirms: 4, nRounds: 8, firmMode: "team", title: "design pack", modules: { laborMarket: { enabled: true }, consumerDrift: { enabled: true }, marketConduct: { enabled: true }, sustainability: { enabled: true } } });
try {
  const st = await api(`/instructor/games/${g.gameId}/status`);
  const T = Object.fromEntries(st.teams.map((t) => [t.firmId, t.teamId]));
  const me = { ceo: await join_(g.joinCode, T.firm_1, "ceo", "Ana Reyes", "Hop Theory"), cfo: await join_(g.joinCode, T.firm_1, "cfo", "Ben Okafor"), coo: await join_(g.joinCode, T.firm_1, "coo", "Cy Tran"), cmo: await join_(g.joinCode, T.firm_1, "cmo", "Dee Marsh") };
  const rivals = [await join_(g.joinCode, T.firm_2, "ceo", "Rival Two", "Granite & Grain"), await join_(g.joinCode, T.firm_3, "ceo", "Rival Three", "Low Tide Brewing"), await join_(g.joinCode, T.firm_4, "ceo", "Rival Four", "Vagrant Star")];
  await api(`/instructor/games/${g.gameId}/timeline`, { op: "schedule", spec: { type_id: "demand_slump", round: 3, magnitude: 0.25, duration: 2 } }); // announced: shows as "~3r"
  const ceo = await mk(me.ceo), cfo = await mk(me.cfo);

  // ── round 1: the calm state, and an announced shock in the header ──
  await shoot(ceo, "decide-ceo-whole-firm");
  await shoot(ceo, "header-shock-announced", HEADER);
  await shoot(cfo, "decide-cfo-finance-desk");
  // the team disagrees: COO + CFO change their own levers, the CEO types different numbers
  await apiSubmit(me.coo, { invest_cap: 80000, invest_Q: 15000 }, ["presence", "invest_cap", "invest_process", "invest_Q"]);
  await apiSubmit(me.cmo, {}, ["price", "buy_info", "invest_B"]);
  await type(cfo, /^Draw debt \(cash in\)$/, 50000); await type(cfo, /^Pay dividend \(cash out\)$/, 10000); await submit(cfo);
  await type(ceo, /^Invest in tank capacity/, 200000); await type(ceo, /^Draw debt \(cash in\)$/, 120000); await type(ceo, /^Raise equity \(cash in\)$/, 60000);
  await sleep(6000); // the CEO's (front) tab polls in the teammates' submits
  await waitText(ceo, /What locks at round end/).catch(() => console.log("warn  no commit panel on the CEO page")); // DW-077
  await shoot(ceo, "decide-ceo-with-open-conflicts");
  await shoot(ceo, "reconcile-ceo-open-conflicts", RECONCILE);
  await shoot(ceo, "commit-dial-team-plan-gap", COMMIT);
  await submit(ceo);
  await cfo.bringToFront(); await sleep(6000);
  await shoot(cfo, "decide-cfo-after-ceo-submits");
  await shoot(cfo, "reconcile-cfo-ceo-changed-my-desk", RECONCILE);
  for (const r of rivals) await apiSubmit(r, { invest_Q: 20000, invest_B: 15000 });
  await resolve(g.gameId);

  // ── round 2: plant a water shortage for this round; it fires at the resolve ──
  await api(`/instructor/games/${g.gameId}/timeline`, { op: "schedule", spec: { type_id: "water", round: 1, magnitude: 0.4, duration: 2 } });
  await apiSubmit(me.ceo, { invest_Q: 20000 });
  for (const r of rivals) await apiSubmit(r, { invest_Q: 20000 });
  await resolve(g.gameId);

  // ── round 3: the shock is active ──
  await ceo.bringToFront();
  await ceo.waitForFunction(() => /Round\s*3\s*\//.test(document.body.innerText), { timeout: 30000 });
  await waitText(ceo, /Income statement/); await sleep(800);
  await ceo.evaluate(() => { for (const b of [...document.querySelectorAll("button[aria-expanded='false']")]) b.click(); }); await sleep(500);
  await shoot(ceo, "review-statements-accordions-open");
  await click(ceo, "The Dispatch");
  await shoot(ceo, "review-dispatch-after-shock-round");
  await click(ceo, "Decide"); await waitText(ceo, /What locks at round end|Commit the round/);
  await shoot(ceo, "decide-ceo-shock-active");
  await shoot(ceo, "header-shock-active", HEADER);
  const mapBtn = await ceo.$("xpath/.//button[contains(@class,'tt-tab')][contains(normalize-space(.), 'Map') or contains(normalize-space(.), 'City')]");
  if (mapBtn) { await mapBtn.click(); await sleep(1500); await shoot(ceo, "map"); } else console.log("warn  no Map tab");
  console.log(`header at round 3: ${(await ceo.evaluate(() => document.querySelector("header")?.innerText ?? "")).replace(/\n+/g, " | ").slice(0, 260)}`);
} finally {
  await api(`/instructor/games/${g.gameId}/end`, {}).catch(() => {});
  await browser.close();
}
copyFileSync(join(HERE, "..", "src", "index.css"), join(OUT, "tokens.css"));
console.log(`DONE ${written.length} PNGs + tokens.css → ${OUT}`);
