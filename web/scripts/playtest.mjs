// Playtest launcher (DW-051): one command opens a VISIBLE Chrome with an instructor window and
// one window per chair, on the real dev build — no private windows, no re-provisioning.
//   cd server && SENTRY_DSN= npm run serve      (memory adapter, :8787)
//   cd web && npm run dev                        (:5173)
//   cd web && npm run playtest                   (defaults: 2 firms × CEO,CFO)
// Options (env): FIRMS=3 CHAIRS=ceo,cfo,cmo MODE=team|solo PRESET="Everything (Pro)" PASS=letmein URL=http://localhost:5173
// Each window is its own browser context (own localStorage), so students never auto-resume
// into each other's seats. Ctrl-C closes everything. Exactly the same UI code as production.
import puppeteer from "puppeteer-core";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.URL ?? "http://localhost:5173/";
const PASS = process.env.PASS ?? "letmein";
const FIRMS = Math.max(1, Number(process.env.FIRMS ?? 2));
const CHAIRS = (process.env.CHAIRS ?? "ceo,cfo").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const MODE = process.env.MODE ?? "team";
const NAMES = ["Ana Ruiz", "Ben Okafor", "Cy Lindqvist", "Dee Patel", "Eli Moreau", "Fay Chen", "Gus Ortega", "Hal Nakamura", "Ivy Brooks", "Jo Haddad", "Kai Novak", "Lou Diallo", "Mo Sato", "Nia Kowalski", "Oz Reyes", "Pia Berg"];
const PRESET = process.env.PRESET ?? ""; // e.g. "Everything (Pro)", "Financial strategy" — a preset pill on the create form
// Individual module toggles ON TOP of (or instead of) a preset pill, matched on the module's
// display name, case-insensitively, by substring. The Sprint 1 classroom config is a preset
// pill plus two of these, which PRESET alone could not express:
//   MODULES="labor market,sustainability" npm run playtest
const MODULES = (process.env.MODULES ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport: null, args: ["--no-sandbox", "--window-size=1280,900"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = async () => { const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.goto(URL, { waitUntil: "networkidle0" }); return p; };
const clickText = async (page, text, tag = "button") => { const el = await page.waitForSelector(`xpath/.//${tag}[contains(normalize-space(.), ${JSON.stringify(text)})]`, { timeout: 10000 }); await el.click(); };
const waitText = (page, re, t = 15000) => page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), { timeout: t }, re.source);

// ── instructor ──
const ins = await mk();
await clickText(ins, "Instructor");
await ins.type('input[placeholder="Enter your instructor passcode"]', PASS);
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
  const applied = await ins.evaluate((wanted) => {
    const out = [];
    for (const name of wanted) {
      const row = [...document.querySelectorAll("div")].find((d) => {
        const label = d.querySelector(":scope > div > div > span.font-semibold");
        return label && label.textContent.toLowerCase().includes(name.toLowerCase()) && d.querySelector(":scope > button[aria-pressed]");
      });
      const btn = row?.querySelector(":scope > button[aria-pressed]");
      if (!btn) { out.push(`${name}: NOT FOUND`); continue; }
      if (btn.getAttribute("aria-pressed") !== "true") btn.click();
      out.push(`${name}: on`);
    }
    return out;
  }, MODULES);
  console.log(`modules -> ${applied.join(", ")}`);
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
  for (let f = 1; f <= FIRMS; f++) for (const chair of CHAIRS) { const name = NAMES[n % NAMES.length]; rows.push(`${chair}${f}, ${name}, Group ${f}, ${chair.toUpperCase()}`); students.push({ net: `${chair}${f}`, name, firm: f, chair }); n++; }
  const ta = await ins.$('textarea[placeholder^="jdoe1"]');
  await ta.type(rows.join("\n"));
  await clickText(ins, "Apply seat plan");
  await waitText(ins, /seated/);
  await sleep(1200);
  const codes = await ins.evaluate(() => [...document.querySelectorAll('button[title^="Return code"]')].map((b) => [b.parentElement.innerText.replace(/\s+/g, " "), b.textContent.trim()]));
  for (const s of students) s.claim = codes.find((c) => c[0].includes(s.net))?.[1];
  // ── students: each in its own window, straight to their chair (CEO founds the firm) ──
  for (const s of students) {
    const p = await mk();
    await clickText(p, "Join a game");
    await p.type('input[placeholder="6 characters"]', code);
    await p.type('input[placeholder="optional"]', s.claim);
    await clickText(p, "Continue");
    await waitText(p, /round open|submitted|name your brewery/);
    if (await p.evaluate(() => /Open the brewery/i.test(document.body.innerText))) {
      const colors = await p.$$('button[title]');
      const pick = ["Plum", "Forest", "Teal", "Gold", "Brick", "Indigo", "Slate", "Copper"][(s.firm - 1) % 8];
      for (const b of colors) if ((await b.evaluate((e) => e.title)) === pick) await b.click();
      const inputs = await p.$$("input"); for (const i of inputs) { const v = await i.evaluate((e) => e.value); if (/^Group \d+$/.test(v)) { await i.click(); await p.keyboard.down("Meta"); await p.keyboard.press("a"); await p.keyboard.up("Meta"); await p.keyboard.press("Backspace"); await i.type(`${["Hop Theory", "Barrel & Vine", "Sediment Co.", "Wort & Peace", "Mash Tun Club", "Lupulin Lane"][(s.firm - 1) % 6]}`); } }
      await clickText(p, "Open the brewery");
      await waitText(p, /round open|submitted/);
    }
    console.log(`  ${s.name.padEnd(10)} firm ${s.firm} ${s.chair.toUpperCase().padEnd(4)} claim ${s.claim}`);
  }
} else {
  for (let f = 1; f <= FIRMS; f++) {
    const p = await mk();
    await clickText(p, "Join a game");
    await p.type('input[placeholder="6 characters"]', code);
    await clickText(p, "Continue");
    await waitText(p, /name your brewery|found/i, 15000).catch(() => {});
    console.log(`  solo player ${f}: join code entered — pick a name/colour in the window`);
  }
}
console.log(`\n${1 + (MODE === "team" ? students.length : FIRMS)} windows open — instructor first. Ctrl-C to close all.`);
await new Promise((r) => process.on("SIGINT", r));
await browser.close();
