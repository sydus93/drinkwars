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
import type { Config, FirmDecision, FirmState, SegmentId, WorldState } from "../types.js";

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

  // How quality- vs cost-oriented is my chosen allocation?
  const totalPresence = Object.values(presence).reduce((a, b) => a + b, 0) || 1;
  const qualityWeight = chosen.filter((p) => QUALITY_SEGS.has(p.seg)).reduce((a, p) => a + presence[p.seg], 0) / totalPresence;
  const costWeight = 1 - qualityWeight;

  // Resilience funding scaled by readable upcoming shocks (the §9.4 signal lesson).
  const shockSignal = upcomingSignaledShocks(world);
  const resilienceBoost = shockSignal > 0 ? 40 + 20 * shockSignal : 10;

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

  // Solvency guard.
  const total = Object.values(spend).reduce((a, b) => a + b, 0);
  const equity = f.paid_in_capital + f.retained_earnings;
  const drawRoom = f.debt / Math.max(equity, 1e-6) < c.finance.max_leverage * 0.7;
  const draw = drawRoom ? lean.debtDraw : 0;
  const budget = Math.max(0, f.cash) * lean.cashGuard + draw;
  if (total > budget && total > 0) {
    const scale = budget / total;
    spend = Object.fromEntries(Object.entries(spend).map(([k, v]) => [k, v * scale])) as typeof spend;
  }

  return {
    firm_id: f.id,
    price,
    presence,
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
