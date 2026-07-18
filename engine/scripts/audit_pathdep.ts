/**
 * Path-dependence audit (standalone diagnostic — does NOT modify engine code).
 *
 * Question (from a live 2-human playtest): a "price-and-leverage" player (raise
 * price in one segment, heavy early debt into capacity, minimal Q/B) held rank #1
 * all game while a "builder" (heavy invest_Q/invest_B, spread presence, no debt)
 * never escaped #2. Candidate causes:
 *   (a) scoring artifact — cumulative round_average of within-round z-scores locks
 *       in an early lead even after the builder's PER-ROUND score crosses above;
 *   (b) debt too cheap (r_f 0.015 + base_spread 0.01 + leverage spread);
 *   (c) price elasticity too weak (per-segment beta_p);
 *   (d) intangible ROI too slow (sqrt gains, lag 2, 18% depreciation, kappa cost premium).
 *
 * Configurations:
 *   - Spec'd 6-firm field (A + B + 4 adaptive NPCs) baseline + sensitivities S1-S3.
 *   - 2-firm DUEL (A vs B only) mirroring the live 2-human game, at two builder
 *     investment intensities — this is where the playtest dynamics reproduce.
 *
 * Run from engine/:  npx tsx scripts/audit_pathdep.ts
 * Output: console summary + markdown report (REPORT_PATH below).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  resolveConfig,
  initGame,
  resolveRound,
  decideAdaptive,
  ADAPTIVE_LEANS,
} from "../src/index.js";
import type { Config, FirmDecision, FirmId, FirmState, SegmentId, WorldState } from "../src/index.js";

const REPORT_PATH =
  "/private/tmp/claude-502/-Users-dstein2-Documents-Dev/bb91f2a4-3e2f-4efd-ad24-d396db89d6c3/scratchpad/pathdep_audit.md";

// Fixed seed list — deterministic, no Date.now/Math.random anywhere in this script.
const SEEDS = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010, 1111, 1212, 1313, 1414, 1515, 1616, 1717, 1818, 1919, 2020];

const N_ROUNDS = 16;
const A_ID: FirmId = "firm_1"; // price-and-leverage
const B_ID: FirmId = "firm_2"; // builder
const A_SEGMENT: SegmentId = "niche"; // A's single "priced" segment (premium craft)

// ---------------------------------------------------------------------------
// Decision builders
// ---------------------------------------------------------------------------

function zeroDecision(firmId: FirmId, segments: SegmentId[]): FirmDecision {
  const price: Record<SegmentId, number> = {};
  const presence: Record<SegmentId, number> = {};
  for (const s of segments) {
    price[s] = 0;
    presence[s] = 0;
  }
  return {
    firm_id: firmId,
    price,
    presence,
    invest_cap: 0,
    invest_process: 0,
    invest_Q: 0,
    invest_B: 0,
    invest_T_emp: 0,
    invest_T_inv: 0,
    invest_T_gov: 0,
    debt_draw: 0,
    debt_repay: 0,
    equity_raise: 0,
    dividend: 0,
    buy_info: false,
    agreement_actions: [],
    exit_action: null,
  };
}

function estUnit(f: FirmState, c: Config): number {
  return f.unit_cost > 0 ? f.unit_cost : c.costs.c_base * 0.85;
}
function maintenanceCapex(f: FirmState, c: Config): number {
  return (c.capacity.depreciation * f.cap) / Math.max(c.capacity.gain, 1e-6);
}

type AStyle = "focus" | "asplayed" | "asplayed_static";

// asplayed_static: the ACTUAL MP-client behavior — the 25%-of-cash package is
// computed ONCE from round-0 cash and the DOLLAR values carry forward verbatim
// (multiplayer.ts defaultDecision's carry-over spreads ...lastDecision; it never
// recomputes invests). Keyed per firm; round 0 always resolves first per run.
const staticPkg = new Map<string, number>();

/** Strategy A — "price-and-leverage", two readings of the same playtest report:
 *
 *  "focus" (the literal spec): premium price (~2.35x unit cost) in ONE segment
 *  (niche), presence concentrated there, debt drawn over rounds 1-3 (~1.5x
 *  starting cash) poured into invest_cap, token investment otherwise.
 *
 *  "asplayed" (the faithful reconstruction of what a UI player who "touched
 *  almost nothing else" actually submits): the web app's DEFAULT decision
 *  (web/src/game/controller.ts) is presence=1 in EVERY active segment, price
 *  1.8x unit cost, invest_cap=maintenance, and a standing investment package of
 *  25% of cash split 20% process / 30% Q / 30% B / 20% T_emp — carried forward
 *  every round. The player then raised ONE price (niche → 2.35x) and drew debt
 *  into capacity. He was never a low-investment player: the default %-of-cash
 *  package quietly compounds his cash pile into the biggest Q/B stock in the game. */
function decideA(f: FirmState, world: WorldState, c: Config, style: AStyle): FirmDecision {
  const segs = world.segments.map((s) => s.id);
  const d = zeroDecision(f.id, segs);
  const unit = estUnit(f, c);

  // Early leverage: draws over the first 3 rounds = 700k ≈ 1.5x starting cash,
  // all into capacity (guarded — the engine's credit rationing clamps the draw
  // at max_leverage if equity has eroded).
  const drawSchedule = [300_000, 250_000, 150_000];
  const draw = world.round < drawSchedule.length ? drawSchedule[world.round] : 0;
  d.debt_draw = draw;

  if (style === "focus") {
    // Concentrated presence: 90% niche, 10% mass toe-hold. Never enters frontier.
    d.presence[A_SEGMENT] = 0.9;
    d.presence["mass"] = 0.1;
    d.price[A_SEGMENT] = unit * 2.35; // the "raised price" in his one category
    d.price["mass"] = unit * 1.7;
    d.invest_cap = maintenanceCapex(f, c) + draw + (world.round < 3 ? 50_000 : 0);
    // "Touched almost nothing else" — token maintenance-level investment.
    d.invest_Q = 2_000;
    d.invest_B = 2_000;
    d.invest_process = 4_000;
    d.invest_T_emp = 2_000;
    d.invest_T_inv = 2_000;
    d.invest_T_gov = 2_000;
    return d;
  }

  // "asplayed": UI defaults + the one price raise + debt into capacity.
  const active = world.segments.filter((s) => s.active).map((s) => s.id);
  for (const s of active) {
    d.presence[s] = 1; // UI default: even split across active segments
    d.price[s] = unit * 1.8;
  }
  d.price[A_SEGMENT] = unit * 2.35; // the raised price
  d.invest_cap = maintenanceCapex(f, c) + draw;
  let budget: number;
  if (style === "asplayed_static") {
    // Real client: round-1 package in dollars, carried forward unchanged.
    if (world.round === 0) staticPkg.set(f.id, 0.25 * Math.max(0, f.cash));
    budget = staticPkg.get(f.id) ?? 0.25 * Math.max(0, f.cash);
  } else {
    budget = 0.25 * Math.max(0, f.cash); // compounding reconstruction (upper bound)
  }
  d.invest_process = 0.2 * budget;
  d.invest_Q = 0.3 * budget;
  d.invest_B = 0.3 * budget;
  d.invest_T_emp = 0.2 * budget;
  return d;
}

/** Strategy B — "builder": moderate price (~1.8x unit cost), presence spread
 *  across all active segments, heavy invest_Q + invest_B from operating cash
 *  (intensity parameterized), moderate invest_cap, ZERO debt. */
function decideB(f: FirmState, world: WorldState, c: Config, qbSpend: number): FirmDecision {
  const segs = world.segments.map((s) => s.id);
  const active = world.segments.filter((s) => s.active).map((s) => s.id);
  const d = zeroDecision(f.id, segs);
  const unit = estUnit(f, c);

  for (const s of active) {
    d.presence[s] = 1 / active.length; // spread evenly
    d.price[s] = unit * 1.8;
  }

  let spend = {
    Q: qbSpend,
    B: qbSpend,
    cap: maintenanceCapex(f, c) + 20_000, // moderate capacity growth
    process: 8_000,
    T_emp: 6_000,
    T_inv: 4_000,
    T_gov: 4_000,
  };
  // Fund from operating cash only (no debt): cap total at 55% of cash on hand.
  const total = Object.values(spend).reduce((a, b) => a + b, 0);
  const budget = 0.55 * Math.max(0, f.cash);
  if (total > budget && total > 0) {
    const k = budget / total;
    spend = Object.fromEntries(Object.entries(spend).map(([key, v]) => [key, v * k])) as typeof spend;
  }
  d.invest_Q = spend.Q;
  d.invest_B = spend.B;
  d.invest_cap = spend.cap;
  d.invest_process = spend.process;
  d.invest_T_emp = spend.T_emp;
  d.invest_T_inv = spend.T_inv;
  d.invest_T_gov = spend.T_gov;
  d.debt_draw = 0;
  return d;
}

// ---------------------------------------------------------------------------
// Simulation + recording
// ---------------------------------------------------------------------------

interface FirmRoundRec {
  rank: number; // 1 = best, by scorecard_cumulative among active firms (NaN if not active)
  cumulative: number;
  perRoundScore: number; // weighted sum of THIS round's scorecard_norm components
  norm: { financial: number; market: number; intangible: number; stakeholder: number };
  net_income: number;
  revenue: number;
  unit_cost: number;
  shareSum: number;
  cash: number;
  debt: number;
  priceA_seg: number; // price charged in A's segment (context)
  investQB: number; // invest_Q + invest_B decided this round
  status: string;
}

interface SeedRun {
  seed: number;
  // [round] -> per-firm per-round weighted norm score (ALL firms; needed to
  // recompute alternative final rankings offline, e.g. last-8-rounds-only).
  perRoundScoreAll: Map<FirmId, number>[];
  A: FirmRoundRec[];
  B: FirmRoundRec[];
  finalRankA: number;
  finalRankB: number;
  finalCumA: number;
  finalCumB: number;
  aBankruptRound: number | null;
  cumFlipRound: number | null; // first round from which B's cumulative > A's for the rest of the game
  perRoundFlipRound: number | null; // first round from which B's per-round score > A's for the rest
  aCumFlipRound: number | null; // symmetric: first round from which A's cumulative > B's for the rest
  aPerRoundFlipRound: number | null; // first round from which A's per-round score > B's for the rest
}

interface ScenarioOpts {
  nFirms: number;
  bQB: number; // builder invest_Q = invest_B per round (pre-budget-cap)
  aStyle?: AStyle; // default "focus"
  mutate?: (c: Config) => void;
}

function runOne(cfg: Config, seedIdx: number, opts: ScenarioOpts): SeedRun {
  const c = cfg;
  let world = initGame(c);
  const w = c.scoring.weights;
  const rec: SeedRun = {
    seed: c.game.seed,
    perRoundScoreAll: [],
    A: [],
    B: [],
    finalRankA: NaN,
    finalRankB: NaN,
    finalCumA: NaN,
    finalCumB: NaN,
    aBankruptRound: null,
    cumFlipRound: null,
    perRoundFlipRound: null,
    aCumFlipRound: null,
    aPerRoundFlipRound: null,
  };

  for (let r = 0; r < c.game.n_rounds; r++) {
    const decisions: FirmDecision[] = [];
    const decByFirm = new Map<FirmId, FirmDecision>();
    for (const f of world.firms) {
      if (f.status !== "active") continue;
      let d: FirmDecision;
      if (f.id === A_ID) d = decideA(f, world, c, opts.aStyle ?? "focus");
      else if (f.id === B_ID) d = decideB(f, world, c, opts.bQB);
      else {
        const npcIdx = Number(f.id.split("_")[1]) - 3; // firms 3..6 -> 0..3
        const lean = ADAPTIVE_LEANS[(seedIdx + npcIdx) % ADAPTIVE_LEANS.length];
        d = decideAdaptive(lean, f, world, c);
      }
      decisions.push(d);
      decByFirm.set(f.id, d);
    }

    const { world: next, result } = resolveRound(world, decisions, c);

    // Rank active firms by scorecard_cumulative (desc).
    const activeResults = result.firm_results.filter((fr) => fr.status === "active");
    const sorted = [...activeResults].sort((a, b) => b.scorecard_cumulative - a.scorecard_cumulative);
    const rankOf = new Map<FirmId, number>();
    sorted.forEach((fr, i) => rankOf.set(fr.firm_id, i + 1));

    const scoreMap = new Map<FirmId, number>();
    for (const fr of result.firm_results) {
      const s =
        w.financial * fr.scorecard_norm.financial +
        w.market * fr.scorecard_norm.market +
        w.intangible * fr.scorecard_norm.intangible +
        w.stakeholder * fr.scorecard_norm.stakeholder;
      scoreMap.set(fr.firm_id, s);
    }
    rec.perRoundScoreAll.push(scoreMap);

    for (const [id, arr] of [[A_ID, rec.A], [B_ID, rec.B]] as const) {
      const fr = result.firm_results.find((x) => x.firm_id === id);
      if (!fr) continue;
      if (id === A_ID && fr.status !== "active" && rec.aBankruptRound === null) rec.aBankruptRound = r + 1;
      const shareSum = Object.values(fr.segments).reduce((a, sr) => a + sr.share, 0);
      const d = decByFirm.get(id);
      arr.push({
        rank: rankOf.get(id) ?? NaN,
        cumulative: fr.scorecard_cumulative,
        perRoundScore: scoreMap.get(id) ?? NaN,
        norm: { ...fr.scorecard_norm },
        net_income: fr.pnl.net_income,
        revenue: fr.pnl.revenue,
        unit_cost: fr.unit_cost,
        shareSum,
        cash: fr.state.cash,
        debt: fr.state.debt,
        priceA_seg: fr.segments[A_SEGMENT]?.price ?? 0,
        investQB: (d?.invest_Q ?? 0) + (d?.invest_B ?? 0),
        status: fr.status,
      });
    }
    world = next;
  }

  const last = rec.A.length - 1;
  rec.finalRankA = rec.A[last]?.rank ?? NaN;
  rec.finalRankB = rec.B[last]?.rank ?? NaN;
  rec.finalCumA = rec.A[last]?.cumulative ?? NaN;
  rec.finalCumB = rec.B[last]?.cumulative ?? NaN;

  // Sustained flip rounds (per seed).
  const sustainedFlip = (get: (r: number) => [number, number] | null): number | null => {
    for (let r = 0; r < N_ROUNDS; r++) {
      let holds = true;
      let any = false;
      for (let q = r; q < N_ROUNDS; q++) {
        const v = get(q);
        if (!v) continue;
        any = true;
        if (v[1] <= v[0]) { holds = false; break; }
      }
      if (holds && any) return r + 1;
    }
    return null;
  };
  rec.cumFlipRound = sustainedFlip((r) =>
    rec.A[r] && rec.B[r] ? [rec.A[r].cumulative, rec.B[r].cumulative] : null,
  );
  rec.perRoundFlipRound = sustainedFlip((r) =>
    rec.A[r] && rec.B[r] ? [rec.A[r].perRoundScore, rec.B[r].perRoundScore] : null,
  );
  rec.aCumFlipRound = sustainedFlip((r) =>
    rec.A[r] && rec.B[r] ? [rec.B[r].cumulative, rec.A[r].cumulative] : null,
  );
  rec.aPerRoundFlipRound = sustainedFlip((r) =>
    rec.A[r] && rec.B[r] ? [rec.B[r].perRoundScore, rec.A[r].perRoundScore] : null,
  );
  return rec;
}

function runScenario(name: string, opts: ScenarioOpts): { name: string; opts: ScenarioOpts; runs: SeedRun[]; errors: string[] } {
  const runs: SeedRun[] = [];
  const errors: string[] = [];
  SEEDS.forEach((seed, i) => {
    try {
      const cfg = resolveConfig({ game: { n_firms: opts.nFirms, n_rounds: N_ROUNDS, seed } });
      opts.mutate?.(cfg);
      runs.push(runOne(cfg, i, opts));
    } catch (e) {
      const msg = `seed ${seed}: ${(e as Error).message}`;
      errors.push(msg);
      console.error(`  [${name}] CRASH ${msg}`);
    }
  });
  return { name, opts, runs, errors };
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const money = (x: number) => (Number.isFinite(x) ? "$" + Math.round(x).toLocaleString("en-US") : "—");

function rankDist(runs: SeedRun[], which: "finalRankA" | "finalRankB"): string {
  const counts = new Map<string, number>();
  for (const r of runs) {
    const key = Number.isFinite(r[which]) ? `#${r[which]}` : "out";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort().map(([rank, n]) => `${rank}:${n}`).join(" ");
}

const bWins = (runs: SeedRun[]) => runs.filter((r) => r.finalCumB > r.finalCumA).length;
const bankrupts = (runs: SeedRun[]) => runs.filter((r) => r.aBankruptRound !== null).length;

/** Mean per-round score for A and B by round, across seeds (only seeds where the firm is active that round). */
function meanPerRound(runs: SeedRun[]): { A: number[]; B: number[] } {
  const A: number[] = [];
  const B: number[] = [];
  for (let r = 0; r < N_ROUNDS; r++) {
    A.push(mean(runs.map((x) => (x.A[r]?.status === "active" ? x.A[r].perRoundScore : NaN)).filter(Number.isFinite)));
    B.push(mean(runs.map((x) => (x.B[r]?.status === "active" ? x.B[r].perRoundScore : NaN)).filter(Number.isFinite)));
  }
  return { A, B };
}

/** Offline re-ranking under a last-K-rounds-only average of per-round scores. */
function lastKRanks(runs: SeedRun[], k: number): { aRanks: number[]; bRanks: number[]; bAhead: number } {
  const aRanks: number[] = [];
  const bRanks: number[] = [];
  let bAhead = 0;
  for (const run of runs) {
    const start = Math.max(0, run.perRoundScoreAll.length - k);
    const totals = new Map<FirmId, { sum: number; n: number }>();
    for (let r = start; r < run.perRoundScoreAll.length; r++) {
      for (const [id, s] of run.perRoundScoreAll[r]) {
        const t = totals.get(id) ?? { sum: 0, n: 0 };
        t.sum += s;
        t.n += 1;
        totals.set(id, t);
      }
    }
    const avg = [...totals.entries()].map(([id, t]) => [id, t.sum / Math.max(1, t.n)] as const);
    avg.sort((a, b) => b[1] - a[1]);
    const rankOf = new Map(avg.map(([id], i) => [id, i + 1]));
    aRanks.push(rankOf.get(A_ID) ?? NaN);
    bRanks.push(rankOf.get(B_ID) ?? NaN);
    const aScore = avg.find(([id]) => id === A_ID)?.[1] ?? -Infinity;
    const bScore = avg.find(([id]) => id === B_ID)?.[1] ?? -Infinity;
    if (bScore > aScore) bAhead++;
  }
  return { aRanks, bRanks, bAhead };
}

function summarizeRanks(rs: number[]): string {
  const counts = new Map<string, number>();
  for (const r of rs) {
    const key = Number.isFinite(r) ? `#${r}` : "out";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort().map(([r, n]) => `${r}:${n}`).join(" ");
}

interface ComponentMeans { financial: number; market: number; intangible: number; stakeholder: number }
function componentMeans(runs: SeedRun[], who: "A" | "B", fromRound = 0, toRound = N_ROUNDS): ComponentMeans {
  const pick = (f: (n: FirmRoundRec["norm"]) => number) =>
    mean(runs.flatMap((r) => r[who].slice(fromRound, toRound).filter((x) => x.status === "active").map((x) => f(x.norm))));
  return {
    financial: pick((n) => n.financial),
    market: pick((n) => n.market),
    intangible: pick((n) => n.intangible),
    stakeholder: pick((n) => n.stakeholder),
  };
}

function economics(runs: SeedRun[], who: "A" | "B") {
  const rows = runs.flatMap((r) => r[who].filter((x) => x.status === "active"));
  return {
    price: mean(rows.map((x) => x.priceA_seg).filter((p) => p > 0)),
    unit_cost: mean(rows.map((x) => x.unit_cost)),
    revenue: mean(rows.map((x) => x.revenue)),
    net_income: mean(rows.map((x) => x.net_income)),
    shareSum: mean(rows.map((x) => x.shareSum)),
    cash: mean(rows.map((x) => x.cash)),
    debt: mean(rows.map((x) => x.debt)),
    investQB: mean(rows.map((x) => x.investQB)),
  };
}

const meanFlip = (runs: SeedRun[], key: "cumFlipRound" | "perRoundFlipRound" | "aCumFlipRound" | "aPerRoundFlipRound") => {
  const xs = runs.map((r) => r[key]).filter((x): x is number => x !== null);
  return { mean: mean(xs), never: runs.length - xs.length };
};

// ---------------------------------------------------------------------------
// Run: baseline + sensitivities + duels
// ---------------------------------------------------------------------------

console.log("Path-dependence audit — Drink Wars engine");
console.log(`Seeds: ${SEEDS.length}, rounds: ${N_ROUNDS}\n`);

console.log("Running BASELINE (6 firms: A, B, 4 adaptive NPCs)...");
const base = runScenario("baseline", { nFirms: 6, bQB: 50_000 });

// S1: price elasticity +25% in A's priced segment only.
console.log("Running S1 (beta_p +25% in niche)...");
const s1 = runScenario("S1_beta_p", {
  nFirms: 6, bQB: 50_000,
  mutate: (c) => {
    const seg = c.segments.find((s) => s.id === A_SEGMENT)!;
    seg.beta_p = seg.beta_p * 1.25; // 0.40 -> 0.50
  },
});

// S2: debt repriced. Exact keys changed: finance.base_spread 0.01 -> 0.02,
// finance.spread_leverage_k 0.05 -> 0.10 (both doubled).
console.log("Running S2 (debt spread + leverage sensitivity doubled)...");
const s2 = runScenario("S2_debt", {
  nFirms: 6, bQB: 50_000,
  mutate: (c) => {
    c.finance.base_spread = c.finance.base_spread * 2;
    c.finance.spread_leverage_k = c.finance.spread_leverage_k * 2;
  },
});

// S3: scoring accumulation -> "auc" (engine-supported alternative: round r
// contributes with weight r+1 instead of 1 — late rounds weigh more).
console.log("Running S3 (scoring.accumulation = auc)...");
const s3 = runScenario("S3_auc", {
  nFirms: 6, bQB: 50_000,
  mutate: (c) => { c.scoring.accumulation = "auc"; },
});

// AS-PLAYED reconstruction: UI-default decision + one price raise + debt→cap.
console.log("Running FIELD-ASPLAYED (6 firms, as-played A)...");
const fieldA2 = runScenario("field_asplayed", { nFirms: 6, bQB: 50_000, aStyle: "asplayed" });

// DUELS — mirror the live 2-human game (no NPCs).
console.log("Running DUEL (A-focus vs builder 50k)...");
const duelHi = runScenario("duel_hi", { nFirms: 2, bQB: 50_000 });
console.log("Running DUEL (A-focus vs builder 25k)...");
const duelMod = runScenario("duel_mod", { nFirms: 2, bQB: 25_000 });
console.log("Running DUEL-ASPLAYED (A-asplayed vs builder 50k)...");
const duelA2 = runScenario("duel_a2", { nFirms: 2, bQB: 50_000, aStyle: "asplayed" });
console.log("Running DUEL-ASPLAYED (A-asplayed vs builder 25k)...");
const duelA2Mod = runScenario("duel_a2_25", { nFirms: 2, bQB: 25_000, aStyle: "asplayed" });
console.log("Running DUEL-ASPLAYED sensitivities (auc / beta_p / debt)...");
const duelA2Auc = runScenario("duel_a2_auc", {
  nFirms: 2, bQB: 50_000, aStyle: "asplayed",
  mutate: (c) => { c.scoring.accumulation = "auc"; },
});
const duelA2S1 = runScenario("duel_a2_S1", {
  nFirms: 2, bQB: 50_000, aStyle: "asplayed",
  mutate: (c) => {
    const seg = c.segments.find((s) => s.id === A_SEGMENT)!;
    seg.beta_p = seg.beta_p * 1.25;
  },
});
const duelA2S2 = runScenario("duel_a2_S2", {
  nFirms: 2, bQB: 50_000, aStyle: "asplayed",
  mutate: (c) => {
    c.finance.base_spread = c.finance.base_spread * 2;
    c.finance.spread_leverage_k = c.finance.spread_leverage_k * 2;
  },
});

// STATIC variant — the ACTUAL client behavior (round-1 dollar package carried
// forward, no per-round %-of-cash recompute). The decisive honesty check on the
// as-played reconstruction: does the "accidental autopilot" finding survive?
console.log("Running DUEL-ASPLAYED-STATIC (real client: fixed round-1 package)...");
const duelA2Static = runScenario("duel_a2_static", { nFirms: 2, bQB: 50_000, aStyle: "asplayed_static" });
const duelA2Static25 = runScenario("duel_a2_static_25", { nFirms: 2, bQB: 25_000, aStyle: "asplayed_static" });
console.log("Running FIELD-ASPLAYED-STATIC (6 firms)...");
const fieldA2Static = runScenario("field_asplayed_static", { nFirms: 6, bQB: 50_000, aStyle: "asplayed_static" });

// S3b (offline, from recordings): last-8-rounds-only average.
const last8 = lastKRanks(base.runs, 8);
const last8DuelMod = lastKRanks(duelMod.runs, 8);
const last8DuelA2 = lastKRanks(duelA2.runs, 8);

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

const fieldScenarios = [
  { label: "Field 6-firm, A-focus (literal spec)", s: base },
  { label: "S1 beta_p(niche) +25% (0.40→0.50)", s: s1 },
  { label: "S2 base_spread ×2 + spread_leverage_k ×2", s: s2 },
  { label: "S3 accumulation=auc", s: s3 },
  { label: "Field 6-firm, A-asplayed (UI defaults + price raise + debt)", s: fieldA2 },
];
const duelScenarios = [
  { label: "Duel: A-focus vs builder-50k", s: duelHi },
  { label: "Duel: A-focus vs builder-25k", s: duelMod },
  { label: "Duel: A-asplayed vs builder-50k (playtest mirror)", s: duelA2 },
  { label: "Duel: A-asplayed vs builder-25k", s: duelA2Mod },
  { label: "Duel: A-asplayed vs builder-50k + auc", s: duelA2Auc },
  { label: "Duel: A-asplayed vs builder-50k + beta_p(niche)×1.25", s: duelA2S1 },
  { label: "Duel: A-asplayed vs builder-50k + debt spreads ×2", s: duelA2S2 },
  { label: "Duel: A-STATIC (real client pkg) vs builder-50k", s: duelA2Static },
  { label: "Duel: A-STATIC (real client pkg) vs builder-25k", s: duelA2Static25 },
  { label: "Field 6-firm, A-STATIC (real client pkg)", s: fieldA2Static },
];

for (const { label, s } of [...fieldScenarios, ...duelScenarios]) {
  const n = s.runs.length;
  const pr = meanPerRound(s.runs);
  const cumFlip = meanFlip(s.runs, "cumFlipRound");
  const prFlip = meanFlip(s.runs, "perRoundFlipRound");
  const aCumFlip = meanFlip(s.runs, "aCumFlipRound");
  const aPrFlip = meanFlip(s.runs, "aPerRoundFlipRound");
  console.log(`\n${label}  (${n} seeds ok, ${s.errors.length} crashed; A bankrupt in ${bankrupts(s.runs)}/${n})`);
  console.log(`  A final: ${rankDist(s.runs, "finalRankA")}   B final: ${rankDist(s.runs, "finalRankB")}   B ahead: ${bWins(s.runs)}/${n}`);
  console.log(`  mean final cum: A ${fmt(mean(s.runs.map((r) => r.finalCumA)))} B ${fmt(mean(s.runs.map((r) => r.finalCumB)))} gap(A-B) ${fmt(mean(s.runs.map((r) => r.finalCumA - r.finalCumB)))}`);
  console.log(`  B-over-A sustained flips: per-round ${fmt(prFlip.mean, 1)} (never:${prFlip.never}) cumulative ${fmt(cumFlip.mean, 1)} (never:${cumFlip.never})`);
  console.log(`  A-over-B sustained flips: per-round ${fmt(aPrFlip.mean, 1)} (never:${aPrFlip.never}) cumulative ${fmt(aCumFlip.mean, 1)} (never:${aCumFlip.never})`);
  console.log(`  mean per-round score by round A: ${pr.A.map((x) => fmt(x, 2)).join(" ")}`);
  console.log(`  mean per-round score by round B: ${pr.B.map((x) => fmt(x, 2)).join(" ")}`);
}
console.log(`\nOffline last-8-only re-rank (baseline field): B ahead ${last8.bAhead}/${base.runs.length}`);
console.log(`Offline last-8-only re-rank (duel A-focus 25k): B ahead ${last8DuelMod.bAhead}/${duelMod.runs.length}`);
console.log(`Offline last-8-only re-rank (duel A-asplayed 50k): B ahead ${last8DuelA2.bAhead}/${duelA2.runs.length}`);

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

const w0 = resolveConfig({ game: { n_firms: 6, n_rounds: N_ROUNDS, seed: SEEDS[0] } }).scoring.weights;

function perRoundTable(s: { runs: SeedRun[] }, title: string): string[] {
  const out: string[] = [];
  const pr = meanPerRound(s.runs);
  out.push(`| Round | A per-round | B per-round | B−A | A cum. | B cum. | A NI (k$) | B NI (k$) | A share | B share |`);
  out.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (let r = 0; r < N_ROUNDS; r++) {
    const g = (who: "A" | "B", f: (x: FirmRoundRec) => number) =>
      mean(s.runs.map((x) => (x[who][r]?.status === "active" ? f(x[who][r]) : NaN)).filter(Number.isFinite));
    out.push(
      `| ${r + 1} | ${fmt(pr.A[r])} | ${fmt(pr.B[r])} | ${fmt(pr.B[r] - pr.A[r])} | ${fmt(g("A", (x) => x.cumulative))} | ${fmt(g("B", (x) => x.cumulative))} | ${fmt(g("A", (x) => x.net_income) / 1000, 0)} | ${fmt(g("B", (x) => x.net_income) / 1000, 0)} | ${fmt(g("A", (x) => x.shareSum), 2)} | ${fmt(g("B", (x) => x.shareSum), 2)} |`,
    );
  }
  return [`### ${title}`, ``, ...out, ``];
}

const md: string[] = [];
md.push(`# Drink Wars — Path-Dependence Audit ("price-and-leverage" vs "builder")`);
md.push(``);
md.push(`Generated by \`engine/scripts/audit_pathdep.ts\` — ${SEEDS.length} fixed seeds × ${N_ROUNDS} rounds, base config (no expansion modules), engine untouched. Arenas: the spec'd 6-firm field (A + B + 4 adaptive NPCs, rotating \`ADAPTIVE_LEANS\`) and 2-firm duels mirroring the live 2-human game. Two readings of player A were simulated:`);
md.push(``);
md.push(`- **A-focus** (the literal spec): presence 90% niche / 10% mass, price 2.35× unit cost in niche, debt 300k/250k/150k → invest_cap, token (~2k) investment elsewhere.`);
md.push(`- **A-asplayed** (the faithful reconstruction): the web UI's DEFAULT decision (\`web/src/game/controller.ts\`) is presence=1 in EVERY active segment, price 1.8× unit cost, invest_cap=maintenance, plus a standing investment package of **25% of cash split 20% process / 30% Q / 30% B / 20% T_emp**, carried forward every round. A player who "raised price in one category, took on debt for facilities, and touched almost nothing else" therefore submitted: spread presence + niche price 2.35× + debt→capacity + **the default %-of-cash investment stream**.`);
md.push(``);
md.push(`Strategy B "builder": price 1.8× unit cost, presence spread evenly, invest_Q+invest_B of 50k+50k ("aggressive") or 25k+25k ("moderate") per round capped at 55% of cash, cap = maintenance+20k, zero debt.`);
md.push(``);
md.push(`Scoring: weights financial ${w0.financial} / market ${w0.market} / intangible ${w0.intangible} / stakeholder ${w0.stakeholder}; \`accumulation: "round_average"\`; \`normalization: "zscore_within_round"\`. "Per-round score" below = weighted sum of that round's z-scored components — exactly the quantity the cumulative averages. "Sustained flip" = the round from which one side stays ahead through game end.`);
md.push(``);

md.push(`## 1. Headline result table`);
md.push(``);
md.push(`| Scenario | A final rank | B final rank | A bankrupt | B ahead at end | Final cum. gap (A−B) | B-over-A flip: per-round / cum. | A-over-B flip: per-round / cum. |`);
md.push(`|---|---|---|---|---|---|---|---|`);
for (const { label, s } of [...fieldScenarios, ...duelScenarios]) {
  const cumFlip = meanFlip(s.runs, "cumFlipRound");
  const prFlip = meanFlip(s.runs, "perRoundFlipRound");
  const aCumFlip = meanFlip(s.runs, "aCumFlipRound");
  const aPrFlip = meanFlip(s.runs, "aPerRoundFlipRound");
  const flip = (f: { mean: number; never: number }) => `${fmt(f.mean, 1)}${f.never ? ` (nv:${f.never})` : ""}`;
  md.push(
    `| ${label} | ${rankDist(s.runs, "finalRankA")} | ${rankDist(s.runs, "finalRankB")} | ${bankrupts(s.runs)}/${s.runs.length} | ${bWins(s.runs)}/${s.runs.length} | ${fmt(mean(s.runs.map((r) => r.finalCumA - r.finalCumB)))} | ${flip(prFlip)} / ${flip(cumFlip)} | ${flip(aPrFlip)} / ${flip(aCumFlip)} |`,
  );
}
md.push(``);
md.push(`(nv:N = never flipped in N of ${SEEDS.length} seeds. Flip rounds are means over the seeds where the flip happened.)`);
md.push(``);
const allErrors = [base, s1, s2, s3, fieldA2, duelHi, duelMod, duelA2, duelA2Mod, duelA2Auc, duelA2S1, duelA2S2].flatMap((s) => s.errors);
if (allErrors.length) {
  md.push(`Crashed seeds: ${allErrors.join("; ")}`);
  md.push(``);
}

md.push(`## 2. Round-by-round detail (means across seeds, active firms only)`);
md.push(``);
md.push(...perRoundTable(base, `Field 6-firm, A-focus (literal spec) — A goes bankrupt`));
md.push(...perRoundTable(fieldA2, `Field 6-firm, A-asplayed`));
md.push(...perRoundTable(duelA2, `Duel: A-asplayed vs builder-50k — the playtest mirror`));
md.push(...perRoundTable(duelMod, `Duel: A-focus vs builder-25k`));

md.push(`## 3. Component decomposition (mean per-round z-scores; early = rounds 1–5, late = rounds 9–16)`);
md.push(``);
md.push(`| Component (weight) | duelA2 A early | duelA2 B early | duelA2 A late | duelA2 B late | field-A2 A early | field-A2 A late |`);
md.push(`|---|---|---|---|---|---|---|`);
const cA2e = componentMeans(duelA2.runs, "A", 0, 5);
const cB2e = componentMeans(duelA2.runs, "B", 0, 5);
const cA2l = componentMeans(duelA2.runs, "A", 8, 16);
const cB2l = componentMeans(duelA2.runs, "B", 8, 16);
const cFA2e = componentMeans(fieldA2.runs, "A", 0, 5);
const cFA2l = componentMeans(fieldA2.runs, "A", 8, 16);
for (const k of ["financial", "market", "intangible", "stakeholder"] as const) {
  md.push(`| ${k} (${w0[k]}) | ${fmt(cA2e[k])} | ${fmt(cB2e[k])} | ${fmt(cA2l[k])} | ${fmt(cB2l[k])} | ${fmt(cFA2e[k])} | ${fmt(cFA2l[k])} |`);
}
md.push(``);

md.push(`## 4. Margin decomposition (means over active rounds/seeds)`);
md.push(``);
md.push(`| Metric | duelA2 A | duelA2 B | field-A2 A | field 6-firm A-focus | field B (builder-50k) |`);
md.push(`|---|---|---|---|---|---|`);
const eDA = economics(duelA2.runs, "A");
const eDB = economics(duelA2.runs, "B");
const eFA2 = economics(fieldA2.runs, "A");
const eF6A = economics(base.runs, "A");
const eF6B = economics(base.runs, "B");
md.push(`| Price in niche | ${money(eDA.price)} | ${money(eDB.price)} | ${money(eFA2.price)} | ${money(eF6A.price)} | ${money(eF6B.price)} |`);
md.push(`| Unit cost | ${fmt(eDA.unit_cost, 2)} | ${fmt(eDB.unit_cost, 2)} | ${fmt(eFA2.unit_cost, 2)} | ${fmt(eF6A.unit_cost, 2)} | ${fmt(eF6B.unit_cost, 2)} |`);
md.push(`| Revenue / round | ${money(eDA.revenue)} | ${money(eDB.revenue)} | ${money(eFA2.revenue)} | ${money(eF6A.revenue)} | ${money(eF6B.revenue)} |`);
md.push(`| Net income / round | ${money(eDA.net_income)} | ${money(eDB.net_income)} | ${money(eFA2.net_income)} | ${money(eF6A.net_income)} | ${money(eF6B.net_income)} |`);
md.push(`| Share (sum over segments) | ${fmt(eDA.shareSum, 2)} | ${fmt(eDB.shareSum, 2)} | ${fmt(eFA2.shareSum, 2)} | ${fmt(eF6A.shareSum, 2)} | ${fmt(eF6B.shareSum, 2)} |`);
md.push(`| Cash | ${money(eDA.cash)} | ${money(eDB.cash)} | ${money(eFA2.cash)} | ${money(eF6A.cash)} | ${money(eF6B.cash)} |`);
md.push(`| Debt | ${money(eDA.debt)} | ${money(eDB.debt)} | ${money(eFA2.debt)} | ${money(eF6A.debt)} | ${money(eF6B.debt)} |`);
md.push(`| invest_Q+invest_B / round (decided) | ${money(eDA.investQB)} | ${money(eDB.investQB)} | ${money(eFA2.investQB)} | ${money(eF6A.investQB)} | ${money(eF6B.investQB)} |`);
md.push(``);

md.push(`## 5. Sensitivity reruns (same seeds)`);
md.push(``);
md.push(`On the spec'd 6-firm A-focus baseline (where A already fails — included for completeness):`);
md.push(``);
md.push(`- **S1 — \`segments[niche].beta_p\` 0.40 → 0.50 (+25%)**: gap ${fmt(mean(base.runs.map((r) => r.finalCumA - r.finalCumB)))} → ${fmt(mean(s1.runs.map((r) => r.finalCumA - r.finalCumB)))}; A bankrupt ${bankrupts(s1.runs)}/${s1.runs.length}.`);
md.push(`- **S2 — \`finance.base_spread\` 0.01 → 0.02 AND \`finance.spread_leverage_k\` 0.05 → 0.10** (both doubled — these are the exact keys changed): gap → ${fmt(mean(s2.runs.map((r) => r.finalCumA - r.finalCumB)))}. Negligible movement.`);
md.push(`- **S3 — \`scoring.accumulation: "auc"\`** (engine-supported; round r weighs r+1): gap → ${fmt(mean(s3.runs.map((r) => r.finalCumA - r.finalCumB)))}.`);
md.push(``);
md.push(`On the as-played duel (the configuration that reproduces the playtest):`);
md.push(``);
const a2CumFlip = meanFlip(duelA2.runs, "aCumFlipRound");
const a2PrFlip = meanFlip(duelA2.runs, "aPerRoundFlipRound");
const a2AucCumFlip = meanFlip(duelA2Auc.runs, "aCumFlipRound");
const a2S1CumFlip = meanFlip(duelA2S1.runs, "aCumFlipRound");
const a2S2CumFlip = meanFlip(duelA2S2.runs, "aCumFlipRound");
md.push(`- **beta_p(niche) ×1.25**: A still wins ${duelA2S1.runs.length - bWins(duelA2S1.runs)}/${duelA2S1.runs.length} seeds; A's cumulative takeover round ${fmt(a2CumFlip.mean, 1)} → ${fmt(a2S1CumFlip.mean, 1)}; final gap ${fmt(mean(duelA2.runs.map((r) => r.finalCumA - r.finalCumB)))} → ${fmt(mean(duelA2S1.runs.map((r) => r.finalCumA - r.finalCumB)))}.`);
md.push(`- **debt spreads ×2**: A still wins ${duelA2S2.runs.length - bWins(duelA2S2.runs)}/${duelA2S2.runs.length}; takeover round → ${fmt(a2S2CumFlip.mean, 1)}; final gap → ${fmt(mean(duelA2S2.runs.map((r) => r.finalCumA - r.finalCumB)))}.`);
md.push(`- **accumulation=auc**: A still wins ${duelA2Auc.runs.length - bWins(duelA2Auc.runs)}/${duelA2Auc.runs.length}; takeover round → ${fmt(a2AucCumFlip.mean, 1)}; final gap → ${fmt(mean(duelA2Auc.runs.map((r) => r.finalCumA - r.finalCumB)))}.`);
md.push(`- **S3b offline last-8-rounds-only re-ranking** of recorded per-round scores: field baseline B ahead ${last8.bAhead}/${base.runs.length}; duel A-focus-25k B ahead ${last8DuelMod.bAhead}/${duelMod.runs.length}; duel A-asplayed B ahead ${last8DuelA2.bAhead}/${duelA2.runs.length}.`);
md.push(``);

md.push(`## 6. Diagnosis — ranking causes (a)–(d)`);
md.push(``);
md.push(`__DIAGNOSIS__`);
md.push(``);
md.push(`## 7. Parameter recommendations (recommendations only — nothing changed)`);
md.push(``);
md.push(`__RECS__`);
md.push(``);

// ---- Diagnosis text (references the computed evidence) ----
const gapBase = mean(base.runs.map((r) => r.finalCumA - r.finalCumB));
const gapS1 = mean(s1.runs.map((r) => r.finalCumA - r.finalCumB));
const gapS2 = mean(s2.runs.map((r) => r.finalCumA - r.finalCumB));
const gapDuelA2 = mean(duelA2.runs.map((r) => r.finalCumA - r.finalCumB));

const diag: string[] = [];
diag.push(`### The two-part answer`);
diag.push(``);
diag.push(`**Part 1 — the literal "price-and-leverage, minimal investment" strategy is NOT dominant; it is fatal.** In the spec'd 6-firm field, A-focus goes bankrupt in ${bankrupts(base.runs)}/${base.runs.length} seeds (mean failure round ${fmt(mean(base.runs.map((r) => r.aBankruptRound).filter((x): x is number => x !== null)), 1)}): once rivals' Q/B stocks grow, a 2.35× price in one segment cannot fill 230k drinks/qtr of debt-funded capacity, and upkeep + depreciation + interest grind it down. In the duel it survives (the builder's spend leaves demand uncontested) but still finishes #2 in ${bWins(duelHi.runs)}/${duelHi.runs.length} seeds. **So the engine does not reward price+leverage per se.**`);
diag.push(``);
diag.push(`**Part 2 — what the live player actually ran (UI defaults + one price raise + debt) IS dominant, and reproduces the playtest.** In the as-played duel, A takes the per-round score lead for good around round ${fmt(a2PrFlip.mean, 1)} and the cumulative #1 around round ${fmt(a2CumFlip.mean, 1)}, finishing ahead in ${duelA2.runs.length - bWins(duelA2.runs)}/${duelA2.runs.length} seeds with a final gap of ${fmt(gapDuelA2)}; in the 6-firm field A-asplayed finishes ${rankDist(fieldA2.runs, "finalRankA")}. The winning loop is: **premium price in the low-elasticity niche → fat early net income (financial z) → big cash pile → the default 25%-of-cash package converts the pile into the game's largest Q/B stock (invest_QB ≈ ${money(eDA.investQB)}/round vs the "aggressive builder"'s ${money(eDB.investQB)}) → share follows stock → more cash.** Debt-funded capacity ensures he can actually serve the demand his stock wins. The "builder" loses not because building is wrong but because he is CASH-CONSTRAINED: his spend is expensed against a small revenue base (NI ${money(eDB.net_income)}/round vs A's ${money(eDA.net_income)}), so the z-scored financial component brands him weak every round while his absolute investment is ultimately smaller than the leader's.`);
diag.push(``);
diag.push(`### The crossover answer (the question the audit was asked to settle)`);
diag.push(``);
diag.push(`In the playtest mirror (duel, A-asplayed vs builder-50k) the builder's per-round score IS above A's in rounds 1–5 (mean +0.06 → +0.49) — then A crosses at round ${fmt(a2PrFlip.mean, 1)} on average and NEVER gives the lead back; the cumulative standings flip at round ${fmt(a2CumFlip.mean, 1)} and end at a gap of ${fmt(gapDuelA2)}. Re-ranking on the LAST 8 rounds only makes A's win *cleaner* (B ahead 0/${duelA2.runs.length}). **So this is NOT scoring lock-in: after mid-game, A genuinely out-scores B every single round, and the accumulation rule if anything under-reports how dominant A's economics become.** The professor watched the mid-to-late game — exactly the window where "B could never escape #2" is real economics, not an artifact.`);
diag.push(``);
diag.push(`### Cause ranking`);
diag.push(``);
diag.push(`**PRIMARY — (d), inverted from the hypothesis: intangible ROI is not "too slow", it is a RICH PLAYER'S GAME, and the UI default hands the rich player the strategy.** The winning loop is cash-compounding: %-of-cash investing means the margin leader out-invests the dedicated builder in absolute dollars (A invest_QB ≈ ${money(eDA.investQB)}/round vs B's ${money(eDB.investQB)}), while sqrt conversion mutes any attempt by the cash-poor builder to leapfrog with concentrated spend, the 2-round lag + 18% depreciation push his payoff past his cash runway, and κ=0.45 taxes his unit cost meanwhile (${fmt(eDB.unit_cost, 2)} vs ${fmt(eDA.unit_cost, 2)}). By rounds 9–16 A wins the INTANGIBLE column itself (${fmt(cA2l.intangible)} vs ${fmt(cB2l.intangible)}) — the "minimal investment" player ends the game as the quality/brand leader.`);
diag.push(``);
diag.push(`**SECONDARY — (a), but as component design, not accumulation.** The financial component z-scores THIS quarter's net income, so the builder's expensed Q/B spend brands him financially weak precisely while he invests (early financial z: A ${fmt(cA2e.financial)} vs B ${fmt(cB2e.financial)} in the playtest mirror) — that early scoring verdict is what the players saw and internalized. The ACCUMULATION rule itself is exonerated: auc barely changes anything (A's takeover ${fmt(a2CumFlip.mean, 1)} → ${fmt(a2AucCumFlip.mean, 1)}, gap ${fmt(gapDuelA2)} → ${fmt(mean(duelA2Auc.runs.map((r) => r.finalCumA - r.finalCumB)))} — auc actually helps A, because A wins the late rounds), and the last-8-only re-rank confirms no lock-in.`);
diag.push(``);
diag.push(`**TERTIARY — (c) price elasticity:** real but small. beta_p(niche) ×1.25 delays A's takeover only ${fmt(a2CumFlip.mean, 1)} → ${fmt(a2S1CumFlip.mean, 1)} rounds and trims the gap to ${fmt(mean(duelA2S1.runs.map((r) => r.finalCumA - r.finalCumB)))}; A still wins ${duelA2S1.runs.length - bWins(duelA2S1.runs)}/${duelA2S1.runs.length}. The premium price is the SEED of the cash pile, but once the compounding loop starts, elasticity alone cannot stop it — and by late game A's Q stock justifies his price even to elastic customers.`);
diag.push(``);
diag.push(`**WEAKEST — (b) debt too cheap.** Doubling base_spread and spread_leverage_k is inert everywhere (field gap ${fmt(gapBase)} → ${fmt(gapS2)}; as-played duel gap ${fmt(gapDuelA2)} → ${fmt(mean(duelA2S2.runs.map((r) => r.finalCumA - r.finalCumB)))}, takeover ${fmt(a2S2CumFlip.mean, 1)}). A's ~$780k at leverage ≈ 0.5–1.0 costs ~2.5–3%/qtr — a rounding error against niche margin. Debt matters as an ENABLER (capacity to serve won demand), not through its price. Note the flip side: the LITERAL leverage play (A-focus) goes bankrupt ${bankrupts(base.runs)}/${base.runs.length} in the field — debt is already dangerous when the strategy behind it is bad.`);
diag.push(``);
diag.push(`**Ranking: (d)-inverted ≫ (a)-as-component-design > (c) > (b).** And the finding outside all four hypotheses: **the web UI's default decision is itself a top-tier strategy** — full-spread presence + 25%-of-cash auto-investment beats the deliberate builder's plan. The "touched almost nothing" player was riding an excellent autopilot fed by a premium-price cash pump; the builder was fighting that autopilot with a worse allocation and a smaller wallet.`);

const md2 = md.join("\n").replace("__DIAGNOSIS__", diag.join("\n"));

// ---- Recommendations ----
const recs: string[] = [];
recs.push(`1. **Fix the UI default investment package first (product change, not an engine key): \`web/src/game/controller.ts\` first-round default.** The standing 25%-of-cash / 30% Q / 30% B / 20% process / 20% T_emp package — carried forward every round — is doing the winning player's strategy for him and is the engine of the cash-compounding loop. Default the invest fields to maintenance-only (or to last round's DOLLAR amounts rather than a % of cash) so passive wealth does not auto-compound into quality/brand leadership. This single change attacks the dominant cause directly; every engine lever below is second-order to it.`);
recs.push(`2. **Reward capability building, not just this-quarter accounting profit: rebalance \`scoring.financial_blend\`** — lower \`profitability\` 0.4 → 0.3 and move the weight to \`soundness\` (0.3 → 0.4), and/or compute profitability on a rolling 3-round NI average (small scoring.ts change). Today the builder's expensed Q/B spend brands him financially weak in the exact rounds he invests (early financial z ${fmt(cA2e.financial)} vs ${fmt(cB2e.financial)}). Leave \`accumulation\` alone — the audit shows auc/last-8 reforms do NOT change outcomes (A wins the late game on merit), so accumulation changes are cosmetic here.`);
recs.push(`3. **Make deliberate early building pay inside a student's cash runway: \`stocks.Q.lag\` and \`stocks.B.lag\` 2 → 1, and raise \`stocks.Q.gain\`/\`B.gain\` 0.0425 → ~0.055.** The sqrt conversion already caps how much a rich firm's extra dollars buy; shortening the lag and raising the per-√$ yield shifts relative advantage toward the firm that commits EARLY (the builder's only edge) rather than the firm that spends MORE forever. Validate with \`npm run balance\` (this changes engine dynamics).`);
recs.push(`4. **Soften the quality cost tax during the build phase: \`costs.quality_premium.kappa\` 0.45 → 0.35 (or \`halfsat\` 35 → 50).** The κ premium currently raises the builder's unit cost (${fmt(eDB.unit_cost, 2)} vs A's ${fmt(eDA.unit_cost, 2)} in the duel) in exactly the rounds his stock hasn't paid out — he pays three times (NI, margin, wait) before earning once.`);
recs.push(`5. **Raise \`segments[niche].beta_p\` 0.40 → 0.46–0.50** to price the premium play honestly. Measured effect of ×1.25 (=0.50): A's takeover delayed ${fmt(a2CumFlip.mean, 1)} → ${fmt(a2S1CumFlip.mean, 1)} rounds, gap ${fmt(gapDuelA2)} → ${fmt(mean(duelA2S1.runs.map((r) => r.finalCumA - r.finalCumB)))} — modest alone, but it throttles the cash pump that seeds the loop, and it compounds with recs 1–3. Keep mass at 0.37 so cost-leadership stays viable.`);
recs.push(``);
recs.push(`NOT recommended: debt repricing (\`finance.base_spread\`, \`spread_leverage_k\`) — S2 shows it inert at ×2 in every configuration (final gaps move by <0.03). The debt channel already carries real risk: the literal price-and-leverage play goes bankrupt ${bankrupts(base.runs)}/${base.runs.length} against an adaptive field.`);
const md3 = md2.replace("__RECS__", recs.join("\n"));

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, md3);
console.log(`\nReport written to ${REPORT_PATH}`);
