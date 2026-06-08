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
      assert.ok(Math.abs(bs.assets - (bs.cash + bs.ppe)) < 1e-3, `assets = cash + ppe ${f.firm_id} r${f.round}`);
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

test("non-submission is zero-filled, not a crash", () => {
  const c = loadConfig();
  const world = initGame(c);
  // Submit no decisions at all — engine must treat every firm as zero-fill.
  const out = resolveRound(world, [], c);
  assert.equal(out.result.firm_results.length, c.game.n_firms);
  assert.ok(out.result.firm_results.every((f) => Number.isFinite(f.pnl.net_income)));
});
