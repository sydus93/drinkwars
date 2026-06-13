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

  // modules (optional; absent ⇒ all-off / legacy). Validate the blocks that carry
  // real parameters only when their module object is present.
  const mods = c.modules;
  if (mods) {
    const inv = mods.inventory;
    if (inv) {
      req(typeof inv.enabled === "boolean", "modules.inventory.enabled must be a boolean");
      rate(inv.spoilage_rate, "modules.inventory.spoilage_rate");
      req(isNum(inv.max_run_rate) && (inv.max_run_rate as number) >= 1, "modules.inventory.max_run_rate must be ≥ 1");
      nonneg(inv.holding_cost_per_unit, "modules.inventory.holding_cost_per_unit");
    }
    const as = mods.asymmetricStarts;
    if (as) {
      req(typeof as.enabled === "boolean", "modules.asymmetricStarts.enabled must be a boolean");
      req(Number.isInteger(as.incumbent_count) && as.incumbent_count >= 0, "modules.asymmetricStarts.incumbent_count must be a non-negative integer");
      for (const role of ["incumbent", "entrant"] as const) {
        const p = as[role];
        if (!p) { issues.push(`modules.asymmetricStarts.${role} is missing`); continue; }
        for (const k of ["cap", "B", "Q", "cash", "unit_cost"] as const) pos(p[k], `modules.asymmetricStarts.${role}.${k}`);
      }
    }
    const geo = mods.geography;
    if (geo) {
      req(typeof geo.enabled === "boolean", "modules.geography.enabled must be a boolean");
      req(Array.isArray(geo.markets) && geo.markets.length >= 1, "modules.geography.markets must be a non-empty array");
      req((geo.markets ?? []).some((m) => m.kind === "home"), "modules.geography.markets must include a home market");
      const mIds = new Set<string>();
      for (const [i, m] of (geo.markets ?? []).entries()) {
        req(typeof m.id === "string" && m.id.length > 0, `modules.geography.markets[${i}].id must be a non-empty string`);
        req(!mIds.has(m.id), `duplicate market id "${m.id}"`);
        mIds.add(m.id);
        req(["home", "domestic", "export"].includes(m.kind), `modules.geography.markets[${i}].kind invalid`);
        pos(m.demand_mult, `modules.geography.markets[${i}].demand_mult`);
        nonneg(m.entry_cost, `modules.geography.markets[${i}].entry_cost`);
        nonneg(m.distribution_cost_per_unit, `modules.geography.markets[${i}].distribution_cost_per_unit`);
        rate(m.tariff_rate, `modules.geography.markets[${i}].tariff_rate`);
        nonneg(m.brand_transfer, `modules.geography.markets[${i}].brand_transfer`);
      }
    }
    const intl = mods.international;
    if (intl) {
      req(typeof intl.enabled === "boolean", "modules.international.enabled must be a boolean");
      pos(intl.fx_mean, "modules.international.fx_mean");
      rate(intl.fx_speed, "modules.international.fx_speed");
    }
    const vi = mods.verticalIntegration;
    if (vi) {
      req(typeof vi.enabled === "boolean", "modules.verticalIntegration.enabled must be a boolean");
      req(Number.isInteger(vi.max_assets) && vi.max_assets >= 1, "modules.verticalIntegration.max_assets must be ≥ 1");
      for (const [i, a] of (vi.assets ?? []).entries()) {
        req(["upstream", "downstream"].includes(a.type), `modules.verticalIntegration.assets[${i}].type invalid`);
        pos(a.cost, `modules.verticalIntegration.assets[${i}].cost`);
        rate(a.unit_cost_reduction, `modules.verticalIntegration.assets[${i}].unit_cost_reduction`);
        rate(a.reg_relief, `modules.verticalIntegration.assets[${i}].reg_relief`);
        req(Number.isInteger(a.integration_lag) && a.integration_lag >= 0, `modules.verticalIntegration.assets[${i}].integration_lag must be a non-negative integer`);
      }
    }
    const lab = mods.laborMarket;
    if (lab) {
      req(typeof lab.enabled === "boolean", "modules.laborMarket.enabled must be a boolean");
      rate(lab.departure_prob, "modules.laborMarket.departure_prob");
      rate(lab.t_emp_mitigation, "modules.laborMarket.t_emp_mitigation");
      pos(lab.t_emp_halfsat, "modules.laborMarket.t_emp_halfsat");
      for (const [i, r] of (lab.roles ?? []).entries()) {
        req(typeof r.id === "string" && r.id.length > 0, `modules.laborMarket.roles[${i}].id must be a non-empty string`);
        nonneg(r.salary, `modules.laborMarket.roles[${i}].salary`);
        nonneg(r.signing_bonus, `modules.laborMarket.roles[${i}].signing_bonus`);
      }
    }
    const fi = mods.financialInstruments;
    if (fi) {
      req(typeof fi.enabled === "boolean", "modules.financialInstruments.enabled must be a boolean");
      rate(fi.convertible?.rate, "modules.financialInstruments.convertible.rate");
      req(Number.isInteger(fi.convertible?.term) && fi.convertible.term >= 1, "modules.financialInstruments.convertible.term must be ≥ 1");
      rate(fi.rbf?.payment_rate, "modules.financialInstruments.rbf.payment_rate");
      req(isNum(fi.rbf?.multiple) && fi.rbf.multiple >= 1, "modules.financialInstruments.rbf.multiple must be ≥ 1");
    }
    const ma = mods.ma;
    if (ma) {
      req(typeof ma.enabled === "boolean", "modules.ma.enabled must be a boolean");
      rate(ma.integration_discount, "modules.ma.integration_discount");
      rate(ma.min_price_fraction, "modules.ma.min_price_fraction", 2);
      req(Number.isInteger(ma.min_distress_rounds) && ma.min_distress_rounds >= 1, "modules.ma.min_distress_rounds must be ≥ 1");
      req(Number.isInteger(ma.max_acquisitions) && ma.max_acquisitions >= 1, "modules.ma.max_acquisitions must be ≥ 1");
    }
    const tr = mods.teamRoles;
    if (tr) {
      req(typeof tr.enabled === "boolean", "modules.teamRoles.enabled must be a boolean");
      for (const k of ["cfo", "cmo", "coo", "ceo"] as const) rate(tr.noise?.[k], `modules.teamRoles.noise.${k}`);
    }
    const rnd = mods.rndRace;
    if (rnd) {
      req(typeof rnd.enabled === "boolean", "modules.rndRace.enabled must be a boolean");
      nonneg(rnd.gain, "modules.rndRace.gain");
      pos(rnd.threshold, "modules.rndRace.threshold");
      nonneg(rnd.first_mover_brand_bonus, "modules.rndRace.first_mover_brand_bonus");
      req(Number.isInteger(rnd.first_mover_duration) && rnd.first_mover_duration >= 0, "modules.rndRace.first_mover_duration must be a non-negative integer");
    }
    const rep = mods.reputation;
    if (rep) {
      req(typeof rep.enabled === "boolean", "modules.reputation.enabled must be a boolean");
      nonneg(rep.gain_honor, "modules.reputation.gain_honor");
      nonneg(rep.loss_defect, "modules.reputation.loss_defect");
      rate(rep.depreciation, "modules.reputation.depreciation");
      pos(rep.halfsat, "modules.reputation.halfsat");
      rate(rep.spread_reduction_max, "modules.reputation.spread_reduction_max");
    }
    const pg = mods.publicGoods;
    if (pg) {
      req(typeof pg.enabled === "boolean", "modules.publicGoods.enabled must be a boolean");
      rate(pg.decay, "modules.publicGoods.decay");
      req(Array.isArray(pg.goods), "modules.publicGoods.goods must be an array");
      for (const [i, g] of (pg.goods ?? []).entries()) {
        req(typeof g.id === "string" && g.id.length > 0, `modules.publicGoods.goods[${i}].id must be a non-empty string`);
        req(["demand", "water_resilience", "quality"].includes(g.benefit), `modules.publicGoods.goods[${i}].benefit invalid`);
        nonneg(g.threshold, `modules.publicGoods.goods[${i}].threshold`);
        nonneg(g.max_effect, `modules.publicGoods.goods[${i}].max_effect`);
        pos(g.halfsat, `modules.publicGoods.goods[${i}].halfsat`);
      }
    }
    const sust = mods.sustainability;
    if (sust) {
      req(typeof sust.enabled === "boolean", "modules.sustainability.enabled must be a boolean");
      nonneg(sust.gain, "modules.sustainability.gain");
      rate(sust.depreciation, "modules.sustainability.depreciation");
      nonneg(sust.resilience_k, "modules.sustainability.resilience_k");
      pos(sust.resilience_halfsat, "modules.sustainability.resilience_halfsat");
      nonneg(sust.t_gov_gain_per_invest, "modules.sustainability.t_gov_gain_per_invest");
    }
    const pr = mods.prEvents;
    if (pr) {
      req(typeof pr.enabled === "boolean", "modules.prEvents.enabled must be a boolean");
      req(Number.isInteger(pr.cooldown_rounds) && pr.cooldown_rounds >= 0, "modules.prEvents.cooldown_rounds must be a non-negative integer");
      nonneg(pr.spike_magnitude, "modules.prEvents.spike_magnitude");
      rate(pr.spike_decay_rate, "modules.prEvents.spike_decay_rate");
      nonneg(pr.cost, "modules.prEvents.cost");
      rate(pr.negative_pr_probability, "modules.prEvents.negative_pr_probability");
      rate(pr.negative_pr_t_emp_mitigation, "modules.prEvents.negative_pr_t_emp_mitigation");
      nonneg(pr.negative_pr_brand_damage, "modules.prEvents.negative_pr_brand_damage");
    }
    const drift = mods.consumerDrift;
    if (drift) {
      req(typeof drift.enabled === "boolean", "modules.consumerDrift.enabled must be a boolean");
      req(Array.isArray(drift.tracks), "modules.consumerDrift.tracks must be an array");
      for (const [i, t] of (drift.tracks ?? []).entries()) {
        req(ids.has(t.segment), `modules.consumerDrift.tracks[${i}].segment "${t.segment}" is not a segment id`);
        req(["beta_q", "beta_p", "beta_b"].includes(t.variable), `modules.consumerDrift.tracks[${i}].variable must be beta_q|beta_p|beta_b`);
        req(isNum(t.delta_per_round), `modules.consumerDrift.tracks[${i}].delta_per_round must be a number`);
      }
    }
  }

  if (issues.length) throw new ConfigError(issues);
  return c;
}
