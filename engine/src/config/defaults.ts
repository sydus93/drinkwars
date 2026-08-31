/**
 * Baseline Drink Wars config (§14). This is the canonical v1 parameterization —
 * the starting point the balance harness stresses and tunes. Alternative configs
 * (overrides merged over this) are the research treatment-condition mechanism.
 *
 * Values are deliberate first guesses; §16 pathologies are expected to drive
 * tuning. Beverage labels are comments only — engine keys stay generic.
 *
 * MONEY & VOLUME SCALE (DW-029): the engine speaks REAL DOLLARS and REAL DRINKS.
 * One round ≈ one fiscal quarter of a US craft-beverage firm; one unit = one
 * drink (pint/can equivalent). Calibration anchors (see vault DW-029 for cites):
 *   - Home market ≈ a metro of ~180k residents at ~4.3 craft drinks/resident/qtr
 *     (Brewers Association 2024 per-capita craft consumption).
 *   - A firm ≈ a taproom-tier craft brewery: ~80k drinks/qtr (~1,300 bbl/yr),
 *     revenue ~$400–700k/qtr, startup capitalization ~$400–750k.
 *   - Prices are per-drink taproom pours ($6–9); c_base is the fully-loaded
 *     VARIABLE cost per drink served (ingredients + packaging + serving labor +
 *     excise + card fees — not just brewing COGS), so gross margin starts ~35%
 *     and climbs toward taproom-like margins as learning/process bite.
 *
 * This scale was reached from the old "toy" units by an EXACT units change
 * (×400 on all $ lump sums and drink volumes, sqrt-conversion gains ÷20,
 * $-denominated halfsats/thresholds ×400, per-drink and dimensionless values
 * unchanged) — dynamics-identical by construction, verified against the balance
 * harness. Bot heuristics (bots/*, harness/archetypes.ts) are scaled to match.
 * If you rescale again, scale ALL of it or the dynamics change.
 */
import type { Config } from "../types.js";
import { defaultModules } from "./modules.js";

export const defaultConfig: Config = {
  game: {
    n_rounds: 16,
    n_firms: 8,
    seed: 12345,
  },

  init: {
    starting_cash: 460_000, // seed capitalization — benchmark taproom brewery $400–750k
    // 40k→64k (DW-042): demand/installed-capacity starts at 1.22× instead of 1.95×.
    // At 1.95× every firm sold everything it could brew all game, so overbuilding
    // capacity — the defining craft-beer strategy error of the 2020s — was literally
    // unreachable (the calibrate.ts stranded-capacity probe showed a forced
    // overbuilder MAKING money at 1.39×). At 1.22×, with honest idle-capacity
    // carrying costs below, the probe finally punishes.
    starting_cap: 64_000, // drinks/qtr of production capacity (~1,050 bbl/yr)
    starting_debt: 80_000, // modest opening equipment note
    starting_Q: 10,
    starting_B: 10,
    starting_T_emp: 10,
    starting_T_inv: 10,
    starting_T_gov: 10,
    starting_process: 5,
  },

  segments: [
    {
      // Mass — approachable lagers / light: price-sensitive, high volume.
      // βp eased and D0 raised so a volume/cost-leadership play is a viable
      // counter to premium focus (otherwise niche strictly dominates).
      id: "mass",
      alpha: 3.2,
      beta_p: 0.37,
      beta_q: 0.05,
      beta_b: 0.05,
      beta_fit: 0.5,
      D0: 440_000, // drinks/qtr city-wide
      // growth 1.02→1.005/qtr (DW-042): the old 8%/yr encoded the 2010s craft boom.
      // BA 2024–25: craft volume is FLAT to declining; a mature local market grows
      // ~2%/yr at best. Compounding boom-rate demand re-tightened supply by mid-game
      // and made overbuilding profitable no matter the starting ratio.
      growth: 1.005,
      U0: 1.2,
      active_at_start: true,
      emerge_round: null,
      emerge_capability_threshold: null,
    },
    {
      // Niche — craft premium (IPAs, specialty): quality/brand-sensitive.
      // U0/βp raised and βq trimmed so niche is a real contest, not a safe rent.
      // βp at 0.3 (still < mass's 0.33) makes monopoly pricing cost real share, so
      // premium focus is a strong play, not a free lunch.
      id: "niche",
      alpha: 2.5,
      beta_p: 0.4,
      beta_q: 0.16,
      beta_b: 0.16,
      beta_fit: 0.5,
      D0: 184_000,
      growth: 1.01, // premium still outgrows mass (4%/yr), but no longer boom-rate (DW-042)
      U0: 0.9,
      active_at_start: true,
      emerge_round: null,
      emerge_capability_threshold: null,
    },
    {
      // Frontier — non-alcoholic / functional: the "new category" emergence.
      // High U0 + the cross-segment substitution term cap a thin-segment monopoly.
      id: "frontier",
      alpha: 2.2,
      beta_p: 0.36,
      beta_q: 0.14,
      beta_b: 0.16,
      beta_fit: 0.5,
      D0: 152_000,
      growth: 1.03, // an emerging category can still grow ~12%/yr — the game's one growth story (DW-042)
      U0: 1.1,
      active_at_start: false,
      emerge_round: 9,
      emerge_capability_threshold: 320, // OR total Q across firms crosses this
    },
  ],

  demand: {
    // 0.5→0.65 (DW-042): when a firm rations, most of its unserved customers walk
    // (outside option) rather than queue at whichever rival has spare tanks. At 0.5
    // the spill was generous enough that holding excess capacity harvested rivals'
    // rationing — overbuilding worked as cheap insurance (see the calibrate probe).
    unmet_demand_lost_fraction: 0.65,
    cross_segment_substitution: 0.2,
  },

  costs: {
    c_base: 5.0, // $/drink fully-loaded variable cost (see header note)
    learning_rate: 0.92, // ~8% cost decline per doubling of cumulative output
    learning_q0: 200_000, // drinks of cumulative output where learning starts to bite
    learning_floor: 0.45,
    location_factor_mean: 1.0,
    location_factor_sd: 0.06,
    productivity_kappa: 0.5,
    productivity_halfsat: 20,
    process: {
      depreciation: 0.1,
      gain: 0.05, // sqrt conversion on $ spend (was 1.0 at toy scale; ÷√400)
      lag: 1,
      conversion: "sqrt",
      effect_max: 0.3, // process can shave up to 30% off unit cost
      halfsat: 20,
    },
    // Premium recipes cost more to brew — the cost-side counterweight to quality's
    // demand pull, so a pure quality rush trades margin for appeal (κ = up to +45%
    // unit cost at very high Q; halfsat sets how fast it bites).
    quality_premium: { kappa: 0.45, halfsat: 35 },
  },

  capacity: {
    depreciation: 0.1,
    gain: 0.25, // $X capex → 0.25·X drinks/qtr of capacity (book_value_per_unit = 4)
    lag: 1,
    conversion: "linear",
    // 0.2→0.4 (DW-042): idle capacity has to hurt. At $0.2/qtr a drink of unused
    // brewhouse paid for itself at ~30% utilization, so overbuilding was cheap
    // insurance; at $0.4 (lease + utilities + insurance on space you aren't
    // filling) a stranded expansion is a real P&L wound — the calibrate.ts
    // stranded-capacity probe is the regression test for exactly this.
    fixed_cost_per_unit: 0.4, // $/qtr upkeep per drink of quarterly capacity
    book_value_per_unit: 4.0, // ≈$250/bbl-yr of capacity — generic expansion tanks
  },

  stocks: {
    // Q/B lag 2→1 (turnaround tuning 2026-07-17, vault 09 audit): a good midgame
    // strategy shows in the product NEXT round, not three rounds out. Gain stays
    // 0.0425 — raising it to 0.055 alongside lag 1 lifted the steady-state stock a
    // spender can hold and tripped the §16.2 dominant-strategy gate (brand_builder
    // 63%); lag-only moves the TIMING of payoff without cheapening the lever.
    Q: { depreciation: 0.18, gain: 0.0425, lag: 1, conversion: "sqrt" },
    // B decay 0.18→0.21 (DW-042): abundant capacity (starting_cap 56k) removed the
    // supply cap on demand-side plays and pushed brand_builder's fixed-sweep win share
    // to 71% (§16.2 FAIL). Faster brand decay makes the brand position a flow to keep
    // funding, not a stock to sit on — attention fades faster than craft skill.
    B: { depreciation: 0.21, gain: 0.0425, lag: 1, conversion: "sqrt" },
    T_emp: { depreciation: 0.1, gain: 0.05, lag: 1, conversion: "sqrt" },
    T_inv: { depreciation: 0.1, gain: 0.05, lag: 1, conversion: "sqrt" },
    T_gov: { depreciation: 0.1, gain: 0.05, lag: 1, conversion: "sqrt" },
  },

  finance: {
    // Quarterly rates (round = quarter). Base borrowing ≈ 2.5%/qtr ≈ 10% APR —
    // benchmark SBA 7(a) 9–11.5% APR (2025–26). Leverage/coverage penalties still
    // push a stretched firm's rate well past 20% APR.
    r_f: 0.015,
    base_spread: 0.01,
    spread_leverage_k: 0.05,
    leverage_ref: 1.0,
    spread_tinv_k: 0.0015,
    tinv_ref: 10,
    coverage_threshold: 1.5,
    coverage_penalty_spread: 0.1,
    max_leverage: 3.0,
    equity_issue_cost_base: 0.05,
    equity_issue_cost_tinv_k: 0.002,
    fixed_overhead: 28_000, // $/qtr G&A: insurance, licenses, card fees, admin
    regulatory_burden_base: 16_000, // $/qtr compliance drag, relieved by T_gov
    regulatory_burden_halfsat: 10,
    dividend_max_fraction: 0.5,
    solvency_runway_rounds: 5, // DW-051: 3→5 so the M&A window (min_distress_rounds 3) opens before the covenant closes
    valuation: {
      multiple: 12, // ≈3× annualized quarterly earnings — distressed craft-M&A comps
      normalization_window: 3,
      // $ of valuation per unit of stock (scaled with the money units)
      premium_weights: { cap: 0, Q: 800, B: 800, T_emp: 400, T_inv: 400, T_gov: 400, process: 0 },
    },
  },

  exit: {
    base_recovery: 0.8,
    liquidation_decay: 0.2,
    bankruptcy_recovery: 0.1,
    reentry_cost: 160_000,
    reentry_cost_escalation: 1.5,
    reentry_cooldown_rounds: 1,
  },

  shocks: {
    types: [
      {
        // Water scarcity / drought — an unannounced resilience shock. It strikes
        // without a multi-round telegraph (a drought isn't on the calendar), so the
        // lesson is standing preparedness — water-efficiency + process/community
        // resilience built BEFORE trouble, not a reaction to a countdown.
        id: "water",
        kind: "cost_spike",
        target: "all",
        magnitude_mean: 0.35,
        magnitude_sd: 0.07,
        prob_per_round: 0.35,
        earliest_round: 6,
        latest_round: 14,
        signaling: "unannounced",
        resilience_mitigated: true,
        duration: 2,
        regional: true, // a drought hits ONE region's water — exposure depends on where you produce
      },
      {
        // Hop/barley harvest failure — dramatic unannounced cost spike.
        id: "harvest",
        kind: "cost_spike",
        target: "all",
        magnitude_mean: 0.55,
        magnitude_sd: 0.1,
        prob_per_round: 0.2,
        earliest_round: 8,
        latest_round: 14,
        signaling: "unannounced",
        resilience_mitigated: true,
        duration: 1,
      },
      // ── Gamemaster-only events (DW-044): prob_per_round 0 — these NEVER roll on
      // their own. They exist so an instructor can plant demand-side turns from the
      // Schedule tab and align the market's story with the syllabus week by week.
      {
        // Macro slump — consumers tighten up across every segment.
        id: "demand_slump",
        kind: "demand_drop",
        target: "all",
        magnitude_mean: 0.15,
        magnitude_sd: 0.03,
        prob_per_round: 0,
        earliest_round: 1,
        latest_round: 15,
        signaling: "signaled_noisy", // macro turns have leading indicators — info buyers see it coming
        resilience_mitigated: false,
        duration: 2,
      },
      {
        // Craft wave — festival season / tourist influx lifts the whole market.
        id: "craft_wave",
        kind: "demand_boost",
        target: "all",
        magnitude_mean: 0.15,
        magnitude_sd: 0.03,
        prob_per_round: 0,
        earliest_round: 1,
        latest_round: 15,
        signaling: "signaled_noisy",
        resilience_mitigated: false,
        duration: 2,
      },
      {
        // Health shift — tastes turn away from legacy alcohol (mass segment). Pairs
        // with the frontier growth story: plant it as the maturing-industry beat.
        id: "health_shift",
        kind: "demand_drop",
        target: "mass",
        magnitude_mean: 0.2,
        magnitude_sd: 0.04,
        prob_per_round: 0,
        earliest_round: 1,
        latest_round: 15,
        signaling: "signaled_noisy",
        resilience_mitigated: false,
        duration: 3,
      },
      {
        // NA moment — the non-alcoholic category goes mainstream. Only meaningful
        // once frontier has emerged (round 9 by default); plant it after.
        id: "na_moment",
        kind: "demand_boost",
        target: "frontier",
        magnitude_mean: 0.25,
        magnitude_sd: 0.05,
        prob_per_round: 0,
        earliest_round: 1,
        latest_round: 15,
        signaling: "signaled_noisy",
        resilience_mitigated: false,
        duration: 3,
      },
      {
        // CO2 / packaging squeeze — capacity hit.
        id: "co2",
        kind: "capacity_hit",
        target: "all",
        magnitude_mean: 0.28,
        magnitude_sd: 0.06,
        prob_per_round: 0.15,
        earliest_round: 8,
        latest_round: 14,
        signaling: "unannounced",
        resilience_mitigated: true,
        duration: 1,
      },
    ],
    resilience_process_k: 0.6,
    resilience_temp_k: 0.6,
    resilience_halfsat: 20,
    max_mitigation: 0.8,
    endogenous: {
      antitrust: {
        base_prob: 0.3,
        tgov_k: 0.04,
        penalty_cash: 120_000, // consumer-protection / antitrust fine
        penalty_constrain_rounds: 3,
      },
      distress_dumping: {
        min_share_to_trigger: 0.15,
        price_depression: 0.5,
        duration: 1,
      },
    },
  },

  coopetition: {
    forms: {
      relational: { formation_cost: 0, defect_trust_cost_emp: 5, defect_trust_cost_inv: 5 },
      formal: { formation_cost: 20_000, breach_penalty: 60_000 },
      collective: { formation_cost: 40_000, min_size: 3, freerider_decay: 0.1 },
    },
    templates: {
      joint_marketing: { brand_pool_fraction: 0.3 },
      capacity_coordination: { capacity_restraint: 0.2 },
      supply_share: { unit_cost_reduction: 0.1 },
    },
    antitrust_coordination_threshold: 1,
  },

  information: {
    cost: 12_000, // market research: a syndicated consumer study (§15.7)
  },

  // Expansion modules (04_expansion_module_spec). All off by default ⇒ identical
  // to the v1 base game. Per-game "modes" are just a subset of these flags flipped
  // on (see config/modules.ts for the registry + instructor presets).
  modules: defaultModules,

  scoring: {
    weights: { financial: 0.3, market: 0.3, intangible: 0.2, stakeholder: 0.2 },
    accumulation: "round_average",
    normalization: "zscore_within_round",
    // profitability 0.3 / soundness 0.4 (was 0.4/0.3): expensed capability building
    // (Q/B invest) no longer brands a firm financially weak in the exact rounds it
    // invests — the z-of-this-quarter-NI penalty was a secondary audit finding.
    financial_blend: { profitability: 0.3, soundness: 0.4, cash_resilience: 0.3 },
    cash_safety_threshold: 120_000,
    healthy_coverage: 2.0,
    healthy_leverage: 1.5,
    // Scoring layer (06_scoring_layer_spec) — everything at its no-op default, so
    // output is byte-identical to the pre-layer engine (acceptance gate §8.1).
    // drop_first is expected to move to 1–2 once live-play data says how many rounds
    // the interface takes to learn; flip it per-game, not here, until then.
    accumulation_window: { drop_first: 0, tail_only: null },
    terminal_weight: 0,
    penalties: [],
    // §5 benchmark bands — DISPLAY ONLY (gate §8.6: mutating these changes no score).
    // Derived 2026-08-11 via `npm run bands` (mixed population, 24 seeds, steady-state,
    // base + full preset; below P30 → weak, P30–P75 → sound, above P75 → strong),
    // then rounded to teachable numbers reconciled across both configs:
    //   roic            base P30/50/75 = −.024/.027/.062, full −.060/.007/.049 → weak
    //                   boundary set at 0 (losing money reads "weak" — the honest lesson;
    //                   quarterly, so ~12%/yr = sound, ~25%/yr = strong).
    //   interest_cover  cohort distribution is degenerate (most firms run near debt-free:
    //                   P50 = cap), so these are the textbook finance thresholds instead;
    //                   the UI shows "no debt" rather than a tier when debt ≈ 0.
    //   segment_share   sums across segments (a two-segment firm adds both).
    //   intangible_index Q+B; P75 ≈ 47 in BOTH configs — unusually stable.
    //   stakeholder_mean starting stocks are 10, so ≤10.5 = "never invested in people/
    //                   investors/regulators", the weak read.
    // Re-run `npm run bands` after any economy retune; these move with the economy.
    benchmark_bands: {
      roic: { weak: 0.0, sound: 0.03, strong: 0.06 },
      interest_cover: { weak: 1.5, sound: 3.0, strong: 6.0 },
      segment_share: { weak: 0.12, sound: 0.25, strong: 0.45 },
      intangible_index: { weak: 18, sound: 32, strong: 47 },
      stakeholder_mean: { weak: 10.5, sound: 18, strong: 28 },
    },
  },
};
