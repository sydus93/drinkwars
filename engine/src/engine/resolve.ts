/**
 * Round resolution (§13). The deterministic order of operations that turns
 * (state, decisions, config, seed) into (next state, per-firm results). Steps 5
 * and 7 read the same pre-event snapshot so endogenous-rule evaluation is
 * order-independent. This is the pure function the whole app is built around;
 * it clones the input world and never mutates it.
 */
import type {
  Config, FirmDecision, FirmId, FirmRoundResult, RoundResult, SegmentId, SegmentResult, WorldState,
} from "../types.js";
import { advancePipeline, updateStock } from "./stocks.js";
import { computeUnitCost } from "./cost.js";
import { resolveDemand, type DemandModifiers } from "./demand.js";
import { buildStatements, firmValuation } from "./finance.js";
import { resolveAgreementActions, computeAgreementEffects } from "./coopetition.js";
import { computeShockEffects } from "./shocks.js";
import { scoreRound, type ScoreSnapshot } from "./scoring.js";
import { buildStrategyVector, computeDistinctiveness, type StrategyVector } from "./distinctiveness.js";
import { processExits } from "./exit.js";

function zeroDecision(firmId: FirmId, segments: SegmentId[]): FirmDecision {
  const price: Record<SegmentId, number> = {};
  const presence: Record<SegmentId, number> = {};
  for (const s of segments) {
    price[s] = 0;
    presence[s] = 0;
  }
  return {
    firm_id: firmId, price, presence,
    invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
    debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0,
    buy_info: false, agreement_actions: [], exit_action: null,
  };
}

const nn = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);

export function resolveRound(prevWorld: WorldState, decisionList: FirmDecision[], c: Config): { world: WorldState; result: RoundResult } {
  const w: WorldState = structuredClone(prevWorld);
  const round = w.round;
  const events: string[] = [];

  // Step 0: re-activate rebuilt firms whose cooldown has elapsed (§8.3).
  for (const f of w.firms) {
    if (f.status === "exited_rebuilt" && f.cooldown_until_round !== null && round >= f.cooldown_until_round) {
      f.status = "active";
      f.cooldown_until_round = null;
      events.push(`RE-ENTRY: ${f.id} re-activates (repositioned to ${f.primary_segment ?? "?"})`);
    }
  }

  const activeSegmentIds = w.segments.filter((s) => s.active).map((s) => s.id);
  const allSegmentIds = w.segments.map((s) => s.id);
  const participants = w.firms.filter((f) => f.status === "active").map((f) => f.id);

  // Step 1: ingest & sanitize decisions; zero-fill missing (locked controls = 0).
  const decisions = new Map<FirmId, FirmDecision>();
  for (const id of participants) {
    const raw = decisionList.find((d) => d.firm_id === id) ?? zeroDecision(id, allSegmentIds);
    const price: Record<SegmentId, number> = {};
    const presence: Record<SegmentId, number> = {};
    for (const s of allSegmentIds) {
      price[s] = Math.max(0, raw.price?.[s] ?? 0);
      presence[s] = Math.max(0, raw.presence?.[s] ?? 0);
    }
    decisions.set(id, {
      ...raw, price, presence,
      invest_cap: nn(raw.invest_cap), invest_process: nn(raw.invest_process), invest_Q: nn(raw.invest_Q),
      invest_B: nn(raw.invest_B), invest_T_emp: nn(raw.invest_T_emp), invest_T_inv: nn(raw.invest_T_inv), invest_T_gov: nn(raw.invest_T_gov),
      debt_draw: nn(raw.debt_draw), debt_repay: nn(raw.debt_repay), equity_raise: nn(raw.equity_raise), dividend: nn(raw.dividend),
      agreement_actions: raw.agreement_actions ?? [],
    });
  }

  // Step 3: resolve agreement actions (form/defect), trust effects & costs.
  const agRes = resolveAgreementActions(w, decisions, c, round);
  events.push(...agRes.events);

  // Step 4: advance lagged stocks to current.
  for (const f of w.firms) {
    if (f.status !== "active") continue;
    const d = decisions.get(f.id)!;
    const cap = advancePipeline(f.pipelines.cap, c.capacity.lag, d.invest_cap);
    f.cap = updateStock(f.cap, c.capacity.depreciation, cap.matured, c.capacity.conversion, c.capacity.gain);
    f.pipelines.cap = cap.pipeline;
    const adv = (key: "Q" | "B" | "T_emp" | "T_inv" | "T_gov", invest: number, sp: { depreciation: number; gain: number; lag: number; conversion: "linear" | "sqrt" | "log" }) => {
      const r = advancePipeline(f.pipelines[key], sp.lag, invest);
      f[key] = updateStock(f[key], sp.depreciation, r.matured, sp.conversion, sp.gain);
      f.pipelines[key] = r.pipeline;
    };
    adv("Q", d.invest_Q, c.stocks.Q);
    adv("B", d.invest_B, c.stocks.B);
    adv("T_emp", d.invest_T_emp, c.stocks.T_emp);
    adv("T_inv", d.invest_T_inv, c.stocks.T_inv);
    adv("T_gov", d.invest_T_gov, c.stocks.T_gov);
    const proc = advancePipeline(f.pipelines.process, c.costs.process.lag, d.invest_process);
    f.process = updateStock(f.process, c.costs.process.depreciation, proc.matured, c.costs.process.conversion, c.costs.process.gain);
    f.pipelines.process = proc.pipeline;

    // Defection trust hits (§11) applied to the realized stocks, clamped ≥ 0.
    const hit = agRes.trustHits.get(f.id);
    if (hit) {
      f.T_emp = Math.max(0, f.T_emp - hit.emp);
      f.T_inv = Math.max(0, f.T_inv - hit.inv);
    }
  }

  // Step 5: events — segment emergence, agreement effects, shocks, distress mods.
  const totalQ = w.firms.filter((f) => f.status === "active").reduce((acc, f) => acc + f.Q, 0);
  for (const sw of w.segments) {
    if (sw.active) continue;
    const sc = c.segments.find((s) => s.id === sw.id)!;
    const byRound = sc.emerge_round !== null && round >= sc.emerge_round;
    const byCap = sc.emerge_capability_threshold !== null && totalQ >= sc.emerge_capability_threshold;
    if (byRound || byCap) {
      sw.active = true;
      sw.D = sc.D0;
      events.push(`NEW CATEGORY: segment "${sw.id}" emerges (D=${sc.D0}${byCap && !byRound ? ", capability-triggered" : ""})`);
    }
  }
  const agEff = computeAgreementEffects(w, c, round);
  const shock = computeShockEffects(w, c, agEff.coordinationUnits);
  events.push(...shock.events);

  const alphaDelta = new Map<SegmentId, number>();
  for (const m of w.pending_segment_mods) {
    if (round < m.until_round) alphaDelta.set(m.segment, (alphaDelta.get(m.segment) ?? 0) + m.alpha_delta);
  }

  // Step 6: unit cost per firm (supply-share + shock multipliers).
  for (const f of w.firms) {
    if (f.status !== "active") continue;
    const { unitCost } = computeUnitCost(f, c, agEff.unitCostReduction.get(f.id) ?? 0, shock.perFirm.get(f.id)?.cost_multiplier ?? 1);
    f.unit_cost = unitCost;
  }

  // Step 7: demand, shares, quantities.
  const firmsById = new Map(w.firms.map((f) => [f.id, f]));
  const mods: DemandModifiers = {
    extraBrand: (id, seg) => agEff.extraBrand.get(id)?.get(seg) ?? 0,
    segmentAlphaDelta: (seg) => alphaDelta.get(seg) ?? 0,
    segmentDemandMultiplier: (seg) => shock.segmentDemandMultiplier.get(seg) ?? 1,
    effectiveCap: (id) => {
      const f = firmsById.get(id)!;
      const restraint = agEff.capacityRestraint.get(id) ?? 0;
      const capMult = shock.perFirm.get(id)?.capacity_multiplier ?? 1;
      return Math.max(0, f.cap * (1 - restraint) * capMult);
    },
  };
  const demand = resolveDemand(w, decisions, c, mods);
  for (const f of w.firms) {
    if (f.status !== "active") continue;
    const segs = demand.perFirm.get(f.id) ?? {};
    f.cum_output += Object.values(segs).reduce((acc, r) => acc + r.q_sold, 0);
  }

  // Step 8 (+9): statements, cash, balance sheet; cash-hit damage flows through here.
  const finByFirm = new Map<FirmId, ReturnType<typeof buildStatements>>();
  for (const f of w.firms) {
    if (f.status !== "active") continue;
    const d = decisions.get(f.id)!;
    const segs = demand.perFirm.get(f.id) ?? {};
    let revenue = 0;
    let cogs = 0;
    for (const r of Object.values(segs)) {
      revenue += r.revenue;
      cogs += f.unit_cost * r.q_sold;
    }
    const fin = buildStatements({
      firm: f, revenue, cogs,
      invest: { Q: d.invest_Q, B: d.invest_B, T_emp: d.invest_T_emp, T_inv: d.invest_T_inv, T_gov: d.invest_T_gov, process: d.invest_process, cap: d.invest_cap },
      financing: { debt_draw: d.debt_draw, debt_repay: d.debt_repay, equity_raise: d.equity_raise, dividend: d.dividend },
      extraOpex: (agRes.extraOpex.get(f.id) ?? 0) + (d.buy_info ? c.information.cost : 0),
      cashHit: shock.perFirm.get(f.id)?.cash_hit ?? 0,
      config: c,
    });
    f.cash = fin.next.cash;
    f.debt = fin.next.debt;
    f.paid_in_capital = fin.next.paid_in_capital;
    f.retained_earnings = fin.next.retained_earnings;
    f.ppe_book = fin.next.ppe_book;
    f.ni_history.push(fin.pnl.net_income);
    finByFirm.set(f.id, fin);
    // Banked-path firms accrue risk-free interest on parked capital (§8.4).
  }
  for (const f of w.firms) {
    if (f.status === "exited_banked" && f.banked_cash > 0) f.banked_cash *= 1 + c.finance.r_f;
  }

  // Step 10: solvency / exit / investor elections.
  const coverageByFirm = new Map<FirmId, number>();
  const valuationByFirm = new Map<FirmId, number>();
  const sharesByFirm = new Map<FirmId, Map<SegmentId, number>>();
  for (const id of participants) {
    const f = firmsById.get(id)!;
    coverageByFirm.set(id, finByFirm.get(id)?.cost_of_capital.coverage ?? 999);
    valuationByFirm.set(id, firmValuation(f, c));
    const m = new Map<SegmentId, number>();
    const segs = demand.perFirm.get(id) ?? {};
    for (const [seg, r] of Object.entries(segs)) m.set(seg, r.share);
    sharesByFirm.set(id, m);
  }
  const exitRes = processExits({ world: w, decisions, config: c, round, coverageByFirm, sharesByFirm, valuationByFirm });
  events.push(...exitRes.events);

  // Step 11: distinctiveness on the round's strategy profile (participants).
  const vectors: StrategyVector[] = participants.map((id) => ({ firm_id: id, vector: buildStrategyVector(firmsById.get(id)!, decisions.get(id), activeSegmentIds, c) }));
  const distinct = computeDistinctiveness(vectors);

  // Step 12: update running scorecard (participants, normalized within round).
  const snaps: ScoreSnapshot[] = participants.map((id) => {
    const f = firmsById.get(id)!;
    const fin = finByFirm.get(id)!;
    const shareSum = [...(sharesByFirm.get(id)?.values() ?? [])].reduce((a, b) => a + b, 0);
    return {
      firm_id: id, net_income: fin.pnl.net_income, invested_capital: fin.balance_sheet.debt + fin.balance_sheet.equity,
      coverage: fin.cost_of_capital.coverage, leverage: fin.cost_of_capital.leverage, cash: f.cash,
      shareSum, Q: f.Q, B: f.B, T_emp: f.T_emp, T_inv: f.T_inv, T_gov: f.T_gov,
    };
  });
  const scores = scoreRound(snaps, c, firmsById);

  // Step 13: emit per-firm results + next world.
  const firm_results: FirmRoundResult[] = participants.map((id) => {
    const f = firmsById.get(id)!;
    const fin = finByFirm.get(id)!;
    const d = decisions.get(id)!;
    const segMap = demand.perFirm.get(id) ?? {};
    const segments: Record<SegmentId, SegmentResult> = {};
    for (const segId of activeSegmentIds) {
      segments[segId] = segMap[segId] ?? {
        price: d.price[segId] ?? 0, share: 0, q_desired: 0, q_sold: 0, revenue: 0, utility: 0,
        attraction: { alpha: 0, price: 0, quality: 0, brand: 0, fit: 0, agreement: 0 },
      };
    }
    const sc = scores.get(id)!;
    const cb = computeUnitCost(f, c, 0, 1).buildup; // structural buildup (pre-shock) for diagnostics
    return {
      firm_id: id, round, status: f.status, segments,
      unit_cost: f.unit_cost,
      cost_buildup: { ...cb, shock: shock.perFirm.get(id)?.cost_multiplier ?? 1, supply_share: 1 - (agEff.unitCostReduction.get(id) ?? 0) },
      pnl: fin.pnl, balance_sheet: fin.balance_sheet, cash_flow: fin.cash_flow, cost_of_capital: fin.cost_of_capital,
      state: { cash: f.cash, cap: f.cap, Q: f.Q, B: f.B, T_emp: f.T_emp, T_inv: f.T_inv, T_gov: f.T_gov, process: f.process, cum_output: f.cum_output, debt: f.debt, equity: fin.balance_sheet.equity },
      scorecard_raw: sc.raw, scorecard_norm: sc.norm, scorecard_cumulative: sc.cumulative,
      distinctiveness: distinct.get(id) ?? null,
      valuation: valuationByFirm.get(id) ?? 0,
      info_purchased: d.buy_info,
      events: [],
    };
  });

  const market = w.segments.map((s) => ({ segment: s.id, D: s.D, total_q: demand.segmentTotals.get(s.id) ?? 0, active: s.active }));

  // Grow active-segment demand for the next round; advance the clock.
  for (const sw of w.segments) {
    if (sw.active) {
      const sc = c.segments.find((s) => s.id === sw.id)!;
      sw.D *= sc.growth;
    }
  }
  w.pending_segment_mods = w.pending_segment_mods.filter((m) => round < m.until_round);
  w.live_triggers = [];
  w.round = round + 1;

  return { world: w, result: { round, firm_results, events, market } };
}
