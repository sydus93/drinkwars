/**
 * Sprint-1 regression (DW-073) — the real class game (42b80c61, 2026-10-01) replayed through the
 * real server: every stored seat slice goes through submitMemberDecision in its stored order,
 * then lock + resolve, for every round. Asserts the failures of that day cannot recur.
 *
 * The fixture is STUDENT DATA and is never committed. It lives outside git in
 *   <repo>/.scratch/sprint1/{config.json,decisions.json,stored_scores.json}
 * (or wherever DW_SPRINT1_FIXTURE points). With no fixture this file SKIPS — it never fails CI.
 *
 * One normalisation, and why: Sprint 1's client seeded each round's form from the tab's memory of
 * its own last submit, so a seat's slice re-sends last round's numbers as if freshly chosen. The
 * DW-073 client seeds from the firm's standing plan instead. So a carried lever a seat left at ITS
 * OWN previous-round value is rewritten to this replay's standing value — what the new client
 * would have sent for an untouched lever. Everything a seat actually changed is replayed verbatim.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sameLever, statementLineGaps, DESK_LEVERS, type Config, type FirmDecision } from "drinkwars-engine";
import { GameOrchestrator } from "../src/lifecycle.js";
import { InMemoryAdapter } from "../src/adapters/memory.js";

const DIR = process.env.DW_SPRINT1_FIXTURE ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".scratch", "sprint1");
const have = ["config.json", "decisions.json"].every((f) => existsSync(join(DIR, f)));

interface Slice { round: number; team_id: string; desk: string | null; partial: Partial<FirmDecision>; submitted: boolean; updated_at: string }
interface Fixture { teams: { id: string; firm_id: string; name: string }[]; member_decisions: Slice[]; decisions: { round: number; firm_id: string; decision: FirmDecision }[] }
const ROLE: Record<string, string> = { all: "ceo", commercial: "cmo", operations: "coo", people: "chro", finance: "cfo" };
// The levers the server's standing plan carries from round to round (lifecycle.ts standingDecision).
const CARRIED = ["price", "presence", "run_rate", "market_presence", "market_supply", "invest_cap", "invest_process", "invest_Q", "invest_B", "invest_T_emp", "invest_T_inv", "invest_T_gov"] as const;
// Scalar money levers, for the general "no CEO entry silently dropped" property.
const MONEY = ["invest_cap", "invest_process", "invest_Q", "invest_B", "invest_T_emp", "invest_T_inv", "invest_T_gov", "invest_water_efficiency", "debt_draw", "debt_repay", "equity_raise", "dividend"] as const;
const ownerDesk = (k: string) => (Object.entries(DESK_LEVERS).find(([, fs]) => (fs as string[]).includes(k))?.[0]) ?? "strategy";

test("Sprint 1 replay: CEO entries land, nothing throws, every round's statements add up", { skip: have ? false : `no fixture at ${DIR} (student data, kept out of git) — set DW_SPRINT1_FIXTURE` }, async () => {
  const config = JSON.parse(readFileSync(join(DIR, "config.json"), "utf8")) as Config;
  const D = JSON.parse(readFileSync(join(DIR, "decisions.json"), "utf8")) as Fixture;
  const firms = [...D.teams].sort((a, b) => a.firm_id.localeCompare(b.firm_id, "en", { numeric: true }));

  let now = 1_000;
  const store = new InMemoryAdapter();
  const orch = new GameOrchestrator(store, () => now);
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", title: "sprint 1 replay", teams: firms.map((t) => ({ name: t.name })) });
  const teams = await store.getTeams(gameId);
  const teamOf = new Map(firms.map((t) => [t.id, teams.find((x) => x.firm_id === t.firm_id)!])); // fixture team id → replay team
  for (const t of firms) assert.ok(teamOf.get(t.id), `replay has a team for ${t.firm_id}`);

  // One synthetic member per (team, desk) that ever submitted — the export carries no user ids.
  const uid = (teamId: string, desk: string) => `u-${teamOf.get(teamId)!.firm_id}-${desk}`;
  const seated = new Set<string>();
  for (const m of D.member_decisions) {
    const desk = m.desk ?? "all", id = uid(m.team_id, desk);
    if (seated.has(id)) continue;
    seated.add(id);
    await orch.joinGame(code, `${teamOf.get(m.team_id)!.firm_id} ${ROLE[desk]}`, id, { teamId: teamOf.get(m.team_id)!.id, role: ROLE[desk] });
  }

  const rounds = [...new Set(D.member_decisions.map((m) => m.round))].sort((a, b) => a - b);
  const prev = new Map<string, Partial<FirmDecision>>(); // seat → its raw slice last round
  const composedAt = new Map<string, FirmDecision>(); // `${round}:${firm}` → what the server composed
  const dropped: string[] = [], threw: string[] = [], gaps: string[] = [];
  let teamRounds = 0, skippedDead = 0;

  for (const r of rounds) {
    const game = await store.getGame(gameId);
    if (!game || game.lifecycle === "complete" || game.current_round !== r) break;
    const world = (await store.getWorldState(gameId, r)) ?? (await store.getLatestWorldState(gameId));
    const alive = new Set((world?.state.firms ?? []).filter((f) => f.status === "active").map((f) => f.id));
    const slices = D.member_decisions.filter((m) => m.round === r && m.submitted).sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
    const sent = new Map<string, { desk: string; partial: Partial<FirmDecision> }[]>(); // firm → what each seat sent (normalised)
    const base = new Map<string, FirmDecision>();
    for (const m of slices) {
      const team = teamOf.get(m.team_id)!, desk = m.desk ?? "all", seat = uid(m.team_id, desk);
      if (!alive.has(team.firm_id)) { skippedDead++; continue; } // out of the game in THIS replay
      if (!base.has(team.firm_id)) base.set(team.firm_id, (await orch.getStandingDecision(gameId, team.id))!);
      const std = base.get(team.firm_id)! as unknown as Record<string, unknown>;
      const p = { ...m.partial } as Record<string, unknown>;
      const before = prev.get(seat) as Record<string, unknown> | undefined;
      if (before) for (const k of CARRIED) if (k in p && sameLever(p[k], before[k])) p[k] = std[k]; // tab-memory echo → untouched
      p.firm_id = team.firm_id;
      now = Date.parse(m.updated_at);
      try { await orch.submitMemberDecision(gameId, team.id, seat, p as Partial<FirmDecision>, ROLE[desk]); }
      catch (e) { threw.push(`r${r} ${team.firm_id} ${desk}: ${(e as Error).message}`); continue; }
      sent.set(team.firm_id, [...(sent.get(team.firm_id) ?? []), { desk, partial: p as Partial<FirmDecision> }]);
    }
    for (const m of slices) prev.set(uid(m.team_id, m.desk ?? "all"), m.partial);

    // The DW-073 property, on every team-round: a money lever the CEO changed and the owning
    // chair left alone (or never sent) runs at the CEO's number.
    for (const [firm, seats] of sent) {
      teamRounds++;
      const team = teams.find((t) => t.firm_id === firm)!;
      const got = (await store.getDecision(gameId, r, team.id))!.decision;
      composedAt.set(`${r}:${firm}`, got);
      const std = base.get(firm)! as unknown as Record<string, unknown>;
      const ceo = seats.filter((s) => s.desk === "all").at(-1)?.partial as Record<string, unknown> | undefined;
      if (!ceo) continue;
      for (const k of MONEY) {
        if (ceo[k] === undefined || sameLever(ceo[k], std[k])) continue; // the CEO didn't change it
        const owner = seats.filter((s) => s.desk === ownerDesk(k)).at(-1)?.partial as Record<string, unknown> | undefined;
        if (owner && owner[k] !== undefined && !sameLever(owner[k], std[k])) continue; // the chair made its own call — theirs wins, by design
        // An EMPTY chair covered by a teammate: among non-owners the later word wins (DW-051), by design.
        if (!owner && seats.some((s) => s.desk !== "all" && (s.partial as Record<string, unknown>)[k] !== undefined)) continue;
        if (!sameLever((got as unknown as Record<string, unknown>)[k], ceo[k])) dropped.push(`r${r} ${firm} ${k}: CEO ${ceo[k]} → ran ${(got as unknown as Record<string, unknown>)[k]}`);
      }
    }

    now += 60_000;
    await orch.lockRound(gameId);
    const done = await orch.resolveRound(gameId, { force: true }); // throws InvariantError if the books don't balance (§7.2)
    if (done.lifecycle === "published") await orch.advanceRound(gameId); // the transport's resolve does both
    const res = (await store.getRoundResult(gameId, r))!.result;
    for (const fr of res.firm_results) {
      for (const g of statementLineGaps(fr.pnl, fr.balance_sheet, fr.cash_flow)) gaps.push(`r${r} ${fr.firm_id} ${g}`);
      const bs = fr.balance_sheet;
      const tol = 1e-6 * Math.max(1, Math.abs(bs.assets));
      if (Math.abs(bs.assets - (bs.debt + bs.equity)) > tol) gaps.push(`r${r} ${fr.firm_id} balance sheet: assets ${bs.assets} ≠ debt ${bs.debt} + equity ${bs.equity}`);
      for (const v of [bs.cash, bs.assets, bs.equity, fr.pnl.net_income, fr.scorecard_cumulative]) if (!Number.isFinite(v)) gaps.push(`r${r} ${fr.firm_id} non-finite figure`);
    }
  }

  assert.deepEqual(threw, [], "no seat submit throws");
  assert.deepEqual(gaps, [], "every resolved firm-round passes the accounting + statement-line invariants");
  assert.deepEqual(dropped, [], "no CEO money entry is dropped behind a chair that left the lever alone");
  assert.ok(teamRounds >= 20, `replayed ${teamRounds} team-rounds (${skippedDead} slices skipped: firm out of the game in this replay)`);

  // firm 1 (firm_1), wire round 0: the CEO's tanks + loan run. (With the whole CEO plan actually
  // running — $435k tanks, $126k quality, three key hires on $460k cash — this replay's firm 1 is
  // bankrupt at the end of round 0, so its later rounds are checked against the as-played history
  // in the next test.)
  const d0 = composedAt.get("0:firm_1");
  assert.ok(d0, "firm 1 has a round-0 plan");
  assert.equal(d0!.invest_cap, 435_000, "firm 1 wire round 0: the CEO's tanks run");
  assert.equal(d0!.debt_draw, 100_000, "firm 1 wire round 0: the CEO's loan runs");

  // firm 3 (firm_3): the CEO's taproom-community spend, replaced by the CHRO's $0 on the day.
  const firm3 = D.teams.find((t) => t.firm_id === "firm_3");
  if (firm3) {
    let checked = 0;
    for (const r of rounds) {
      const ceo: Slice | undefined = D.member_decisions.find((m) => m.round === r && m.team_id === firm3.id && (m.desk ?? "all") === "all");
      const d = composedAt.get(`${r}:${firm3.firm_id}`);
      const prior = r > 0 ? D.member_decisions.find((m) => m.round === r - 1 && m.team_id === firm3.id && (m.desk ?? "all") === "all") : undefined;
      if (!ceo || !d || !ceo.partial.invest_T_emp) continue;
      if (prior && sameLever(prior.partial.invest_T_emp, ceo.partial.invest_T_emp)) continue; // an echo, not a fresh entry
      assert.equal(d.invest_T_emp, ceo.partial.invest_T_emp, `firm 3 wire round ${r}: employee-relations spend follows the CEO`);
      checked++;
    }
    assert.ok(checked >= 3, `firm 3: ${checked} CEO people-spend entries checked`);
  }
});

test("Sprint 1 as played: in each of firm 1's four rounds the DW-073 merge composes the CEO's entries", { skip: have ? false : `no fixture at ${DIR}` }, async () => {
  const config = JSON.parse(readFileSync(join(DIR, "config.json"), "utf8")) as Config;
  const D = JSON.parse(readFileSync(join(DIR, "decisions.json"), "utf8")) as Fixture;
  const firms = [...D.teams].sort((a, b) => a.firm_id.localeCompare(b.firm_id, "en", { numeric: true }));
  const dosFx = D.teams.find((t) => t.firm_id === "firm_1")!;
  const want: [number, Partial<Record<keyof FirmDecision, number>>][] = [
    [0, { invest_cap: 435_000, debt_draw: 100_000 }],
    [1, { invest_cap: 570_000, equity_raise: 300_000 }],
    [2, { invest_cap: 95_000 }],
    [3, { invest_cap: 130_000, debt_draw: 1_025_000 }],
  ];
  for (const [target, levers] of want) {
    // History up to `target` exactly as it was played (the stored composed decisions), so the firm
    // is alive and its standing plan is the one its officers were looking at that day…
    let now = 1_000;
    const store = new InMemoryAdapter();
    const orch = new GameOrchestrator(store, () => now);
    const code = GameOrchestrator.makeJoinCode();
    const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", teams: firms.map((t) => ({ name: t.name })) });
    const teams = await store.getTeams(gameId);
    for (let r = 0; r < target; r++) {
      for (const d of D.decisions.filter((x) => x.round === r)) await orch.submitDecision(gameId, teams.find((t) => t.firm_id === d.firm_id)!.id, d.decision);
      await orch.lockRound(gameId);
      const done = await orch.resolveRound(gameId, { force: true });
      if (done.lifecycle === "published") await orch.advanceRound(gameId);
      now += 60_000;
    }
    const world = (await store.getWorldState(gameId, target)) ?? (await store.getLatestWorldState(gameId));
    assert.equal(world?.state.firms.find((f) => f.id === "firm_1")?.status, "active", `as played, firm 1 is still trading entering wire round ${target}`);
    // …then that round's seat slices, verbatim and in their stored order, through the real merge.
    const team = teams.find((t) => t.firm_id === "firm_1")!;
    const slices = D.member_decisions.filter((m) => m.round === target && m.team_id === dosFx.id && m.submitted).sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
    assert.ok(slices.some((m) => (m.desk ?? "all") === "all") && slices.length >= 2, `wire round ${target}: the CEO and at least one specialist submitted`);
    for (const m of slices) {
      const desk = m.desk ?? "all", id = `u-${desk}`;
      if (!team.member_user_ids.includes(id) && !(await store.getTeam(team.id))!.member_user_ids.includes(id)) await orch.joinGame(code, ROLE[desk], id, { teamId: team.id, role: ROLE[desk] });
      now = Date.parse(m.updated_at);
      await orch.submitMemberDecision(gameId, team.id, id, { ...m.partial, firm_id: "firm_1" }, ROLE[desk]);
    }
    const got = (await store.getDecision(gameId, target, team.id))!.decision as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(levers)) assert.equal(got[k], v, `firm 1 wire round ${target}: composed ${k} = the CEO's entry (on the day the specialist's untouched default ran instead)`);
  }
});
