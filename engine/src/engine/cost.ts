/**
 * Cost & production engine (§6).
 *
 *   unit_cost = c_base · learning(cum_output) · (1 − process_effect)
 *               · location_factor / productivity(T_emp)
 *               · (1 − supply_share_reduction)   // from §11 agreements
 *               · shock_cost_multiplier          // from §9
 *
 * learning() is Wright's law; process_effect and productivity() are concave and
 * bounded. The supply-share and shock multipliers are passed in by the resolver.
 */
import type { Config, CostBuildup, FirmState } from "../types.js";

/** Wright's-law experience curve: cost falls by (1 − learning_rate) per doubling. */
export function learningMultiplier(cumOutput: number, c: Config): number {
  const { learning_rate, learning_q0, learning_floor } = c.costs;
  const exponent = Math.log2(learning_rate); // negative for learning_rate < 1
  const ratio = (Math.max(0, cumOutput) + learning_q0) / learning_q0; // = 1 at cum=0
  return Math.max(learning_floor, Math.pow(ratio, exponent));
}

/** Concave, bounded cost reduction from the process capability stock. */
export function processEffect(processStock: number, c: Config): number {
  const { effect_max, halfsat } = c.costs.process;
  return effect_max * (processStock / (processStock + halfsat));
}

/** Increasing, bounded productivity multiplier from employee/community trust. */
export function productivity(tEmp: number, c: Config): number {
  const { productivity_kappa, productivity_halfsat } = c.costs;
  return 1 + productivity_kappa * (tEmp / (tEmp + productivity_halfsat));
}

/** Premium-recipe cost markup: higher recipe quality (better ingredients, slower
 *  brewing, tighter QC) costs more per unit. Concave & bounded by κ. This is the
 *  cost-side counterweight to quality's demand-side pull — so quality is a real
 *  tradeoff (margin vs appeal), not a free lunch. 1.0 when unconfigured. */
export function qualityPremium(quality: number, c: Config): number {
  const qp = c.costs.quality_premium;
  if (!qp) return 1;
  const q = Math.max(0, quality);
  return 1 + qp.kappa * (q / (q + qp.halfsat));
}

export function computeUnitCost(
  firm: FirmState,
  c: Config,
  supplyShareReduction: number, // fraction in [0,1) from supply-share agreements
  shockCostMultiplier: number, // ≥1 from cost-spike shocks (resilience-mitigated)
): { unitCost: number; buildup: CostBuildup } {
  const learning = learningMultiplier(firm.cum_output, c);
  const pEff = processEffect(firm.process, c);
  const prod = productivity(firm.T_emp, c);
  const qPrem = qualityPremium(firm.Q, c);
  const supply = Math.min(0.95, Math.max(0, supplyShareReduction));
  const shock = Math.max(1, shockCostMultiplier);

  const unitCost =
    c.costs.c_base * learning * (1 - pEff) * qPrem * firm.location_factor / prod * (1 - supply) * shock;

  return {
    unitCost: Math.max(0, unitCost),
    buildup: {
      c_base: c.costs.c_base,
      learning,
      process: 1 - pEff,
      location: firm.location_factor,
      productivity: prod,
      quality_premium: qPrem,
      supply_share: 1 - supply,
      shock,
    },
  };
}
