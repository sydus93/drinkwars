/**
 * Game initialization. Builds the firm registry and world state, derives a
 * balanced opening balance sheet (paid_in = cash + PP&E − debt so Assets ≡ L+E at
 * t0), samples location factors, and rolls the editable shock timeline (§9.1).
 */
import type { Config, FirmState, StartProfile, WorldState } from "../types.js";
import { RNG, deriveSeed } from "../rng.js";
import { emptyPipeline } from "./stocks.js";
import { rollTimeline } from "./shocks.js";

/** No-op start profile: every multiplier = 1 (the symmetric v1 baseline). */
const EVEN: StartProfile = { cap: 1, B: 1, Q: 1, cash: 1, unit_cost: 1 };

/** MOD-A07 — the start profile for firm index `i`. Disabled ⇒ EVEN for all firms,
 *  so the opening state is identical to v1. Enabled ⇒ the first `incumbent_count`
 *  firms are incumbents, the rest entrants. */
function startProfile(c: Config, i: number): StartProfile {
  const as = c.modules?.asymmetricStarts;
  if (!as?.enabled) return EVEN;
  return i < as.incumbent_count ? as.incumbent : as.entrant;
}

export function initFirm(id: string, c: Config, locationFactor: number, profile: StartProfile = EVEN): FirmState {
  const cap = c.init.starting_cap * profile.cap;
  const cash = c.init.starting_cash * profile.cash;
  const ppe = cap * c.capacity.book_value_per_unit;
  const paidIn = cash + ppe - c.init.starting_debt; // forces opening balance
  return {
    id,
    status: "active",
    cash,
    cap,
    unit_cost: 0,
    Q: c.init.starting_Q * profile.Q,
    B: c.init.starting_B * profile.B,
    T_emp: c.init.starting_T_emp,
    T_inv: c.init.starting_T_inv,
    T_gov: c.init.starting_T_gov,
    process: c.init.starting_process,
    pipelines: {
      cap: emptyPipeline(c.capacity.lag),
      Q: emptyPipeline(c.stocks.Q.lag),
      B: emptyPipeline(c.stocks.B.lag),
      T_emp: emptyPipeline(c.stocks.T_emp.lag),
      T_inv: emptyPipeline(c.stocks.T_inv.lag),
      T_gov: emptyPipeline(c.stocks.T_gov.lag),
      process: emptyPipeline(c.costs.process.lag),
    },
    debt: c.init.starting_debt,
    paid_in_capital: paidIn,
    retained_earnings: 0,
    ppe_book: ppe,
    cum_output: 0,
    inventory_units: 0,
    inventory_value: 0,
    pr_spike: 0,
    pr_cooldown_until: null,
    water_efficiency: 0,
    markets_entered: ["home"],
    reputation: 0,
    rnd_progress: 0,
    vertical_assets: [],
    key_hires: [],
    convertible_note: null,
    rbf_outstanding: 0,
    rbf_principal: 0,
    location_factor: locationFactor * profile.unit_cost, // <1 for incumbents ⇒ cheaper to produce
    primary_segment: null,
    ni_history: [],
    score_accum: { financial: 0, market: 0, intangible: 0, stakeholder: 0, rounds: 0 },
    rounds_below_health: 0,
    reentry_count: 0,
    cooldown_until_round: null,
    holdings: [],
    cap_table: [{ holder_id: id, shares: 1 }],
    banked_cash: 0,
    initial_capital: paidIn,
  };
}

export function initGame(c: Config): WorldState {
  const rng = new RNG(deriveSeed(c.game.seed, 0, 1));
  const firms: FirmState[] = [];
  for (let i = 0; i < c.game.n_firms; i++) {
    const loc = Math.max(0.5, rng.normal(c.costs.location_factor_mean, c.costs.location_factor_sd));
    firms.push(initFirm(`firm_${i + 1}`, c, loc, startProfile(c, i)));
  }
  return {
    round: 0,
    n_rounds: c.game.n_rounds,
    segments: c.segments.map((s) => ({ id: s.id, D: s.active_at_start ? s.D0 : 0, active: s.active_at_start })),
    firms,
    agreements: [],
    shock_timeline: rollTimeline(c, c.game.seed),
    pending_segment_mods: [],
    live_triggers: [],
    seed: c.game.seed,
    public_good_pools: {},
    fx_rates: {},
    frontier_first_mover: null,
  };
}
