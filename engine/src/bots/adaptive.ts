/**
 * Adaptive (best-response) archetype for the balance harness.
 *
 * Unlike the fixed archetypes, this bot re-plans each round: it forecasts its
 * own logit share in every active segment against the *current* field (rivals'
 * observed Q/B/unit_cost), grid-searches the profit-maximizing price per segment,
 * allocates capacity toward the most profitable segments (diversifying away from
 * crowded ones), invests to reinforce the segments it actually serves, and reads
 * signaled shocks to fund resilience (process + T_emp) ahead of time (§9.4).
 *
 * This is the honest test of whether a "dominant" fixed strategy is a real
 * exploit or just an artifact of bots that can't reposition — when everyone can
 * pile into a lucrative segment, crowding should erode its rents.
 */
import type { Config, FirmDecision, FirmState, PrPlayType, SegmentId, WorldState } from "../types.js";
import { invCfg } from "../engine/inventory.js";
import { firmValuation } from "../engine/finance.js";

export interface Lean {
  id: string;
  bias: { Q: number; B: number; process: number; cap: number; T_emp: number; T_inv: number; T_gov: number };
  cashGuard: number;
  debtDraw: number; // fixed draw appetite when leverage room exists
}

const MARKUP_GRID = [1.3, 1.5, 1.7, 1.9, 2.1, 2.3];
const QUALITY_SEGS = new Set(["niche", "frontier"]);

function estUnit(f: FirmState, c: Config): number {
  return f.unit_cost > 0 ? f.unit_cost : c.costs.c_base * 0.85;
}
function maintenanceCapex(f: FirmState, c: Config): number {
  return (c.capacity.depreciation * f.cap) / Math.max(c.capacity.gain, 1e-6);
}

/** Count signaled shocks scheduled within the next `horizon` rounds (the readable signal). */
function upcomingSignaledShocks(world: WorldState, horizon = 2): number {
  return world.shock_timeline.filter((s) => s.signaling === "signaled_noisy" && s.round >= world.round && s.round <= world.round + horizon).length;
}

export function decideAdaptive(lean: Lean, f: FirmState, world: WorldState, c: Config): FirmDecision {
  const activeSegs = world.segments.filter((s) => s.active);
  const allSegs = world.segments.map((s) => s.id);
  const rivals = world.firms.filter((x) => x.status === "active" && x.id !== f.id);
  const unit = estUnit(f, c);

  // Forecast best price + share + profit-density for each active segment.
  type Plan = { seg: SegmentId; price: number; share: number; profit: number };
  const plans: Plan[] = [];
  for (const sw of activeSegs) {
    const sc = c.segments.find((s) => s.id === sw.id)!;
    // Rivals' (fixed) utilities, assuming each prices at a typical markup over its unit cost.
    let rivalExpSum = 0;
    for (const r of rivals) {
      const rUnit = r.unit_cost > 0 ? r.unit_cost : c.costs.c_base * 0.85;
      const rPrice = rUnit * 1.7;
      const u = sc.alpha - sc.beta_p * rPrice + sc.beta_q * r.Q + sc.beta_b * r.B + sc.beta_fit * 0.5;
      rivalExpSum += Math.exp(u);
    }
    const outside = Math.exp(sc.U0);

    let best: Plan = { seg: sw.id, price: unit * 1.7, share: 0, profit: -Infinity };
    for (const mk of MARKUP_GRID) {
      const price = unit * mk;
      const u = sc.alpha - sc.beta_p * price + sc.beta_q * f.Q + sc.beta_b * f.B + sc.beta_fit * 0.7;
      const share = Math.exp(u) / (Math.exp(u) + rivalExpSum + outside);
      const qest = Math.min(sw.D * share, f.cap); // if I devoted full cap here
      const profit = qest * (price - unit);
      if (profit > best.profit) best = { seg: sw.id, price, share, profit };
    }
    plans.push(best);
  }

  // Allocate capacity toward profitable segments; diversify (no single seg > 70%).
  const positive = plans.filter((p) => p.profit > 0).sort((a, b) => b.profit - a.profit);
  const chosen = positive.slice(0, 3);
  const presence: Record<SegmentId, number> = {};
  const price: Record<SegmentId, number> = {};
  for (const s of allSegs) {
    presence[s] = 0;
    price[s] = 0;
  }
  if (chosen.length) {
    const totalProfit = chosen.reduce((a, p) => a + p.profit, 0);
    for (const p of chosen) {
      presence[p.seg] = Math.min(0.7, p.profit / totalProfit);
      price[p.seg] = p.price;
    }
  } else {
    // No profitable plan — sit in the least-bad active segment cheaply.
    const fallback = plans.sort((a, b) => b.profit - a.profit)[0];
    if (fallback) {
      presence[fallback.seg] = 1;
      price[fallback.seg] = fallback.price;
    }
  }

  // Run-rate (inventory mode): brew to match forecast demand, lightly shaded down
  // since the per-segment shares above assume full devotion (real fit is split). A
  // best-responder doesn't want to overbrew into spoilage. Ignored when disabled.
  const expectedSold = chosen.reduce((a, p) => {
    const sw = activeSegs.find((s) => s.id === p.seg);
    return a + (sw ? sw.D * p.share : 0);
  }, 0);
  const runRate = chosen.length ? Math.max(0.3, Math.min(1, (0.85 * expectedSold) / Math.max(1, f.cap))) : 0.3;

  // How quality- vs cost-oriented is my chosen allocation?
  const totalPresence = Object.values(presence).reduce((a, b) => a + b, 0) || 1;
  const qualityWeight = chosen.filter((p) => QUALITY_SEGS.has(p.seg)).reduce((a, p) => a + presence[p.seg], 0) / totalPresence;
  const costWeight = 1 - qualityWeight;

  // Resilience funding scaled by readable upcoming shocks (the §9.4 signal lesson).
  const shockSignal = upcomingSignaledShocks(world);
  const resilienceBoost = shockSignal > 0 ? 40 + 20 * shockSignal : 10;

  // ---- Expansion-module levers (each gated on its module; lean-differentiated so
  // the field stays heterogeneous: brand bots play PR, cost bots integrate upstream,
  // stakeholder bots fund the guild, aggressive bots expand and hunt M&A). ----
  const mods = c.modules;
  let moduleCash = 0; // up-front cash these plays commit (reserved from the budget)
  // Shared per-round module budget (~40% of cash) so plays stagger over rounds
  // rather than stacking into one round and starving core investment.
  let moduleBudget = 0.4 * Math.max(0, f.cash);
  const commit = (cost: number): boolean => {
    if (cost > moduleBudget) return false;
    moduleBudget -= cost;
    moduleCash += cost;
    return true;
  };

  // PR plays — brand-leaning bots, off cooldown, when cash comfortably covers it.
  let prAction: PrPlayType | null = null;
  if (mods?.prEvents?.enabled && lean.bias.B >= 1.2) {
    const offCooldown = f.pr_cooldown_until == null || world.round >= f.pr_cooldown_until;
    if (offCooldown && f.cash > mods.prEvents.cost * 3 && commit(mods.prEvents.cost)) {
      prAction = lean.bias.B >= 2 ? "viral" : "collab";
    }
  }

  // Water efficiency — ops/stakeholder bots arm against the signaled drought.
  let waterInvest = 0;
  if (mods?.sustainability?.enabled && shockSignal > 0 && (lean.bias.process >= 1.2 || lean.bias.T_emp >= 1.4) && commit(50)) {
    waterInvest = 50;
  }

  // Public goods — civic leans contribute; aggressive leans free-ride (the lesson).
  const contributions: Record<string, number> = {};
  if (mods?.publicGoods?.enabled && lean.bias.T_gov >= 0.8 && lean.cashGuard <= 0.45 && f.cash > 400) {
    const want = 15 + (shockSignal > 0 ? 20 : 0);
    if (commit(want)) {
      contributions.regional_marketing = 15;
      if (shockSignal > 0) contributions.water_commons = 20;
    }
  }

  // R&D race — quality leans chase the new category while it's still closed.
  let rndInvest = 0;
  if (mods?.rndRace?.enabled && lean.bias.Q >= 1.2 && world.segments.some((s) => !s.active) && commit(50)) {
    rndInvest = 50;
  }

  // Geography — expand into the region that suits the lean once cash allows.
  let marketPresence: Record<string, number> | undefined;
  if (mods?.geography?.enabled && world.round >= 2) {
    const markets = mods.geography.markets.filter((m) => m.kind !== "export" || mods.international?.enabled);
    const wantsCheap = lean.bias.process >= 1.8 || lean.bias.cap >= 1.8;
    const target = markets.find((m) => m.kind === "domestic" && (wantsCheap ? m.beta_p_mult > 1 : m.beta_q_mult > 1));
    if (target && f.cash > target.entry_cost + 500) {
      const entered = (f.markets_entered ?? ["home"]).includes(target.id);
      if (entered || commit(target.entry_cost)) {
        marketPresence = { home: 0.7, [target.id]: 0.3 };
        // Aggressive, brand-rich bots also probe an export lane when international is on.
        const exp = markets.find((m) => m.kind === "export");
        if (exp && lean.debtDraw >= 160 && f.B > 25 && f.cash > target.entry_cost + exp.entry_cost + 700) {
          const expEntered = (f.markets_entered ?? []).includes(exp.id);
          if (expEntered || commit(exp.entry_cost)) marketPresence = { home: 0.6, [target.id]: 0.25, [exp.id]: 0.15 };
        }
      }
    }
  }

  // Vertical assets — cost bots buy the supplier; regulator-minded bots buy distribution.
  const buyVertical: string[] = [];
  if (mods?.verticalIntegration?.enabled && (f.vertical_assets ?? []).length < mods.verticalIntegration.max_assets) {
    const ownedIds = new Set((f.vertical_assets ?? []).map((a) => a.id));
    const up = mods.verticalIntegration.assets.find((a) => a.type === "upstream" && !ownedIds.has(a.id));
    const down = mods.verticalIntegration.assets.find((a) => a.type === "downstream" && !ownedIds.has(a.id));
    if (up && (lean.bias.process >= 1.8 || lean.bias.cap >= 1.8) && f.cash > up.cost + 400 && commit(up.cost)) {
      buyVertical.push(up.id);
    } else if (down && lean.bias.T_gov >= 1.4 && f.cash > down.cost + 500 && commit(down.cost)) {
      buyVertical.push(down.id);
    }
  }

  // Key hires — hire the specialist matching the lean's strongest capability bias.
  const hireRoles: string[] = [];
  if (mods?.laborMarket?.enabled && f.cash > 500) {
    const staffed = new Set((f.key_hires ?? []).map((h) => h.role));
    const pref =
      lean.bias.Q >= Math.max(lean.bias.B, lean.bias.process) ? "head_brewer" :
      lean.bias.B >= lean.bias.process ? "sales_director" : "ops_manager";
    const role = mods.laborMarket.roles.find((r) => r.id === pref);
    if (role && !staffed.has(role.id) && commit(role.signing_bonus + role.salary)) {
      hireRoles.push(role.id);
    }
  }

  // Revenue financing — a cash-poor but levered-tolerant bot grabs a lifeline.
  let drawRbf = 0;
  if (mods?.financialInstruments?.enabled && f.cash < 150 && (f.rbf_outstanding ?? 0) <= 0 && lean.cashGuard >= 0.4) {
    drawRbf = 200;
  }

  // M&A — the aggressive lean bids on a distressed rival at a fair-value price.
  let acquisitionBid: { target: string; price: number } | null = null;
  if (mods?.ma?.enabled && lean.debtDraw >= 160 && (f.acquisitions_made ?? 0) < mods.ma.max_acquisitions) {
    const prey = rivals.filter((r) => r.rounds_below_health >= mods.ma!.min_distress_rounds).sort((a, b) => a.cash - b.cash)[0];
    if (prey) {
      const price = Math.max(50, (mods.ma.min_price_fraction + 0.1) * Math.max(0, firmValuation(prey, c)));
      if (f.cash > price + 300) acquisitionBid = { target: prey.id, price };
    }
  }

  const base = 65;
  let spend = {
    Q: base * lean.bias.Q * qualityWeight,
    B: base * lean.bias.B * qualityWeight,
    process: base * lean.bias.process * (0.4 + costWeight) + resilienceBoost,
    cap: base * lean.bias.cap * costWeight + maintenanceCapex(f, c),
    T_emp: base * lean.bias.T_emp * 0.5 + resilienceBoost * 0.5,
    T_inv: base * lean.bias.T_inv * 0.4,
    T_gov: base * lean.bias.T_gov * 0.4,
  };

  // Solvency guard. With inventory enabled, brewing is paid in cash up front
  // (recovered as COGS only when sold), so reserve that production bill before
  // committing the rest of the cash to discretionary investment.
  const total = Object.values(spend).reduce((a, b) => a + b, 0);
  const equity = f.paid_in_capital + f.retained_earnings;
  const drawRoom = f.debt / Math.max(equity, 1e-6) < c.finance.max_leverage * 0.7;
  const draw = drawRoom ? lean.debtDraw : 0;
  const prodReserve = (invCfg(c).enabled ? runRate * Math.max(0, f.cap) * unit : 0);
  const budget = Math.max(0, Math.max(0, f.cash) * lean.cashGuard - prodReserve - moduleCash) + draw + drawRbf;
  if (total > budget && total > 0) {
    const scale = budget / total;
    spend = Object.fromEntries(Object.entries(spend).map(([k, v]) => [k, v * scale])) as typeof spend;
  }

  return {
    firm_id: f.id,
    price,
    presence,
    run_rate: runRate,
    invest_cap: spend.cap,
    invest_process: spend.process,
    invest_Q: spend.Q,
    invest_B: spend.B,
    invest_T_emp: spend.T_emp,
    invest_T_inv: spend.T_inv,
    invest_T_gov: spend.T_gov,
    debt_draw: draw,
    debt_repay: 0,
    equity_raise: 0,
    dividend: 0,
    buy_info: shockSignal > 0,
    agreement_actions: [],
    exit_action: null,
    // Expansion-module levers (undefined/empty when the module is off).
    pr_action: prAction,
    invest_water_efficiency: waterInvest,
    public_good_contributions: contributions,
    invest_rnd: rndInvest,
    market_presence: marketPresence,
    buy_vertical: buyVertical,
    hire_roles: hireRoles,
    draw_rbf: drawRbf,
    acquisition_bid: acquisitionBid,
  };
}

/** Eight distinct adaptive "personalities" — all best-respond, but with different
 *  investment leanings and risk appetite, so the dominant-strategy detector is
 *  meaningful (distinct strategies) while every agent can reposition. */
export const ADAPTIVE_LEANS: Lean[] = [
  { id: "ad_generalist", bias: { Q: 1, B: 1, process: 1, cap: 1, T_emp: 1, T_inv: 1, T_gov: 1 }, cashGuard: 0.4, debtDraw: 0 },
  { id: "ad_quality", bias: { Q: 2.2, B: 1.2, process: 0.6, cap: 0.6, T_emp: 0.6, T_inv: 0.5, T_gov: 0.5 }, cashGuard: 0.4, debtDraw: 0 },
  { id: "ad_cost", bias: { Q: 0.4, B: 0.4, process: 2.2, cap: 1.8, T_emp: 1.0, T_inv: 0.5, T_gov: 0.5 }, cashGuard: 0.5, debtDraw: 80 },
  { id: "ad_brand", bias: { Q: 0.8, B: 2.4, process: 0.6, cap: 0.7, T_emp: 0.6, T_inv: 0.5, T_gov: 0.5 }, cashGuard: 0.4, debtDraw: 0 },
  { id: "ad_stakeholder", bias: { Q: 0.8, B: 0.8, process: 1.2, cap: 0.8, T_emp: 2.0, T_inv: 1.6, T_gov: 1.6 }, cashGuard: 0.4, debtDraw: 0 },
  { id: "ad_aggressive", bias: { Q: 1.2, B: 1.2, process: 1.2, cap: 2.0, T_emp: 0.6, T_inv: 0.6, T_gov: 0.4 }, cashGuard: 0.6, debtDraw: 160 },
  { id: "ad_lean_ops", bias: { Q: 0.6, B: 0.6, process: 1.8, cap: 1.0, T_emp: 1.4, T_inv: 0.6, T_gov: 0.6 }, cashGuard: 0.35, debtDraw: 0 },
  { id: "ad_conservative", bias: { Q: 0.8, B: 0.8, process: 0.8, cap: 0.7, T_emp: 0.8, T_inv: 0.8, T_gov: 0.8 }, cashGuard: 0.25, debtDraw: 0 },
];
