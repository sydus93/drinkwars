/**
 * Class-day dress rehearsal (DW-053) — drives a classroom-shaped load through the REAL
 * transport API: N firms × 3 chairs of simulated students who claim their pre-seated
 * chairs, poll /pulse at the client's real cadence, fetch /view on stamp changes, and
 * submit desk slices (with the chaos we've been bitten by: double submits, re-join +
 * resubmit, a cover on an empty desk) while the instructor announces deadlines, locks,
 * resolves, and exports. Measures per-endpoint latency (p50/p95/max), payload sizes,
 * and asserts every lifecycle transition every client should observe.
 *
 *   cd server && npx tsx scripts/prod-rehearsal.ts                  # local (:8787, pass letmein)
 *   cd server && DW_INSTRUCTOR_PASS=… npx tsx scripts/prod-rehearsal.ts --prod
 *
 * Options (env): FIRMS=9 ROUNDS=3 POLL_MS=2500 BASE=<url>
 * --prod targets the live edge function. The test game is titled "REHEARSAL …" and
 * ended (lifecycle complete) on the way out, success or failure. Roster users are
 * rhz01…rhzNN under cohort "rehearsal" — re-runs reuse them (provisioning is idempotent).
 */
import { PRESETS } from "drinkwars-engine";
import { BrowserFleet, type SeatSpec } from "./rehearsal-browsers.js";

const PROD = "https://kikmdmldfgakdabbsdcq.supabase.co/functions/v1/drinkwars";
const PROD_WEB = "https://devinstein.me/drinkwars/";
const isProd = process.argv.includes("--prod");
const BASE = isProd ? (process.env.BASE ?? PROD) : (process.env.BASE ?? "http://localhost:8787");
const WEB_BASE = process.env.WEB_BASE ?? (isProd ? PROD_WEB : "http://localhost:5173/");
// Prefer the SECONDARY passcode when one is supplied. Both tiers authenticate, but a game
// created by the test tier is owned by it (`owner_tag`), and the test tier is a super-user
// over nothing but its own games — so a rehearsal run this way cannot lock, resolve or end
// a real class game even by mistake. The primary pass has no such blast radius.
const PASS = process.env.DW_INSTRUCTOR_PASS_TEST || process.env.DW_INSTRUCTOR_PASS || "letmein";
const TIER = process.env.DW_INSTRUCTOR_PASS_TEST ? "test (scoped to its own games)" : "primary";
const FIRMS = Math.max(1, Number(process.env.FIRMS ?? 8));
const ROUNDS = Math.max(1, Number(process.env.ROUNDS ?? 3));
const POLL_MS = Math.max(500, Number(process.env.POLL_MS ?? 2500));
const BROWSERS = Math.max(0, Number(process.env.BROWSERS ?? 4));
// DW-065: the live client pins the edge to the database's region (multiplayer.ts edgeUrl). Default matches it;
// EDGE_REGION= (empty) reproduces the unpinned behaviour for an A/B.
const EDGE_REGION = process.env.EDGE_REGION ?? (isProd ? "us-east-2" : "");
// DW-065: the instructor console polls /status for the whole class period (Instructor.tsx: 4 s, one in
// flight). Before this the harness never issued it, and at 71 storage reads a call on the pre-DW-065
// server that single poll loop was as much load as the entire class — so every earlier rehearsal
// under-loaded prod. CONSOLE_MS=0 disables it; 2500 reproduces the pre-DW-065 console cadence.
const CONSOLE_MS = Math.max(0, Number(process.env.CONSOLE_MS ?? 4000));
let consoleStop = false;
async function consoleLoop(gid: string): Promise<void> {
  while (!consoleStop) {
    await call("GET", `/instructor/games/${gid}/status`, { instructor: true, label: "/instructor/games/:id/status (console)" });
    await sleep(CONSOLE_MS);
  }
}

const ALL_CHAIRS = ["ceo", "cfo", "cmo", "coo", "chro"] as const;
type Chair = (typeof ALL_CHAIRS)[number];

/**
 * A real classroom, not a uniform grid: most teams carry four or five of the five chairs,
 * and WHICH chair is missing rotates so every desk sits empty somewhere in the room. That
 * matters because the two merge rules are different — a seated officer's word is final on
 * their own desk, while an empty chair is last-word-wins among whoever covers it — and a
 * class of mixed-size teams runs both rules at once. The old fixed roster (ceo/cfo/chro,
 * CMO and COO always empty) only ever exercised the second one, which is why it could not
 * have caught DW-062. Deterministic in the firm index, so two runs are comparable.
 */
function chairsFor(firm: number): Chair[] {
  const short = firm % 2 === 0 || firm % 5 === 3;
  return short ? ALL_CHAIRS.filter((_, i) => i !== (firm - 1) % ALL_CHAIRS.length) : [...ALL_CHAIRS];
}
/** Firm 1 is reserved for the real browser seats when any are running. */
const BROWSER_FIRM = 1;

if (isProd && !process.env.DW_INSTRUCTOR_PASS && !process.env.DW_INSTRUCTOR_PASS_TEST) {
  console.error(`Refusing to hit prod with the default passcode.

  Put the SECONDARY passcode in server/.env (gitignored) as
      DW_INSTRUCTOR_PASS_TEST=...
  then run
      npx tsx --env-file=.env scripts/prod-rehearsal.ts --prod

  The test tier owns only the games it creates, so it cannot touch a real class game.`);
  process.exit(2);
}

// ── instrumented fetch ────────────────────────────────────────────────────────
type Sample = { path: string; ms: number; status: number; bytes: number };
const samples: Sample[] = [];
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function call(method: string, path: string, opts: { body?: unknown; token?: string; instructor?: boolean; label?: string } = {}): Promise<{ status: number; json: any; bytes: number }> {
  const url = new URL(BASE + path);
  if (opts.token) url.searchParams.set("token", opts.token);
  if (EDGE_REGION) url.searchParams.set("forceFunctionRegion", EDGE_REGION); // DW-065: mirror the client's region pin
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...(opts.instructor ? { "x-instructor-pass": PASS } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    const ms = performance.now() - t0;
    samples.push({ path: opts.label ?? path.replace(/\/games\/[^/]+/, "/games/:id"), ms, status: res.status, bytes: text.length });
    let json: any = null; try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    return { status: res.status, json, bytes: text.length };
  } catch (e) {
    const ms = performance.now() - t0;
    samples.push({ path: opts.label ?? path, ms, status: 0, bytes: 0 });
    failures.push(`${method} ${path} — network error: ${e instanceof Error ? e.message : e}`);
    return { status: 0, json: null, bytes: 0 };
  }
}
const expect = (cond: boolean, what: string) => { if (!cond) failures.push(what); return cond; };
const must = async (p: Promise<{ status: number; json: any; bytes: number }>, what: string) => {
  const r = await p;
  expect(r.status === 200, `${what} → ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
  return r.json;
};

// ── student simulator ─────────────────────────────────────────────────────────
type Student = { ext: string; name: string; firm: number; chair: Chair; submittedThisRound?: boolean; lifecycle?: string; lastRound?: number; lastLifecycle?: string; lastFull?: number; claim?: string; token?: string; round: number; stamp: string; views: number; stop: boolean };
async function pollLoop(s: Student) {
  // The real client: /pulse on a jittered cadence, full /view only when the stamp moves.
  await sleep(Math.random() * POLL_MS);
  while (!s.stop) {
    const p = await call("GET", "/pulse", { token: s.token });
    if (p.status === 200) s.lifecycle = p.json?.lifecycle ?? s.lifecycle;
    // Mirror the client's DW-064 coalescing: a round/lifecycle change is fetched at once,
    // but a teammate's write only forces a full view if we have not fetched one recently.
    // Without this the driver keeps generating the 5-fetches-per-round pattern the deployed
    // client no longer produces, and would understate the fix it is meant to measure.
    const bigChange = p.json?.round !== s.lastRound || p.json?.lifecycle !== s.lastLifecycle;
    const coalesced = !bigChange && Date.now() - (s.lastFull ?? 0) < 6000;
    if (p.status === 200 && p.json?.stamp && p.json.stamp !== s.stamp && !coalesced) {
      s.stamp = p.json.stamp;
      s.round = p.json.round;
      s.lastRound = p.json.round;
      s.lastLifecycle = p.json.lifecycle;
      s.lastFull = Date.now();
      // Mirror the client's DW-064 herd jitter: everyone notices the same stamp change at
      // once, so the real app spreads the follow-up /view. A driver without it measures a
      // burst the deployed client no longer produces.
      if (s.views > 0) await sleep(Math.random() * 1200);
      const v = await call("GET", "/view", { token: s.token });
      if (v.status === 200) s.views++;
      else failures.push(`${s.ext} /view after stamp change → ${v.status}`);
    } else if (p.status !== 200) {
      failures.push(`${s.ext} /pulse → ${p.status}`);
    }
    // Mirror the REAL client's back-off (MultiplayerPlay.tsx): 3s open, 6s once this seat has
    // submitted, 8s while locked/resolving. The old flat cadence polled ~2x harder than a
    // classroom actually does, so it measured a load no real class would generate.
    const cadence = s.submittedThisRound ? 6000 : s.lifecycle && s.lifecycle !== "open" ? 8000 : 3000;
    await sleep(cadence * (0.85 + Math.random() * 0.3));
  }
}
const submit = async (s: Student, decision: Record<string, unknown>, note: string) => {
  const r = await must(call("POST", "/submit", { body: { token: s.token, decision } }), `${s.ext} (${s.chair}) submit ${note}`);
  s.submittedThisRound = true; // drives the real client's slower post-submit cadence
  return r;
};

let segs: string[] = [];
/** A distinctive, firm- and round-specific split so a stale or reverted value is obvious. */
const splitFor = (firm: number, round: number): Record<string, number> =>
  Object.fromEntries(segs.map((g, i) => [g, i === 0 ? 2 + ((firm + round) % 4) : 1]));

// ── the rehearsal ─────────────────────────────────────────────────────────────
async function main() {
  const headcount = Array.from({ length: FIRMS }, (_, i) => chairsFor(i + 1).length).reduce((a, b) => a + b, 0);
  console.log(`Rehearsal vs ${BASE}`);
  console.log(`  ${headcount} students across ${FIRMS} teams of 4–5, ${ROUNDS} rounds, poll ${POLL_MS}ms, instructor tier: ${TIER}`);
  console.log(`  ${BROWSERS > 0 ? `${BROWSERS} of them driving REAL browsers at ${WEB_BASE}` : "API-only (set BROWSERS=4 for real browser seats)"}\n`);
  const full = PRESETS.find((p) => p.id === "full");
  const modules = Object.fromEntries((full?.modules ?? []).map((id) => [id, { enabled: true }]));

  // 1. create game + roster + seat plan — the instructor's pre-class ritual, via API.
  const game = await must(call("POST", "/instructor/games", { instructor: true, body: { nFirms: FIRMS, nRounds: Math.max(ROUNDS + 2, 6), firmMode: "team", modules, configOverride: { classroom: { forecasts: { enabled: true } } } /* DW-077: calls on, as the create form defaults */, title: `REHEARSAL ${new Date().toISOString().slice(0, 16)}` } }), "create game");
  if (!game?.gameId) { console.error("Cannot continue without a game."); return finish(null); }
  const gid = game.gameId as string;
  console.log(`game ${game.joinCode} (${gid})`);

  const students: Student[] = [];
  let n = 0;
  for (let f = 1; f <= FIRMS; f++) for (const chair of chairsFor(f)) { n++; students.push({ ext: `rhz${String(n).padStart(2, "0")}`, name: `Rehearsal ${n}`, firm: f, chair, round: 0, stamp: "", views: 0, stop: false }); }
  const sizes = new Map<number, number>();
  for (const s of students) sizes.set(s.firm, (sizes.get(s.firm) ?? 0) + 1);
  console.log(`  roster: ${students.length} students across ${FIRMS} teams — ${[...sizes.entries()].map(([f, k]) => `T${f}:${k}`).join(" ")}`);
  for (let f = 1; f <= FIRMS; f++) { const missing = ALL_CHAIRS.filter((c) => !chairsFor(f).includes(c)); if (missing.length) console.log(`  team ${f} has no ${missing.join("/")}`); }
  const roster = await must(call("POST", "/instructor/roster", { instructor: true, body: { cohort: "rehearsal", roster: students.map((s) => ({ external_id: s.ext, name: s.name })) } }), "provision roster");
  for (const s of students) s.claim = roster?.students?.find((r: any) => r.external_id === s.ext)?.claim_code ?? roster?.students?.find((r: any) => r.external_id === s.ext)?.claim;
  expect(students.every((s) => !!s.claim), `roster: missing claim codes (${students.filter((s) => !s.claim).map((s) => s.ext).join(",") || "none"})`);
  await must(call("POST", `/instructor/games/${gid}/seats`, { instructor: true, body: { plan: students.map((s) => ({ external_id: s.ext, team: `Group ${s.firm}`, role: s.chair })) } }), "apply seat plan");

  // 1b. Real browser seats take over firm 1's chairs — the API students there step aside,
  //     so no chair is driven twice. Everything else in the room stays API-driven load.
  let fleet: BrowserFleet | null = null;
  const browserSeats = BROWSERS > 0 ? students.filter((s) => s.firm === BROWSER_FIRM).slice(0, BROWSERS) : [];
  const apiStudents = students.filter((s) => !browserSeats.includes(s));
  if (browserSeats.length) {
    console.log(`\n  ${browserSeats.length} REAL browser seats on team ${BROWSER_FIRM} (${browserSeats.map((s) => s.chair).join(", ")}) vs ${WEB_BASE}`);
    fleet = new BrowserFleet(WEB_BASE, game.joinCode as string, (l) => console.log(l));
    await fleet.start(browserSeats.map((s): SeatSpec => ({ ext: s.ext, chair: s.chair, claim: s.claim!, firm: s.firm })));
    for (const s of browserSeats) s.stop = true; // no API poll loop for a seat a browser holds
  }

  // 2. the join rush — everyone claims within ~10 s, like the start of class.
  await Promise.all(apiStudents.map(async (s, i) => {
    await sleep(i * (10_000 / Math.max(1, apiStudents.length)) * Math.random());
    const j = await must(call("POST", "/join", { body: { code: game.joinCode, claim: s.claim } }), `${s.ext} join`);
    s.token = j?.token;
  }));
  expect(apiStudents.every((s) => !!s.token), "every API student holds a session token");
  const loops = apiStudents.filter((s) => s.token).map((s) => pollLoop(s));
  if (CONSOLE_MS > 0) { loops.push(consoleLoop(gid)); console.log(`  instructor console polling /status every ${CONSOLE_MS} ms`); }

  // 3. rounds
  for (let r = 1; r <= ROUNDS; r++) {
    console.log(`— round ${r}`);
    for (const s of apiStudents) s.submittedThisRound = false;
    await must(call("POST", `/instructor/games/${gid}/deadline`, { instructor: true, body: { deadlineAt: Date.now() + 75_000 } }), "announce deadline");

    // Segment ids come from a live view — presence/price are keyed by them.
    if (!segs.length) {
      const any = apiStudents.find((s) => s.token);
      const v = any ? (await call("GET", "/view", { token: any.token })).json : null;
      segs = (v?.segments ?? []).filter((x: any) => x.active).map((x: any) => x.id);
    }

    // Submits staggered over ~20 s, with the chaos catalogue mixed in.
    await Promise.all(apiStudents.filter((s) => s.token).map(async (s) => {
      await sleep(3_000 + Math.random() * 17_000);
      if (s.chair === "ceo") await submit(s, { invest_T_gov: 1000 * r }, "CEO slice");
      if (s.chair === "cmo") await submit(s, { price: Object.fromEntries(segs.map((g, i) => [g, 7 + i + r * 0.25])), invest_B: 4000 }, "CMO slice");
      if (s.chair === "coo") await submit(s, { presence: splitFor(s.firm, r), invest_cap: 6000 }, "COO slice");
      if (s.chair === "cfo") {
        await submit(s, { invest_T_inv: 5000, ...(r === 2 ? { dividend: 2000 } : {}) }, "CFO slice");
        await submit(s, { invest_T_inv: 5000, ...(r === 2 ? { dividend: 2000 } : {}) }, "CFO double submit"); // replace semantics under load
      }
      if (s.chair === "chro") {
        // Own desk + a cover on the empty COO desk (invest_rnd is operations') — the DW-052 path.
        await submit(s, { invest_T_emp: 3000, invest_rnd: 2000 }, "CHRO slice + COO cover");
        if (s.firm === 1) { // one student "reloads": fresh join with the same claim, then resubmits
          const j = await must(call("POST", "/join", { body: { code: game.joinCode, claim: s.claim } }), `${s.ext} re-join (reload)`);
          if (j?.token) { s.token = j.token; await submit(s, { invest_T_emp: 3500, invest_rnd: 2000 }, "post-reload resubmit"); }
        }
      }
    }));

    // ── DW-062 probe: the COO's capacity split must survive the CMO submitting AFTER it.
    //    Needs a team carrying BOTH chairs — the merge rule under test is "the desk that
    //    owns the lever wins", and with either chair empty a different rule applies.
    const probe = apiStudents.find((s) => s.chair === "coo" && s.token && apiStudents.some((o) => o.firm === s.firm && o.chair === "cmo" && o.token));
    if (probe && segs.length > 1) {
      const split = splitFor(probe.firm, r);
      const cmo = apiStudents.find((o) => o.firm === probe.firm && o.chair === "cmo" && o.token)!;
      await submit(probe, { presence: split }, "DW-062 COO split");
      await sleep(900);
      await submit(cmo, { price: Object.fromEntries(segs.map((g, i) => [g, 8 + i])) }, "DW-062 CMO submits after");
      await sleep(900);
      const v = (await call("GET", "/view", { token: probe.token })).json;
      const got = v?.teamPlan?.composed?.presence ?? null;
      const kept = !!got && segs.every((g) => Number(got[g]) === Number(split[g]));
      expect(kept, `DW-062 r${r}: composed plan dropped the COO's split — sent ${JSON.stringify(split)}, composed ${JSON.stringify(got)}`);
      if (kept) console.log(`  DW-062 ok — team ${probe.firm}'s COO split survived the CMO submitting after it`);
    } else if (r === 1) {
      console.log("  DW-062 probe skipped — no team carries both a COO and a CMO");
    }

    // Real browsers act in the same window, under the same load.
    if (fleet) { await fleet.submitRound(r); await fleet.assertDividerHeld(BASE, r); }

    // Lock → resolve (auto-advances) once everyone has had their window.
    await sleep(4_000);
    const lock = await must(call("POST", `/instructor/games/${gid}/lock`, { instructor: true }), `lock r${r}`);
    if (lock?.nonSubmitters?.length) console.log(`  nonSubmitters at lock: ${lock.nonSubmitters.join(", ")}`);
    const res = await must(call("POST", `/instructor/games/${gid}/resolve`, { instructor: true, body: {} }), `resolve r${r}`);
    expect(res?.lifecycle === "published" || res?.lifecycle === "open" || res?.round != null, `resolve r${r} returned a lifecycle`);

    // Every client should see the new round within a few poll cycles.
    // Game rounds are 0-indexed: after resolving displayed round r, pulse.round === r.
    // Six poll cycles is generous when a round-trip is 7ms and tight when it is 800ms, so
    // against prod allow real wall-clock — but REPORT how long it actually took, because a
    // widened window that hides a regression is worse than a failing one.
    const t0 = Date.now();
    const window = isProd ? Math.max(6 * POLL_MS, 60_000) : 6 * POLL_MS;
    const deadline = t0 + window;
    while (Date.now() < deadline) { if (apiStudents.every((s) => s.round >= r)) break; await sleep(1000); }
    const took = Date.now() - t0;
    const lagged = apiStudents.filter((s) => s.round < r);
    expect(lagged.length === 0, `r${r}: ${lagged.length} clients never saw the advance in ${(window / 1000).toFixed(0)}s (${lagged.slice(0, 5).map((s) => `${s.ext}@r${s.round}`).join(",")})`);
    console.log(`  resolved; ${apiStudents.length - lagged.length}/${apiStudents.length} API clients saw round ${r + 1} in ${(took / 1000).toFixed(1)}s`);
    if (fleet) await fleet.waitForRound(r);
  }

  // 4. instructor wrap-up: status, dashboard, export (the after-class ritual).
  await must(call("GET", `/instructor/games/${gid}/status`, { instructor: true }), "status");
  await must(call("GET", `/instructor/games/${gid}/dashboard`, { instructor: true }), "dashboard");
  const csv = await call("GET", `/instructor/games/${gid}/export?format=csv`, { instructor: true, label: "/instructor/games/:id/export" });
  expect(csv.status === 200 && csv.bytes > 200, `export CSV (${csv.bytes} bytes)`);
  return finish(gid, loops, students, fleet);
}

async function finish(gid: string | null, loops: Promise<void>[] = [], students: Student[] = [], fleet: BrowserFleet | null = null) {
  for (const s of students) s.stop = true;
  consoleStop = true;
  await Promise.allSettled(loops);
  if (fleet) {
    // A real client that cannot join or submit is a failed rehearsal, not a footnote.
    failures.push(...fleet.failures);
    const pe = fleet.pageErrors();
    if (pe.length) { console.log(`\nBROWSER PAGE ERRORS (${pe.length}):`); for (const e of pe.slice(0, 15)) console.log(`  ! ${e}`); failures.push(...pe.map((e) => `browser page error — ${e}`)); }
    else console.log("\nBrowser seats: no page errors, no failed requests.");
    await fleet.stop();
  }
  if (gid) await call("POST", `/instructor/games/${gid}/end`, { instructor: true }); // leave nothing running

  // ── report ──
  const by = new Map<string, Sample[]>();
  for (const s of samples) { const k = `${s.path}`; (by.get(k) ?? by.set(k, []).get(k)!).push(s); }
  const q = (xs: number[], p: number) => xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? 0;
  console.log(`\n${"endpoint".padEnd(34)} ${"n".padStart(5)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"max".padStart(7)} ${"KB p95".padStart(7)} err`);
  for (const [k, xs] of [...by.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const ms = xs.map((x) => x.ms); const errs = xs.filter((x) => x.status !== 200).length;
    console.log(`${k.padEnd(34)} ${String(xs.length).padStart(5)} ${q(ms, 0.5).toFixed(0).padStart(6)}ms ${q(ms, 0.95).toFixed(0).padStart(6)}ms ${Math.max(...ms).toFixed(0).padStart(6)}ms ${(q(xs.map((x) => x.bytes), 0.95) / 1024).toFixed(1).padStart(7)} ${errs || ""}`);
  }
  const total = samples.length; const errs = samples.filter((s) => s.status !== 200).length;
  console.log(`\n${total} requests, ${errs} non-200, ${(samples.reduce((a, s) => a + s.bytes, 0) / 1024 / 1024).toFixed(1)} MB transferred`);
  if (failures.length) { console.log(`\nFAILURES (${failures.length}):`); for (const f of failures.slice(0, 30)) console.log(`  ✗ ${f}`); }
  else console.log("\nAll assertions passed ✓");
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { failures.push(`fatal: ${e instanceof Error ? e.stack : e}`); return finish(null); });
