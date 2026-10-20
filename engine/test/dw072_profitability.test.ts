/**
 * DW-072 #3 follow-up — invested capital ≤ 0 takes the profitability clamp's FLOOR whatever the
 * round's income was. The ±10 clamp alone left one hole: a wiped-out firm with a positive quarter
 * divided by EPS and scored +10, the best profitability in the room.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROFITABILITY_CLAMP, initGame, resolveConfig } from "../src/index.js";
import { scoreRound, type ScoreSnapshot } from "../src/engine/scoring.js";

const c = resolveConfig();
const firms = () => new Map(initGame(c).firms.map((f) => [f.id, f]));
const snap = (id: string, ni: number, ic: number): ScoreSnapshot => ({
  firm_id: id, net_income: ni, invested_capital: ic, coverage: 2, leverage: 1, cash: 200_000, shareSum: 0.3,
  Q: 20, B: 20, T_emp: 10, T_inv: 10, T_gov: 10,
});
const fb = c.scoring.financial_blend;
// Every snapshot above shares the same soundness and cash terms, so raw.financial isolates profitability.
const rest = fb.soundness * (Math.min(2 / c.scoring.healthy_coverage, 1.5) - Math.max(0, 1 / c.scoring.healthy_leverage - 1)) + fb.cash_resilience * Math.min(200_000 / c.scoring.cash_safety_threshold, 3);
const profitOf = (raw: number) => (raw - rest) / fb.profitability;
const HEALTHY = [snap("firm_2", 40_000, 800_000), snap("firm_3", -20_000, 600_000), snap("firm_4", 10_000, 500_000)];

test("a wiped-out firm with a POSITIVE quarter scores the floor, not the ceiling", () => {
  for (const ic of [-50_000, 0]) {
    const out = scoreRound([snap("firm_1", 25_000, ic), ...HEALTHY], c, firms(), 0);
    assert.ok(Math.abs(profitOf(out.get("firm_1")!.raw.financial) + PROFITABILITY_CLAMP) < 1e-9, `ic ${ic}: ${profitOf(out.get("firm_1")!.raw.financial)}`);
    // …and so ranks below every solvent rival on the financial pillar.
    for (const id of ["firm_2", "firm_3", "firm_4"]) assert.ok(out.get(id)!.norm.financial > out.get("firm_1")!.norm.financial, id);
  }
});

test("the firm 1 round (a LOSS on capital ≤ 0) is the same floor as before — bounded", () => {
  const out = scoreRound([snap("firm_1", -314_000, -50_000), ...HEALTHY], c, firms(), 0);
  assert.ok(Math.abs(profitOf(out.get("firm_1")!.raw.financial) + PROFITABILITY_CLAMP) < 1e-9);
  assert.ok(out.get("firm_2")!.norm.financial > out.get("firm_3")!.norm.financial, "rivals keep their order");
});

test("solvent firms are untouched, bit for bit: profitability is exactly net income / invested capital", () => {
  const out = scoreRound(HEALTHY, c, firms(), 0);
  for (const s of HEALTHY) {
    const expect = fb.profitability * (s.net_income / s.invested_capital) + fb.soundness * (Math.min(s.coverage / c.scoring.healthy_coverage, 1.5) - Math.max(0, s.leverage / c.scoring.healthy_leverage - 1)) + fb.cash_resilience * Math.min(s.cash / c.scoring.cash_safety_threshold, 3);
    assert.equal(out.get(s.firm_id)!.raw.financial, expect, s.firm_id);
  }
  // A thin but positive capital base still clamps at the ceiling (the floor rule is for ≤ 0 only).
  const thin = scoreRound([snap("firm_1", 50_000, 1_000), ...HEALTHY], c, firms(), 0);
  assert.ok(Math.abs(profitOf(thin.get("firm_1")!.raw.financial) - PROFITABILITY_CLAMP) < 1e-9);
});

test("a floored firm is left out of the comparison: the survivors score exactly as if it were not in the room", () => {
  const alone = scoreRound(HEALTHY, c, firms(), 0);
  for (const bust of [snap("firm_1", -314_000, -50_000), snap("firm_1", 25_000, 0), snap("firm_1", -3_000_000, 280_000)]) {
    const withBust = scoreRound([bust, ...HEALTHY], c, firms(), 0);
    // The other pillars are identical across these snapshots, so the financial norm isolates profitability.
    const shift = withBust.get("firm_2")!.norm.financial - alone.get("firm_2")!.norm.financial; // soundness/cash z move by a constant
    for (const s of HEALTHY) assert.ok(Math.abs(withBust.get(s.firm_id)!.norm.financial - alone.get(s.firm_id)!.norm.financial - shift) < 1e-9, s.firm_id);
    const spread = (o: typeof alone) => o.get("firm_2")!.norm.financial - o.get("firm_3")!.norm.financial;
    assert.ok(Math.abs(spread(withBust) - spread(alone)) < 1e-9, "the survivors' spread is not compressed");
    // The floored firm sits strictly at the bottom of the pillar.
    for (const s of HEALTHY) assert.ok(withBust.get("firm_1")!.norm.financial < withBust.get(s.firm_id)!.norm.financial);
  }
});

test("a room with no floored firm scores bit-for-bit as before", () => {
  const out = scoreRound(HEALTHY, c, firms(), 0);
  const mean = HEALTHY.reduce((a, s) => a + s.net_income / s.invested_capital, 0) / 3;
  const sd = Math.sqrt(HEALTHY.reduce((a, s) => a + (s.net_income / s.invested_capital - mean) ** 2, 0) / 3);
  for (const s of HEALTHY) assert.equal(out.get(s.firm_id)!.norm.financial, fb.profitability * ((s.net_income / s.invested_capital - mean) / sd) + 0 + 0);
});
