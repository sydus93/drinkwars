/**
 * Real browser seats for the dress rehearsal (DW-063).
 *
 * The API-level rehearsal POSTs raw decision slices straight to /submit. That proves the
 * SERVER holds up; it proves nothing about the client, because it never runs one. Every
 * bug that has actually reached production lately lived on the client side of that line —
 * the research lock firing on a checkbox change (DW-061b), the capacity divider being
 * transmitted by a desk that could not see it (DW-062). Neither was reachable from an
 * API driver.
 *
 * So: a handful of REAL Chrome clients join the same game and drive the same React app a
 * student would, while the API students generate the load around them. What only a real
 * client exercises — mirrorFirm, the covers set the form computes, Reconcile, the
 * founding wizard, localStorage resume — is exercised here.
 *
 * Headless Chrome, one isolated browser context per seat (own localStorage, own session).
 * Consumed by prod-rehearsal.ts; not a standalone entry point.
 */
type Page = any;

export type SeatSpec = { ext: string; chair: string; claim: string; firm: number };
export type SeatLog = (line: string) => void;

/** The commit button is "Submit my desk (round N)" the first time and "Update my desk"
 *  every time after (MultiplayerPlay.tsx:198). Matching only /^Submit/ meant every RE-submit
 *  silently clicked nothing — and a fixed sleep afterwards made that look like a pass. */
const SUBMIT_BTN = /^(submit|update)\b/i;

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BrowserFleet {
  private browser: any = null;
  private seats: { spec: SeatSpec; page: Page; ok: boolean; errors: string[]; split?: number[]; submits: number }[] = [];
  readonly results: string[] = [];
  readonly failures: string[] = [];

  constructor(private webBase: string, private joinCode: string, private log: SeatLog) {}

  private ok(cond: boolean, what: string, detail = "") {
    this.results.push(`${cond ? "PASS" : "FAIL"}  ${what}${detail ? " — " + detail : ""}`);
    if (!cond) this.failures.push(`browser: ${what}${detail ? " — " + detail : ""}`);
    this.log(`    ${cond ? "ok  " : "FAIL"} ${what}${detail ? " — " + detail : ""}`);
    return cond;
  }

  /** Click the first <button> whose visible text matches. Labels are UPPERCASED by CSS,
   *  so innerText != DOM text — always match case-insensitively (a trap this project has
   *  fallen into four separate times). */
  private async click(p: Page, re: RegExp): Promise<string | null> {
    for (const el of await p.$$("button")) {
      const t = (await el.evaluate((n: any) => n.innerText)).trim();
      if (!re.test(t)) continue;
      // Clicking a DISABLED button is a silent no-op — which is exactly how the CEO seat
      // spun eight times on the founding card without anyone noticing. Say so instead.
      if (await el.evaluate((n: any) => n.disabled)) { this.log(`    (button "${t}" is disabled)`); return null; }
      await el.click();
      return t;
    }
    return null;
  }
  private text = (p: Page) => p.evaluate(() => document.body.innerText);
  private async has(p: Page, re: RegExp) { return re.test(await this.text(p)); }

  async start(specs: SeatSpec[]): Promise<void> {
    const puppeteer: any = await import("puppeteer-core");
    this.browser = await (puppeteer.default ?? puppeteer).launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });

    for (const spec of specs) {
      const errors: string[] = [];
      const ctx = await this.browser.createBrowserContext();
      const page = await ctx.newPage();
      page.on("pageerror", (e: any) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m: any) => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(`console: ${m.text().slice(0, 140)}`); });
      page.on("dialog", async (d: any) => { await d.accept(); }); // the pre-submit off-desk confirm
      page.on("response", async (r: any) => {
        if (/\/submit\b/.test(r.url()) && r.status() === 200) {
          const seat = this.seats.find((x) => x.page === page);
          if (seat) seat.submits += 1;
        }
        if (!/\/join\b/.test(r.url())) return;
        if (r.status() < 400) return;
        errors.push(`join → ${r.status()} ${(await r.text().catch(() => "")).slice(0, 160)}`);
      });
      this.seats.push({ spec, page, ok: false, errors, split: undefined, submits: 0 });
    }

    // The join rush: every browser seat claims at once, like the start of class.
    await Promise.all(this.seats.map(async (s) => {
      try {
        await s.page.goto(this.webBase, { waitUntil: "networkidle0", timeout: 45_000 });
        await this.click(s.page, /^Join a game/i);
        await s.page.waitForSelector('input[placeholder="6 characters"]', { timeout: 15_000 });
        await s.page.type('input[placeholder="6 characters"]', this.joinCode);
        const claimInput = await s.page.$('input[placeholder="optional"]');
        if (claimInput) await claimInput.type(s.spec.claim);
        await this.click(s.page, /^Continue/i);
        await s.page.waitForFunction(() => /round open|submitted|name your brewery|found your|open the brewery|decide/i.test(document.body.innerText), { timeout: 30_000 });
        // The pre-seated CEO gets the founding step: `canJoin` in Join.tsx requires a
        // non-empty brewery name for the founder, so "Open the brewery" stays DISABLED
        // until one is typed. Fill any empty text field on the card before pressing on.
        for (const inp of await s.page.$$('input[type="text"], input:not([type]):not([placeholder="6 characters"]):not([placeholder="optional"])')) {
          const v = await inp.evaluate((n: any) => n.value);
          if (!String(v).trim()) { await inp.click(); await inp.type(`Rehearsal ${s.spec.firm}`); }
        }
        // The pre-seated CEO gets the founding step before the cockpit.
        // Press the founding button ONCE and then WAIT. Re-clicking while the join is
        // still in flight fires a second /join for the same claim, which is a different
        // bug than the one being debugged.
        if (await this.has(s.page, /Open the brewery|FOUND YOUR/i)) {
          // The founding card enters on a `.rise` animation. A real click is dispatched at
          // the box's centre as measured a moment earlier, so clicking mid-flight lands
          // where the button WAS. Nothing overlays it (verified with elementFromPoint) —
          // it just has to stop moving first.
          await sleep(1400);
          await this.click(s.page, /^(Open the brewery|FOUND YOUR)/i);
          let landed = await s.page.waitForFunction(() => /DECIDE/i.test(document.body.innerText), { timeout: 12_000 }).then(() => true).catch(() => false);
          if (!landed) {
            // A real click is dispatched at the element's centre point and can land on
            // whatever is stacked above it (the sticky chrome on this screen). Fall back to
            // a DOM click, which addresses the element directly, and say that we had to.
            this.log("    (native click still did not take — falling back to a DOM click)");
            await s.page.evaluate(() => {
              const b = [...document.querySelectorAll("button")].find((x: any) => /open the brewery|found your/i.test(x.innerText));
              (b as any)?.click();
            });
            landed = await s.page.waitForFunction(() => /DECIDE/i.test(document.body.innerText), { timeout: 20_000 }).then(() => true).catch(() => false);
          }
        }
        await sleep(1500);
        s.ok = await this.has(s.page, /DECIDE/i);
        const where = s.ok ? "" : JSON.stringify(await s.page.evaluate(() => ({
          buttons: [...document.querySelectorAll("button")].map((b: any) => ({ t: b.innerText.trim().replace(/\n/g, "/").slice(0, 28), disabled: b.disabled })).filter((b: any) => b.t).slice(0, 8),
          inputs: [...document.querySelectorAll("input")].map((i: any) => ({ ph: i.placeholder, type: i.type, val: String(i.value).slice(0, 24) })).slice(0, 8),
        })));
        this.ok(s.ok, `${s.spec.ext} (${s.spec.chair}) reached the cockpit in a real browser`, where);
      } catch (e: any) {
        this.ok(false, `${s.spec.ext} (${s.spec.chair}) join`, e.message?.slice(0, 120));
      }
    }));
  }

  /** Every live seat sets a value on its OWN desk through the real form and submits. */
  async submitRound(round: number): Promise<void> {
    await Promise.all(this.seats.filter((s) => s.ok).map(async (s) => {
      try {
        await this.click(s.page, /^DECIDE/i);
        await sleep(800);
        await this.driveOwnDesk(s.page, s.spec.chair, round);
        if (s.spec.chair === "coo") s.split = await this.readBar(s.page);
        const before = s.submits;
        const btn = await this.click(s.page, SUBMIT_BTN);
        if (!btn) return this.ok(false, `${s.spec.ext} found a Submit button`, "none matched");
        const landed = await this.waitForSubmit(s, before);
        this.ok(landed, `${s.spec.ext} (${s.spec.chair}) submitted r${round} through the real form`, landed ? "" : "no 200 from /submit within 45s");
      } catch (e: any) {
        this.ok(false, `${s.spec.ext} submit r${round}`, e.message?.slice(0, 120));
      }
    }));
  }

  /** Touch the one control that belongs to this chair — the point is to exercise the
   *  form's own path (covers set, mirrorFirm) rather than to play well. */
  private async driveOwnDesk(p: Page, chair: string, round: number) {
    if (chair === "coo") {
      // the DW-062 control: drag the capacity divider with a REAL pointer gesture
      const h = await p.$("div.cursor-ew-resize");
      if (!h) return;
      await h.evaluate((el: any) => el.scrollIntoView({ block: "center" }));
      await sleep(400);
      const box = await h.boundingBox();
      const bar = await p.evaluate(() => {
        const l = [...document.querySelectorAll("label")].find((x) => /capacity allocation/i.test(x.textContent || ""));
        const r = (l as any)?.parentElement.querySelector("div.relative.h-12")?.getBoundingClientRect();
        return r ? { x: r.x, w: r.width } : null;
      });
      if (!box || !bar) return;
      const target = bar.x + bar.w * (round % 2 === 1 ? 0.72 : 0.31);
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.mouse.down();
      await p.mouse.move(target, box.y + box.height / 2, { steps: 12 });
      await p.mouse.up();
      await sleep(400);
      return;
    }
    if (chair === "cmo" || chair === "ceo") {
      const inp = await p.$('input[type="number"]'); // first price field
      if (!inp) return;
      await inp.click();
      await p.keyboard.down("Meta"); await p.keyboard.press("a"); await p.keyboard.up("Meta");
      await inp.type(String(7 + round * 0.5));
      return;
    }
    // cfo / chro: nudge the first range slider on their desk
    const r = await p.$('input[type="range"]');
    if (r) await r.evaluate((el: any) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      set.call(el, String(Math.min(Number(el.max), Number(el.value) + Number(el.step || 1) * 3)));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /**
   * Wait for THIS seat's submit to actually land, rather than sleeping a guess.
   *
   * The first version slept a flat 2500ms after clicking Submit. That was calibrated against
   * a 3ms local stack; in the prod rehearsal /submit ran to 9.6s, so the assertions read the
   * composed plan while the writes were still in flight and reported a DW-062 regression that
   * was never there. A load test must never assert on a timer it chose before it knew the
   * latency — it has to await the real completion signal.
   */
  private async waitForSubmit(seat: any, before: number, timeoutMs = 45_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (seat.submits > before) { await sleep(250); return true; } // let the client apply the response
      await sleep(250);
    }
    return false;
  }

  /** The percentages the COO's own allocation bar is showing, as integers. */
  private async readBar(p: Page): Promise<number[] | undefined> {
    return p.evaluate(() => {
      const l = [...document.querySelectorAll("label")].find((x) => /capacity allocation/i.test(x.textContent || ""));
      if (!l) return undefined;
      const seen = [...(l as any).parentElement.querySelectorAll("span.tnum")].map((s: any) => Math.round(parseFloat(s.textContent)));
      return seen.slice(0, seen.length / 2); // the bar prints each share twice (in-bar + legend)
    }).catch(() => undefined);
  }

  /**
   * DW-062, through real clients under load: the CMO submits AFTER the COO, from their own
   * browser, and the firm's composed plan must still carry the COO's split. This is the
   * ordering that silently reverted the divider before the desk move — and the one an
   * API-level driver cannot produce, because it never runs the form that decides which
   * off-desk values a seat transmits.
   */
  async assertDividerHeld(transportBase: string, round: number): Promise<void> {
    const coo = this.seats.find((s) => s.ok && s.spec.chair === "coo");
    const cmo = this.seats.find((s) => s.ok && s.spec.chair === "cmo");
    if (!coo || !cmo) return;
    if (!coo.split?.length) return void this.ok(false, `r${round}: could not read the COO's allocation bar`);

    // the CMO tweaks a price and submits again — last word in the room
    try {
      await this.click(cmo.page, /^DECIDE/i);
      await sleep(700);
      const inp = await cmo.page.$('input[type="number"]');
      if (inp) {
        await inp.click();
        await cmo.page.keyboard.down("Meta"); await cmo.page.keyboard.press("a"); await cmo.page.keyboard.up("Meta");
        await inp.type(String(9 + round));
      }
      const before = cmo.submits;
      await this.click(cmo.page, SUBMIT_BTN);
      if (!(await this.waitForSubmit(cmo, before))) return void this.ok(false, `r${round}: CMO's re-submit never completed`);
    } catch (e: any) { return void this.ok(false, `r${round}: CMO could not re-submit`, e.message?.slice(0, 100)); }

    const composed = await this.composedPresence(coo.spec.ext, transportBase);
    if (!composed) return void this.ok(false, `r${round}: no composed plan visible to the COO`);
    const vals = Object.values(composed).map((v: any) => Math.round(Number(v)));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const pct = vals.map((v) => Math.round((v / total) * 100));
    const want = coo.split!;
    const held = want.every((w, i) => Math.abs((pct[i] ?? -99) - w) <= 1);
    this.ok(held, `DW-062 under load: the COO's split survived the CMO submitting after them (r${round})`,
      `bar ${want.join("/")}% · composed ${pct.join("/")}%`);
  }

  /** What this seat's browser believes the FIRM's plan is — read from the live client's
   *  own session token, i.e. exactly what its UI is rendering from. */
  async composedPresence(ext: string, transportBase: string): Promise<any> {
    const s = this.seats.find((x) => x.spec.ext === ext && x.ok);
    if (!s) return null;
    return s.page.evaluate(async (base: string) => {
      const raw = localStorage.getItem("dw_mp");
      if (!raw) return null;
      const t = JSON.parse(raw).token;
      const v = await (await fetch(`${base}/view?token=${t}`)).json();
      return v?.teamPlan?.composed?.presence ?? null;
    }, transportBase);
  }

  async waitForRound(round: number, timeoutMs = 45_000): Promise<void> {
    const live = this.seats.filter((s) => s.ok);
    const deadline = Date.now() + timeoutMs;
    const seen = new Set<string>();
    while (Date.now() < deadline && seen.size < live.length) {
      for (const s of live) {
        if (seen.has(s.spec.ext)) continue;
        const r = await s.page.evaluate(() => {
          const m = document.body.innerText.match(/round\s+(\d+)/i);
          return m ? Number(m[1]) : null;
        }).catch(() => null);
        if (r != null && r >= round + 1) seen.add(s.spec.ext);
      }
      if (seen.size < live.length) await sleep(2000);
    }
    this.ok(seen.size === live.length, `all ${live.length} real browsers saw round ${round + 1}`, `${seen.size}/${live.length}`);
  }

  pageErrors(): string[] {
    return this.seats.flatMap((s) => s.errors.map((e) => `${s.spec.ext}: ${e}`));
  }

  async stop(): Promise<void> {
    try { await this.browser?.close(); } catch { /* already gone */ }
  }
}
