/**
 * End-to-end orchestration demo: create a game, run every round through the
 * open → lock → resolve → publish lifecycle with the in-memory adapter, then
 * verify replay and show what landed in the research tables. Exercises a
 * deliberate non-submission (zero-fill + flag) and belief/reflection capture.
 *
 *   npm run demo            (from server/)
 */
import { loadConfig } from "drinkwars-engine/node";
import type { Config, FirmDecision, SegmentId, WorldState } from "drinkwars-engine";
import { GameOrchestrator, InMemoryAdapter } from "./index.js";

type Firm = WorldState["firms"][number];

function decide(firm: Firm, activeSegs: SegmentId[], c: Config, idx: number): FirmDecision {
  const unit = firm.unit_cost > 0 ? firm.unit_cost : c.costs.c_base * 0.85;
  const markup = 1.7 + (idx % 4) * 0.12; // a little variety across teams
  const price: Record<SegmentId, number> = {};
  const presence: Record<SegmentId, number> = {};
  for (const s of c.segments.map((x) => x.id)) {
    price[s] = 0;
    presence[s] = 0;
  }
  for (const s of activeSegs) {
    presence[s] = 1;
    price[s] = unit * markup;
  }
  const budget = Math.max(0, firm.cash) * 0.3;
  const each = budget / 4;
  return {
    firm_id: firm.id, price, presence,
    run_rate: 0.9, // brew near capacity (inventory mode); ignored when disabled
    invest_cap: (c.capacity.depreciation * firm.cap) / c.capacity.gain,
    invest_process: each * 0.6, invest_Q: each, invest_B: each, invest_T_emp: each * 0.6,
    invest_T_inv: 0, invest_T_gov: 0,
    debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0,
    buy_info: idx === 0, // team 1 buys market research each round
    agreement_actions: [],
    exit_action: null,
    beliefs: { own_rank: 1 + (idx % 8), market_size: 1400, rival_move: "raise quality" },
    reflection: `Round play: hold ${activeSegs.join("+")}, markup ${markup.toFixed(2)}.`,
  };
}

const config = loadConfig();
const store = new InMemoryAdapter();
const orch = new GameOrchestrator(store);

// Users: half consent to research use (§18). Teams: one per firm.
const N = config.game.n_firms;
const teams: { name: string; memberUserIds?: string[] }[] = [];
for (let i = 0; i < N; i++) {
  const userId = `user_${i + 1}`;
  await store.createUser({ id: userId, role: "student", email: null, consent: i % 2 === 0, deid_code: `s${i + 1}` });
  teams.push({ name: `Brewery ${i + 1}`, memberUserIds: [userId] });
}
await store.createUser({ id: "instructor", role: "instructor", email: null, consent: false, deid_code: "instr" });

const gameId = await orch.createGame({ config, teams });
const teamRecords = await store.getTeams(gameId);
console.log(`Created game ${gameId}: ${N} teams, ${config.game.n_rounds} rounds.\n`);

for (let round = 0; round < config.game.n_rounds; round++) {
  const pub = await orch.getPublicState(gameId);
  const activeSegs = pub.segments.filter((s) => s.active).map((s) => s.id);

  // Each team submits — except team 4 skips round 5 (demonstrates zero-fill + flag).
  for (let i = 0; i < teamRecords.length; i++) {
    if (round === 5 && i === 3) continue;
    const team = teamRecords[i];
    const view = await orch.getTeamView(gameId, team.id);
    if (!view.own || view.own.status !== "active") continue;
    await orch.submitDecision(gameId, team.id, decide(view.own, activeSegs, config, i));
  }

  const nonSubmitters = await orch.lockRound(gameId);
  const { round: resolved, lifecycle } = await orch.resolveRound(gameId);
  if (lifecycle === "published") await orch.advanceRound(gameId);

  const rr = (await store.getRoundResult(gameId, resolved))!;
  const standings = [...rr.result.firm_results].sort((a, b) => b.scorecard_cumulative - a.scorecard_cumulative);
  const active = rr.result.firm_results.filter((f) => f.status === "active").length;
  const flags = nonSubmitters.length ? ` | non-submitters flagged: ${nonSubmitters.length}` : "";
  const ev = rr.result.events.length ? ` | ${rr.result.events.length} event(s)` : "";
  console.log(`R${String(resolved).padStart(2)} [${lifecycle}] active ${active}/${N} | leader ${standings[0]?.firm_id} (${standings[0]?.scorecard_cumulative.toFixed(3)})${flags}${ev}`);
}

// --- Verify replay + show research capture -----------------------------------
const replay = await orch.replay(gameId);
const firmRounds = await store.getFirmRounds(gameId);
const beliefs = await store.getBeliefs(gameId);
const telemetry = await store.getTelemetry(gameId);
const agreements = await store.getAgreements(gameId);
const reflections = await store.getReflections(gameId);
const distinct = await store.getDistinctiveness(gameId);
const consented = firmRounds.filter((r) => r.consent).length;

console.log(`\nReplay determinism: ${replay.ok ? "PASS — recomputed history matches stored" : "FAIL\n  " + replay.mismatches.slice(0, 5).join("\n  ")}`);
console.log("\nResearch tables captured:");
console.log(`  firm_round:     ${firmRounds.length} rows (${consented} consented for publication, §18)`);
console.log(`  beliefs:        ${beliefs.length} rows  (mean accuracy ${(beliefs.reduce((a, b) => a + (b.score ?? 0), 0) / Math.max(1, beliefs.length)).toFixed(2)})`);
console.log(`  telemetry:      ${telemetry.length} rows  (${telemetry.filter((t) => !t.submitted).length} non-submissions, ${telemetry.filter((t) => t.info_purchased).length} info purchases)`);
console.log(`  distinctiveness:${distinct.length} rows`);
console.log(`  reflections:    ${reflections.length} rows`);
console.log(`  agreements:     ${agreements.length} rows`);

const finalGame = await store.getGame(gameId);
console.log(`\nFinal lifecycle: ${finalGame?.lifecycle} (round ${finalGame?.current_round}/${config.game.n_rounds}).`);
