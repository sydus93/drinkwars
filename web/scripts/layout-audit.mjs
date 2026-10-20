// Layout audit (DW-078): every student surface at phone, tablet and desktop widths. A Sprint-2 team
// game (calls on) is played two rounds through the API, a regional drought is planted and fired,
// then every seat is walked through the event takeover, the results page and Decide (the first seat
// also through each Review tab, City & Globe and the dossier / globe / market-entry dialogs) at
// 360 · 390 · 768 · 1024 · 1440, plus the lobby, join, "My games" and a solo game. Each surface
// fails on page overflow, content clipped inside a vertical scroller, or a covered primary button
// (see overflowScan).
// Full-page screenshots land in OUT (default: .scratch/layout-shots, gitignored) for eyeballing.
//   API=http://localhost:8787 WEB=http://localhost:5173 node scripts/layout-audit.mjs
//   WIDTHS=390,1440 SEATS=ceo,chro OUT=/tmp/x SOLO=0 INSTRUCTOR=0 MODE=dark …
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { moduleIds, modulesBlock, describeModules } from "./modules-env.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const API = (process.env.API ?? "http://localhost:8787").replace(/\/$/, ""), WEB = (process.env.WEB ?? "http://localhost:5173").replace(/\/$/, "") + "/";
const INS = { "content-type": "application/json", "x-instructor-pass": process.env.DW_INSTRUCTOR_PASS ?? "letmein" };
const OUT = process.env.OUT ?? join(dirname(fileURLToPath(import.meta.url)), "../../.scratch/layout-shots");
const WIDTHS = (process.env.WIDTHS ?? "360,390,768,1024,1440").split(",").map(Number);
const SEATS = (process.env.SEATS ?? "ceo,cfo,coo,cmo,chro").split(",");
const MODS = moduleIds(["geography", "international", "facilities", "employees", "laborMarket", "consumerDrift", "marketConduct", "sustainability"]);
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => { const r = await fetch(API + p, { method: body ? "POST" : "GET", headers: INS, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${p}: ${r.status} ${JSON.stringify(j)}`); return j; };
const view = (tok) => fetch(`${API}/view?token=${tok}`).then((r) => r.json());
const join_ = async (code, teamId, role, name, teamName) => {
  const r = await fetch(`${API}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name, teamId, role, teamName }) });
  const j = await r.json(); if (!r.ok) throw new Error(`join ${name}: ${JSON.stringify(j)}`);
  return { token: j.token, config: j.config, firmId: j.firmId, nRounds: j.nRounds, firmMode: j.firmMode, role: j.role, claim: j.claim, claimIssued: false };
};
const submitAll = async (s, extra = {}) => {
  const v = await view(s.token);
  const decision = { ...v.standing, debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, ...extra };
  const r = await fetch(`${API}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: s.token, decision }) });
  if (!r.ok) throw new Error(`submit: ${r.status} ${await r.text()}`);
};

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); };

// ── set-up: 4 team firms, Sprint-2 modules, two rounds played, a regional drought fired ──
const g = await api("/instructor/games", { nFirms: 4, nRounds: 8, firmMode: "team", title: "layout audit", modules: modulesBlock(MODS), configOverride: { classroom: { forecasts: { enabled: true } } } });
const st = await api(`/instructor/games/${g.gameId}/status`);
const T = Object.fromEntries(st.teams.map((t) => [t.firmId, t.teamId]));
const A = {};
for (const [role, name] of [["ceo", "Marta Quintero-Wallace"], ["cfo", "Omar"], ["coo", "Jules"], ["cmo", "Priya"], ["chro", "Sam Okonkwo-Berg"]]) A[role] = await join_(g.joinCode, T.firm_1, role, name, role === "ceo" ? "The Very Long Brewery Name Co." : undefined);
const REST = [];
for (const f of ["firm_2", "firm_3", "firm_4"]) REST.push(await join_(g.joinCode, T[f], "ceo", `${f} CEO`, `Rival ${f.slice(-1)}`));
const playRound = async (ceoExtra = {}) => { for (const s of [A.ceo, ...REST]) await submitAll(s, s === A.ceo ? ceoExtra : {}); await api(`/instructor/games/${g.gameId}/lock`, {}); await api(`/instructor/games/${g.gameId}/resolve`, { force: true }); };
// round 1: the CEO also sites a taproom, so City & Globe has a facility popover to open (DW-079)
await playRound({ build_facilities: [{ type: "taproom", location: "downtown" }] }); await playRound();
const v2 = await view(A.ceo.token);
const region = (v2.markets ?? []).find((m) => m.kind === "domestic")?.id ?? "home";
// a domestic market the firm hasn't entered — City & Globe offers "Enter market" for it
const unentered = (v2.markets ?? []).find((m) => m.kind === "domestic" && !m.entered);
await api(`/instructor/games/${g.gameId}/timeline`, { op: "schedule", spec: { type_id: "water", round: v2.round, region } });
await playRound();
const v3 = await view(A.ceo.token);
const sh = (v3.shocks ?? []).find((s) => s.typeId === "water");
ok(!!sh && sh.region === region && typeof sh.regionLabel === "string" && typeof sh.exposure === "number", "regional drought reaches the view with region, label and this firm's exposure", JSON.stringify(sh ?? null));
// submit two desks this round so the Round Table / commit panel have something to show
await submitAll(A.coo);
console.log(`[info] ${describeModules(MODS)} · game ${g.gameId.slice(0, 8)} · drought in ${sh?.regionLabel ?? region}`);

// ── the walk ──
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
/** Three layout faults, checked on whatever is on screen:
 *   page    — the document is wider than the viewport, or an element pokes past the right edge
 *             outside any scroll/clip container;
 *   clipped — content wider than a VERTICAL scroller (overflow-y-auto turns overflow-x to auto too,
 *             so a too-wide row is silently cut off — the Standings scores hid this way);
 *   covered — a primary button (submit / on to round / back to my desk) whose centre or ends are
 *             under another element (the floating theme button sat on the phone CTA). */
const overflowScan = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const doc = document.documentElement.scrollWidth;
  const clipsX = (p) => p !== document.body && p !== document.documentElement && /(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX);
  const inClip = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (clipsX(p)) return true; return false; };
  const label = (el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} "${(el.innerText ?? "").trim().slice(0, 40).replace(/\n/g, " ")}"`;
  const visible = (el) => { const cs = getComputedStyle(el); return cs.visibility !== "hidden" && cs.display !== "none"; };
  const bad = [], clipped = [], covered = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || !visible(el)) continue;
    const cs = getComputedStyle(el);
    // clipped: a vertical scroller whose horizontal overflow is a side effect, not a choice
    if (/(auto|scroll)/.test(cs.overflowY) && /(auto|scroll)/.test(cs.overflowX) && !/overflow-(x-)?(auto|scroll)/.test(String(el.className)) && el.scrollWidth > el.clientWidth + 1)
      clipped.push(`${label(el)} content ${el.scrollWidth}px in ${el.clientWidth}px`);
    if (r.right <= vw + 1) continue;
    if (cs.position === "fixed" && r.left <= 0) continue;
    if (inClip(el)) continue;
    if (el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 1 && !inClip(el.parentElement)) continue; // outermost only
    bad.push(`${label(el)} right=${Math.round(r.right)}`);
  }
  // With a dialog open, only ITS buttons count (the page under a modal is covered on purpose).
  const modals = [...document.querySelectorAll('[aria-modal="true"]')].filter(visible);
  const top = modals.length ? (document.elementFromPoint(vw / 2, vh / 2)?.closest('[aria-modal="true"]') ?? modals[modals.length - 1]) : null;
  for (const b of document.querySelectorAll("button")) {
    if (!visible(b) || !/submit|on to round|back to my desk|see the season/i.test(b.innerText)) continue;
    if (top && !top.contains(b)) continue;
    const r = b.getBoundingClientRect();
    if (!r.width || r.top < 0 || r.bottom > vh) continue;
    const y = r.top + r.height / 2;
    for (const x of [r.left + 6, r.left + r.width / 2, r.right - 6]) {
      const hit = document.elementFromPoint(x, y);
      if (hit && hit !== b && !b.contains(hit)) { covered.push(`"${b.innerText.trim().slice(0, 30)}" under ${label(hit)}`); break; }
    }
  }
  // DW-079 covered dialog: any visible dialog with a foreign element over part of it (the City
  // popovers rose under the frosted sticky tab bar). A dialog under ANOTHER dialog is deliberate.
  for (const d of [...document.querySelectorAll('[role="dialog"]')].filter(visible)) {
    const r = d.getBoundingClientRect();
    const x0 = Math.max(0, r.left), x1 = Math.min(vw, r.right), y0 = Math.max(0, r.top), y1 = Math.min(vh, r.bottom);
    if (x1 - x0 < 16 || y1 - y0 < 16) continue;
    let by = null;
    for (let i = 1; i < 8 && !by; i++) for (let j = 1; j < 8 && !by; j++) {
      const h = document.elementFromPoint(x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * j) / 8);
      if (h && !d.contains(h) && !h.closest('[role="dialog"]')) by = h;
    }
    if (by) covered.push(`dialog "${(d.getAttribute("aria-label") ?? d.innerText ?? "").trim().slice(0, 30)}" under ${label(by)}`);
  }
  // DW-079 long decimals: a lever value printed raw ("27.598636583011583") anywhere on screen
  const decimals = (document.body.innerText.match(/\d+\.\d{4,}/g) ?? []).slice(0, 3);
  // DW-079 overlap: text in the commit panel's "locks at a teammate's number" block printed over other text
  const overlaps = [];
  const pd = document.querySelector('[data-testid="plan-differs"]');
  for (const box of [pd, document.querySelector('[data-dw="commit-sheet"]')].filter((x) => x && x.getClientRects().length)) {
    // per LINE box (getClientRects): two inline runs that wrap share a bounding box without touching
    const leaves = [...box.querySelectorAll("*")].filter((e) => !e.children.length && (e.textContent ?? "").trim() && visible(e)).map((e) => [e, [...e.getClientRects()]]);
    const meet = (p, q) => Math.min(p.right, q.right) - Math.max(p.left, q.left) > 2 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 2;
    for (let i = 0; i < leaves.length && !overlaps.length; i++) for (let j = i + 1; j < leaves.length; j++) {
      const [a, ra] = leaves[i], [b, rb] = leaves[j];
      if (ra.some((p) => rb.some((q) => meet(p, q)))) { overlaps.push(`"${a.textContent.trim().slice(0, 24)}" × "${b.textContent.trim().slice(0, 24)}"`); break; }
    }
  }
  const sheet = document.querySelector('[data-dw="commit-sheet"]');
  const differs = (!!pd && pd.getClientRects().length > 0) || (!!sheet && sheet.getClientRects().length > 0 && /lock(s)? at a teammate/i.test(sheet.innerText));
  return { doc, vw, bad: bad.slice(0, 6), clipped: clipped.slice(0, 4), covered: covered.slice(0, 3), decimals, overlaps, differs };
});
const click = async (page, re) => {
  const h = await page.evaluateHandle((src) => [...document.querySelectorAll("button")].find((b) => new RegExp(src, "i").test(b.innerText) && b.offsetParent !== null) ?? null, re.source);
  if (!(await h.evaluate((x) => !!x))) return false;
  await h.evaluate((x) => x.click()); await sleep(450); return true;
};
const check = async (page, seat, w, surface) => {
  await sleep(350);
  const r = await overflowScan(page);
  const why = [
    r.doc > r.vw + 1 || r.bad.length ? `page ${r.doc}px vs ${r.vw}px · ${r.bad.join(" | ")}` : "",
    r.clipped.length ? `clipped: ${r.clipped.join(" | ")}` : "",
    r.covered.length ? `covered: ${r.covered.join(" | ")}` : "",
    r.decimals.length ? `long decimals: ${r.decimals.join(" | ")}` : "",
    r.overlaps.length ? `overlapping text: ${r.overlaps.join(" | ")}` : "",
  ].filter(Boolean).join(" ;; ");
  ok(!why, `${seat} ${String(w).padStart(4)} ${surface}`, why);
  await page.screenshot({ path: join(OUT, `${seat}_${w}_${surface.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`), fullPage: true });
  return r;
};

for (const seat of SEATS) {
  for (const w of WIDTHS) {
    const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
    await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, "webdriver", { get: () => false })); // let the takeover + results page open
    if (process.env.MODE === "dark") await page.evaluateOnNewDocument(() => localStorage.setItem("dw-mode", "sectional"));
    page.on("dialog", (d) => d.accept());
    await page.setViewport({ width: w, height: w < 700 ? 844 : 1000 });
    await page.goto(WEB, { waitUntil: "domcontentloaded" });
    await page.evaluate((s) => localStorage.setItem("dw_mp", JSON.stringify(s)), A[seat]);
    await page.goto(WEB, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => /Round\s*\d/i.test(document.body.innerText), { timeout: 30000 });
    await sleep(800);
    // overlays first: the takeover (regional drought) then the results page
    if (await page.evaluate(() => /back to my desk/i.test(document.body.innerText))) { await check(page, seat, w, "takeover"); await click(page, /back to my desk/); }
    if (await page.$("[data-dw=on-to-round]")) { await check(page, seat, w, "results"); await page.$eval("[data-dw=on-to-round]", (b) => b.click()); await sleep(500); }
    if (seat === "cfo") {
      // Devin's playtest (10-15): a teammate's lever → "1 lever locks at a teammate's number". Drag the
      // COO's capacity divider the way he did, then the Decide check covers that block's layout + rounding.
      await click(page, /^\s*operations\s*$/); // the CFO lands on the Finance focus desk — open the COO's
      const bar = await page.evaluateHandle(() => [...document.querySelectorAll(".cursor-ew-resize")].find((e) => e.getClientRects().length > 0) ?? null);
      if (await bar.evaluate((e) => !!e)) { await bar.evaluate((e) => e.scrollIntoView({ block: "center" })); await sleep(200); }
      const box = (await bar.evaluate((e) => !!e)) ? await bar.boundingBox() : null;
      if (box) { const x = box.x + box.width / 2, y = box.y + box.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 37, y, { steps: 6 }); await page.mouse.up(); await sleep(500); }
      const r = await check(page, seat, w, "decide (off-desk edit)");
      // a VIEWPORT shot too: full-page captures draw the fixed phone commit sheet in the wrong place
      await page.screenshot({ path: join(OUT, `${seat}_${w}_offdesk-viewport.png`) });
      ok(r.differs, `${seat} ${String(w).padStart(4)} the off-desk edit shows "locks at a teammate's number"`);
      // …and Submit raises the in-app "Before you submit" check (DW-079; it was window.confirm) — look, then Go back
      if (r.differs && (await click(page, /submit my desk/))) {
        const shown = await page.waitForSelector('[data-dw="submit-confirm"]', { timeout: 4000 }).then(() => true).catch(() => false);
        ok(shown, `${seat} ${String(w).padStart(4)} Submit raises the in-app "Before you submit" check`);
        if (shown) { await check(page, seat, w, "submit confirm"); await click(page, /^\s*go back\s*$/); }
      }
    }
    await check(page, seat, w, "decide");
    if (seat === SEATS[0]) {
      // the dossier (tap a Standings row) — a phone-width modal with a roster table
      if (await page.$('button[title="Open dossier"]')) { await page.$eval('button[title="Open dossier"]', (b) => b.click()); await sleep(500); await check(page, seat, w, "dossier"); await page.keyboard.press("Escape"); await sleep(300); }
      await click(page, /^\s*Review\s*$/);
      for (const t of ["Statements & Ratios", "Operations & Demand", "The Dispatch", "Trends", "Field & Intel"]) { if (await click(page, new RegExp(t, "i"))) await check(page, seat, w, `review ${t}`); }
      if (await click(page, /City & Globe|^\s*Map\s*$/)) {
        await check(page, seat, w, "city");
        const pins = await page.evaluate(() => [...document.querySelectorAll('[data-dw="lease-pin"]')].map((b, i) => [i, b.getBoundingClientRect().top]).sort((a, b) => a[1] - b[1]).map(([i]) => i));
        for (const [n, i] of [pins[0], pins[Math.floor(pins.length / 2)], pins[pins.length - 1]].filter((x) => x != null).entries()) {
          for (const scroll of [0, 360]) {
            await page.evaluate((y) => window.scrollTo(0, y), scroll); await sleep(150);
            await page.evaluate((k) => document.querySelectorAll('[data-dw="lease-pin"]')[k]?.click(), i); await sleep(350);
            await check(page, seat, w, `city lease ${n}${scroll ? " scrolled" : ""}`);
            // picking a type adds the bid row — the popover grows and must re-place
            await page.evaluate(() => [...document.querySelectorAll('[data-dw="map-popover"]')].find((d) => d.getClientRects().length)?.querySelector("button.flex")?.click()); await sleep(300);
            await check(page, seat, w, `city lease ${n}${scroll ? " scrolled" : ""} + type`);
            await page.keyboard.press("Escape"); await sleep(200);
          }
        }
        if (await page.$('[data-dw="fac-marker"]')) { await page.evaluate(() => window.scrollTo(0, 0)); await page.$eval('[data-dw="fac-marker"]', (b) => b.click()); await sleep(350); await check(page, seat, w, "city facility"); await page.keyboard.press("Escape"); await sleep(200); }
        else ok(false, `${seat} ${String(w).padStart(4)} city: the round-1 taproom has a marker to open`);
        await page.evaluate(() => window.scrollTo(0, 0));
        if (await page.$('[title="Open the globe"]')) { await page.$eval('[title="Open the globe"]', (d) => d.click()); await sleep(600); await check(page, seat, w, "city globe"); await click(page, /Close/); }
        if (await click(page, /View distribution/)) { await check(page, seat, w, "city distribution"); await page.keyboard.press("Escape"); await click(page, /^✕$/); }
        if (unentered) await click(page, /Enter · \$/); // the city list's row for a market not yet entered
        if (await click(page, /^Enter market ·/)) { await check(page, seat, w, "city enter-market"); await click(page, /^Not now$/); }
        else ok(!unentered, `${seat} ${String(w).padStart(4)} city: "Enter market" offered for ${unentered?.label}`);
      }
    }
    await ctx.close();
  }
}
// ── no seat: the lobby, the join and "My games" forms, and a solo game's Decide / Review ──
if (process.env.SOLO !== "0") {
  for (const w of WIDTHS.filter((x) => x <= 390 || x >= 1440)) {
    const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    await page.setViewport({ width: w, height: w < 700 ? 844 : 1000 });
    const lobby = async () => { await page.goto(WEB, { waitUntil: "networkidle0" }); await page.waitForFunction(() => /Play solo/i.test(document.body.innerText), { timeout: 20000 }); };
    await lobby(); await check(page, "entry", w, "lobby");
    await click(page, /Join a game/); await check(page, "entry", w, "join");
    await lobby(); await click(page, /My games/); await check(page, "entry", w, "my games");
    await lobby(); await click(page, /Play solo/); await check(page, "solo", w, "builder");
    for (let i = 0; i < 8 && !(await click(page, /^Found .* →$/)); i++) await click(page, /^Next →$/);
    await page.waitForFunction(() => /Round\s*1/i.test(document.body.innerText) && /Decide/i.test(document.body.innerText), { timeout: 30000 });
    await sleep(800);
    await check(page, "solo", w, "decide");
    await click(page, /^\s*Review\s*$/); await check(page, "solo", w, "review");
    await ctx.close();
  }
}
// ── the instructor console (laptop + projector widths): every dashboard tab, then projector zoom ──
if (process.env.INSTRUCTOR !== "0") {
  const TABS = ["Overview", "Monitor", "Debrief", "Decisions", "Balance", "Schedule", "Export", "Trajectories", "Score anatomy", "Market", "Strategy map", "Coopetition", "Finance & health", "Team drill-down"];
  for (const w of WIDTHS.filter((x) => x >= 1024)) {
    const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    await page.setViewport({ width: w, height: 900 });
    await page.goto(WEB, { waitUntil: "networkidle0" });
    await click(page, /^\s*Instructor/);
    await page.type('input[placeholder="Enter your instructor passcode"]', INS["x-instructor-pass"]);
    await click(page, /Show my games/);
    await page.waitForFunction(() => /layout audit/i.test(document.body.innerText), { timeout: 15000 });
    const opened = await page.evaluate(() => { const row = [...document.querySelectorAll("div.flex.items-center")].filter((d) => /layout audit/i.test(d.innerText) && d.querySelector("button")).pop(); const b = row && [...row.querySelectorAll("button")].find((x) => /^Open$/.test(x.innerText.trim())); b?.click(); return !!b; });
    ok(opened, `instructor ${w}: opened the audit game from "Your games"`);
    await page.waitForFunction(() => /Controls/.test(document.body.innerText) && /SHARE THIS JOIN CODE/i.test(document.body.innerText), { timeout: 20000 });
    await sleep(600);
    await check(page, "instructor", w, "controls");
    await click(page, /^Dashboard$/);
    await page.waitForFunction(() => /Score anatomy/.test(document.body.innerText), { timeout: 20000 });
    for (const t of TABS) { if (await click(page, new RegExp(`^${t.replace(/[&]/g, "&")}$`))) await check(page, "instructor", w, t); }
    if (await click(page, /^Overview$/) && await click(page, /^150%$/)) { await check(page, "instructor", w, "overview at 150% projector"); await click(page, /^100%$/); }
    await ctx.close();
  }
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed · shots in ${OUT}`);
process.exit(fail ? 1 : 0);
