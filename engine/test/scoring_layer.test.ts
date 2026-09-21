/**
 * Scoring-layer acceptance gates (06_scoring_layer_spec §11).
 *   1. Regression — all new config at defaults reproduces pre-layer output exactly.
 *   2. Bridge closure — Σ bridge bars = headline delta, per firm-round, no residual.
 *   3. Liquidation gate — with terminal_weight > 0, a scripted final-round
 *      liquidator must not out-score a steady operator.
 *   4. Penalty ordering — raw-space-then-normalize ≠ normalize-then-penalize, and
 *      the penalized firm ranks strictly lower.
 *   6. Band independence — mutating benchmark_bands changes nothing.
 * (§5 archetype stability is Tier C — prototypes are not built yet.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config/load.js";
import { ConfigError } from "../src/config/schema.js";
import { initGame, resolveRound } from "../src/index.js";
import { scoreRound, type ScoreSnapshot } from "../src/engine/scoring.js";
import { bandIsMeaningful, bandsForRound, type Config, type FirmDecision, type RoundResult, type SegmentId, type WorldState } from "../src/types.js";

// A plain, deterministic decision for every active firm: mid price, even presence,
// modest investment — enough to trade every round without any module surface.
function plainDecisions(world: WorldState, c: Config, tweak?: (d: FirmDecision, round: number) => void): FirmDecision[] {
  return world.firms.filter((f) => f.status === "active").map((f) => {
    const price: Record<SegmentId, number> = {};
    const presence: Record<SegmentId, number> = {};
    for (const s of world.segments) {
      price[s.id] = s.active ? 8 : 0;
      presence[s.id] = s.active ? 1 / world.segments.filter((x) => x.active).length : 0;
    }
    const d: FirmDecision = {
      firm_id: f.id, price, presence, run_rate: 0.8,
      invest_cap: 8_000, invest_process: 6_000, invest_Q: 10_000, invest_B: 10_000,
      invest_T_emp: 4_000, invest_T_inv: 4_000, invest_T_gov: 4_000,
      debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0,
      buy_info: false, agreement_actions: [], exit_action: null,
    };
    tweak?.(d, world.round);
    return d;
  });
}

function playGame(c: Config, tweak?: (d: FirmDecision, round: number) => void): RoundResult[] {
  let world = initGame(c);
  const out: RoundResult[] = [];
  for (let r = 0; r < c.game.n_rounds; r++) {
    const res = resolveRound(world, plainDecisions(world, c, tweak), c);
    out.push(res.result);
    world = res.world;
  }
  return out;
}

const SHORT = { game: { n_rounds: 8, n_firms: 4 } } as const;

test("gate 1 — defaults are a byte-identical no-op (and legacy configs still load)", () => {
  // Explicit no-op scoring layer vs the plain defaults: identical trajectories.
  const a = playGame(loadConfig(SHORT));
  const b = playGame(loadConfig({ ...SHORT, scoring: { accumulation_window: { drop_first: 0, tail_only: null }, terminal_weight: 0, penalties: [], benchmark_bands: {} } } as never));
  assert.deepEqual(
    a.map((rr) => rr.firm_results.map((f) => f.scorecard_cumulative)),
    b.map((rr) => rr.firm_results.map((f) => f.scorecard_cumulative)),
    "no-op scoring-layer config must not move any score",
  );
  // Every round at defaults is scored.
  assert.ok(a.every((rr) => rr.firm_results.every((f) => f.scored === true)));
});

test("gate 2 — bridge bars sum to the headline delta with zero residual", () => {
  for (const cfg of [
    loadConfig(SHORT),
    loadConfig({ ...SHORT, scoring: { accumulation_window: { drop_first: 2 } } } as never),
    loadConfig({ ...SHORT, scoring: { terminal_weight: 0.2, accumulation: "auc" } } as never),
  ]) {
    const rounds = playGame(cfg);
    const prev = new Map<string, number>();
    for (const rr of rounds) {
      for (const f of rr.firm_results) {
        const b = f.scorecard_bridge!;
        const sum = b.financial + b.market + b.intangible + b.stakeholder + b.terminal;
        const delta = f.scorecard_cumulative - (prev.get(f.firm_id) ?? 0);
        assert.ok(Math.abs(sum - delta) < 1e-9, `bridge residual ${Math.abs(sum - delta)} at r${rr.round} for ${f.firm_id}`);
        prev.set(f.firm_id, f.scorecard_cumulative);
      }
    }
  }
});

test("§2 accumulation window — excluded rounds publish but do not score; loader enforces exclusivity", () => {
  const c = loadConfig({ ...SHORT, scoring: { accumulation_window: { drop_first: 3 } } } as never);
  const rounds = playGame(c);
  for (const rr of rounds) {
    for (const f of rr.firm_results) {
      assert.equal(f.scored, rr.round >= 3, `round ${rr.round} scored flag`);
      if (rr.round < 3) {
        // Unscored rounds still publish a normalized read but hold the headline at 0.
        assert.equal(f.scorecard_cumulative, 0);
        assert.ok(f.scorecard_norm != null);
      }
    }
  }
  // tail_only mirror-image.
  const t = loadConfig({ ...SHORT, scoring: { accumulation_window: { tail_only: 2 } } } as never);
  const tail = playGame(t);
  for (const rr of tail) for (const f of rr.firm_results) assert.equal(f.scored, rr.round >= 8 - 2);
  // Mutually exclusive; and drop_first must leave a scored round.
  assert.throws(() => loadConfig({ ...SHORT, scoring: { accumulation_window: { drop_first: 2, tail_only: 2 } } } as never), ConfigError);
  assert.throws(() => loadConfig({ ...SHORT, scoring: { accumulation_window: { drop_first: 8 } } } as never), ConfigError);
  assert.throws(() => loadConfig({ ...SHORT, scoring: { terminal_weight: 0.6 } } as never), ConfigError);
});

test("gate 3 — terminal weight does not let a final-round liquidator beat its steady twin", () => {
  const c = loadConfig({ ...SHORT, scoring: { terminal_weight: 0.25 } } as never);
  // firm_1 is the liquidator: normal play until the last round, then it guts the
  // future — zero investment, max dividend, price gouge.
  const rounds = playGame(c, (d, round) => {
    if (d.firm_id === "firm_1" && round === c.game.n_rounds - 1) {
      d.invest_cap = 0; d.invest_process = 0; d.invest_Q = 0; d.invest_B = 0;
      d.invest_T_emp = 0; d.invest_T_inv = 0; d.invest_T_gov = 0;
      d.dividend = 10_000_000; // clamped to the allowed fraction of cash
      for (const s of Object.keys(d.price)) d.price[s as SegmentId] = d.price[s as SegmentId] > 0 ? 30 : 0;
    }
  });
  const last = rounds[rounds.length - 1];
  const liq = last.firm_results.find((f) => f.firm_id === "firm_1")!;
  const steady = last.firm_results.filter((f) => f.firm_id !== "firm_1");
  // The liquidator must not take first place on the strength of the terminal round.
  assert.ok(steady.some((f) => f.scorecard_cumulative >= liq.scorecard_cumulative), "a steady operator should outrank the liquidator");
});

test("gate 4 — penalties bite in raw space, before normalization, and reorder the component", () => {
  const c = loadConfig({
    ...SHORT,
    scoring: {
      penalties: [
        { id: "excess_inventory", component: "financial", submetric: "cash_resilience", form: "linear_ratio", numerator: "ending_inventory", denominator: "production", max_bite: 0.4, enabled: true },
      ],
    },
  } as never);
  const mkSnap = (id: string, metrics: Record<string, number>): ScoreSnapshot => ({
    firm_id: id, net_income: 50, invested_capital: 1000, coverage: 3, leverage: 0.5,
    cash: 240_000, shareSum: 0.3, Q: 20, B: 20, T_emp: 10, T_inv: 10, T_gov: 10, metrics,
  });
  const firms = new Map(); // no accumulators — norm output only
  // Identical firms except firm_b sits on a full quarter of unsold stock.
  const clean = scoreRound([mkSnap("firm_a", { ending_inventory: 0, production: 100 }), mkSnap("firm_b", { ending_inventory: 0, production: 100 })], c, firms, 0);
  const dirty = scoreRound([mkSnap("firm_a", { ending_inventory: 0, production: 100 }), mkSnap("firm_b", { ending_inventory: 80, production: 100 })], c, firms, 0);
  assert.equal(clean.get("firm_b")!.penalties.excess_inventory, 1, "clean firm takes no bite");
  assert.equal(dirty.get("firm_b")!.penalties.excess_inventory, 1 - 0.4, "80% excess clamps at max_bite 0.4");
  // Identical inputs normalize to 0-0; the penalty must break the tie downward.
  assert.ok(clean.get("firm_b")!.norm.financial === clean.get("firm_a")!.norm.financial);
  assert.ok(dirty.get("firm_b")!.norm.financial < dirty.get("firm_a")!.norm.financial, "penalized firm ranks strictly lower");
  // Ordering discipline: applying the same multiplier AFTER normalization would
  // scale a z-score of 0 to 0 and change nothing — raw-space application must not
  // equal that. (This is the regression that catches a silent ordering swap.)
  const postNorm = clean.get("firm_b")!.norm.financial * (1 - 0.4);
  assert.notEqual(dirty.get("firm_b")!.norm.financial, postNorm, "raw-space penalty must differ from post-normalization scaling");
});

test("gate 6 — benchmark bands are display-only: mutating them changes nothing", () => {
  const a = playGame(loadConfig(SHORT));
  const b = playGame(loadConfig({ ...SHORT, scoring: { benchmark_bands: { roic: { weak: 0.04, sound: 0.1, strong: 0.18 }, segment_share: { weak: 0.08, sound: 0.15, strong: 0.25 } } } } as never));
  assert.deepEqual(
    a.map((rr) => rr.firm_results.map((f) => [f.scorecard_cumulative, f.scorecard_norm, f.valuation])),
    b.map((rr) => rr.firm_results.map((f) => [f.scorecard_cumulative, f.scorecard_norm, f.valuation])),
    "bands must never enter the score",
  );
});

// ── 7. Round-indexed benchmark bands (DW-057) ────────────────────────────────

test("bands resolve by round, merge over the flat map, and stay display-only", () => {
  const c = loadConfig();
  const sched = c.scoring.benchmark_bands_by_round;
  assert.ok(sched && sched.length > 0, "shipped config carries a band schedule");

  // The bucket boundaries are the contract the UI relies on: the LAST entry at or below the
  // round wins, never the first match.
  const r0 = bandsForRound(c.scoring, 0);
  const r3 = bandsForRound(c.scoring, 3);
  const r15 = bandsForRound(c.scoring, 15);
  assert.ok(r3.stakeholder_mean.sound > r0.stakeholder_mean.sound, "standing bar rises off round 0");
  assert.ok(r15.stakeholder_mean.sound > r3.stakeholder_mean.sound, "and keeps rising into a full season");
  assert.ok(r15.intangible_index.strong > r3.intangible_index.strong, "so does preparedness");

  // A metric left out of the schedule keeps its flat band at every round — interest_cover's
  // textbook 1.5/3/6 must survive, since its empirical cut is saturation noise.
  for (const round of [0, 1, 5, 9, 15]) {
    assert.deepEqual(
      bandsForRound(c.scoring, round).interest_cover,
      c.scoring.benchmark_bands!.interest_cover,
      `interest_cover stays textbook at round ${round}`,
    );
  }

  // Every shipped band is ordered. An inverted one would tier a firm below `weak` as "strong".
  for (const [i, entry] of sched!.entries()) {
    for (const [k, b] of Object.entries(entry.bands)) {
      assert.ok(b.weak <= b.sound && b.sound <= b.strong, `schedule[${i}].${k} ordered (${b.weak}/${b.sound}/${b.strong})`);
    }
  }

  // The founding quarter grades nothing: every firm starts identical and its one quarter of
  // investment has not landed, so the field carries only a handful of distinct values and any
  // absolute tier would be invented. The relative reading still works there.
  for (const k of ["roic", "segment_share", "intangible_index", "stakeholder_mean"]) {
    assert.equal(bandIsMeaningful(r0[k]), false, `${k} must not be graded in the founding quarter`);
  }
  // …and every one of them is gradable again as soon as the season is actually running.
  for (const k of ["roic", "segment_share", "intangible_index", "stakeholder_mean"]) {
    assert.equal(bandIsMeaningful(r3[k]), true, `${k} must be gradable by round 3`);
    assert.equal(bandIsMeaningful(r15[k]), true, `${k} must be gradable in a full season`);
  }

  // Gate §8.6 extends to the schedule: rewriting it must not move a single score.
  const a = playGame(loadConfig(SHORT));
  const b = playGame(loadConfig({ ...SHORT, scoring: { benchmark_bands_by_round: [{ from_round: 0, bands: { roic: { weak: -9, sound: 0, strong: 9 } } }] } } as never));
  assert.deepEqual(
    a.map((rr) => rr.firm_results.map((f) => [f.scorecard_cumulative, f.scorecard_norm, f.valuation])),
    b.map((rr) => rr.firm_results.map((f) => [f.scorecard_cumulative, f.scorecard_norm, f.valuation])),
    "the band schedule must never enter the score either",
  );
});
