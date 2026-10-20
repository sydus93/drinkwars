// Headless-Chrome classroom audit (DW-050). Needs the memory server (`cd server && npm run serve`),
// the Vite dev server (`cd web && npm run dev`), Google Chrome, and `puppeteer-core` available
// (e.g. `npm i --no-save puppeteer-core` in web/). Run: `node web/scripts/ui-audit.mjs`.
// Drives: team game → seat plan with names → two students join by claim only → deadline →
// CEO/CFO "what locks" panel (DW-077: the commit panel's differs block replaced the Reconcile card) →
// off-desk edit notice → lock/resolve. Prints PASS/FAIL per step.
import puppeteer from "puppeteer-core";
import { autoConfirm } from "./confirm-dialog.mjs";
import { describeModules, moduleIds, moduleNames } from "./modules-env.mjs";
const API = (process.env.API ?? "http://localhost:8787").replace(/\/$/, ""), WEB = (process.env.WEB ?? "http://localhost:5173").replace(/\/$/, "") + "/"; // ports via env (defaults unchanged)
// DW-076: MODULES=<preset id | comma list> — this audit creates its game through the REAL instructor form,
// so the modules are switched on by their toggles (default: the standard game, as before).
const MODS = moduleIds([]);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const ok = (c, l, d = "") => { const line = `${c ? "PASS" : "FAIL"}  ${l}${d ? " — " + d : ""}`; results.push(line); console.log(line); };
const logs = [];
const mk = async (tag) => { const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await autoConfirm(p, (t) => logs.push(`[${tag} dialog] ${t.replace(/\s+/g, " ").slice(0, 400)}`)); p.on("pageerror", (e) => logs.push(`[${tag} pageerror] ${e.message}`)); p.on("console", (m) => { if (m.type() === "error" && !/404|validateDOMNesting/.test(m.text())) logs.push(`[${tag} error] ${m.text().slice(0, 200)}`); }); p.on("dialog", async (d) => { logs.push(`[${tag} dialog] ${d.message().slice(0, 160)}`); await d.accept(); }); await p.goto(WEB, { waitUntil: "networkidle0" }); return p; };
const clickText = async (page, text, tag = "button") => { const sel = `xpath/.//${tag}[contains(normalize-space(.), ${JSON.stringify(text)})]`; const el = await page.waitForSelector(sel, { timeout: 8000 }).catch(() => null); if (!el) throw new Error(`no ${tag} "${text}" — page: ${(await page.evaluate(() => document.body.innerText)).slice(0, 200)}`); await el.click(); };
const has = (page, re) => page.evaluate((src) => new RegExp(src, "i").test(document.body.innerText), re.source);
const waitText = (page, re, t = 10000) => page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), { timeout: t }, re.source);
const text = (page) => page.evaluate(() => document.body.innerText);

try {
// ── instructor: team game + seat plan (with names) ──
const ins = await mk("ins");
await clickText(ins, "Instructor");
await ins.type('input[placeholder="Enter your instructor passcode"]', "letmein");
await clickText(ins, "Team · C-suite");
if (MODS.length) {
  // open every shelf, then flip each wanted module's toggle (the row's aria-pressed button) by its display name
  const names = moduleNames();
  await ins.evaluate(() => { for (const b of document.querySelectorAll("button")) if (/available|\d+ on/.test(b.textContent ?? "") && b.querySelector("span")) b.click(); });
  await sleep(300);
  // one toggle per render, as a person clicks — a synchronous burst of clicks only kept the last per render
  const flipped = [];
  for (const name of MODS.map((id) => names[id] ?? id)) {
    const hit = await ins.evaluate((n) => {
      const label = [...document.querySelectorAll("span")].find((e) => e.textContent?.trim() === n);
      const btn = label?.closest("div.flex.items-start")?.querySelector("button[aria-pressed]");
      if (btn && btn.getAttribute("aria-pressed") !== "true") btn.click();
      return !!btn;
    }, name);
    if (hit) flipped.push(name);
    await sleep(150);
  }
  await sleep(300);
  const createLabel = await ins.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Create game/.test(b.textContent ?? ""))?.textContent ?? "");
  ok(flipped.length === MODS.length && new RegExp(`${MODS.length} module`).test(createLabel), `MODULES: ${MODS.length} module toggle${MODS.length === 1 ? "" : "s"} flipped on the form`, `${describeModules(MODS)} → "${createLabel}"`);
}
await clickText(ins, "Create game");
await waitText(ins, /share this join code/);
const code = await ins.evaluate(() => document.querySelector(".wordmark")?.textContent?.trim());
ok(!!code, "team game created", code);
const ta = await ins.$('textarea[placeholder^="jdoe1"]');
await ta.type("ceo01, Ana Ceo, Hop Theory, CEO\ncfo02, Ben Cfo, Hop Theory, CFO\nx03, Cy Other, Barrel Vine, CEO");
await clickText(ins, "Apply seat plan");
await waitText(ins, /3 seated|seated/);
await sleep(1200);
const codes = await ins.evaluate(() => [...document.querySelectorAll('button[title^="Return code"]')].map((b) => [b.parentElement.innerText.replace(/\s+/g, " "), b.textContent.trim()]));
ok(codes.length === 3, "seat plan seated 3 with return codes visible", JSON.stringify(codes));
const claimOf = (net) => { const c = codes.find((c) => c[0].includes(net))?.[1]; if (!c) throw new Error(`no code for ${net} in ${JSON.stringify(codes)} | brewers: ${(await0)}`); return c; };
const await0 = await ins.evaluate(() => document.body.innerText.match(/Brewers[\s\S]{0,400}/)?.[0]);

// ── students join by code + claim only ──
const joinAs = async (tag, claim, brewery) => {
  const p = await mk(tag); await clickText(p, "Join a game"); await p.type('input[placeholder="6 characters"]', code); await p.type('input[placeholder="optional"]', claim); await clickText(p, "Continue");
  await waitText(p, /round open|submitted|name your brewery/);
  if (await has(p, /Open the brewery/)) {
    ok(!!brewery && await has(p, /seated as CEO/), `${tag}: pre-seated CEO gets the founding step (name + mark), no pickers`, (await has(p, /Your seat ·/)) ? "seat picker leaked" : "");
    const inp = await p.$('input[value]'); // brewery name (prefilled with the plan label)
    const names = await p.$$("input"); for (const i of names) { const v = await i.evaluate((e) => e.value); if (/Hop Theory/.test(v)) { await i.click(); await p.keyboard.down("Meta"); await p.keyboard.press("a"); await p.keyboard.up("Meta"); await p.keyboard.press("Backspace"); await i.type(brewery); } }
    await p.click('button[title="Plum"]'); // DW-051: a non-default house colour, so the teammate check is real
    await clickText(p, "Open the brewery"); await waitText(p, /round open|submitted/);
  } else ok(!brewery, `${tag}: non-CEO lands directly in the chair`);
  return p;
};
const ceo = await joinAs("ceo", claimOf("ceo01"), "Sediment & Sons");
const cfo = await joinAs("cfo", claimOf("cfo02"));
// DW-078: the chair is the seat plate now (the "You're the CEO" banner is gone)
const seatOf = (p) => p.evaluate(() => document.querySelector("[data-seat-plate]")?.getAttribute("data-seat-plate") ?? null);
ok(await seatOf(ceo) === "ceo" && await has(ceo, /SEDIMENT & SONS/i), "CEO lands in the CEO chair with the renamed brewery");
ok(await seatOf(cfo) === "cfo" && await has(cfo, /SEDIMENT & SONS/i), "CFO lands in the CFO chair and sees the CEO's brewery name");
// ── DW-051: the founder's colour + mark reach the CFO (server-side team style) ──
const cfoStyle = await cfo.evaluate(async (api) => { const v = await (await fetch(`${api}/view?token=${JSON.parse(localStorage.getItem("dw_mp")).token}`)).json(); return v.styles?.[v.own?.id] ?? null; }, API);
const cfoChip = await cfo.evaluate(() => { const el = [...document.querySelectorAll("span")].find((s) => /#7c4f86|rgb\(124, 79, 134\)/i.test(s.getAttribute("style") ?? "")); return el ? { bg: el.style.background, svg: !!el.querySelector("svg") } : null; });
ok(cfoStyle?.color === "#7c4f86" && !!cfoStyle?.emblem && !!cfoChip?.svg, "CFO sees the CEO's house colour (Plum) + mark on the HUD chip", JSON.stringify({ cfoStyle, cfoChip }));
// ── DW-051: fresh round, nobody submitted — a specialist's form mirrors the STANDING plan (no phantom "$0" edits) ──
ok(!(await has(cfo, /Not your desk/)), "fresh round: CFO form mirrors the standing plan — no off-desk notice");
// ── DW-051: "?" cards render above the commit dial (portalled, fixed) ──
await cfo.evaluate(() => window.scrollTo(0, 0));
const dots = [];
for (const d of await cfo.$$('button[aria-label^="Info:"]')) { const bb = await d.boundingBox(); if (bb && bb.width > 0 && bb.height > 0) dots.push(d); } // visible ones only — a module panel can hide its "?" at this width
let onTop = null;
if (dots.length) { await dots[Math.min(2, dots.length - 1)].hover(); await sleep(250); /* hover opens; a click after the hover-open toggles it shut */ onTop = await cfo.evaluate(() => { const t = document.querySelector('[role="tooltip"]'); if (!t) return { tip: false }; const r = t.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + 8, r.top + 8); return { tip: true, fixed: getComputedStyle(t).position === "fixed", inBody: t.parentElement === document.body, unobscured: !!hit && (t === hit || t.contains(hit)) }; }); await cfo.keyboard.press("Escape"); }
ok(!!onTop?.tip && onTop.fixed && onTop.inBody && onTop.unobscured, "'?' card is portalled to <body>, fixed, and not obscured by any panel", JSON.stringify(onTop));

// ── deadline: instructor Announce → student banner ──
await clickText(ins, "Announce");
await waitText(ins, /deadline announced/);
await sleep(1500);
ok(await has(ins, /Announced:.*left/), "instructor card shows Announced + countdown", (await text(ins)).match(/Announced:.*\n?.*left/)?.[0]?.slice(0, 80));
await sleep(4000);
ok(await has(cfo, /⏱ Deadline .* left/), "student banner leads with the deadline countdown", (await text(cfo)).match(/⏱[^\n]*/)?.[0]);

// ── CEO submits a dividend via API (token from page) → CFO's commit panel says the CEO's number locks ──
const ceoTok = await ceo.evaluate(() => JSON.parse(localStorage.getItem("dw_mp")).token);
const cfoTok = await cfo.evaluate(() => JSON.parse(localStorage.getItem("dw_mp")).token);
const base = await ceo.evaluate(async (api) => (await (await fetch(`${api}/view?token=${JSON.parse(localStorage.getItem("dw_mp")).token}`)).json()), API);
const ceoDec = { ...base.standing, dividend: 40000, price: Object.fromEntries(Object.entries(base.standing.price).map(([k, v]) => [k, v])) };
let r = await fetch(`${API}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: ceoTok, decision: ceoDec }) });
ok(r.ok, "CEO submits dividend $40k (whole-firm slice)");
await waitText(cfo, /1 lever locks at a teammate/, 20000).catch(() => {}); // DW-065b: teammate writes coalesce up to 10 s — poll, don't sleep
const cfoT = await text(cfo);
// DW-077: the count disc + headline, the WHO DECIDES line in the engine's words (the CFO left the
// lever at last round's value, so the CEO's change stands), LOCKS = the CEO's $40k, the typed $0
// struck, the lever input captioned, and the submit label counting the lever that follows.
ok(/1 lever locks at a teammate's number/i.test(cfoT) && /Dividend\s*\n\s*CEO changed this; you left it at last round's value\s*\n\s*Locks\s*\n\s*\$40,000\s*\n\s*Your form\s*\n\s*\$0/i.test(cfoT), "CFO's panel: Dividend locks at the CEO's $40,000 — 'CEO changed this; you left it at last round's value'", cfoT.match(/1 lever locks[\s\S]{0,260}/i)?.[0]?.replace(/\n+/g, " | ").slice(0, 260));
ok(/Your form alone would give/.test(cfoT) && /Locks at \$40,000 · CEO changed it; you left it/i.test(cfoT), "CFO's dial shows the form-alone cash, and the dividend input is captioned 'Locks at $40,000'", cfoT.match(/Your form alone[^\n]*/)?.[0]);
ok(/my desk[^\n]*1 lever follows teammates/i.test(cfoT) && /Take the CEO's numbers/i.test(cfoT) && /Keep mine/i.test(cfoT), "CFO's submit label counts '1 lever follows teammates'; Take the CEO's numbers / Keep mine offered", cfoT.match(/[^\n]*my desk[^\n]*/i)?.[0]);
ok(await cfo.evaluate(() => { const i = [...document.querySelectorAll("input[type=number]")].find((x) => /dividend/i.test(x.parentElement?.parentElement?.innerText ?? "")); return !!i && /\(168, 63, 44\)|\(216, 106, 82\)/.test(getComputedStyle(i).borderColor); }), "the dividend input carries the red 'locks at a teammate's number' border");
// CFO takes the CEO's number → the form matches the team's plan
await clickText(cfo, "Take the CEO's numbers");
await sleep(300);
ok(!(await has(cfo, /lever(s)? lock(s)? at a teammate/)) && await has(cfo, /Your form matches the team's plan/) && !(await has(cfo, /follows? teammates/i)), "Take the CEO's numbers clears the block → 'Your form matches the team's plan', plain submit label");
ok(!(await has(cfo, /Not your desk/)), "CFO sees NO off-desk notice before editing (form tracks the firm's plan live)");
// ── CFO edits a PRICE (not their desk) on the All desk ──
await clickText(cfo, "All");
await sleep(300);
const priceInputs = await cfo.evaluate(() => [...document.querySelectorAll("input[type=number]")].map((i, idx) => ({ idx, label: (i.closest("label")?.innerText || i.parentElement?.innerText || "").slice(0, 40), value: i.value })));
const pi = priceInputs.find((p) => /price|\$/i.test(p.label)) ?? priceInputs[0];
logs.push(`[cfo] number inputs: ${JSON.stringify(priceInputs.slice(0, 8))}`);
const handles = await cfo.$$("input[type=number]");
await handles[pi.idx].click({ clickCount: 3 }); await handles[pi.idx].type("9.99");
await sleep(400);
ok(await has(cfo, /Prices\s*\n\s*Not your desk — the CMO chair is empty, so yours is used and the CEO will see it/), "CFO editing a price sees 'Not your desk' (empty CMO chair → a cover the CEO will see) as a panel row", (await text(cfo)).match(/Prices\s*\n[^\n]*\n[^\n]*/)?.[0]?.slice(0, 200));
// CFO submits → confirm dialog lists it → accepted → CEO still shows firm price
await clickText(cfo, "my desk");
await sleep(3000);
ok(logs.some((l) => /dialog\][\s\S]*(not your desk|is the CMO's desk)/i.test(l)), "pre-submit confirm named the off-desk edit in plain words", logs.find((l) => /dialog\]/.test(l))?.slice(0, 240));
ok(await has(cfo, /Submitted ✓/) && await has(cfo, /Your desk is in/), "CFO submit landed with receipt + seat-level banner");
await waitText(ceo, /Your desk is in/, 20000).catch(() => {}); // the CEO page polls on its own clock
ok(await has(ceo, /Your desk is in/), "CEO banner is seat-level too");
const plan = await (await fetch(`${API}/view?token=${ceoTok}`)).json();
const firmPrice = plan.teamPlan?.composed?.price; const seg = Object.keys(firmPrice ?? {})[0];
const cfoSeatPrice = plan.teamPlan?.seats.find((x) => x.role === "cfo")?.partial?.price?.[seg];
ok(firmPrice && cfoSeatPrice != null && Math.abs(firmPrice[seg] - cfoSeatPrice) < 1e-6 && Math.abs(firmPrice[seg] - ceoDec.price[seg]) > 1e-6 && plan.teamPlan.composed.dividend === 40000, "composed plan: CFO's price COVER lands (CMO chair empty, later word than the CEO's), dividend $40k", JSON.stringify({ price: firmPrice?.[seg], cfoTyped: cfoSeatPrice, ceoHad: ceoDec.price[seg], dividend: plan.teamPlan?.composed?.dividend }));
// ── CEO page: disagree with the CFO on the CFO's own desk. The CEO's form copies nobody (DW-081), so
//    its dividend reads last round's $0 — type a third number so the disagreement is the CEO's own:
//    the CFO changed that lever, so the CEO must be told "theirs goes through".
{
  const idx = await ceo.evaluate(() => [...document.querySelectorAll("input[type=number]")].findIndex((i) => /dividend/i.test((i.closest("label")?.innerText || i.parentElement?.parentElement?.innerText || "").slice(0, 120))));
  if (idx < 0) throw new Error("no dividend input on the CEO page");
  const hs = await ceo.$$("input[type=number]");
  await hs[idx].click({ clickCount: 3 }); await hs[idx].type("10000");
}
await waitText(ceo, /2 levers lock at a teammate/, 20000).catch(() => {}); // DW-065b: teammate writes coalesce up to 10 s — poll, don't sleep
const ceoT = await text(ceo);
// (the typed dividend reads $100,000 or $10,000 depending on where the caret landed — the fact is
//  that $40,000 LOCKS and the typed number is the struck one)
const struck = await ceo.evaluate(() => [...document.querySelectorAll('[data-testid="plan-differs"] span')].some((e) => getComputedStyle(e).textDecorationLine === "line-through" && /^\$[\d,]+$/.test((e.textContent ?? "").trim()) && e.textContent.trim() !== "$40,000"));
// DW-081: the CEO's form never copies the price cover, so both rows lock at the CFO's numbers
ok(/2 levers lock at a teammate's number, not yours/i.test(ceoT) && /Dividend\s*\n\s*CFO Ben Cfo's desk — they changed it\s*\n\s*Locks\s*\n\s*\$40,000\s*\n\s*You typed\s*\n\s*\$[\d,]+/i.test(ceoT) && struck && /Prices[\s\S]{0,120}CFO Ben Cfo set this for the empty CMO desk · theirs — change it, or Keep mine, to use yours/i.test(ceoT), "CEO with a stale form sees the CFO's dividend (their desk — they changed it; $40,000 locks, the typed number struck) AND the price cover ('theirs, unless you submit again')", ceoT.match(/2 levers lock[\s\S]{0,420}/i)?.[0]?.replace(/\n+/g, " | ").slice(0, 420));
ok(/Locks at \$40,000 · CFO Ben Cfo's desk/i.test(ceoT), "CEO's dividend input is captioned with the CFO's locking number", ceoT.match(/Locks at \$40,000[^\n]*/i)?.[0]);
// DW-081 (playtest 10-19): the CFO's price cover is named in the CEO's panel, never copied into the CEO's boxes
const ceoPrices = await ceo.evaluate(() => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n = null; while (w.nextNode()) if (/Set your price in each category/.test(w.currentNode.nodeValue ?? "")) { n = w.currentNode.parentElement; break; }
  while (n && !n.querySelector("input[type=number]")) n = n.parentElement;
  return n ? [...n.querySelectorAll("input[type=number]")].map((i) => Number(i.value)) : [];
});
ok(ceoPrices.length > 0 && Math.abs(ceoPrices[0] - ceoDec.price[seg]) < 0.005 && Math.abs(ceoPrices[0] - cfoSeatPrice) > 0.005 && /Locks at [^\n]*· CFO Ben Cfo covers the empty CMO chair/i.test(ceoT), "the CEO's own price box keeps the CEO's number; the caption says the CFO's cover locks", JSON.stringify({ ceoPrices, standing: ceoDec.price[seg], cfoTyped: cfoSeatPrice, caption: ceoT.match(/Locks at [^\n]*CMO chair[^\n]*/i)?.[0] }));
// DW-060 (kept by DW-077): the dividend sits on the CFO's OWN desk, so the CEO gets a notification,
// not a choice — the CEO view has no buttons at all (no Take / Keep / Got it / OK keep theirs); the
// rule line says whose number is used and why.
// DW-080: the CEO's only button is Keep mine, and only for a teammate's cover on an EMPTY chair (an
// unchanged resubmit no longer overrules one) — never an approve/deny on a seated teammate's own lever
// the BUTTON, not the words — cover rows now say "change it, or Keep mine"
const ceoKeep = await ceo.evaluate(() => [...document.querySelectorAll("button")].some((b) => /^\s*Keep mine\s*$/i.test(b.textContent ?? "") && b.getClientRects().length > 0));
const ceoCover = await has(ceo, /(set this for the empty [A-Z]+ desk|covers the (empty )?[A-Z]+ chair)[^\n]*· theirs/);
ok(!(await has(ceo, /Take theirs|Take the CEO|Got it|OK, keep theirs/)) && (!ceoKeep || ceoCover) && await has(ceo, /These levers sit on a seated teammate's desk, so their number is used where they changed it/), "CEO gets NO approve/deny on a seated teammate's own lever — a notification with the rule; Keep mine only for an empty-chair cover", JSON.stringify({ take: await has(ceo, /Take theirs|Take the CEO/), gotIt: await has(ceo, /Got it/), okTheirs: await has(ceo, /OK, keep theirs/), keep: ceoKeep, cover: ceoCover, rule: await has(ceo, /These levers sit on a seated teammate's desk, so their number is used where they changed it/) }));
// ── DW-051 cover: CFO hires for the EMPTY CHRO chair + buys research, AFTER the CEO submitted ──
const cfoView = await (await fetch(`${API}/view?token=${cfoTok}`)).json();
const cfoSlice = { ...(cfoView.teamPlan.seats.find((s) => s.me).partial), invest_T_emp: 21000, buy_info: true };
r = await fetch(`${API}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: cfoTok, decision: cfoSlice }) });
ok(r.ok, "CFO API-submits employee-relations spend (cover for the empty CHRO chair) + market research");
const after = await (await fetch(`${API}/view?token=${ceoTok}`)).json();
ok(after.teamPlan?.composed?.invest_T_emp === 21000 && after.infoActive === true, "composed plan carries the CFO's cover + research (later word wins over the CEO's earlier slice)", JSON.stringify({ invest_T_emp: after.teamPlan?.composed?.invest_T_emp, infoActive: after.infoActive }));
const rival = (after.firms ?? []).find((f) => !f.isYou && f.status === "active");
ok(!!rival && (rival.employees?.length > 0 || rival.Q > 0 || rival.cash !== 0), "research reveals rivals' confidential fundamentals in the view", rival ? JSON.stringify({ name: rival.name, Q: rival.Q, cash: rival.cash, crew: rival.employees?.length }) : "no rival");
await waitText(ceo, /set this for the empty CHRO desk/, 20000).catch(() => {}); // DW-065b: teammate writes coalesce up to 10 s — poll, don't sleep
const ceoTxt = await text(ceo);
ok(/Employee relations[\s\S]{0,120}set this for the empty CHRO desk[\s\S]{0,200}theirs — change it, or Keep mine, to use yours/i.test(ceoTxt) && /\$21,000/.test(ceoTxt), "CEO's Reconcile names the cover in plain words", ceoTxt.match(/Employee relations[^\n]*\n[^\n]*/)?.[0]?.slice(0, 220));
// DW-081: the CFO's research purchase is the TEAM's — the CEO's form credits the buyer; it is nobody's cover row
await waitText(ceo, /Purchased for this round by/, 15000).catch(() => {});
ok(await has(ceo, /Purchased for this round by CFO Ben Cfo/) && !(await has(ceo, /Market research\s*\n[^\n]*(set this for|suggested|covers)/)), "research is the team's purchase: the CEO's form credits the CFO, and the panel lists no research cover", (await text(ceo)).match(/Purchased for this round[^\n]*/)?.[0]?.slice(0, 120));
// DW-080/081: the CEO submits again WITHOUT touching the covers — they stay the CFO's (an unchanged
// resubmit never erases a cover, and the CEO's form never copied them). The dividend stays the CFO's too.
await clickText(ceo, "my desk");
await sleep(3000);
await waitText(ceo, /3 levers lock at a teammate's number/, 15000).catch(() => {}); // the resubmit lands and the panel re-reads it
const ceoAfter = await text(ceo);
ok(/3 levers lock at a teammate's number, not yours/i.test(ceoAfter) && !/it's in your form/i.test(ceoAfter) && /Employee relations\s*\n\s*CFO Ben Cfo set this for the empty CHRO desk · theirs — change it, or Keep mine, to use yours/i.test(ceoAfter) && /Dividend\s*\n\s*CFO Ben Cfo's desk — they changed it/i.test(ceoAfter), "after the CEO's unchanged resubmit the covers are still the CFO's ('theirs — change it, or Keep mine'); the CFO's dividend still locks", ceoAfter.match(/\d+ (of \d+ differing )?levers? lock[\s\S]{0,260}/i)?.[0]?.replace(/\n+/g, " | ").slice(0, 260));
const planAfter = await (await fetch(`${API}/view?token=${ceoTok}`)).json();
ok(planAfter.teamPlan?.composed?.invest_T_emp === 21000 && planAfter.teamPlan?.composed?.buy_info === true && planAfter.teamPlan?.composed?.dividend === 40000, "composed plan after the CEO's resubmit: covers + research kept (an untouched resubmit erases nothing), CFO's dividend kept", JSON.stringify({ invest_T_emp: planAfter.teamPlan?.composed?.invest_T_emp, buy_info: planAfter.teamPlan?.composed?.buy_info, dividend: planAfter.teamPlan?.composed?.dividend }));
// ── lock (confirm) → resolve (confirm) → next round, deadline cleared ──
await clickText(ins, "Lock round");
await waitText(ins, /Locked — ready to resolve/);
await clickText(ins, "Resolve");
await waitText(ins, /Round 2 \/ 16/, 20000);
ok(await has(ins, /None announced/), "deadline cleared on the next round");
await sleep(9000);
ok(await has(cfo, /Round open/) && !(await has(cfo, /⏱/)), "students moved to round 2, no stale deadline");
} catch (e) { results.push("ABORT " + e.message); console.log("ABORT " + e.message.split("\n")[0]); }
console.log("DONE " + results.length);
console.log("--- logs ---\n" + logs.slice(0, 14).join("\n"));
await browser.close();
