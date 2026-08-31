/** DW-044 classroom smoke: the exact semester configuration, end to end, against the
 *  real node transport. 25-student roster → 5 team firms × 5 seats + 2 NPC firms,
 *  full "Everything (Pro)" preset, per-desk submissions, lock/resolve rounds, and the
 *  gamemaster schedule (plant/cancel a demand event, arm a live trigger).
 *  The pre-semester check: run it the day before class. Run: PORT=8787 npm run serve (one shell) then PORT=8787 npm run classroom:smoke */
import { PRESETS } from "drinkwars-engine";

const BASE = `http://127.0.0.1:${process.env.PORT ?? 8787}`;
const PASS = process.env.DW_INSTRUCTOR_PASS ?? "letmein";
let failures = 0;
const ok = (cond: boolean, label: string, detail = "") => {
  console.log(`${cond ? "  PASS" : "✗ FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

async function api(path: string, init: RequestInit = {}, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...headers } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body: body as Record<string, unknown> };
}
const asInstructor = (path: string, init: RequestInit = {}) => api(path, init, { "x-instructor-pass": PASS });

// ── 1. create the semester game ─────────────────────────────────────────────
const full = PRESETS.find((p) => p.id === "full")!;
const modules = Object.fromEntries(full.modules.map((id) => [id, { enabled: true }]));
const create = await asInstructor("/instructor/games", {
  method: "POST",
  body: JSON.stringify({ nFirms: 7, nRounds: 16, firmMode: "team", title: "GBA 490 — Fall 2026", modules }),
});
ok(create.status === 200, "create team game, Everything (Pro), 7 firms × 16 rounds", String(create.body.error ?? ""));
const gameId = String(create.body.gameId);
const joinCode = String(create.body.joinCode);

// ── 2. provision the 25-student roster ──────────────────────────────────────
const roster = Array.from({ length: 25 }, (_, i) => ({ external_id: `student${String(i + 1).padStart(2, "0")}`, name: `Student ${i + 1}` }));
const prov = await asInstructor("/instructor/roster", { method: "POST", body: JSON.stringify({ roster, cohort: "GBA490-F26" }) });
const students = (prov.body.students ?? prov.body.roster ?? []) as { external_id: string; claim_code: string }[];
ok(prov.status === 200 && students.length === 25, "provision 25-student roster with claim codes", `got ${students.length}`);

// ── 3. 25 students join: 5 firms × 5 seats, via claim codes ────────────────
const SEATS = ["ceo", "cfo", "cmo", "coo", "chro"];
const TEAMS = ["Hop Theory", "Barrel & Vine", "North Fork", "Copper Kettle", "Late Addition"];
const tokens: { token: string; teamId: string; seat: string; team: number }[] = [];
let joinErrs: string[] = [];
for (let t = 0; t < 5; t++) {
  let teamId: string | undefined;
  for (let s = 0; s < 5; s++) {
    const idx = t * 5 + s;
    const body: Record<string, unknown> = { code: joinCode, name: `Student ${idx + 1}`, claim: students[idx].claim_code, role: SEATS[s] };
    if (s === 0) body.teamName = TEAMS[t]; // founder names the brewery (auto-CEO)
    else body.teamId = teamId; // teammates take a named chair on the founded firm
    const r = await api("/join", { method: "POST", body: JSON.stringify(body) });
    if (r.status !== 200) joinErrs.push(`${idx + 1}/${SEATS[s]}: ${r.body.error}`);
    else {
      teamId = String(r.body.teamId);
      tokens.push({ token: String(r.body.token), teamId: teamId!, seat: SEATS[s], team: t });
    }
  }
}
ok(tokens.length === 25 && !joinErrs.length, "25 students seated: 5 firms × 5 named chairs", joinErrs.slice(0, 2).join(" | "));

// A 26th student is turned away from a full firm with a human error.
const extra = await api("/join", { method: "POST", body: JSON.stringify({ code: joinCode, name: "Student 26", teamId: tokens[0].teamId, role: "cfo" }) });
ok(extra.status === 400 && /taken|full/i.test(String(extra.body.error)), "26th student gets a clear 'seat taken / firm full' error", String(extra.body.error));

// ── 4. every seat submits its own desk slice; team plan composes live ──────
const submit = (token: string, decision: Record<string, unknown>) =>
  api("/submit", { method: "POST", body: JSON.stringify({ token, decision }) });
let subErrs: string[] = [];
for (const t of tokens) {
  const d: Record<string, unknown> = {};
  if (t.seat === "cmo") { d.price = { mass: 7.4, niche: 8.4, frontier: 0 }; d.presence = { mass: 0.6, niche: 0.4, frontier: 0 }; d.invest_B = 12_000; }
  if (t.seat === "coo") { d.invest_cap = 8_000; d.invest_process = 6_000; d.invest_Q = 10_000; d.run_rate = 0.85; }
  if (t.seat === "chro") { d.invest_T_emp = 5_000; }
  if (t.seat === "cfo") { d.debt_repay = 4_000; d.invest_T_inv = 3_000; }
  if (t.seat === "ceo") { d.invest_T_gov = 3_000; }
  const r = await submit(t.token, d);
  if (r.status !== 200) subErrs.push(`${t.seat}: ${r.body.error}`);
}
ok(!subErrs.length, "all 25 desk slices accepted", subErrs.slice(0, 2).join(" | "));

// The CFO of team 1 sees the composed plan with the CMO's price on it.
const view1 = await api(`/view?token=${tokens[1].token}`);
const plan = view1.body.teamPlan as { composed?: { price?: Record<string, number> } ; seats?: unknown[] } | undefined;
ok(!!plan?.composed && Math.abs((plan.composed.price?.mass ?? 0) - 7.4) < 1e-9, "team plan composes desks live (CFO sees CMO's $7.40 mass price)", JSON.stringify(plan?.composed?.price ?? {}));

// ── 5. gamemaster: see the rolled fate, plant + cancel a syllabus event ────
const tl0 = await asInstructor(`/instructor/games/${gameId}/timeline`);
const catalog = (tl0.body.catalog ?? []) as { id: string }[];
ok(tl0.status === 200 && catalog.some((c) => c.id === "health_shift") && catalog.some((c) => c.id === "na_moment"), "shock catalog offers the gamemaster demand events", catalog.map((c) => c.id).join(","));
const plant = await asInstructor(`/instructor/games/${gameId}/timeline`, { method: "POST", body: JSON.stringify({ op: "schedule", spec: { type_id: "health_shift", round: 5, magnitude: 0.2, duration: 3 } }) });
const planted = (plant.body.timeline as { type_id: string; round: number; id: string }[] | undefined)?.find((s) => s.type_id === "health_shift");
ok(plant.status === 200 && planted?.round === 5, "plant a health_shift (mass demand −20%) on round 5");
const unplant = await asInstructor(`/instructor/games/${gameId}/timeline`, { method: "POST", body: JSON.stringify({ op: "unschedule", shockId: planted?.id }) });
ok(unplant.status === 200 && !(unplant.body.timeline as { id: string }[]).some((s) => s.id === planted?.id), "cancel it again");
const replant = await asInstructor(`/instructor/games/${gameId}/timeline`, { method: "POST", body: JSON.stringify({ op: "schedule", spec: { type_id: "na_moment", round: 10, duration: 3 } }) });
ok(replant.status === 200, "plant the NA-moment (frontier demand +25%) on round 10 for the maturing-industry beat");

// ── 5b. DW-048 classroom ops: per-chair status, deadline, unlock, remove/re-seat ──
const st0 = (await asInstructor(`/instructor/games/${gameId}/status`)).body as { firmMode?: string; deadlineAt?: number | null; teams?: { teamId: string; members?: { userId: string; role: string | null; submitted: boolean }[] }[] };
const chairs = (st0.teams ?? []).flatMap((t) => t.members ?? []);
ok(st0.firmMode === "team" && chairs.length === 25 && chairs.every((m) => m.submitted), "status lists all 25 chairs with per-chair submit state", `${chairs.length} chairs, ${chairs.filter((m) => m.submitted).length} submitted`);
const dl = Date.now() + 3 * 3600_000;
const setDl = await asInstructor(`/instructor/games/${gameId}/deadline`, { method: "POST", body: JSON.stringify({ deadlineAt: dl }) });
const viewDl = await api(`/view?token=${tokens[0].token}`);
ok(setDl.status === 200 && viewDl.body.deadlineAt === dl && !!viewDl.body.standing, "deadline announced → students' view carries it (+ standing plan seed)", String(setDl.body.error ?? ""));
const lock0 = await asInstructor(`/instructor/games/${gameId}/lock`, { method: "POST" });
const lateSubmit = await submit(tokens[2].token, { invest_B: 1 });
const unlock0 = await asInstructor(`/instructor/games/${gameId}/unlock`, { method: "POST" });
const okAgain = await submit(tokens[2].token, { price: { mass: 7.4, niche: 8.4, frontier: 0 }, presence: { mass: 0.6, niche: 0.4, frontier: 0 }, invest_B: 12_000 });
ok(lock0.status === 200 && lateSubmit.status === 400 && /locked|not open/i.test(String(lateSubmit.body.error)) && unlock0.status === 200 && okAgain.status === 200, "lock rejects a late submit with a plain error; unlock re-opens the window", String(lateSubmit.body.error ?? unlock0.body.error ?? okAgain.body.error ?? ""));
const t5 = (st0.teams ?? []).find((t) => t.teamId === tokens[24].teamId)!;
const chro = t5.members!.find((m) => m.role === "chro")!;
const rm = await asInstructor(`/instructor/games/${gameId}/members`, { method: "POST", body: JSON.stringify({ op: "remove", teamId: t5.teamId, userId: chro.userId }) });
const st1 = (await asInstructor(`/instructor/games/${gameId}/status`)).body as { teams?: { teamId: string; members?: unknown[] }[] };
const rejoinChro = await api("/join", { method: "POST", body: JSON.stringify({ code: joinCode, claim: students[24].claim_code, teamId: t5.teamId, role: "chro" }) });
const st2 = (await asInstructor(`/instructor/games/${gameId}/status`)).body as { teams?: { teamId: string; members?: unknown[] }[] };
ok(rm.status === 200 && st1.teams?.find((t) => t.teamId === t5.teamId)?.members?.length === 4 && rejoinChro.status === 200 && st2.teams?.find((t) => t.teamId === t5.teamId)?.members?.length === 5, "instructor removes a chair (4 left) and the student re-takes it by claim code (5 again)", String(rm.body.error ?? rejoinChro.body.error ?? ""));
if (rejoinChro.status === 200) tokens[24] = { ...tokens[24], token: String(rejoinChro.body.token) };
await submit(tokens[24].token, { invest_T_emp: 5_000 });

// ── 6. run the game: lock → resolve × 12 rounds, everyone keeps trading ────
let npcTraded = false, allRoundsClean = true, deadStudentFirms = 0;
for (let r = 0; r < 12; r++) {
  const lock = await asInstructor(`/instructor/games/${gameId}/lock`, { method: "POST" });
  const resolve = await asInstructor(`/instructor/games/${gameId}/resolve`, { method: "POST" });
  if (lock.status !== 200 || resolve.status !== 200) { allRoundsClean = false; console.log(`   round ${r}: lock ${lock.status} resolve ${resolve.status} ${resolve.body.error ?? ""}`); break; }
}
const status = await asInstructor(`/instructor/games/${gameId}/status`);
const st = status.body as { round?: number; deadlineAt?: number | null; teams?: { teamId: string; firmId: string; joined: boolean }[] };
ok(allRoundsClean && (st.round ?? 0) >= 12, `12 rounds lock/resolve cleanly (round now ${st.round})`);
ok(st.deadlineAt == null, "the round-1 deadline cleared itself when the next round opened");

// Student + NPC firm health after 12 rounds of nobody re-submitting (no-show carry).
const dash = await asInstructor(`/instructor/games/${gameId}/dashboard`);
const dbody = dash.body as {
  teams?: { teamId: string; firmId: string; joined: boolean }[];
  panel?: { round: number; firmId: string; status: string; revenue: number }[];
};
const joinedFirms = new Set((dbody.teams ?? []).filter((t) => t.joined).map((t) => t.firmId));
const lastRound = Math.max(...(dbody.panel ?? []).map((p) => p.round), 0);
let npcRevenue = 0, studentAlive = 0;
for (const p of (dbody.panel ?? []).filter((x) => x.round === lastRound)) {
  if (joinedFirms.has(p.firmId)) { if (p.status === "active") studentAlive++; else deadStudentFirms++; }
  else if (p.revenue > 0) { npcTraded = true; npcRevenue += p.revenue; }
}
ok(studentAlive === 5 && deadStudentFirms === 0, `all 5 student firms still trading at round 12 on carried plans (alive ${studentAlive})`);
ok(npcTraded, "NPC firms trade the empty slots", `combined NPC revenue $${Math.round(npcRevenue).toLocaleString()}`);

// ── 7. a student reconnects by claim code (lost laptop) ────────────────────
const rejoin = await api("/join", { method: "POST", body: JSON.stringify({ code: joinCode, claim: students[7].claim_code }) });
ok(rejoin.status === 200 && String(rejoin.body.teamId) === tokens[7].teamId, "student 8 reconnects via claim code into the same seat");

// ── 8. instructor administration (DW-049): list · rename · return codes · end early ──
const lst = await asInstructor("/instructor/games");
const lrow = ((lst.body as { games?: { gameId: string; title: string | null; nFirms: number; firmMode: string }[] }).games ?? []).find((g) => g.gameId === gameId);
ok(lst.status === 200 && !!lrow, "the game appears in the instructor's game list", lrow ? `${lrow.nFirms} firms · ${lrow.firmMode}` : undefined);
await asInstructor(`/instructor/games/${gameId}/title`, { method: "POST", body: JSON.stringify({ title: "Smoke · Section A" }) });
const st8 = await asInstructor(`/instructor/games/${gameId}/status`);
const s8 = st8.body as { title?: string | null; modules?: string[]; teams?: { members?: { claim?: string | null }[] }[] };
ok(s8.title === "Smoke · Section A" && Array.isArray(s8.modules), "status carries the title + enabled-module list (set-up card)", `modules: ${(s8.modules ?? []).join(",") || "standard"}`);
const chairs8 = (s8.teams ?? []).flatMap((t) => t.members ?? []);
ok(chairs8.length > 0 && chairs8.every((m) => typeof m.claim === "string" && m.claim.length >= 6), "every chair's return code is visible to the instructor");
const end = await asInstructor(`/instructor/games/${gameId}/end`, { method: "POST" });
const stEnd = await asInstructor(`/instructor/games/${gameId}/status`);
const vEnd = await api(`/view?token=${tokens[0].token}`);
ok(end.status === 200 && (stEnd.body as { lifecycle?: string }).lifecycle === "complete" && (vEnd.body as { complete?: boolean }).complete === true, "End game → season complete for instructor and student");

// ── 9. pre-seating (DW-050): plan → claim-only join lands in the chair; pulse is quiet until a write ──
const g2 = await asInstructor("/instructor/games", { method: "POST", body: JSON.stringify({ nFirms: 3, nRounds: 4, firmMode: "team", modules: { teamRoles: { enabled: true } } }) });
const g2id = String(g2.body.gameId), g2code = String(g2.body.joinCode);
const seatPlan = await asInstructor(`/instructor/games/${g2id}/seats`, { method: "POST", body: JSON.stringify({ plan: [
  { external_id: "student01", team: "Alpha Ales", role: "CEO" }, { external_id: "student02", team: "Alpha Ales", role: "cfo" }, { external_id: "student03", team: "Alpha Ales", role: "cmo" },
  { external_id: "student04", team: "Beta Brew", role: "ceo" }, { external_id: "ghost99", team: "Beta Brew", role: "cfo" }, { external_id: "student05", team: "Beta Brew", role: "ceo" },
] }) });
const pb = seatPlan.body as { seated?: unknown[]; errors?: { external_id: string; error: string }[] };
ok(seatPlan.status === 200 && (pb.seated ?? []).length === 4 && (pb.errors ?? []).length === 2, "seat plan: 4 seated, 2 row errors (unprovisioned NetID, chair taken)", (pb.errors ?? []).map((e) => `${e.external_id}: ${e.error}`).join(" | "));
const peek2 = await api(`/game?code=${g2code}&claim=${students[1].claim_code}`);
const ys = (peek2.body as { yourSeat?: { team: string; role: string } }).yourSeat;
ok(!!ys && ys.team === "Alpha Ales" && ys.role === "cfo", "peek with claim code reveals the pre-assigned chair", ys ? `${ys.team} · ${ys.role}` : "no yourSeat");
const j2 = await api("/join", { method: "POST", body: JSON.stringify({ code: g2code, claim: students[1].claim_code }) });
ok(j2.status === 200 && j2.body.role === "cfo", "join with code + claim only (no picks) lands in the planned chair", String(j2.body.error ?? j2.body.role));
const pulseA = await api(`/pulse?token=${j2.body.token}`);
const pulseB = await api(`/pulse?token=${j2.body.token}`);
await submit(String(j2.body.token), { dividend: 1000 });
const pulseC = await api(`/pulse?token=${j2.body.token}`);
ok(pulseA.status === 200 && pulseA.body.stamp === pulseB.body.stamp && pulseC.body.stamp !== pulseA.body.stamp, "pulse stamp is stable between reads and moves on a seat's write", `${String(pulseA.body.stamp).length}-char stamp`);

console.log(failures ? `\n✗ ${failures} failure(s)` : "\nAll classroom-flow checks green.");
process.exit(failures ? 1 : 0);
