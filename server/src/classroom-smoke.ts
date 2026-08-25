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

// ── 6. run the game: lock → resolve × 12 rounds, everyone keeps trading ────
let npcTraded = false, allRoundsClean = true, deadStudentFirms = 0;
for (let r = 0; r < 12; r++) {
  const lock = await asInstructor(`/instructor/games/${gameId}/lock`, { method: "POST" });
  const resolve = await asInstructor(`/instructor/games/${gameId}/resolve`, { method: "POST" });
  if (lock.status !== 200 || resolve.status !== 200) { allRoundsClean = false; console.log(`   round ${r}: lock ${lock.status} resolve ${resolve.status} ${resolve.body.error ?? ""}`); break; }
}
const status = await asInstructor(`/instructor/games/${gameId}/status`);
const st = status.body as { round?: number; teams?: { teamId: string; firmId: string; joined: boolean }[] };
ok(allRoundsClean && (st.round ?? 0) >= 12, `12 rounds lock/resolve cleanly (round now ${st.round})`);

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

console.log(failures ? `\n✗ ${failures} failure(s)` : "\nAll classroom-flow checks green.");
process.exit(failures ? 1 : 0);
