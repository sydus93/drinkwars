/**
 * Headless run driver + metric extraction for the balance harness. Runs one game
 * capturing the per-round, per-firm series the §16 pathology detectors need
 * (concentration, segment monopoly, comebacks, cartel persistence, invariants),
 * and provides the baseline and coopetition scenario decision providers.
 */
import type { Config, FirmDecision, RoundResult, SegmentId, WorldState } from "../src/types.js";
import { initGame, resolveRound, InvariantError } from "../src/index.js";
import { loadConfig } from "../src/config/load.js";
import { type ArchetypeId, BASELINE_ASSIGNMENT, makeProvider } from "./archetypes.js";
import { ADAPTIVE_LEANS, decideAdaptive } from "./adaptive.js";

export type Provider = (world: WorldState, c: Config) => FirmDecision[];

export interface FirmRoundMetric {
  firm_id: string;
  round: number;
  archetype: string;
  score: number;
  shareSum: number;
  cash: number;
  equity: number;
  ni: number;
  status: string;
}

export interface RunMetrics {
  seed: number;
  assignment: string[];
  history: RoundResult[];
  firmRounds: FirmRoundMetric[];
  bankruptcies: { firm: string; round: number }[];
  finalScores: { firm: string; archetype: string; score: number; status: string }[];
  winner: { firm: string; archetype: string; score: number } | null;
  hhiByRound: number[]; // industry output concentration
  maxSegShareByRound: Map<SegmentId, number[]>;
  outsideShareByRound: number[]; // mean unmet fraction across active segments
  agreementCountByRound: number[];
  antitrustFired: boolean;
  invariantError: string | null;
}

export function configWithSeed(seed: number, override: Parameters<typeof loadConfig>[0] = {}): Config {
  const base = typeof override === "object" ? override : {};
  return loadConfig({ ...(base as object), game: { ...((base as { game?: object }).game ?? {}), seed } } as never);
}

export function runOne(config: Config, labels: string[], provider: Provider): RunMetrics {
  const archOf = (firmIdx: number) => labels[firmIdx % labels.length];
  let world = initGame(config);
  const history: RoundResult[] = [];
  const firmRounds: FirmRoundMetric[] = [];
  const bankruptcies: { firm: string; round: number }[] = [];
  const hhiByRound: number[] = [];
  const maxSegShareByRound = new Map<SegmentId, number[]>(config.segments.map((s) => [s.id, []]));
  const outsideShareByRound: number[] = [];
  const agreementCountByRound: number[] = [];
  let antitrustFired = false;
  let invariantError: string | null = null;

  const idxOf = new Map(world.firms.map((f, i) => [f.id, i]));

  for (let r = 0; r < config.game.n_rounds; r++) {
    const decisions = provider(world, config);
    let result: RoundResult;
    try {
      const out = resolveRound(world, decisions, config);
      result = out.result;
      world = out.world;
    } catch (e) {
      invariantError = e instanceof InvariantError ? e.message : String(e);
      break;
    }
    history.push(result);

    // Industry output concentration (HHI over total q).
    const totalQ = result.firm_results.reduce((a, f) => a + Object.values(f.segments).reduce((s, x) => s + x.q_sold, 0), 0);
    let hhi = 0;
    for (const f of result.firm_results) {
      const fq = Object.values(f.segments).reduce((s, x) => s + x.q_sold, 0);
      const share = totalQ > 0 ? fq / totalQ : 0;
      hhi += share * share;
    }
    hhiByRound.push(hhi);

    // Per-segment max within-segment share + unmet fraction.
    let unmetSum = 0;
    let activeSegs = 0;
    for (const m of result.market) {
      if (!m.active) continue;
      activeSegs++;
      let maxShare = 0;
      for (const f of result.firm_results) {
        const sh = f.segments[m.segment]?.share ?? 0;
        if (sh > maxShare) maxShare = sh;
      }
      maxSegShareByRound.get(m.segment)?.push(maxShare);
      unmetSum += m.D > 0 ? Math.max(0, 1 - m.total_q / m.D) : 0;
    }
    outsideShareByRound.push(activeSegs ? unmetSum / activeSegs : 0);

    // Active agreement count this round (carried in the post-round world).
    agreementCountByRound.push(world.agreements.filter((a) => a.active).length);
    if (result.events.some((e) => e.startsWith("ANTITRUST"))) antitrustFired = true;
    for (const e of result.events) {
      if (e.startsWith("FORCED EXIT")) {
        const m = e.match(/firm_\d+/);
        if (m) bankruptcies.push({ firm: m[0], round: r });
      }
    }

    for (const f of result.firm_results) {
      firmRounds.push({
        firm_id: f.firm_id,
        round: r,
        archetype: archOf(idxOf.get(f.firm_id) ?? 0),
        score: f.scorecard_cumulative,
        shareSum: Object.values(f.segments).reduce((s, x) => s + x.share, 0),
        cash: f.balance_sheet.cash,
        equity: f.balance_sheet.equity,
        ni: f.pnl.net_income,
        status: f.status,
      });
    }
  }

  const last = history[history.length - 1];
  const finalScores = (last?.firm_results ?? []).map((f) => ({
    firm: f.firm_id,
    archetype: archOf(idxOf.get(f.firm_id) ?? 0),
    score: f.scorecard_cumulative,
    status: world.firms.find((x) => x.id === f.firm_id)?.status ?? "?",
  }));
  // Winner = highest cumulative score among firms still standing (active or invested).
  const standing = finalScores.filter((s) => s.status === "active" || s.status === "exited_invested");
  const pool = standing.length ? standing : finalScores;
  const winner = pool.length ? pool.reduce((a, b) => (b.score > a.score ? b : a)) : null;

  return {
    seed: config.game.seed,
    assignment: labels,
    history,
    firmRounds,
    bankruptcies,
    finalScores,
    winner: winner ? { firm: winner.firm, archetype: winner.archetype, score: winner.score } : null,
    hhiByRound,
    maxSegShareByRound,
    outsideShareByRound,
    agreementCountByRound,
    antitrustFired,
    invariantError,
  };
}

/** Baseline run (fixed archetypes) for a given seed. */
export function runBaseline(seed: number): RunMetrics {
  const config = configWithSeed(seed);
  return runOne(config, BASELINE_ASSIGNMENT, makeProvider(BASELINE_ASSIGNMENT));
}

/** Adaptive sweep: 8 distinct best-response agents (adaptive.ts). The honest test
 *  of whether a fixed-archetype "dominant strategy" survives when agents can
 *  reposition — crowding should erode the rents of any over-served segment. */
export function runAdaptive(seed: number): RunMetrics {
  const config = configWithSeed(seed);
  const labels = ADAPTIVE_LEANS.map((l) => l.id);
  const provider: Provider = (world, c) => {
    const out: FirmDecision[] = [];
    world.firms.forEach((f, i) => {
      if (f.status !== "active") return;
      out.push(decideAdaptive(ADAPTIVE_LEANS[i % ADAPTIVE_LEANS.length], f, world, c));
    });
    return out;
  };
  return runOne(config, labels, provider);
}

/**
 * Coopetition scenario (§11.4 degeneracy guards). Firms 1–3 form a
 * capacity-coordination collective ("guild") at round 1 and honor it for the
 * rest of the game (a would-be stable cartel); firm 4 forms a relational pact
 * with firm 5 then defects mid-game (to exercise the defection trust cost).
 */
export function coopetitionScenario(seed: number): { assignment: ArchetypeId[]; metrics: RunMetrics } {
  const assignment: ArchetypeId[] = ["cartel_member", "cartel_member", "cartel_member", "defector", "balanced", "differentiator", "cost_leader", "brand_builder"];
  const config = configWithSeed(seed);
  const base = makeProvider(assignment);
  let formed = false;
  let relationalId: string | null = null;
  let defected = false;

  const provider: Provider = (world, c) => {
    const decisions = base(world, c);
    const round = world.round;
    const byId = new Map(decisions.map((d) => [d.firm_id, d]));
    const active = new Set(world.firms.filter((f) => f.status === "active").map((f) => f.id));

    // Form the capacity-coordination guild at round 1.
    if (round === 1 && !formed && ["firm_1", "firm_2", "firm_3"].every((id) => active.has(id))) {
      const d = byId.get("firm_1");
      if (d) {
        d.agreement_actions.push({ type: "form", form: "collective", template: "capacity_coordination", counterparties: ["firm_2", "firm_3"] });
        formed = true;
      }
    }
    // Form a relational pact firm_4↔firm_5 at round 1; firm_4 defects at round 6.
    if (round === 1 && active.has("firm_4") && active.has("firm_5")) {
      const d = byId.get("firm_4");
      if (d) d.agreement_actions.push({ type: "form", form: "relational", template: "joint_marketing", counterparties: ["firm_5"], segment: "niche" });
    }
    if (round === 6 && !defected) {
      relationalId = world.agreements.find((a) => a.active && a.form === "relational" && a.signatories.includes("firm_4"))?.id ?? null;
      const d = byId.get("firm_4");
      if (d && relationalId) {
        d.agreement_actions.push({ type: "defect", agreement_id: relationalId });
        defected = true;
      }
    }
    return decisions;
  };

  return { assignment, metrics: runOne(config, assignment, provider) };
}
