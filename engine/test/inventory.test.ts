/**
 * Carried-inventory tests: the weighted-average accounting math, the §7.2 finance
 * invariants holding with stock on the balance sheet, unit conservation, the
 * run-rate clamp, and disabled-config parity (the legacy WC=0 path is untouched).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGame, resolveRound, runGame } from "../src/index.js";
import { computeInventory } from "../src/engine/inventory.js";
import { loadConfig } from "../src/config/load.js";
import type { FirmDecision, SegmentId } from "../src/types.js";
import { BASELINE_ASSIGNMENT, makeProvider } from "../harness/archetypes.js";

const withInventory = () => loadConfig({ modules: { inventory: { enabled: true } } } as never);

test("computeInventory: weighted-average cost, conservation, turnover", () => {
  // begin 0 units, brew 100 @ $5, sell 60, spoil 10% of the post-sale stock.
  const f = computeInventory(0, 0, 100, 5, 60, 0.1);
  assert.equal(f.produced, 100);
  assert.equal(f.sold, 60);
  assert.ok(Math.abs(f.avg_cost - 5) < 1e-9, "avg cost = production cost when stock starts empty");
  assert.ok(Math.abs(f.cogs - 300) < 1e-9, "COGS = sold × avg");
  // post-sale stock 40 → spoil 4 → end 36.
  assert.ok(Math.abs(f.spoiled - 4) < 1e-9);
  assert.ok(Math.abs(f.end - 36) < 1e-9);
  // unit conservation: end = begin + produced − sold − spoiled.
  assert.ok(Math.abs(f.end - (f.begin + f.produced - f.sold - f.spoiled)) < 1e-9);
  // value identity: carried value = end units × avg cost.
  assert.ok(Math.abs(f.value_end - f.end * f.avg_cost) < 1e-9);
  // turnover = sold ÷ average-on-hand ((0+100)/2 = 50) = 1.2.
  assert.ok(Math.abs(f.turnover - 1.2) < 1e-9);
});

test("computeInventory: blends cost basis across rounds (carried + new brew)", () => {
  // 50 units carried @ $4 ($200), brew 50 more @ $6 ($300) → avg ($500/100) = $5.
  const f = computeInventory(50, 200, 50, 6, 0, 0);
  assert.ok(Math.abs(f.avg_cost - 5) < 1e-9);
  assert.ok(Math.abs(f.value_end - 500) < 1e-9, "nothing sold/spoiled ⇒ value = pooled cost");
  assert.equal(f.end, 100);
});

test("inventory on: §7.2 invariants hold + stock is actually carried", () => {
  const c = withInventory();
  const { history } = runGame(c, makeProvider(BASELINE_ASSIGNMENT));
  let everCarried = false;
  let everSpoiled = false;
  for (const r of history) {
    for (const f of r.firm_results) {
      const bs = f.balance_sheet;
      // Balance sheet balances WITH the inventory line, and assets = cash+ppe+inventory.
      assert.ok(Math.abs(bs.assets - (bs.debt + bs.equity)) < 1e-3, `balance ${f.firm_id} r${f.round}`);
      assert.ok(Math.abs(bs.assets - (bs.cash + bs.ppe + bs.inventory)) < 1e-3, `assets=cash+ppe+inv ${f.firm_id} r${f.round}`);
      assert.ok(bs.inventory >= -1e-9, "inventory value never negative");
      if (f.inventory) {
        // unit conservation each round.
        const inv = f.inventory;
        assert.ok(Math.abs(inv.end - (inv.begin + inv.produced - inv.sold - inv.spoiled)) < 1e-6, `conservation ${f.firm_id} r${f.round}`);
        if (inv.end > 1e-6) everCarried = true;
        if (inv.spoiled > 1e-6) everSpoiled = true;
      }
    }
  }
  assert.ok(everCarried, "inventory mode should actually carry stock at some point");
  assert.ok(everSpoiled, "spoilage should bite at some point");
});

test("disabled-config parity: results identical to legacy, no inventory on the books", () => {
  const disabled = loadConfig(); // default ⇒ inventory off
  const a = runGame(disabled, makeProvider(BASELINE_ASSIGNMENT));
  const b = runGame(loadConfig({ modules: { inventory: { enabled: false } } } as never), makeProvider(BASELINE_ASSIGNMENT));
  const sa = a.history.at(-1)!.firm_results.map((f) => f.scorecard_cumulative);
  const sb = b.history.at(-1)!.firm_results.map((f) => f.scorecard_cumulative);
  assert.deepEqual(sa, sb, "explicit-off and default-off must be identical");
  for (const r of a.history) {
    for (const f of r.firm_results) {
      assert.equal(f.balance_sheet.inventory, 0, "no inventory asset when disabled");
      assert.equal(f.pnl.spoilage, 0, "no spoilage when disabled");
      assert.equal(f.inventory, null, "no inventory flow record when disabled");
    }
  }
});

test("run_rate clamps to [0, max_run_rate] (no surge above capacity)", () => {
  const c = withInventory();
  const world = initGame(c);
  const cap = world.firms[0].cap;
  const segs = world.segments.map((s) => s.id);
  const mk = (firm_id: string, run_rate: number): FirmDecision => {
    const price: Record<SegmentId, number> = {};
    const presence: Record<SegmentId, number> = {};
    for (const s of segs) { price[s] = 8; presence[s] = s === "mass" ? 1 : 0; }
    return {
      firm_id, price, presence, run_rate,
      invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
      debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null,
    };
  };
  const { result } = resolveRound(world, [mk("firm_1", 5), mk("firm_2", -3)], c);
  const f1 = result.firm_results.find((f) => f.firm_id === "firm_1")!;
  const f2 = result.firm_results.find((f) => f.firm_id === "firm_2")!;
  // Capacity depreciates in step 4 (no cap investment), so full-run = (1−δ)·cap.
  const fullRun = (1 - c.capacity.depreciation) * cap;
  // run_rate 5 ⇒ clamped to max_run_rate (1.0) ⇒ produced = full effective capacity, never above it.
  assert.ok(Math.abs((f1.inventory?.produced ?? 0) - fullRun) < 1e-6, `over-run clamped to capacity (got ${f1.inventory?.produced}, expected ${fullRun})`);
  assert.ok((f1.inventory?.produced ?? 0) <= cap + 1e-9, "no surge above starting capacity");
  // run_rate −3 ⇒ clamped to 0 ⇒ no production.
  assert.equal(f2.inventory?.produced ?? -1, 0);
});
