/**
 * In-process smoke for the instructor analytics dashboard. Drives a memory-mode
 * GameOrchestrator through a few rounds (one human team submitting beliefs +
 * reflections, the rest bot-filled), then asserts that buildInstructorDashboard
 * assembles a complete payload and dashboardToCsv emits one row per firm per round.
 *
 *   Run:  npm run dashboard:smoke   (from server/)
 *
 * No server / database required.
 */
import { ADAPTIVE_LEANS, decideAdaptive } from "drinkwars-engine";
import { loadConfig } from "drinkwars-engine/node";
import { GameOrchestrator, InMemoryAdapter, buildInstructorDashboard, dashboardToCsv } from "./index.js";

const ok = (label: string) => console.log(`  ✓ ${label}`);
function check(cond: unknown, m: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${m}`);
}

const N_FIRMS = 4;
const N_ROUNDS = 3;

async function main(): Promise<void> {
  const store = new InMemoryAdapter();
  let now = 1_000_000;
  const orch = new GameOrchestrator(store, () => (now += 1000), { botFillEmptySlots: true });

  const config = loadConfig({ game: { n_firms: N_FIRMS, n_rounds: N_ROUNDS } } as never);
  const code = GameOrchestrator.makeJoinCode();
  const teams = Array.from({ length: N_FIRMS }, (_, i) => ({ name: `Open slot ${i + 1}` }));
  const gameId = await orch.createGame({ config, joinCode: code, teams });
  ok(`created game (${N_FIRMS} firms, ${N_ROUNDS} rounds)`);

  const joined = await orch.joinGame(code, "Test Brewer", "user-1");
  ok(`one human joined as ${joined.firmId}`);

  for (let r = 0; r < N_ROUNDS; r++) {
    // Human team submits an adaptive decision augmented with a belief + reflection.
    const world = (await store.getLatestWorldState(gameId))!.state;
    const firm = world.firms.find((f) => f.id === joined.firmId)!;
    const base = decideAdaptive(ADAPTIVE_LEANS[0], firm, world, config);
    await orch.submitDecision(gameId, joined.teamId, {
      ...base,
      firm_id: joined.firmId,
      beliefs: { own_rank: 2 },
      reflection: `round ${r}: defend the niche, build brand`,
    });
    await orch.lockRound(gameId);
    const res = await orch.resolveRound(gameId);
    if (res.lifecycle === "published") await orch.advanceRound(gameId);
  }
  ok(`played ${N_ROUNDS} rounds (human + ${N_FIRMS - 1} bot-filled)`);

  const dash = await buildInstructorDashboard(store, gameId);

  // --- meta -----------------------------------------------------------------
  check(dash.meta.resolvedRounds === N_ROUNDS, `resolvedRounds === ${N_ROUNDS}`);
  check(dash.meta.lifecycle === "complete", "lifecycle complete after final round");
  check(typeof dash.meta.weights.financial === "number", "scorecard weights present");
  check(dash.teams.length === N_FIRMS, `${N_FIRMS} teams listed`);
  check(dash.teams.some((t) => t.joined) && dash.teams.some((t) => !t.joined), "joined + open slots both present");
  ok("meta + teams");

  // --- panel ----------------------------------------------------------------
  check(dash.panel.length === N_FIRMS * N_ROUNDS, `panel has ${N_FIRMS}×${N_ROUNDS} rows (got ${dash.panel.length})`);
  for (const p of dash.panel) {
    for (const k of ["financial", "market", "intangible", "stakeholder"] as const) {
      check(Number.isFinite(p.scoreNorm[k]) && Number.isFinite(p.scoreRaw[k]), `scorecard component ${k} finite`);
    }
    check(Number.isFinite(p.scoreCumulative), "cumulative score finite");
    check(Number.isFinite(p.share) && p.share >= 0, "share finite ≥ 0");
    check(p.rank >= 1 && p.rank <= N_FIRMS, "rank in range");
    check(Object.keys(p.segments).length > 0, "per-segment detail present");
  }
  // Ranks within a round are a permutation 1..N.
  for (let r = 0; r < N_ROUNDS; r++) {
    const ranks = dash.panel.filter((p) => p.round === r).map((p) => p.rank).sort((a, b) => a - b);
    check(JSON.stringify(ranks) === JSON.stringify(Array.from({ length: N_FIRMS }, (_, i) => i + 1)), `round ${r} ranks are 1..${N_FIRMS}`);
  }
  ok("panel: cardinality, finite scorecards, valid ranks, segment detail");

  // --- market ---------------------------------------------------------------
  check(dash.market.length === config.segments.length * N_ROUNDS, `market has segments×rounds rows (got ${dash.market.length})`);
  ok(`market: ${config.segments.length} segments × ${N_ROUNDS} rounds`);

  // --- events ---------------------------------------------------------------
  check(dash.events.length === N_ROUNDS, "one event bucket per resolved round");
  ok("events bucketed per round");

  // --- engagement (incl. beliefs + reflection from the human) ---------------
  check(dash.engagement.length === N_FIRMS * N_ROUNDS, `engagement has ${N_FIRMS}×${N_ROUNDS} rows (got ${dash.engagement.length})`);
  const human = dash.engagement.filter((e) => e.firmId === joined.firmId);
  check(human.length === N_ROUNDS, "human has an engagement row each round");
  check(human.every((e) => e.reflection.length > 0), "human reflections captured");
  check(human.every((e) => e.predictedRank === 2 && e.realizedRank != null), "predicted vs realized rank captured");
  check(human.every((e) => e.beliefScore != null && e.beliefScore >= 0 && e.beliefScore <= 1), "belief accuracy scored in [0,1]");
  ok("engagement: telemetry + beliefs + reflections");

  // --- CSV ------------------------------------------------------------------
  const csv = dashboardToCsv(dash);
  const lines = csv.split("\n");
  check(lines.length === N_FIRMS * N_ROUNDS + 1, `CSV has header + ${N_FIRMS}×${N_ROUNDS} rows (got ${lines.length - 1})`);
  check(lines[0].includes("score_cumulative") && lines[0].includes("reflection"), "CSV header has expected columns");
  for (const s of config.segments) check(lines[0].includes(`price_${s.id}`), `CSV has per-segment column price_${s.id}`);
  ok(`CSV export: ${lines.length - 1} data rows, ${lines[0].split(",").length} columns`);

  console.log("\nDashboard verified — panel / market / events / engagement / CSV all assemble from persisted history.");
}

main().catch((e) => {
  console.error("\nDASHBOARD SMOKE FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
