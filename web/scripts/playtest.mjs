// Playtest launcher (DW-051): one command opens a VISIBLE Chrome with an instructor window and
// one window per chair, on the real dev build — no private windows, no re-provisioning.
//   cd server && SENTRY_DSN= npm run serve      (memory adapter, :8787)
//   cd web && npm run dev                        (:5173)
//   cd web && npm run playtest                   (defaults: 2 firms × CEO,CFO)
// Options (env): FIRMS=3 CHAIRS=ceo,cfo,cmo MODE=team|solo PRESET="Everything (Pro)" PASS=letmein URL=http://localhost:5173
//   CHAIRS="ceo,cfo,coo,cmo,chro|ceo" gives each firm its own chairs (full team + a lone rival CEO); HEADLESS=1 for a dry run.
// Each window is its own browser context (own localStorage), so students never auto-resume
// into each other's seats. Ctrl-C closes everything. Exactly the same UI code as production.
import puppeteer from "puppeteer-core";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.URL ?? "http://localhost:5173/";
const PASS = process.env.PASS ?? "letmein";
const CHAIR_SETS = (process.env.CHAIRS ?? "ceo,cfo").split("|").map((g) => g.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
const chairsFor = (f) => CHAIR_SETS[Math.min(f - 1, CHAIR_SETS.length - 1)];
const FIRMS = Math.max(1, Number(process.env.FIRMS ?? (CHAIR_SETS.length > 1 ? CHAIR_SETS.length : 2)));
const MODE = process.env.MODE ?? "team";
const NAMES = ["Ana Ruiz", "Ben Okafor", "Cy Lindqvist", "Dee Patel", "Eli Moreau", "Fay Chen", "Gus Ortega", "Hal Nakamura", "Ivy Brooks", "Jo Haddad", "Kai Novak", "Lou Diallo", "Mo Sato", "Nia Kowalski", "Oz Reyes", "Pia Berg"];
const PRESET = process.env.PRESET ?? ""; // e.g. "Everything (Pro)", "Financial strategy" — a preset pill on the create form
// Individual module toggles ON TOP of (or instead of) a preset pill, matched on the module's
// display name, case-insensitively, by substring. The Sprint 1 classroom config is a preset
// pill plus two of these, which PRESET alone could not express:
//   MODULES="labor market,sustainability" npm run playtest
const MODULES = (process.env.MODULES ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// Present as an ordinary Chrome: under automation (navigator.webdriver) the event takeover and the
// results page never open — that keeps the audits unblocked, but a playtest needs to see them.
const browser = await puppeteer.launch({ executablePath: CHROME, headless: process.env.HEADLESS === "1", defaultViewport: null, ignoreDefaultArgs: ["--enable-automation"], args: ["--window-size=1280,900", "--disable-blink-features=AutomationControlled"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nWin = 0;
const mk = async (title) => {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage();
  // Title each window after its chair (Chrome's Window menu lists them) and cascade them so they don't stack as one.
  await p.evaluateOnNewDocument((t) => document.addEventListener("DOMContentLoaded", () => { document.title = t; }), title);
  try { const cdp = await p.createCDPSession(); const { windowId } = await cdp.send("Browser.getWindowForTarget"); await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left: 36 * nWin, top: 28 * nWin, width: 1280, height: 900 } }); } catch { /* headless */ }
  nWin++;
  await p.goto(URL, { waitUntil: "networkidle0" }); return p;
};
const clickText = async (page, text, tag = "button") => { const el = await page.waitForSelector(`xpath/.//${tag}[contains(normalize-space(.), ${JSON.stringify(text)})]`, { timeout: 10000 }); await el.click(); };
const waitText = (page, re, t = 15000) => page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), { timeout: t }, re.source);
// Set a field in one shot, like a paste. Typing key by key into a VISIBLE window once lost the end of the
// seat plan mid-word (focus moved: firm 2 came out named "D" and three chairs had no seat or return code).
const fill = async (page, sel, v) => { const el = await page.waitForSelector(sel, { timeout: 10000 }); await el.evaluate((e, val) => { const proto = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(e, val); e.dispatchEvent(new Event("input", { bubbles: true })); }, v); };

// ── instructor ──
const ins = await mk("Instructor");
await clickText(ins, "Instructor");
await fill(ins, 'input[placeholder="Enter your instructor passcode"]', PASS);
if (MODE === "team") await clickText(ins, "Team · C-suite");
if (PRESET) { await clickText(ins, PRESET); await sleep(300); }
if (MODULES.length) {
  // The shelves are collapsed by default, so open every category before hunting for rows.
  // One at a time, re-querying between clicks: React replaces the shelf nodes on each toggle,
  // so collecting them all up front and clicking through the list hits detached elements and
  // silently opens only the first (that bug cost me a "labor market: NOT FOUND").
  for (let i = 0; i < 12; i++) {
    const opened = await ins.evaluate(() => {
      const shelf = [...document.querySelectorAll("button")].find(
        (b) => /\d+ (on|available)$/.test(b.innerText.trim()) && !b.querySelector("span")?.className.includes("rotate-90"),
      );
      if (!shelf) return false;
      shelf.click();
      return true;
    });
    if (!opened) break;
    await sleep(150);
  }
  await sleep(400);
  // One toggle per tick, then READ BACK the state. Two things went wrong here before: the
  // shelves re-render on each click (so a collected list goes stale), and ModeSelector used to
  // rebuild its selection from a closed-over value, so two toggles in one batch kept only the
  // last. Both are fixed, but this still verifies rather than trusting the click — reporting
  // "on" for a module that never turned on is worse than failing.
  const applied = [];
  for (const name of MODULES) {
    const res = await ins.evaluate((n) => {
      const row = [...document.querySelectorAll("div")].find((d) => {
        const label = d.querySelector(":scope > div > div > span.font-semibold");
        return label && label.textContent.toLowerCase().includes(n.toLowerCase()) && d.querySelector(":scope > button[aria-pressed]");
      });
      const btn = row?.querySelector(":scope > button[aria-pressed]");
      if (!btn) return "NOT FOUND";
      if (btn.getAttribute("aria-pressed") !== "true") btn.click();
      return "clicked";
    }, name);
    await sleep(250);
    const on = await ins.evaluate((n) => {
      const row = [...document.querySelectorAll("div")].find((d) => {
        const label = d.querySelector(":scope > div > div > span.font-semibold");
        return label && label.textContent.toLowerCase().includes(n.toLowerCase()) && d.querySelector(":scope > button[aria-pressed]");
      });
      return row?.querySelector(":scope > button[aria-pressed]")?.getAttribute("aria-pressed") === "true";
    }, name);
    applied.push(`${name}: ${res === "NOT FOUND" ? "NOT FOUND" : on ? "on" : "FAILED TO STICK"}`);
  }
  console.log(`modules -> ${applied.join(", ")}`);
  if (applied.some((a) => /NOT FOUND|FAILED/.test(a))) { console.error("Aborting: the game would not have the modules you asked for."); process.exit(1); }
  await sleep(300);
}
await clickText(ins, "Create game");
await waitText(ins, /share this join code/);
const code = await ins.evaluate(() => document.querySelector(".wordmark")?.textContent?.trim());
console.log(`game ${code} (${MODE}${PRESET ? " · " + PRESET : ""})`);

const students = [];
if (MODE === "team") {
  const rows = [];
  let n = 0;
  for (let f = 1; f <= FIRMS; f++) for (const chair of chairsFor(f)) { const name = NAMES[n % NAMES.length]; rows.push(`${chair}${f}, ${name}, Group ${f}, ${chair.toUpperCase()}`); students.push({ net: `${chair}${f}`, name, firm: f, chair }); n++; }
  await fill(ins, 'textarea[placeholder^="jdoe1"]', rows.join("\n"));
  await clickText(ins, "Apply seat plan");
  await waitText(ins, /\d+ seated/);
  const seated = await ins.evaluate(() => Number(document.body.innerText.match(/(\d+) seated/)?.[1] ?? 0));
  if (seated !== students.length) { console.error(`Aborting: the seat plan seated ${seated} of ${students.length}.`); process.exit(1); }
  // Every chair's return code, waiting for the Brewers card to list them all (not a fixed sleep).
  const hasCode = (codes, s) => codes.find((c) => c[0].includes(`· ${s.net} `))?.[1];
  let codes = [];
  for (let i = 0; i < 20 && !students.every((s) => hasCode(codes, s)); i++) {
    await sleep(500);
    codes = await ins.evaluate(() => [...document.querySelectorAll('button[title^="Return code"]')].map((b) => [b.parentElement.innerText.replace(/\s+/g, " "), b.textContent.trim()]));
  }
  for (const s of students) s.claim = hasCode(codes, s);
  const missing = students.filter((s) => !s.claim).map((s) => s.net);
  if (missing.length) { console.error(`Aborting: no return code on the Brewers card for ${missing.join(", ")}.`); process.exit(1); }
  // ── students: each in its own window, straight to their chair (CEO founds the firm) ──
  for (const s of students) {
    const p = await mk(`G${s.firm} ${s.chair.toUpperCase()} · ${s.name}`);
    await clickText(p, "Join a game");
    await fill(p, 'input[placeholder="6 characters"]', code);
    await fill(p, 'input[placeholder="optional"]', s.claim);
    await clickText(p, "Continue");
    await waitText(p, /round open|submitted|name your brewery/);
    if (await p.evaluate(() => /Open the brewery/i.test(document.body.innerText))) {
      const colors = await p.$$('button[title]');
      const pick = ["Plum", "Forest", "Teal", "Gold", "Brick", "Indigo", "Slate", "Copper"][(s.firm - 1) % 8];
      for (const b of colors) if ((await b.evaluate((e) => e.title)) === pick) await b.click();
      const brewery = ["Hop Theory", "Barrel & Vine", "Sediment Co.", "Wort & Peace", "Mash Tun Club", "Lupulin Lane"][(s.firm - 1) % 6];
      await p.evaluate(() => { const i = [...document.querySelectorAll("input")].find((e) => /^Group \d+$/.test(e.value)); if (i) i.setAttribute("data-pt-name", "1"); });
      if (await p.$("input[data-pt-name]")) await fill(p, "input[data-pt-name]", brewery);
      await clickText(p, "Open the brewery");
      await waitText(p, /round open|submitted/);
    }
    console.log(`  ${s.name.padEnd(10)} firm ${s.firm} ${s.chair.toUpperCase().padEnd(4)} claim ${s.claim}`);
  }
} else {
  for (let f = 1; f <= FIRMS; f++) {
    const p = await mk(`Solo ${f}`);
    await clickText(p, "Join a game");
    await p.type('input[placeholder="6 characters"]', code);
    await clickText(p, "Continue");
    await waitText(p, /name your brewery|found/i, 15000).catch(() => {});
    console.log(`  solo player ${f}: join code entered — pick a name/colour in the window`);
  }
}
console.log(`\n${1 + (MODE === "team" ? students.length : FIRMS)} windows open — instructor first. Ctrl-C (or quit this Chrome) to close all.`);
browser.on("disconnected", () => process.exit(0));
await new Promise((r) => process.on("SIGINT", r));
await browser.close();
