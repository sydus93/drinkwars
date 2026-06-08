/**
 * Config validation (§14). Catches the parameterization mistakes that would
 * otherwise surface as silent garbage in a 16-round run: out-of-range rates,
 * non-summing scoring weights, duplicate/empty segments, broken lag pipelines.
 */
import type { Config, StockParams } from "../types.js";

export class ConfigError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(`Invalid config:\n  - ${issues.join("\n  - ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function validateConfig(c: Config): Config {
  const issues: string[] = [];
  const req = (cond: boolean, msg: string) => {
    if (!cond) issues.push(msg);
  };
  const rate = (v: unknown, name: string, hi = 1) =>
    req(isNum(v) && (v as number) >= 0 && (v as number) <= hi, `${name} must be a number in [0, ${hi}] (got ${String(v)})`);
  const pos = (v: unknown, name: string) => req(isNum(v) && (v as number) > 0, `${name} must be a positive number (got ${String(v)})`);
  const nonneg = (v: unknown, name: string) => req(isNum(v) && (v as number) >= 0, `${name} must be ≥ 0 (got ${String(v)})`);

  // game
  req(isNum(c.game?.n_rounds) && c.game.n_rounds >= 1, "game.n_rounds must be ≥ 1");
  req(isNum(c.game?.n_firms) && c.game.n_firms >= 2, "game.n_firms must be ≥ 2");
  req(Number.isInteger(c.game?.seed), "game.seed must be an integer");

  // segments
  req(Array.isArray(c.segments) && c.segments.length >= 1, "segments must be a non-empty array");
  const ids = new Set<string>();
  let anyActive = false;
  for (const [i, s] of (c.segments ?? []).entries()) {
    req(typeof s.id === "string" && s.id.length > 0, `segments[${i}].id must be a non-empty string`);
    req(!ids.has(s.id), `duplicate segment id "${s.id}"`);
    ids.add(s.id);
    nonneg(s.beta_p, `segments[${i}].beta_p`);
    nonneg(s.D0, `segments[${i}].D0`);
    pos(s.growth, `segments[${i}].growth`);
    if (s.active_at_start) anyActive = true;
  }
  req(anyActive, "at least one segment must be active_at_start");

  // demand
  rate(c.demand?.unmet_demand_lost_fraction, "demand.unmet_demand_lost_fraction");
  nonneg(c.demand?.cross_segment_substitution, "demand.cross_segment_substitution");

  // stock dynamics — depreciation, gain, lag, conversion
  const checkStock = (s: StockParams | undefined, name: string) => {
    if (!s) {
      issues.push(`${name} is missing`);
      return;
    }
    rate(s.depreciation, `${name}.depreciation`);
    nonneg(s.gain, `${name}.gain`);
    req(Number.isInteger(s.lag) && s.lag >= 0, `${name}.lag must be a non-negative integer`);
    req(["linear", "sqrt", "log"].includes(s.conversion), `${name}.conversion must be linear|sqrt|log`);
  };
  checkStock(c.stocks?.Q, "stocks.Q");
  checkStock(c.stocks?.B, "stocks.B");
  checkStock(c.stocks?.T_emp, "stocks.T_emp");
  checkStock(c.stocks?.T_inv, "stocks.T_inv");
  checkStock(c.stocks?.T_gov, "stocks.T_gov");
  checkStock(c.costs?.process, "costs.process");
  checkStock(c.capacity, "capacity");
  rate(c.costs?.process?.effect_max, "costs.process.effect_max");
  pos(c.capacity?.book_value_per_unit, "capacity.book_value_per_unit");

  // costs
  pos(c.costs?.c_base, "costs.c_base");
  req(isNum(c.costs?.learning_rate) && c.costs.learning_rate > 0 && c.costs.learning_rate <= 1, "costs.learning_rate must be in (0, 1]");
  pos(c.costs?.learning_q0, "costs.learning_q0");

  // finance
  nonneg(c.finance?.r_f, "finance.r_f");
  pos(c.finance?.max_leverage, "finance.max_leverage");
  rate(c.finance?.equity_issue_cost_base, "finance.equity_issue_cost_base");
  rate(c.finance?.dividend_max_fraction, "finance.dividend_max_fraction");

  // shocks
  req(Array.isArray(c.shocks?.types), "shocks.types must be an array");
  for (const [i, t] of (c.shocks?.types ?? []).entries()) {
    rate(t.prob_per_round, `shocks.types[${i}].prob_per_round`);
    req(["cost_spike", "capacity_hit", "demand_drop", "demand_boost", "cash_hit"].includes(t.kind), `shocks.types[${i}].kind invalid`);
    req(["unannounced", "signaled_noisy"].includes(t.signaling), `shocks.types[${i}].signaling invalid`);
    req(Number.isInteger(t.duration) && t.duration >= 1, `shocks.types[${i}].duration must be ≥ 1`);
    if (t.target !== "all") req(ids.has(t.target), `shocks.types[${i}].target "${t.target}" is not a segment id`);
  }
  rate(c.shocks?.max_mitigation, "shocks.max_mitigation");

  // scoring weights must sum ~1
  const w = c.scoring?.weights;
  if (!w) {
    issues.push("scoring.weights missing");
  } else {
    const sum = w.financial + w.market + w.intangible + w.stakeholder;
    req(Math.abs(sum - 1) < 1e-6, `scoring.weights must sum to 1 (got ${sum.toFixed(4)})`);
  }
  const fb = c.scoring?.financial_blend;
  if (fb) {
    const fs = fb.profitability + fb.soundness + fb.cash_resilience;
    req(Math.abs(fs - 1) < 1e-6, `scoring.financial_blend must sum to 1 (got ${fs.toFixed(4)})`);
  }
  req(["round_average", "auc"].includes(c.scoring?.accumulation), "scoring.accumulation must be round_average|auc");

  // coopetition
  req(Number.isInteger(c.coopetition?.forms?.collective?.min_size) && c.coopetition.forms.collective.min_size >= 3, "coopetition.forms.collective.min_size must be ≥ 3");

  // information
  nonneg(c.information?.cost, "information.cost");

  if (issues.length) throw new ConfigError(issues);
  return c;
}
