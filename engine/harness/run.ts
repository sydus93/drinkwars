/**
 * Headless run driver + metric extraction for the balance harness. Runs one game
 * capturing the per-round, per-firm series the §16 pathology detectors need
 * (concentration, segment monopoly, comebacks, cartel persistence, invariants),
 * and provides the baseline and coopetition scenario decision providers.
 */
import type { Config, FirmDecision, ModuleId, RoundResult, SegmentId, WorldState } from "../src/types.js";
import { initGame, resolveRound, InvariantError } from "../src/index.js";
import { facilityCapacity } from "../src/engine/facilities.js";
import { loadConfig } from "../src/config/load.js";
import { MODULE_REGISTRY, presetById } from "../src/config/modules.js";
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
  /** Installed capacity going into the round: the generic stock PLUS whatever the firm's
   *  online facilities contribute (resolve.ts uses the same sum). FirmRoundResult only
   *  reports `state.cap`, which is the generic stock alone and understates a facilities
   *  game badly — the calibration harness needs the real denominator for utilization. */
  effectiveCap: number;
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
  // DW_MODULES=all (every implemented module), a preset id (e.g. "full" — what the
  // instructor picker actually ships, which since DW-042 excludes asymmetricStarts),
  // or a comma list of module ids — lets the whole harness sweep an expansion
  // configuration without code changes.
  let modules: Record<string, { enabled: boolean }> | undefined;
  const env = process.env.DW_MODULES;
  if (env) {
    const preset = presetById(env);
    const ids = env === "all" ? MODULE_REGISTRY.filter((m) => m.implemented).map((m) => m.id) : preset ? preset.modules : (env.split(",") as ModuleId[]);
    modules = {};
    for (const id of ids) modules[id] = { enabled: true };
  }
  return loadConfig({ ...(base as object), ...(modules ? { modules } : {}), game: { ...((base as { game?: object }).game ?? {}), seed } } as never);
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
    // Snapshot installed capacity BEFORE the resolve consumes it (generic stock + online
    // facilities), so utilization has an honest denominator in a facilities game.
    const capBefore = new Map(world.firms.map((f) => [f.id, f.cap + facilityCapacity(f, config, r)]));
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
        effectiveCap: capBefore.get(f.firm_id) ?? f.state.cap,
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

/** Mixed classroom sweep (DW-042): four best-response agents and four scripted
 *  archetypes in the SAME game. A real section is a mixed-ability field — some teams
 *  play near-optimally, some run one fixed idea all semester — and industry moments
 *  (exit rates, utilization, margins) depend on that mix. An all-best-response field
 *  produces zero exits (skill, not safety); an all-scripted field overstates them. */
export function runMixed(seed: number): RunMetrics {
  const config = configWithSeed(seed);
  const archIds: ArchetypeId[] = ["balanced", "brand_builder", "cost_leader", "niche_specialist"];
  const leanIdx = [1, 0, 5, 4]; // ad_quality, ad_generalist, ad_aggressive, ad_stakeholder
  const labels = Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? ADAPTIVE_LEANS[leanIdx[i >> 1]].id : archIds[i >> 1]));
  const archProvider = makeProvider(Array.from({ length: 8 }, (_, i) => archIds[(i >> 1) % archIds.length]));
  const provider: Provider = (world, c) => {
    const scripted = new Map(archProvider(world, c).map((d) => [d.firm_id, d]));
    const out: FirmDecision[] = [];
    world.firms.forEach((f, i) => {
      if (f.status !== "active") return;
      if (i % 2 === 0) out.push(decideAdaptive(ADAPTIVE_LEANS[leanIdx[i >> 1]], f, world, c));
      else {
        const d = scripted.get(f.id);
        if (d) out.push(d);
      }
    });
    return out;
  };
  return runOne(config, labels, provider);
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

/** Overbuilder probe (DW-042): the same adaptive field, but one firm is forced to
 *  build capacity hard through the early game regardless of its forecast. Run it
 *  against `runAdaptive(seed)` on the same seed and compare that firm's late-game
 *  utilization and cumulative net income with its disciplined twin — the direct
 *  test that the stranded-capacity trap is REACHABLE (a population average can't
 *  show that, because rational agents refuse to walk into it). */
export function runOverbuilder(seed: number, firmIdx = 5): RunMetrics {
  const config = configWithSeed(seed);
  const labels = ADAPTIVE_LEANS.map((l, i) => (i === firmIdx ? `${l.id}+overbuild` : l.id));
  const provider: Provider = (world, c) => {
    const out: FirmDecision[] = [];
    world.firms.forEach((f, i) => {
      if (f.status !== "active") return;
      const d = decideAdaptive(ADAPTIVE_LEANS[i % ADAPTIVE_LEANS.length], f, world, c);
      // Build INTO the maturing market (rounds 5–9), after the early land-grab: the
      // real stranded-capacity error was expanding late in the boom, and building at
      // round 1 into genuine scarcity is simply correct (measured: it pays).
      // Overbuild = +40% of the firm's OWN installed capacity per round for five rounds (≈2.5×
      // by r9), so the probe scales with the firm rather than adding a fixed $64k that a
      // capacity-short winner in a richer preset would simply sell through (DW-046).
      if (i === firmIdx && world.round >= 5 && world.round <= 9) d.invest_cap += (0.4 * (f.cap + facilityCapacity(f, c, world.round))) / c.capacity.gain;
      out.push(d);
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
