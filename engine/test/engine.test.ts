/**
 * Engine unit tests (node:test). Focused checks that complement the balance
 * harness: config validation, determinism, the finance invariants re-derived
 * from the results, stock-lag timing, and segment emergence.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, initGame, resolveRound, runGame, defaultConfig } from "../src/index.js";
import { loadConfig } from "../src/config/load.js";
import { advancePipeline, updateStock } from "../src/engine/stocks.js";
import { resolveArena } from "../src/engine/demand.js";
import { computeUnitCost } from "../src/engine/cost.js";
import { BASELINE_ASSIGNMENT, makeProvider } from "../harness/archetypes.js";

test("config loader: baseline validates", () => {
  const c = loadConfig();
  assert.equal(c.game.n_firms, defaultConfig.game.n_firms);
  assert.equal(c.segments.length, 3);
});

test("config loader: rejects weights that don't sum to 1", () => {
  assert.throws(
    () => loadConfig({ scoring: { weights: { financial: 0.5, market: 0.5, intangible: 0.5, stakeholder: 0.5 } } } as never),
    ConfigError,
  );
});

test("config loader: override merges over defaults (arrays replace)", () => {
  const c = loadConfig({ game: { n_rounds: 8 } } as never);
  assert.equal(c.game.n_rounds, 8);
  assert.equal(c.game.n_firms, defaultConfig.game.n_firms); // untouched
});

test("determinism: same (config, seed) → identical results", () => {
  const c = loadConfig();
  const a = runGame(c, makeProvider(BASELINE_ASSIGNMENT));
  const b = runGame(c, makeProvider(BASELINE_ASSIGNMENT));
  const sa = a.history.at(-1)!.firm_results.map((f) => f.scorecard_cumulative);
  const sb = b.history.at(-1)!.firm_results.map((f) => f.scorecard_cumulative);
  assert.deepEqual(sa, sb);
});

test("finance invariants hold for every firm-round (§7.2)", () => {
  const c = loadConfig();
  const { history } = runGame(c, makeProvider(BASELINE_ASSIGNMENT));
  for (const r of history) {
    for (const f of r.firm_results) {
      const bs = f.balance_sheet;
      assert.ok(Math.abs(bs.assets - (bs.debt + bs.equity)) < 1e-3, `balance sheet ${f.firm_id} r${f.round}`);
      assert.ok(Math.abs(bs.assets - (bs.cash + bs.ppe + bs.inventory)) < 1e-3, `assets = cash + ppe + inventory ${f.firm_id} r${f.round}`);
      assert.ok(Math.abs(bs.equity - (bs.paid_in + bs.retained)) < 1e-3, `equity = paid_in + retained ${f.firm_id} r${f.round}`);
    }
  }
});

test("stock lag: investment matures exactly `lag` rounds later", () => {
  // lag = 2: pushing X now returns 0 for two advances, then X.
  let p: number[] = [0, 0];
  let r = advancePipeline(p, 2, 100);
  assert.equal(r.matured, 0);
  p = r.pipeline;
  r = advancePipeline(p, 2, 0);
  assert.equal(r.matured, 0);
  p = r.pipeline;
  r = advancePipeline(p, 2, 0);
  assert.equal(r.matured, 100); // the original investment matures on the 2nd advance after
});

test("stock update: depreciation + concave conversion", () => {
  // S' = (1-0.1)*100 + 1.0*sqrt(400) = 90 + 20 = 110
  assert.equal(updateStock(100, 0.1, 400, "sqrt", 1.0), 110);
});

test("frontier segment emerges by the configured round", () => {
  const c = loadConfig();
  let world = initGame(c);
  let emerged = false;
  const provider = makeProvider(BASELINE_ASSIGNMENT);
  for (let i = 0; i < c.game.n_rounds; i++) {
    const out = resolveRound(world, provider(world, c), c);
    world = out.world;
    if (out.result.events.some((e) => e.startsWith("NEW CATEGORY"))) emerged = true;
  }
  assert.ok(emerged, "frontier should emerge within the game");
  assert.ok(world.segments.find((s) => s.id === "frontier")?.active);
});

test("demand: an absurdly-priced sole survivor does NOT absorb redistributed overflow", () => {
  // Regression for the redistribution bug: when cheap rivals sell out, the only
  // unconstrained firm used to hoover ALL the overflow even priced at $1000
  // (share≈0 / unconstrainedShareSum≈0 → ratio 1.0). It must now sell ~nothing.
  const c = loadConfig();
  const mk = (id: string, cap: number) => ({
    id, status: "active", cash: 1000, cap, ppe_book: 0, debt: 0, paid_in_capital: 500,
    retained_earnings: 500, Q: 10, B: 10, process: 10, T_emp: 10, T_inv: 10, T_gov: 10,
    unit_cost: 3, cum_output: 0, ni_history: [], rounds_below_health: 0, primary_segment: "mass",
    inventory_units: 0, inventory_value: 0, markets_entered: ["home"], reputation: 0,
    water_efficiency: 0, rnd_progress: 0, vertical_assets: [], key_hires: [], pr_spike: 0,
  }) as never;
  const firms = [mk("firm_1", 5000), ...Array.from({ length: 6 }, (_, i) => mk(`firm_${i + 2}`, 40))] as Array<{ id: string; cap: number }>;
  const capOf = (id: string) => firms.find((f) => f.id === id)!.cap;
  const dec = new Map<string, never>();
  const baseDec = (id: string, price: number) => ({
    firm_id: id, price: { mass: price }, presence: { mass: 1 }, run_rate: 1,
    invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0,
    invest_T_gov: 0, debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false,
    agreement_actions: [], exit_action: null, beliefs: {}, reflection: "",
  }) as never;
  dec.set("firm_1", baseDec("firm_1", 1000));
  for (let i = 2; i <= 7; i++) dec.set(`firm_${i}`, baseDec(`firm_${i}`, 6));
  const mod = {
    extraBrand: () => 0, segmentAlphaDelta: () => 0, segmentDemandMultiplier: () => 1,
    sellableSupply: (id: string) => capOf(id),
    segmentBetaDelta: () => ({ q: 0, p: 0, b: 0 }),
  } as never;
  const arena = { segments: [{ id: "mass", D: 2000, active: true }], betaMult: { p: 1, q: 1, b: 1 }, brandMult: 1, supplyOf: (id: string) => capOf(id) } as never;
  const res = resolveArena(firms as never, dec, c, arena, mod);
  const r1 = res.perFirm.get("firm_1")!.mass;
  assert.ok(r1.q_sold < 1, `firm priced at $1000 must sell ~0, sold ${r1.q_sold.toFixed(1)}`);
});

test("cost: premium recipe (higher Q) raises unit cost via the quality premium", () => {
  const c = loadConfig();
  const base = { cum_output: 0, process: 10, T_emp: 10, location_factor: 1 };
  const lowQ = computeUnitCost({ ...base, Q: 5 } as never, c, 0, 1).unitCost;
  const highQ = computeUnitCost({ ...base, Q: 80 } as never, c, 0, 1).unitCost;
  assert.ok(highQ > lowQ * 1.1, `high quality should cost more to brew (${highQ.toFixed(2)} vs ${lowQ.toFixed(2)})`);
});

test("non-submission is zero-filled, not a crash", () => {
  const c = loadConfig();
  const world = initGame(c);
  // Submit no decisions at all — engine must treat every firm as zero-fill.
  const out = resolveRound(world, [], c);
  assert.equal(out.result.firm_results.length, c.game.n_firms);
  assert.ok(out.result.firm_results.every((f) => Number.isFinite(f.pnl.net_income)));
});
