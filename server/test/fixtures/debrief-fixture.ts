/**
 * Debrief fixtures (DW-068 phase 2), built the DW-067 way: an in-memory orchestrator, a handful
 * of human firms making DELIBERATE moves, the rest bot-filled → the instructor dashboard payload
 * (= the JSON export). One game is scripted to trip every debrief rule at least once:
 * price cuts and raises against full and idle tanks, a tank build, quality left to fade, a firm
 * that borrows and burns its way to a forced exit, a planted water shock, wrong rank calls.
 */
import { ADAPTIVE_LEANS, decideAdaptive, type FirmDecision } from "drinkwars-engine";
import { loadConfig } from "drinkwars-engine/node";
import { GameOrchestrator, InMemoryAdapter } from "../../src/index.js";
import { buildInstructorDashboard, type InstructorDashboard } from "../../src/dashboard.js";

export const FIXTURE_ROUNDS = 7;
const PLAYERS = ["Hopworks", "Silver Tap", "Night Owl", "Burn Rate", "Élan & Sons"]; // + one NPC slot

export async function buildDebriefFixture(opts: { modules?: string[] } = {}): Promise<InstructorDashboard> {
  const modules = Object.fromEntries((opts.modules ?? ["laborMarket", "sustainability"]).map((id) => [id, { enabled: true }]));
  const config = loadConfig({ game: { n_firms: 6, n_rounds: FIXTURE_ROUNDS + 1 }, modules } as never);
  const store = new InMemoryAdapter();
  let now = 1_000_000;
  const orch = new GameOrchestrator(store, () => (now += 1000), { botFillEmptySlots: true });
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, teams: Array.from({ length: 6 }, (_, i) => ({ name: `Open slot ${i + 1}` })) });
  const seats: { teamId: string; firmId: string }[] = [];
  for (const [i, name] of PLAYERS.entries()) seats.push(await orch.joinGame(code, name, `user-${i}`, { teamName: name }));
  await orch.scheduleShock(gameId, { type_id: "water", round: 4, magnitude: 0.4, duration: 1 });

  const last: Record<string, FirmDecision> = {};
  for (let r = 0; r < FIXTURE_ROUNDS; r++) {
    const world = (await store.getLatestWorldState(gameId))!.state;
    for (const [i, s] of seats.entries()) {
      const firm = world.firms.find((f) => f.id === s.firmId)!;
      if (firm.status !== "active") continue;
      const prevD = last[s.firmId];
      const d: FirmDecision = { ...(prevD ?? decideAdaptive(ADAPTIVE_LEANS[i % ADAPTIVE_LEANS.length], firm, world, config)), firm_id: s.firmId,
        debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, hire_roles: [], fire_roles: [] };
      const price = { ...d.price };
      const scale = (m: number) => { for (const seg of Object.keys(price)) price[seg] *= m; };
      if (i === 0) { // Hopworks: raises price into full tanks, then builds tanks, later lets quality fade
        if (r === 1) scale(1.12);
        d.invest_cap = r === 2 ? 220_000 : d.invest_cap;
        d.invest_Q = r < 2 ? 30_000 : 0; d.invest_B = r < 2 ? 20_000 : 0;
        d.beliefs = { own_rank: 1 }; d.reflection = `round ${r + 1}: price up while the tanks are full, then build`;
      }
      if (i === 1) { // Silver Tap: cuts price while sold out, twice
        if (r === 1 || r === 3) scale(0.88);
        d.beliefs = { own_rank: 1 };
      }
      if (i === 2) { // Night Owl: premium — invests in quality + brand and charges for it
        if (r === 0) scale(1.25);
        d.invest_Q = 45_000; d.invest_B = 35_000; d.invest_T_emp = r < 3 ? 12_000 : 0;
        d.beliefs = { own_rank: 5 };
      }
      if (i === 3) { // Burn Rate: prices itself out, borrows, and pays it away → forced exit
        scale(prevD ? 1.02 : 1.9);
        d.debt_draw = 400_000; d.invest_B = 250_000; d.invest_cap = 200_000; d.dividend = r === 0 ? 150_000 : 0;
        d.beliefs = { own_rank: 2 };
      }
      if (i === 4) { // Élan & Sons: overbuilds tanks early, then idles them behind a high price
        d.invest_cap = r === 0 ? 300_000 : 0;
        if (r === 2) scale(1.3);
        d.invest_Q = 0; d.invest_B = 0;
      }
      d.price = Object.fromEntries(Object.entries(price).map(([seg, v]) => [seg, Math.round(v * 100) / 100]));
      last[s.firmId] = d;
      await orch.submitDecision(gameId, s.teamId, d);
    }
    await orch.lockRound(gameId);
    const res = await orch.resolveRound(gameId);
    if (res.lifecycle === "published") await orch.advanceRound(gameId);
  }
  // Through JSON, exactly as the browser and the export file receive it.
  return JSON.parse(JSON.stringify(await buildInstructorDashboard(store, gameId)));
}

/** A pre-DW-067 payload: no shopper demand (`q_desired`) and no pull breakdown per category. */
export function asPre067(d: InstructorDashboard): InstructorDashboard {
  const j = JSON.parse(JSON.stringify(d)) as InstructorDashboard;
  for (const p of j.panel) for (const s of Object.values(p.segments)) { delete s.q_desired; delete s.pull; }
  return j;
}
