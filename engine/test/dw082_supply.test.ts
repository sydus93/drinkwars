/**
 * DW-082 (audit #2, finding 1): Supply & lanes says "leave blank for auto", but once any market had
 * an offer every market left out — Home included — was offered 0 units. One offer for a new market
 * zeroed Home's sales. Now a market left out shares what the offers leave, by presence; an empty
 * offer map is the plain presence split.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGame, resolveRound } from "../src/index.js";
import { loadConfig } from "../src/config/load.js";
import { modulesOverride } from "../src/config/modules.js";
import type { FirmDecision, SegmentId, WorldState } from "../src/types.js";

const c = loadConfig(modulesOverride(["geography"]));
function mk(firm_id: string, w: WorldState, over: Partial<FirmDecision> = {}): FirmDecision {
  const price: Record<SegmentId, number> = {};
  const presence: Record<SegmentId, number> = {};
  for (const s of w.segments) { price[s.id] = 8; presence[s.id] = s.id === "mass" ? 1 : 0; }
  return {
    firm_id, price, presence,
    invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
    debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null,
    ...over,
  };
}
/** firm_1's sales per market after one round with these levers (everyone else plain). */
function sold(over: Partial<FirmDecision>) {
  const w = initGame(c);
  const r = resolveRound(w, w.firms.map((f) => mk(f.id, w, f.id === "firm_1" ? over : {})), c);
  const fr = r.result.firm_results.find((f) => f.firm_id === "firm_1")!;
  return { home: fr.markets?.home?.q_sold ?? 0, coastal: fr.markets?.coastal?.q_sold ?? 0, fr };
}
const entered = { market_presence: { home: 1, coastal: 0.6 } };

test("an offer for one market leaves Home (blank) on auto — it still sells", () => {
  const s = sold({ ...entered, market_supply: { coastal: 2_000 } });
  assert.ok(s.home > 0, `Home sells on auto (${s.home}) — it was 0 before DW-082`);
  assert.ok(s.coastal > 0 && s.coastal <= 2_000 + 1e-6, `coastal sells at most its offer (${s.coastal})`);
  const bs = s.fr.balance_sheet;
  assert.ok(Math.abs(bs.assets - (bs.debt + bs.equity)) < 1e-3, "balance sheet balances");
});

test("an empty offer map is the plain presence split", () => {
  const none = sold(entered), empty = sold({ ...entered, market_supply: {} });
  assert.deepEqual([empty.home, empty.coastal], [none.home, none.coastal]);
});

test("offers that take everything leave nothing for auto; an offer of 0 ships nothing", () => {
  const all = sold({ ...entered, market_supply: { coastal: 10_000_000 } });
  assert.equal(all.home, 0, "the coastal offer exceeds sellable, so Home's auto share is empty");
  const zero = sold({ ...entered, market_supply: { coastal: 0 } });
  assert.equal(zero.coastal, 0, "an explicit 0 offer is no supply there");
  assert.ok(zero.home > 0, "…and Home takes the rest");
});

test("every market offered explicitly behaves as before (the old two-market test)", () => {
  const heavy = sold({ market_supply: { home: 30, coastal: 400 } }), light = sold({ market_supply: { home: 400, coastal: 30 } });
  assert.ok(heavy.coastal > light.coastal);
});

// DW-082d: Supply & lanes said "ships 21,600" out of Home when 19,372 went — brewed − sold also counted
// the beer the new market was sent but didn't sell. Each market now records what it was sent to sell.
test("each market records what it was sent: offers exactly, the rest by presence; sold never exceeds it", () => {
  const s = sold({ ...entered, market_supply: { coastal: 2_000 } });
  const m = s.fr.markets!;
  assert.ok(Math.abs((m.coastal.supplied ?? -1) - 2_000) < 1e-6, `coastal was sent its offer (${m.coastal.supplied})`);
  for (const id of ["home", "coastal"]) assert.ok(m[id].q_sold <= (m[id].supplied ?? 0) + 1e-6, `${id} sold ${m[id].q_sold} of ${m[id].supplied} sent`);
  const plain = sold(entered).fr.markets!;
  const sent = (plain.home.supplied ?? 0) + (plain.coastal.supplied ?? 0);
  assert.ok(Math.abs((plain.coastal.supplied ?? 0) / sent - 0.6 / 1.6) < 1e-9, "on auto, coastal is sent its presence share (0.6 of 1.6)");
});
