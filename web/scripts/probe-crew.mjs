// Employees/poach probe (DW-051): hire → resolve → rival buys research → dossier shows crew + offer boxes.
// Needs memory server + Vite + puppeteer-core (web devDependency). Run: node web/scripts/probe-crew.mjs
import puppeteer from "puppeteer-core";
const B = "http://localhost:8787"; const H = { "content-type": "application/json", "x-instructor-pass": "letmein" };
const j = async (p, init = {}) => (await fetch(B + p, { headers: H, ...init })).json();
const g = await j("/instructor/games", { method: "POST", body: JSON.stringify({ nFirms: 2, nRounds: 4, firmMode: "team", modules: { employees: { enabled: true }, geography: { enabled: true }, facilities: { enabled: true } } }) });
const a = await j("/join", { method: "POST", body: JSON.stringify({ code: g.joinCode, name: "A Ceo", role: "ceo", teamName: "Alpha" }) });
const b = await j("/join", { method: "POST", body: JSON.stringify({ code: g.joinCode, name: "B Ceo", role: "ceo", teamName: "Beta" }) });
const va = await j(`/view?token=${a.token}`);
const cands = va.hiringMarket.slice(0, 2).map((c) => c.id);
await j("/submit", { method: "POST", body: JSON.stringify({ token: a.token, decision: { ...va.standing, firm_id: va.own.id, hire_employees: cands, hire_bids: Object.fromEntries(cands.map((c) => [c, 1000])) } }) });
await j(`/instructor/games/${g.gameId}/lock`, { method: "POST" }); await j(`/instructor/games/${g.gameId}/resolve`, { method: "POST" });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox"] });
const p = await (await browser.createBrowserContext()).newPage(); await p.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
const click = async (t, tag = "button") => (await p.waitForSelector(`xpath/.//${tag}[contains(normalize-space(.), ${JSON.stringify(t)})]`, { timeout: 8000 })).click();
const txt = () => p.evaluate(() => document.body.innerText);
await click("Join a game"); await p.type('input[placeholder="6 characters"]', g.joinCode); await p.type('input[placeholder="optional"]', b.claim); await click("Continue");
await p.waitForFunction(() => /round open|submitted|open the brewery/i.test(document.body.innerText), { timeout: 15000 });
if (/open the brewery/i.test(await txt())) { await click("Open the brewery"); await p.waitForFunction(() => /round open|submitted/i.test(document.body.innerText), { timeout: 15000 }); }
// buy research via the form: find the market research toggle
const t0 = await txt(); console.log("has research control:", /market research/i.test(t0));
const cb = await p.$$('input[type=checkbox]'); console.log("checkboxes:", cb.length);
// submit via API instead (form location varies), then poll
const vb = await j(`/view?token=${b.token}`);
await j("/submit", { method: "POST", body: JSON.stringify({ token: b.token, decision: { ...vb.standing, firm_id: vb.own.id, buy_info: true } }) });
await new Promise((r) => setTimeout(r, 7000));
await click("Review"); await new Promise((r) => setTimeout(r, 500));
await click("Field"); await new Promise((r) => setTimeout(r, 800));
const t1 = await txt(); console.log("field revealed:", /rivals revealed/i.test(t1), "| locked:", /Intelligence · locked/i.test(t1));
await click("Alpha", "td"); await new Promise((r) => setTimeout(r, 800));
const t2 = await txt(); console.log("dossier crew:", /Their crew/i.test(t2), "| offer box:", (await p.$$('input[type=number]')).length, "| names:", /Yuki|Mei|Sam|Ava/.test(t2));
console.log(t2.match(/BREWERY DOSSIER[\s\S]{0,900}/)?.[0]?.replace(/\n+/g, " | ").slice(0, 900));
await browser.close();
