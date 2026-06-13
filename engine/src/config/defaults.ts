/**
 * Baseline Drink Wars config (§14). This is the canonical v1 parameterization —
 * the starting point the balance harness stresses and tunes. Alternative configs
 * (overrides merged over this) are the research treatment-condition mechanism.
 *
 * Values are deliberate first guesses; §16 pathologies are expected to drive
 * tuning. Beverage labels are comments only — engine keys stay generic.
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
    starting_cash: 1150,
    starting_cap: 100, // tanks
    starting_debt: 200,
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
      D0: 1100,
      growth: 1.02,
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
      D0: 460,
      growth: 1.03,
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
      D0: 380,
      growth: 1.05,
      U0: 1.1,
      active_at_start: false,
      emerge_round: 9,
      emerge_capability_threshold: 320, // OR total Q across firms crosses this
    },
  ],

  demand: {
    unmet_demand_lost_fraction: 0.5,
    cross_segment_substitution: 0.2,
  },

  costs: {
    c_base: 5.0,
    learning_rate: 0.92, // ~8% cost decline per doubling of cumulative output
    learning_q0: 500,
    learning_floor: 0.45,
    location_factor_mean: 1.0,
    location_factor_sd: 0.06,
    productivity_kappa: 0.5,
    productivity_halfsat: 20,
    process: {
      depreciation: 0.1,
      gain: 1.0,
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
    gain: 0.25, // $X capex → 0.25·X capacity units (book_value_per_unit = 4)
    lag: 1,
    conversion: "linear",
    fixed_cost_per_unit: 0.2,
    book_value_per_unit: 4.0,
  },

  stocks: {
    Q: { depreciation: 0.18, gain: 0.85, lag: 2, conversion: "sqrt" },
    B: { depreciation: 0.18, gain: 0.85, lag: 2, conversion: "sqrt" },
    T_emp: { depreciation: 0.1, gain: 1.0, lag: 1, conversion: "sqrt" },
    T_inv: { depreciation: 0.1, gain: 1.0, lag: 1, conversion: "sqrt" },
    T_gov: { depreciation: 0.1, gain: 1.0, lag: 1, conversion: "sqrt" },
  },

  finance: {
    r_f: 0.05,
    base_spread: 0.02,
    spread_leverage_k: 0.05,
    leverage_ref: 1.0,
    spread_tinv_k: 0.0015,
    tinv_ref: 10,
    coverage_threshold: 1.5,
    coverage_penalty_spread: 0.1,
    max_leverage: 3.0,
    equity_issue_cost_base: 0.05,
    equity_issue_cost_tinv_k: 0.002,
    fixed_overhead: 70,
    regulatory_burden_base: 40,
    regulatory_burden_halfsat: 10,
    dividend_max_fraction: 0.5,
    solvency_runway_rounds: 3,
    valuation: {
      multiple: 6,
      normalization_window: 3,
      premium_weights: { cap: 0, Q: 2, B: 2, T_emp: 1, T_inv: 1, T_gov: 1, process: 0 },
    },
  },

  exit: {
    base_recovery: 0.8,
    liquidation_decay: 0.2,
    bankruptcy_recovery: 0.1,
    reentry_cost: 400,
    reentry_cost_escalation: 1.5,
    reentry_cooldown_rounds: 1,
  },

  shocks: {
    types: [
      {
        // Water scarcity / drought — slow-burn resilience shock (signaled).
        id: "water",
        kind: "cost_spike",
        target: "all",
        magnitude_mean: 0.35,
        magnitude_sd: 0.07,
        prob_per_round: 0.35,
        earliest_round: 6,
        latest_round: 14,
        signaling: "signaled_noisy",
        resilience_mitigated: true,
        duration: 2,
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
        penalty_cash: 300,
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
      formal: { formation_cost: 50, breach_penalty: 150 },
      collective: { formation_cost: 100, min_size: 3, freerider_decay: 0.1 },
    },
    templates: {
      joint_marketing: { brand_pool_fraction: 0.3 },
      capacity_coordination: { capacity_restraint: 0.2 },
      supply_share: { unit_cost_reduction: 0.1 },
    },
    antitrust_coordination_threshold: 1,
  },

  information: {
    cost: 30, // market research: a costed value-of-information action (§15.7)
  },

  // Expansion modules (04_expansion_module_spec). All off by default ⇒ identical
  // to the v1 base game. Per-game "modes" are just a subset of these flags flipped
  // on (see config/modules.ts for the registry + instructor presets).
  modules: defaultModules,

  scoring: {
    weights: { financial: 0.3, market: 0.3, intangible: 0.2, stakeholder: 0.2 },
    accumulation: "round_average",
    normalization: "zscore_within_round",
    financial_blend: { profitability: 0.4, soundness: 0.3, cash_resilience: 0.3 },
    cash_safety_threshold: 300,
    healthy_coverage: 2.0,
    healthy_leverage: 1.5,
  },
};
