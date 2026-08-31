// DW-052 probe — authority/suggestion routing on a team firm (Pro preset).
// Needs memory server (:8787) + vite dev (:5173) + Chrome. Run: node web/scripts/probe-covers.mjs
// Chain: CFO covers research → resubmit keeps it (sentCovers) · CHRO sites a facility via the
// City View → cover reaches the composed plan ONCE (no compounding) + CEO's Reconcile names it ·
// CHRO suggests an equity raise → CFO + CEO both see it, CFO's own word wins · CEO's projected
// cash tracks a teammate's submitted spend.
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const ok = (c, l, d = "") => { const line = `${c ? "PASS" : "FAIL"}  ${l}${d ? " — " + d : ""}`; results.push(line); console.log(line); };
const logs = [];
const mk = async (tag) => { const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); p.on("pageerror", (e) => logs.push(`[${tag} pageerror] ${e.message}`)); p.on("dialog", async (d) => { logs.push(`[${tag} dialog] ${d.message().slice(0, 300)}`); await d.accept(); }); await p.goto("http://localhost:5173/", { waitUntil: "networkidle0" }); return p; };
const clickText = async (page, text, tag = "button") => { const sel = `xpath/.//${tag}[contains(normalize-space(.), ${JSON.stringify(text)})]`; const el = await page.waitForSelector(sel, { timeout: 8000 }).catch(() => null); if (!el) throw new Error(`no ${tag} "${text}"`); await el.click(); };
const has = (page, re) => page.evaluate((src) => new RegExp(src, "i").test(document.body.innerText), re.source);
const waitText = (page, re, t = 12000) => page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), { timeout: t }, re.source);
const tok = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("dw_mp")).token);
const view = async (t) => (await fetch(`http://localhost:8787/view?token=${t}`)).json();
const typeNum = async (page, labelRe, value) => {
  const idx = await page.evaluate((src) => {
    const re = new RegExp(src, "i");
    const ins = [...document.querySelectorAll("input[type=number]")];
    return ins.findIndex((i) => re.test((i.closest("label")?.innerText || i.parentElement?.parentElement?.innerText || "").slice(0, 120)));
  }, labelRe.source);
  if (idx < 0) throw new Error(`no number input ${labelRe}`);
  const hs = await page.$$("input[type=number]");
  await hs[idx].click({ clickCount: 3 }); await hs[idx].type(String(value));
};
const submitDesk = async (page) => { await clickText(page, "my desk"); await sleep(2500); };

try {
// ── instructor: Pro team game, one firm, 3 chairs ──
const ins = await mk("ins");
await clickText(ins, "Instructor");
await ins.type('input[placeholder="Enter your instructor passcode"]', "letmein");
await clickText(ins, "Team · C-suite");
await clickText(ins, "Everything (Pro)");
await clickText(ins, "Create game");
await waitText(ins, /share this join code/);
const code = await ins.evaluate(() => document.querySelector(".wordmark")?.textContent?.trim());
const ta = await ins.$('textarea[placeholder^="jdoe1"]');
await ta.type("a1, Ana Ceo, Hop Theory, CEO\nb2, Ben Cfo, Hop Theory, CFO\nc3, Cy Chro, Hop Theory, CHRO");
await clickText(ins, "Apply seat plan");
await sleep(1200);
const codes = await ins.evaluate(() => [...document.querySelectorAll('button[title^="Return code"]')].map((b) => [b.parentElement.innerText.replace(/\s+/g, " "), b.textContent.trim()]));
ok(codes.length === 3, "Pro team game, 3 seats", code);
const claimOf = (net) => codes.find((c) => c[0].includes(net))?.[1];

const joinAs = async (tag, claim, found) => {
  const p = await mk(tag); await clickText(p, "Join a game"); await p.type('input[placeholder="6 characters"]', code); await p.type('input[placeholder="optional"]', claim); await clickText(p, "Continue");
  await waitText(p, /round open|submitted|name your brewery/i);
  if (await has(p, /Open the brewery/)) { await clickText(p, "Open the brewery"); await waitText(p, /round open|submitted/i); }
  return p;
};
const ceo = await joinAs("ceo", claimOf("a1"), true);
const cfo = await joinAs("cfo", claimOf("b2"));
const chro = await joinAs("chro", claimOf("c3"));
const [ceoT, cfoT, chroT] = [await tok(ceo), await tok(cfo), await tok(chro)];

// ── 1. CFO covers market research (CMO chair empty), submits ──
const clicked = await cfo.evaluate(() => {
  const ins = [...document.querySelectorAll("input[type=checkbox]")];
  const el = ins.find((i) => { let n = i; for (let k = 0; k < 4 && n; k++, n = n.parentElement) if (/market research|reveals rival/i.test(n.innerText ?? "")) return true; return false; });
  if (!el) return false; el.click(); return true;
});
if (!clicked) throw new Error("no research checkbox on CFO page");
await sleep(300);
await submitDesk(cfo);
let v = await view(cfoT);
ok(v.infoActive === true && v.teamPlan?.composed?.buy_info === true, "CFO's research cover lands (unlocks on submit)", JSON.stringify({ infoActive: v.infoActive }));

// ── 2. CFO tweaks OWN desk and resubmits → the research cover survives (DW-052 sentCovers) ──
await typeNum(cfo, /dividend/i, 5000);
await sleep(300);
await submitDesk(cfo);
v = await view(cfoT);
ok(v.infoActive === true && v.teamPlan?.composed?.buy_info === true && (v.teamPlan?.composed?.dividend ?? 0) > 0, "resubmit keeps the research cover AND the dividend tweak", JSON.stringify({ infoActive: v.infoActive, dividend: v.teamPlan?.composed?.dividend }));

// ── 3. CHRO sites a facility on the City View (operations = empty COO desk) ──
await clickText(chro, "City & Globe");
await sleep(800);
const lot = await chro.waitForSelector('button[title^="Available parcel"]', { timeout: 8000 });
await lot.click(); await sleep(400);
const typeBtn = await chro.waitForSelector('xpath/.//button[contains(., "to build")]', { timeout: 5000 });
await typeBtn.click(); await sleep(300);
await clickText(chro, "Build ·");
await sleep(300);
await clickText(chro, "Decide");
await sleep(400);
await submitDesk(chro);
v = await view(ceoT);
const builds1 = v.teamPlan?.composed?.build_facilities ?? [];
ok(builds1.length === 1, "CHRO's City View build reaches the composed plan (was stripped before DW-052)", JSON.stringify(builds1));
ok(logs.some((l) => /\[chro dialog\][\s\S]*(build|COO)/i.test(l)), "pre-submit confirm named the build cover", logs.find((l) => /\[chro dialog\]/.test(l))?.slice(0, 200));

// ── 4. CHRO resubmits → still exactly ONE build (dedupe + sentCovers re-send, no compounding) ──
await submitDesk(chro);
v = await view(ceoT);
const builds2 = v.teamPlan?.composed?.build_facilities ?? [];
ok(builds2.length === 1, "resubmit: build count stays 1 (no compounding)", JSON.stringify({ builds: builds2.length }));

// ── 5. CEO's Reconcile names the build cover (one-shot lever, absent from the standing plan) ──
await waitText(ceo, /Build facilities/i, 15000);
ok((await has(ceo, /Build facilities/i)) && (await has(ceo, /empty COO desk/i)), "CEO sees 'Build facilities … set this for the empty COO desk'");

// ── 6. CHRO suggests an equity raise (CFO is seated) → routed to CFO and CEO; CFO's word wins ──
await clickText(chro, "All");
await sleep(400);
await typeNum(chro, /raise equity/i, 50000);
await sleep(300);
await submitDesk(chro);
await sleep(4000);
ok(await has(cfo, /suggests this for YOUR desk/i), "CFO sees the CHRO's equity suggestion on their desk");
ok(await has(ceo, /suggests this for the CFO/i), "CEO sees the suggestion routed to the CFO's desk");
v = await view(ceoT);
ok((v.teamPlan?.composed?.equity_raise ?? 0) === 0, "composed plan keeps the CFO's own word (equity 0) — suggestion doesn't silently apply", String(v.teamPlan?.composed?.equity_raise));

// ── 7. CEO's projected cash tracks a teammate's submitted spend (proj overlay) ──
const dial = (p) => p.evaluate(() => { const m = document.body.innerText.match(/(?:Projected cash|Cash) · pre-sales\s*\n?\s*(\$-?[\d,]+)/i); return m ? Number(m[1].replace(/[$,]/g, "")) : null; });
const before = await dial(ceo);
const cfoPartial = (await view(cfoT)).teamPlan.seats.find((s) => s.me).partial;
await fetch("http://localhost:8787/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: cfoT, decision: { ...cfoPartial, invest_T_inv: 30000 } }) });
await sleep(5000);
const after = await dial(ceo);
ok(before != null && after != null && Math.abs(before - after - 30000) < 1, "CEO's commit dial drops by the CFO's $30k investor-relations spend", JSON.stringify({ before, after }));
} catch (e) { results.push("ABORT " + e.message); console.log("ABORT " + e.message.split("\n")[0]); }
console.log("DONE " + results.length);
console.log("--- logs ---\n" + logs.slice(0, 12).join("\n"));
await browser.close();
