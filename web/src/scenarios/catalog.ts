/**
 * Mini-scenarios — curated teaching bundles over the deterministic engine.
 *
 * A scenario is CONFIGURATION, not mechanics: a `ConfigOverride` (deep-partial of
 * the engine `Config`, see engine/src/types.ts:712) that cranks ONE strategic
 * concept into the dominant driver of a short 3–5 round run, plus an objective
 * and a canned debrief that ties the run back to theory.
 *
 * Key facts about the override plumbing (verified against the engine):
 *  - `ConfigOverride = DeepPartial<Config>`, and `resolveConfig` deep-merges it
 *    over `defaultConfig` (engine/src/config/resolve.ts). Scalars and nested
 *    objects merge key-by-key; ARRAYS REPLACE WHOLESALE (deepMerge: "Arrays
 *    replace"). So `segments` and `shocks.types` must be supplied as COMPLETE
 *    arrays of complete objects — we derive them from the exported
 *    `defaultConfig` so they never drift from the engine baseline.
 *  - The horizon lives INSIDE the override at `game.n_rounds` — there is no
 *    separate start() option for it. `Scenario.horizon` mirrors it for display.
 *  - A deterministic "scheduled" shock is a ShockTypeConfig with
 *    prob_per_round: 1, earliest_round === latest_round, magnitude_sd: 0.
 *  - QUIRK: `Config.modules` is OPTIONAL, and DeepPartial's conditional does not
 *    recurse into optional object keys (`ModulesConfig | undefined` fails the
 *    `extends object` test) — so an override that touches `modules` must supply
 *    a COMPLETE `ModulesConfig`. We build it by spreading the engine's exported
 *    `defaultModules` (runtime-identical to what deepMerge would produce).
 *  - Launch path: `useGame().start({ breweryName, difficulty, override: s.override })`
 *    (web/src/game/useGame.ts → SinglePlayerGame.start → resolveConfig(override)).
 */
import { defaultConfig, defaultModules } from "drinkwars-engine";
import type { ConfigOverride, ModulesConfig, SegmentConfig, ShockKind, ShockTypeConfig } from "drinkwars-engine";

export interface Scenario {
  id: string;
  title: string;
  concept: string; // the one idea it isolates
  week: string; // canonical strategy-course week
  takeaway: string; // the nameable lesson
  blurb: string; // 1–2 sentence setup shown on the card
  objective: string; // explicit player goal for the run
  debrief: string; // canned tie-back to theory, shown at the end
  horizon: number; // n_rounds (short: 1–5); mirrors override.game.n_rounds
  override: ConfigOverride; // the config crank (typed against the real engine)
  notes?: string; // anything not expressible in override, for the integrating engineer
}

// ---------------------------------------------------------------------------
// Helpers. Arrays replace wholesale in resolveConfig's deepMerge, so any
// override touching `segments` or `shocks.types` must ship the FULL array.
// We copy from the engine's own defaultConfig so values can't drift.
// ---------------------------------------------------------------------------

/** Full segments array = engine defaults with per-segment tweaks spread on top. */
function segmentsWith(tweaks: Partial<Record<"mass" | "niche" | "frontier", Partial<SegmentConfig>>>): SegmentConfig[] {
  return defaultConfig.segments.map((s) => ({ ...s, ...(tweaks[s.id as "mass" | "niche" | "frontier"] ?? {}) }));
}

/** Keep the frontier segment out of a short run (its default timed/threshold
 *  emergence would otherwise inject a second storyline mid-scenario). */
const FRONTIER_OFF: Partial<SegmentConfig> = { emerge_round: null, emerge_capability_threshold: null };

/** No exogenous shocks at all — the neutralizer for scenarios about something else. */
const NO_SHOCKS: ShockTypeConfig[] = [];

/** Full ModulesConfig = engine defaults (all off) with per-module replacements.
 *  Required because `Config.modules` is optional, so ConfigOverride does NOT
 *  deep-partialize it (see header note) — a partial block would not typecheck. */
function modulesWith(tweaks: Partial<ModulesConfig>): ModulesConfig {
  return { ...defaultModules, ...tweaks };
}

/** A DETERMINISTIC shock: fires exactly once, in exactly `round`, at exactly
 *  `magnitude` (prob 1 in a single eligible round, sd 0). */
function scheduledShock(s: {
  id: string;
  kind: ShockKind;
  round: number;
  magnitude: number;
  duration?: number;
  signaling?: "unannounced" | "signaled_noisy";
  mitigated?: boolean;
}): ShockTypeConfig {
  return {
    id: s.id,
    kind: s.kind,
    target: "all",
    magnitude_mean: s.magnitude,
    magnitude_sd: 0,
    prob_per_round: 1,
    earliest_round: s.round,
    latest_round: s.round,
    signaling: s.signaling ?? "unannounced",
    resilience_mitigated: s.mitigated ?? true,
    duration: s.duration ?? 1,
  };
}

// ---------------------------------------------------------------------------
// The 8 starter scenarios.
// ---------------------------------------------------------------------------

export const SCENARIOS: Scenario[] = [
  {
    id: "race-to-the-bottom",
    title: "Race to the Bottom",
    concept: "Cost vs. differentiation",
    week: "Generic strategies",
    takeaway: "Diving into price too early compresses everyone's margins — differentiation is the escape hatch.",
    blurb: "The Mass segment has turned brutally price-elastic: a nickel off the pour buys real share, and every rival knows it. Four quarters to see where a price war actually leads.",
    objective: "Finish in the top 3 on cumulative profit — not volume. Try one round of price-cutting in Mass, watch the margin math, then decide whether to keep fighting there or reposition toward Niche.",
    debrief: "Porter's generic strategies: when buyers are highly price-sensitive and products undifferentiated, price cuts are matched and the surplus transfers to consumers (Bertrand logic) — the industry races to the bottom. Cost leadership only works if your costs are genuinely lower; otherwise the profitable move is to step OUT of the price contest and compete on quality/brand where willingness-to-pay, not price, drives choice.",
    horizon: 4,
    override: {
      game: { n_rounds: 4 },
      // Mass cranked to near-pure price competition (βp 0.37→0.85, quality/brand
      // muted, pool enlarged so it's tempting); Niche left at baseline as the
      // differentiation refuge; growth flattened + frontier/shocks off = nothing
      // else moving.
      segments: segmentsWith({
        mass: { beta_p: 0.85, beta_q: 0.02, beta_b: 0.02, D0: 560_000, growth: 1.0 },
        niche: { growth: 1.0 },
        frontier: FRONTIER_OFF,
      }),
      shocks: { types: NO_SHOCKS },
    },
  },
  {
    id: "depreciation-cliff",
    title: "The Depreciation Cliff",
    concept: "Intangibles & commitment",
    week: "Resources & capabilities",
    takeaway: "Brand and quality are stocks, not switches — stop investing and they decay, and demand erodes with them.",
    blurb: "You inherit a firm with an enviable brand and recipe book — but in this market, reputations rot fast. Milk the stocks or maintain them?",
    objective: "End the 4 quarters with your Quality and Brand stocks at or above where they started, while staying profitable. Feel the run-rate of investment it takes just to stand still.",
    debrief: "The resource-based view treats capabilities as asset STOCKS built by flows of investment (Dierickx & Cool's 'asset stock accumulation'). Depreciation means yesterday's advantage is a wasting asset: cutting brand/quality spend flatters this quarter's P&L while the demand curve quietly walks away. Time-compression diseconomies work the other way too — you can't rebuild a decayed stock in one big round of spend.",
    horizon: 4,
    override: {
      game: { n_rounds: 4 },
      // Start rich in intangibles (10→26) but crank Q/B depreciation 0.18→0.40 so
      // the melt is the story. Investment gains stay at baseline: fighting the
      // decay is possible, just expensive. Everything else neutralized.
      init: { starting_Q: 26, starting_B: 26 },
      stocks: { Q: { depreciation: 0.4 }, B: { depreciation: 0.4 } },
      segments: segmentsWith({ frontier: FRONTIER_OFF }),
      shocks: { types: NO_SHOCKS },
    },
  },
  {
    id: "blue-water",
    title: "Blue Water",
    concept: "Optimal distinctiveness",
    week: "Positioning",
    takeaway: "When the middle of the market is crowded, the profitable position is the underserved price/quality niche — find it before rivals do.",
    blurb: "Seven well-capitalized rivals sit on top of a converged mainstream taste, and you start behind on brand and quality. In quarter 2, a new underserved category surfaces.",
    objective: "Don't slug it out in the crowded middle. When the Frontier segment emerges in round 2, be first to position into it (price, quality, presence) and own it by the final round.",
    debrief: "Positioning theory (Hotelling location logic, blue-ocean strategy, optimal distinctiveness): profit lives where willingness-to-pay is high and rivalry is low. Head-to-head at the market centroid dissipates rents through imitation and price pressure; the entrant's edge is spotting the underserved niche and committing early — differentiation is only valuable when it maps to real unmet demand.",
    horizon: 5,
    override: {
      game: { n_rounds: 5 },
      // The mainstream converges to a crowded centroid (mass and niche made
      // similar), while the frontier — quality/brand-hungry, price-insensitive,
      // growing — emerges deterministically in round 2 as the blue water.
      segments: segmentsWith({
        mass: { beta_p: 0.5, beta_q: 0.1, beta_b: 0.1, growth: 1.0 },
        niche: { beta_p: 0.45, beta_q: 0.12, beta_b: 0.12, D0: 240_000, growth: 1.0 },
        frontier: {
          active_at_start: false,
          emerge_round: 2,
          emerge_capability_threshold: null,
          alpha: 2.6,
          beta_p: 0.18,
          beta_q: 0.28,
          beta_b: 0.22,
          D0: 200_000,
          growth: 1.08,
          U0: 0.8,
        },
      }),
      // The rivals start entrenched, you start behind. NOTE the deliberate label
      // inversion: engine/init.ts gives the "incumbent" profile to the FIRST
      // incumbent_count firms, and the human is firm index 0 — so with
      // incumbent_count: 1 the "incumbent" profile targets exactly the PLAYER and
      // the "entrant" profile targets all seven rivals.
      modules: modulesWith({
        asymmetricStarts: {
          enabled: true,
          incumbent_count: 1,
          incumbent: { cap: 0.9, B: 0.6, Q: 0.7, cash: 1.15, unit_cost: 1.0 }, // = YOU (scrappy, cash-ok, behind on stocks)
          entrant: { cap: 1.3, B: 1.5, Q: 1.4, cash: 1.0, unit_cost: 0.95 }, // = the seven entrenched rivals
        },
      }),
      shocks: { types: NO_SHOCKS },
    },
    notes:
      "Recommend launching with difficulty: 'cutthroat' — that roster (controller.ts ROSTERS) stacks quality/brand bots that pile into the contested middle, which is the point. The asymmetricStarts profile-name inversion above is intentional and verified against engine/src/engine/init.ts (firmProfile: i < incumbent_count ⇒ 'incumbent'; the human is firm_1 = index 0). There is no config key for 'place rival bots at the centroid' beyond segment shaping + roster choice.",
  },
  {
    id: "leverage-trap",
    title: "The Leverage Trap",
    concept: "Cost of capital",
    week: "Financial strategy",
    takeaway: "A healthy P&L with thin interest coverage is one shock away from a credit cliff — capital structure is a strategy choice.",
    blurb: "The books show profit, but the balance sheet is stretched: heavy debt, thin coverage, and a hop-harvest failure already on the forecast for quarter 2.",
    objective: "Survive the round-2 cost spike without hitting the coverage penalty or the leverage cap. Decide in round 1: de-lever (repay/raise equity) and give up growth, or hold the debt and pray the margin holds.",
    debrief: "Cost of capital is state-contingent: spreads rise with leverage and collapse coverage triggers punitive repricing and credit rationing — exactly when you need cash most (the 'credit cliff'). Modigliani-Miller breaks under distress costs: the option value of a conservative balance sheet is insurance against shocks. Healthy earnings are not the same as debt capacity.",
    horizon: 4,
    override: {
      game: { n_rounds: 4 },
      // High starting leverage (debt 80k→320k against ~140k opening equity ⇒
      // D/E ≈ 2.3 vs. the 3.0 cap) + a harsher spread curve and coverage trigger,
      // + a TELEGRAPHED deterministic cost spike in round 2 (signaled_noisy: the
      // lesson is balance-sheet structure, not surprise).
      init: { starting_cash: 300_000, starting_debt: 320_000 },
      finance: { spread_leverage_k: 0.12, coverage_threshold: 2.0, coverage_penalty_spread: 0.18 },
      shocks: {
        types: [scheduledShock({ id: "harvest", kind: "cost_spike", round: 2, magnitude: 0.5, duration: 2, signaling: "signaled_noisy", mitigated: false })],
      },
      segments: segmentsWith({ frontier: FRONTIER_OFF }),
    },
  },
  {
    id: "strong-pnl-no-cash",
    title: "Strong P&L, No Cash",
    concept: "Accrual vs. cash",
    week: "Financial analysis",
    takeaway: "You can be profitable on paper and insolvent in cash — capex timing and working capital are where income statements lie.",
    blurb: "Demand is there and margins are fine — but capacity takes two quarters to come online, inventory ties up cash on the shelf, and the till is thin.",
    objective: "Grow capacity to meet demand WITHOUT letting cash run dry: end every round solvent and finish with positive cumulative net income AND more cash than you started with. Watch the gap between net income and the cash line.",
    debrief: "Accrual accounting recognizes profit when earned; cash leaves when capex is paid and inventory is brewed — the timing mismatch is working capital. Growing firms fail solvent-on-paper all the time ('overtrading'): capex leads revenue by the build lag, and every unit carried is cash on a shelf. Read the cash flow statement, not just the P&L, and finance the gap BEFORE it opens.",
    horizon: 4,
    override: {
      game: { n_rounds: 4 },
      // Thin till + undersized plant force growth capex; capacity lag 1→2 makes
      // the cash leave two quarters before the revenue lands; inventory mode ON
      // (spoilage + holding cost) turns production itself into working capital.
      init: { starting_cash: 180_000, starting_cap: 28_000 },
      capacity: { lag: 2 },
      modules: modulesWith({ inventory: { enabled: true, spoilage_rate: 0.08, max_run_rate: 1.15, holding_cost_per_unit: 0.25 } }),
      scoring: { cash_safety_threshold: 150_000 },
      segments: segmentsWith({ frontier: FRONTIER_OFF }),
      shocks: { types: NO_SHOCKS },
    },
  },
  {
    id: "weather-the-drought",
    title: "Weather the Drought",
    concept: "Foresight & resilience",
    week: "Competitive dynamics / risk",
    takeaway: "Resilience is bought before the storm: prior process, sustainability, and community investment pay off under stress.",
    blurb: "The long-range forecast is grim: a multi-quarter water crunch arrives in round 3. Two rounds to prepare — efficiency, process, the water commons — then it hits everyone.",
    objective: "Use rounds 1–2 to build mitigation (water-efficiency, process, employee trust, the shared water commons), then come through the round 3–5 drought with the smallest unit-cost hit in the field and cash intact.",
    debrief: "Dynamic capabilities and real-options logic: resilience investments look like negative-NPV overhead until the state of the world flips — then they're the whole game. The engine's mitigation stocks (process, trust, water efficiency, the commons pool) only work if built BEFORE the shock, because stocks accumulate with lags. Note the collective-action angle: the water commons is a shared public good — underprovision is rational for each firm and costly for all (Ostrom).",
    horizon: 5,
    override: {
      game: { n_rounds: 5 },
      // ONE deterministic slow-burn water shock: signaled in advance (foresight),
      // heavy (55% cost spike), long (rounds 3–5), and strongly mitigable —
      // resilience coefficients cranked so preparation visibly separates firms.
      shocks: {
        types: [scheduledShock({ id: "water", kind: "cost_spike", round: 3, magnitude: 0.55, duration: 3, signaling: "signaled_noisy", mitigated: true })],
        resilience_process_k: 0.8,
        resilience_temp_k: 0.8,
        max_mitigation: 0.9,
      },
      // Sustainability = the direct water-efficiency lever; publicGoods = the
      // shared water-commons pool (its default goods include water_resilience).
      modules: modulesWith({
        sustainability: { ...defaultModules.sustainability, enabled: true },
        publicGoods: { ...defaultModules.publicGoods, enabled: true },
      }),
      segments: segmentsWith({ frontier: FRONTIER_OFF }),
    },
  },
  {
    id: "make-or-ally",
    title: "Make or Ally",
    concept: "Coopetition & governance",
    week: "Alliances & cooperation",
    takeaway: "Building capabilities alone is slow and costly; allying is fast but exposes you to defection — governance form is the real choice.",
    blurb: "You start behind on quality and brand, and building them organically has gotten slow and expensive. Rivals will deal — joint marketing, shared supply — if you'll take the partnership risk.",
    objective: "Close the capability gap by the final round. Compare the organic path (invest and wait out the lag) against at least one agreement — and choose its governance form (relational handshake vs. formal contract) with the defection math in mind.",
    debrief: "Transaction-cost economics (Williamson): the make/buy/ally choice turns on governance. Relational contracts are cheap to form but enforced only by trust and reputation; formal contracts cost more upfront and deter breach with penalties; both beat 'make' when internal accumulation is slow (time-compression diseconomies again). Coopetition adds the twist that today's partner is tomorrow's rival — expect defection where its payoff exceeds the trust/penalty cost.",
    horizon: 5,
    override: {
      game: { n_rounds: 5 },
      // The MAKE path is slowed (Q/B gains halved, lag 2→3): organic catch-up
      // barely fits the horizon. The ALLY path is sweetened (joint marketing
      // pools half the brand, supply-share cuts costs 22%) but defection stakes
      // are raised on both governance forms.
      stocks: { Q: { gain: 0.02, lag: 3 }, B: { gain: 0.02, lag: 3 } },
      coopetition: {
        forms: {
          relational: { defect_trust_cost_emp: 8, defect_trust_cost_inv: 8 },
          formal: { formation_cost: 12_000, breach_penalty: 80_000 },
        },
        templates: {
          joint_marketing: { brand_pool_fraction: 0.5 },
          supply_share: { unit_cost_reduction: 0.22 },
        },
        antitrust_coordination_threshold: 2,
      },
      // Contingent clauses + renegotiation give agreements real governance texture.
      modules: modulesWith({
        contingentContracts: { ...defaultModules.contingentContracts, enabled: true },
        renegotiation: { ...defaultModules.renegotiation, enabled: true },
      }),
      segments: segmentsWith({ frontier: FRONTIER_OFF }),
      shocks: { types: NO_SHOCKS },
    },
    notes:
      "A per-firm capability GAP (you weak, rivals strong) is expressed via modules.asymmetricStarts with incumbent_count: 1 in Blue Water; here I left starts symmetric and instead slowed the organic build path, because stacking both made the solo game unwinnable in playtest-less theory. If you want the explicit gap too, copy the asymmetricStarts block from 'blue-water' (remember: 'incumbent' profile = the human, firm index 0). Also note agreement dynamics depend on the adaptive bots' willingness to accept/propose pacts — verify bots respond to agreement_actions in solo before shipping this one.",
  },
  {
    id: "know-when-to-fold",
    title: "Know When to Fold",
    concept: "Exit timing",
    week: "Shakeout / corporate scope",
    takeaway: "Liquidation value decays every round you bleed — the discipline is timing the exit, not avoiding it.",
    blurb: "The market is shrinking, your costs are underwater, and the balance sheet is already thin. Recovery on a clean exit starts high — and rots a little every distressed quarter you hang on.",
    objective: "Maximize the value you walk away with. Each round, compare what a voluntary exit banks TODAY against the (decaying) odds of a turnaround — and pull the trigger at the value-maximizing moment instead of riding it to bankruptcy.",
    debrief: "Creative destruction and shakeout economics: in declining industries the option to exit is an asset, and it's a wasting one — liquidation recovery decays with distress (fire-sale discounts deepen, credibility erodes). Behavioral traps (escalation of commitment, sunk-cost reasoning) keep firms bleeding past the rational stopping point. Hysteresis cuts the other way too: exit is near-irreversible, so the timing question is a real-options problem — but here the option value is visibly rotting.",
    horizon: 4,
    override: {
      game: { n_rounds: 4 },
      // A bleeding start: thin cash, heavy debt, oversized plant, structurally
      // underwater costs (c_base 5.0→6.2 against ~$7 pours + doubled overhead)
      // in a SHRINKING market. Exit economics cranked: generous recovery if you
      // fold cleanly and early (0.85), but it decays 40%/distressed round, and
      // bankruptcy pays almost nothing (0.05).
      init: { starting_cash: 140_000, starting_debt: 300_000, starting_cap: 48_000 },
      costs: { c_base: 6.2 },
      finance: { fixed_overhead: 48_000 },
      exit: { base_recovery: 0.85, liquidation_decay: 0.4, bankruptcy_recovery: 0.05 },
      segments: segmentsWith({
        mass: { growth: 0.93 },
        niche: { growth: 0.95 },
        frontier: FRONTIER_OFF,
      }),
      shocks: { types: NO_SHOCKS },
    },
    notes:
      "The exit lever is the core FirmDecision.exit_action ({ type: 'voluntary', path: 'bank' } — engine/src/types.ts ExitAction); make sure the Play UI's exit affordance is reachable in scenario runs. Scoring still ranks by the standard scorecard; if you want 'value walked away with' to BE the graded objective, that comparison belongs in the runner's debrief screen (banked recovery vs. peers), not in config.",
  },
];
