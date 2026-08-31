// Headless-Chrome classroom audit (DW-050). Needs the memory server (`cd server && npm run serve`),
// the Vite dev server (`cd web && npm run dev`), Google Chrome, and `puppeteer-core` available
// (e.g. `npm i --no-save puppeteer-core` in web/). Run: `node web/scripts/ui-audit.mjs`.
// Drives: team game → seat plan with names → two students join by claim only → deadline →
// CEO/CFO reconcile → off-desk edit notice → lock/resolve. Prints PASS/FAIL per step.
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const ok = (c, l, d = "") => { const line = `${c ? "PASS" : "FAIL"}  ${l}${d ? " — " + d : ""}`; results.push(line); console.log(line); };
const logs = [];
const mk = async (tag) => { const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); p.on("pageerror", (e) => logs.push(`[${tag} pageerror] ${e.message}`)); p.on("console", (m) => { if (m.type() === "error" && !/404|validateDOMNesting/.test(m.text())) logs.push(`[${tag} error] ${m.text().slice(0, 200)}`); }); p.on("dialog", async (d) => { logs.push(`[${tag} dialog] ${d.message().slice(0, 160)}`); await d.accept(); }); await p.goto("http://localhost:5173/", { waitUntil: "networkidle0" }); return p; };
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
ok(await has(ceo, /You're the CEO/) && await has(ceo, /SEDIMENT & SONS/i), "CEO lands in the CEO chair with the renamed brewery");
ok(await has(cfo, /You're the CFO/) && await has(cfo, /SEDIMENT & SONS/i), "CFO lands in the CFO chair and sees the CEO's brewery name");
// ── DW-051: the founder's colour + mark reach the CFO (server-side team style) ──
const cfoStyle = await cfo.evaluate(async () => { const v = await (await fetch(`http://localhost:8787/view?token=${JSON.parse(localStorage.getItem("dw_mp")).token}`)).json(); return v.styles?.[v.own?.id] ?? null; });
const cfoChip = await cfo.evaluate(() => { const el = [...document.querySelectorAll("span")].find((s) => /#7c4f86|rgb\(124, 79, 134\)/i.test(s.getAttribute("style") ?? "")); return el ? { bg: el.style.background, svg: !!el.querySelector("svg") } : null; });
ok(cfoStyle?.color === "#7c4f86" && !!cfoStyle?.emblem && !!cfoChip?.svg, "CFO sees the CEO's house colour (Plum) + mark on the HUD chip", JSON.stringify({ cfoStyle, cfoChip }));
// ── DW-051: fresh round, nobody submitted — a specialist's form mirrors the STANDING plan (no phantom "$0" edits) ──
ok(!(await has(cfo, /Not your desk/)), "fresh round: CFO form mirrors the standing plan — no off-desk notice");
// ── DW-051: "?" cards render above the commit dial (portalled, fixed) ──
await cfo.evaluate(() => window.scrollTo(0, 0));
const dots = await cfo.$$('button[aria-label^="Info:"]');
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

// ── CEO submits a dividend via API (token from page) → CFO sees Reconcile ──
const ceoTok = await ceo.evaluate(() => JSON.parse(localStorage.getItem("dw_mp")).token);
const cfoTok = await cfo.evaluate(() => JSON.parse(localStorage.getItem("dw_mp")).token);
const base = await ceo.evaluate(async () => (await (await fetch(`http://localhost:8787/view?token=${JSON.parse(localStorage.getItem("dw_mp")).token}`)).json()));
const ceoDec = { ...base.standing, dividend: 40000, price: Object.fromEntries(Object.entries(base.standing.price).map(([k, v]) => [k, v])) };
let r = await fetch("http://localhost:8787/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: ceoTok, decision: ceoDec }) });
ok(r.ok, "CEO submits dividend $40k (whole-firm slice)");
await sleep(4000);
ok(await has(cfo, /Reconcile · 1 open/) && await has(cfo, /Dividend/), "CFO sees Reconcile: Dividend conflict, 'yours goes through'", (await text(cfo)).match(/Reconcile[^\n]*\n[^\n]*\n[^\n]*/)?.[0]?.slice(0, 200));
// CFO adopts CEO's value → conflict clears
await clickText(cfo, "Take theirs");
await sleep(300);
ok(!(await has(cfo, /Reconcile · 1 open/)), "Adopt theirs clears the conflict");
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
ok(await has(cfo, /Not your desk/), "CFO editing a price sees 'Not your desk' with the firm's value", (await text(cfo)).match(/Not your desk[^\n]*\n[^\n]*/)?.[0]?.slice(0, 200));
// CFO submits → confirm dialog lists it → accepted → CEO still shows firm price
await clickText(cfo, "my desk");
await sleep(3000);
ok(logs.some((l) => /dialog\][\s\S]*(not your desk|is the CMO's desk)/i.test(l)), "pre-submit confirm named the off-desk edit in plain words", logs.find((l) => /dialog\]/.test(l))?.slice(0, 240));
ok(await has(cfo, /Submitted ✓/) && await has(cfo, /Your desk is in/), "CFO submit landed with receipt + seat-level banner");
ok(await has(ceo, /Your desk is in/), "CEO banner is seat-level too");
const plan = await (await fetch(`http://localhost:8787/view?token=${ceoTok}`)).json();
const firmPrice = plan.teamPlan?.composed?.price; const seg = Object.keys(firmPrice ?? {})[0];
const cfoSeatPrice = plan.teamPlan?.seats.find((x) => x.role === "cfo")?.partial?.price?.[seg];
ok(firmPrice && cfoSeatPrice != null && Math.abs(firmPrice[seg] - cfoSeatPrice) < 1e-6 && Math.abs(firmPrice[seg] - ceoDec.price[seg]) > 1e-6 && plan.teamPlan.composed.dividend === 40000, "composed plan: CFO's price COVER lands (CMO chair empty, later word than the CEO's), dividend $40k", JSON.stringify({ price: firmPrice?.[seg], cfoTyped: cfoSeatPrice, ceoHad: ceoDec.price[seg], dividend: plan.teamPlan?.composed?.dividend }));
// ── CEO page: its FORM still says dividend $0 (we submitted the CEO's $40k via API, not the form),
//    so it must flag the CFO's $40k as "theirs goes through"; Adopt theirs syncs the form.
await sleep(3000);
const ceoT = await text(ceo);
ok(/Reconcile · 2 open/i.test(ceoT) && /Dividend[\s\S]{0,160}theirs will be used/i.test(ceoT) && /Prices[\s\S]{0,120}set this for the empty CMO desk[\s\S]{0,160}theirs, unless you submit again/i.test(ceoT), "CEO with a stale form sees the CFO's dividend (their desk) AND the price cover, in plain words", ceoT.match(/Reconcile · [\s\S]{0,420}/i)?.[0]?.replace(/\n+/g, " | ").slice(0, 420));
await clickText(ceo, "Take theirs");
await sleep(300);
await clickText(ceo, "OK, keep theirs");
await sleep(300);
ok(!(await has(ceo, /Reconcile · \d+ open/)), "CEO takes the dividend + keeps the price cover → card clears");
// ── DW-051 cover: CFO hires for the EMPTY CHRO chair + buys research, AFTER the CEO submitted ──
const cfoView = await (await fetch(`http://localhost:8787/view?token=${cfoTok}`)).json();
const cfoSlice = { ...(cfoView.teamPlan.seats.find((s) => s.me).partial), invest_T_emp: 21000, buy_info: true };
r = await fetch("http://localhost:8787/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: cfoTok, decision: cfoSlice }) });
ok(r.ok, "CFO API-submits employee-relations spend (cover for the empty CHRO chair) + market research");
const after = await (await fetch(`http://localhost:8787/view?token=${ceoTok}`)).json();
ok(after.teamPlan?.composed?.invest_T_emp === 21000 && after.infoActive === true, "composed plan carries the CFO's cover + research (later word wins over the CEO's earlier slice)", JSON.stringify({ invest_T_emp: after.teamPlan?.composed?.invest_T_emp, infoActive: after.infoActive }));
const rival = (after.firms ?? []).find((f) => !f.isYou && f.status === "active");
ok(!!rival && (rival.employees?.length > 0 || rival.Q > 0 || rival.cash !== 0), "research reveals rivals' confidential fundamentals in the view", rival ? JSON.stringify({ name: rival.name, Q: rival.Q, cash: rival.cash, crew: rival.employees?.length }) : "no rival");
await sleep(8000);
const ceoTxt = await text(ceo);
ok(/Employee relations[\s\S]{0,120}set this for the empty CHRO desk[\s\S]{0,200}theirs, unless you submit again/i.test(ceoTxt) && /\$21,000/.test(ceoTxt), "CEO's Reconcile names the cover in plain words", ceoTxt.match(/Employee relations[^\n]*\n[^\n]*/)?.[0]?.slice(0, 220));
// the CFO's research purchase is a second cover (buy_info is a CMO lever) — acknowledge each
let acks = 0; while (acks < 4 && await has(ceo, /OK, keep theirs/)) { await clickText(ceo, "OK, keep theirs"); await sleep(250); acks++; }
ok(acks >= 2 && !(await has(ceo, /Reconcile · \d+ open/)), "CEO acknowledges each cover (employee relations + research) → card clears", `${acks} acks`);
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
