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

const PROD = "https://kikmdmldfgakdabbsdcq.supabase.co/functions/v1/drinkwars";
const BASE = process.argv.includes("--prod") ? (process.env.BASE ?? PROD) : (process.env.BASE ?? "http://localhost:8787");
const PASS = process.env.DW_INSTRUCTOR_PASS ?? "letmein";
const FIRMS = Math.max(1, Number(process.env.FIRMS ?? 9));
const ROUNDS = Math.max(1, Number(process.env.ROUNDS ?? 3));
const POLL_MS = Math.max(500, Number(process.env.POLL_MS ?? 2500));
const CHAIRS = ["ceo", "cfo", "chro"] as const; // 3 chairs/firm ≈ a 27–28 student class; CMO+COO stay empty so covers happen naturally

if (process.argv.includes("--prod") && !process.env.DW_INSTRUCTOR_PASS) {
  console.error("Refusing to hit prod with the default passcode. Run:  DW_INSTRUCTOR_PASS=<your pass> npx tsx scripts/prod-rehearsal.ts --prod");
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
type Student = { ext: string; name: string; firm: number; chair: (typeof CHAIRS)[number]; claim?: string; token?: string; round: number; stamp: string; views: number; stop: boolean };
async function pollLoop(s: Student) {
  // The real client: /pulse on a jittered cadence, full /view only when the stamp moves.
  await sleep(Math.random() * POLL_MS);
  while (!s.stop) {
    const p = await call("GET", "/pulse", { token: s.token });
    if (p.status === 200 && p.json?.stamp && p.json.stamp !== s.stamp) {
      s.stamp = p.json.stamp;
      s.round = p.json.round;
      const v = await call("GET", "/view", { token: s.token });
      if (v.status === 200) s.views++;
      else failures.push(`${s.ext} /view after stamp change → ${v.status}`);
    } else if (p.status !== 200) {
      failures.push(`${s.ext} /pulse → ${p.status}`);
    }
    await sleep(POLL_MS * (0.85 + Math.random() * 0.3));
  }
}
const submit = (s: Student, decision: Record<string, unknown>, note: string) =>
  must(call("POST", "/submit", { body: { token: s.token, decision } }), `${s.ext} (${s.chair}) submit ${note}`);

// ── the rehearsal ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`Rehearsal vs ${BASE} — ${FIRMS} firms × ${CHAIRS.length} chairs = ${FIRMS * CHAIRS.length} students, ${ROUNDS} rounds, poll ${POLL_MS}ms\n`);
  const full = PRESETS.find((p) => p.id === "full");
  const modules = Object.fromEntries((full?.modules ?? []).map((id) => [id, { enabled: true }]));

  // 1. create game + roster + seat plan — the instructor's pre-class ritual, via API.
  const game = await must(call("POST", "/instructor/games", { instructor: true, body: { nFirms: FIRMS, nRounds: Math.max(ROUNDS + 2, 6), firmMode: "team", modules, title: `REHEARSAL ${new Date().toISOString().slice(0, 16)}` } }), "create game");
  if (!game?.gameId) { console.error("Cannot continue without a game."); return finish(null); }
  const gid = game.gameId as string;
  console.log(`game ${game.joinCode} (${gid})`);

  const students: Student[] = [];
  let n = 0;
  for (let f = 1; f <= FIRMS; f++) for (const chair of CHAIRS) { n++; students.push({ ext: `rhz${String(n).padStart(2, "0")}`, name: `Rehearsal ${n}`, firm: f, chair, round: 0, stamp: "", views: 0, stop: false }); }
  const roster = await must(call("POST", "/instructor/roster", { instructor: true, body: { cohort: "rehearsal", roster: students.map((s) => ({ external_id: s.ext, name: s.name })) } }), "provision roster");
  for (const s of students) s.claim = roster?.students?.find((r: any) => r.external_id === s.ext)?.claim_code ?? roster?.students?.find((r: any) => r.external_id === s.ext)?.claim;
  expect(students.every((s) => !!s.claim), `roster: missing claim codes (${students.filter((s) => !s.claim).map((s) => s.ext).join(",") || "none"})`);
  await must(call("POST", `/instructor/games/${gid}/seats`, { instructor: true, body: { plan: students.map((s) => ({ external_id: s.ext, team: `Group ${s.firm}`, role: s.chair })) } }), "apply seat plan");

  // 2. the join rush — everyone claims within ~10 s, like the start of class.
  await Promise.all(students.map(async (s, i) => {
    await sleep(i * (10_000 / students.length) * Math.random());
    const j = await must(call("POST", "/join", { body: { code: game.joinCode, claim: s.claim } }), `${s.ext} join`);
    s.token = j?.token;
  }));
  expect(students.every((s) => !!s.token), "every student holds a session token");
  const loops = students.filter((s) => s.token).map((s) => pollLoop(s));

  // 3. rounds
  for (let r = 1; r <= ROUNDS; r++) {
    console.log(`— round ${r}`);
    await must(call("POST", `/instructor/games/${gid}/deadline`, { instructor: true, body: { deadlineAt: Date.now() + 75_000 } }), "announce deadline");

    // Submits staggered over ~20 s, with the chaos catalogue mixed in.
    await Promise.all(students.filter((s) => s.token).map(async (s) => {
      await sleep(3_000 + Math.random() * 17_000);
      if (s.chair === "ceo") await submit(s, { invest_T_gov: 1000 * r }, "CEO slice");
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

    // Lock → resolve (auto-advances) once everyone has had their window.
    await sleep(4_000);
    const lock = await must(call("POST", `/instructor/games/${gid}/lock`, { instructor: true }), `lock r${r}`);
    if (lock?.nonSubmitters?.length) console.log(`  nonSubmitters at lock: ${lock.nonSubmitters.join(", ")}`);
    const res = await must(call("POST", `/instructor/games/${gid}/resolve`, { instructor: true, body: {} }), `resolve r${r}`);
    expect(res?.lifecycle === "published" || res?.lifecycle === "open" || res?.round != null, `resolve r${r} returned a lifecycle`);

    // Every client should see the new round within a few poll cycles.
    // Game rounds are 0-indexed: after resolving displayed round r, pulse.round === r.
    const deadline = Date.now() + 6 * POLL_MS;
    while (Date.now() < deadline) { if (students.every((s) => s.round >= r)) break; await sleep(1000); }
    const lagged = students.filter((s) => s.round < r);
    expect(lagged.length === 0, `r${r}: ${lagged.length} clients never saw the advance (${lagged.slice(0, 5).map((s) => `${s.ext}@r${s.round}`).join(",")})`);
    console.log(`  resolved; ${students.length - lagged.length}/${students.length} clients saw round ${r + 1}`);
  }

  // 4. instructor wrap-up: status, dashboard, export (the after-class ritual).
  await must(call("GET", `/instructor/games/${gid}/status`, { instructor: true }), "status");
  await must(call("GET", `/instructor/games/${gid}/dashboard`, { instructor: true }), "dashboard");
  const csv = await call("GET", `/instructor/games/${gid}/export?format=csv`, { instructor: true, label: "/instructor/games/:id/export" });
  expect(csv.status === 200 && csv.bytes > 200, `export CSV (${csv.bytes} bytes)`);
  return finish(gid, loops, students);
}

async function finish(gid: string | null, loops: Promise<void>[] = [], students: Student[] = []) {
  for (const s of students) s.stop = true;
  await Promise.allSettled(loops);
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
