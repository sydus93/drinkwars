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
import { computeBetaDeltas, zeroBetaDelta } from "./drift.js";
import { resolvePrEvents } from "./pr.js";
import { resolveSustainability } from "./sustainability.js";
import { resolvePublicGoods } from "./publicgoods.js";
import { resolveGeography, updateFxRates } from "./geography.js";
import { updateReputation, reputationSpread } from "./reputation.js";
import { resolveRnd, rndFirstMoverBonus } from "./rndrace.js";
import { resolveAssets, verticalCostReduction, verticalRegRelief } from "./assets.js";
import { resolveFacilities, facilityCapacity } from "./facilities.js";
import { resolveMa } from "./ma.js";
import { buildStatements, firmValuation } from "./finance.js";
import { invCfg, computeInventory, type InventoryFlow } from "./inventory.js";
import { resolveAgreementActions, computeAgreementEffects, resolveContingentClauses } from "./coopetition.js";
import { resolveLobbying } from "./lobbying.js";
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
  // Step 3.5: reputation (MOD-B10) — advance the credibility stock from this round's
  // agreement behavior (honor vs defect) before the cost of capital is priced.
  updateReputation(w, decisions, c);

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

  // Step 4.4: vertical assets + key hires (MOD-B06/B03) — purchases, hires, salaries,
  // departures. Runs after stocks advance so hire bonuses land on current stocks and
  // before unit cost / shocks so integrated assets bite this round.
  const assetsRes = resolveAssets(w, decisions, c, round);
  const facRes = resolveFacilities(w, decisions, c, round);
  events.push(...assetsRes.events);
  events.push(...facRes.events);

  // Step 4.5: sustainability (MOD-A03) — advance water-efficiency + T_gov goodwill
  // BEFORE shocks, so the water-shock resilience term sees this round's stock.
  const sustRes = resolveSustainability(w, decisions, c);

  // Step 4.6: public goods (MOD-A02) — aggregate contributions into the shared
  // pools BEFORE shocks/demand so the water-commons, demand, and quality benefits
  // are live this round.
  const pgRes = resolvePublicGoods(w, decisions, c);
  events.push(...pgRes.events);

  // Step 4.7: R&D race (MOD-B04) — accumulate progress toward the frontier category
  // BEFORE emergence is evaluated below.
  const rndRes = resolveRnd(w, decisions, c);

  // Step 4.75: lobbying (MOD-A09) — accumulate initiative progress, fire any cleared
  // regulation into the segment-mod channel (read into the demand modifiers below),
  // and fine heavy offensive lobbyists. Runs before shocks so the antitrust-adjacent
  // scrutiny is settled and any fired regulation is live in this round's demand.
  const loRes = resolveLobbying(w, decisions, c, round);
  events.push(...loRes.events);

  // Step 5: events — segment emergence, agreement effects, shocks, distress mods.
  const totalQ = w.firms.filter((f) => f.status === "active").reduce((acc, f) => acc + f.Q, 0);
  const emergedThisRound = new Set<SegmentId>();
  for (const sw of w.segments) {
    if (sw.active) continue;
    const sc = c.segments.find((s) => s.id === sw.id)!;
    const byRound = sc.emerge_round !== null && round >= sc.emerge_round;
    const byCap = sc.emerge_capability_threshold !== null && totalQ >= sc.emerge_capability_threshold;
    // MOD-B04: the R&D leader crossing the threshold pulls emergence forward.
    const rndCfg = c.modules?.rndRace;
    const byRnd = !!rndCfg?.enabled && rndRes.leader !== null && rndRes.maxProgress >= rndCfg.threshold;
    if (byRound || byCap || byRnd) {
      sw.active = true;
      sw.D = sc.D0;
      emergedThisRound.add(sw.id);
      const earlyRnd = byRnd && !byRound && !byCap;
      if (earlyRnd && rndRes.leader) {
        w.frontier_first_mover = { firm_id: rndRes.leader, segment: sw.id, until_round: round + (rndCfg!.first_mover_duration) };
        events.push(`NEW CATEGORY: ${rndRes.leader} opens "${sw.id}" early through R&D — a first-mover head start`);
      } else {
        events.push(`NEW CATEGORY: segment "${sw.id}" emerges (D=${sc.D0}${byCap && !byRound ? ", capability-triggered" : ""})`);
      }
    }
  }
  const agEff = computeAgreementEffects(w, c, round);
  const shock = computeShockEffects(w, c, agEff.coordinationUnits + assetsRes.antitrustUnits, pgRes.waterMitigation);
  events.push(...shock.events);

  // Step 5.5: contingent clauses (MOD-A05) — react to this round's shock / emergence /
  // partner distress on active agreements. Effects (suspend/terminate/open-reneg) take
  // hold from the next round (this round's agreement effects are already computed).
  const activeShockTypes = new Set<string>();
  for (const s of w.shock_timeline) if (round >= s.round && round < s.round + s.duration) activeShockTypes.add(s.type_id);
  for (const t of w.live_triggers) activeShockTypes.add(t);
  events.push(...resolveContingentClauses(w, c, round, activeShockTypes, emergedThisRound).events);

  // Active segment mods (distress dumping + MOD-A09 fired regulations): an α shift and,
  // for lobbying-driven regulations, additive βq / βb deltas.
  const alphaDelta = new Map<SegmentId, number>();
  const betaQModDelta = new Map<SegmentId, number>();
  const betaBModDelta = new Map<SegmentId, number>();
  for (const m of w.pending_segment_mods) {
    if (round >= m.until_round) continue;
    if (m.alpha_delta) alphaDelta.set(m.segment, (alphaDelta.get(m.segment) ?? 0) + m.alpha_delta);
    if (m.beta_q_delta) betaQModDelta.set(m.segment, (betaQModDelta.get(m.segment) ?? 0) + m.beta_q_delta);
    if (m.beta_b_delta) betaBModDelta.set(m.segment, (betaBModDelta.get(m.segment) ?? 0) + m.beta_b_delta);
  }

  // Step 6: unit cost per firm (supply-share + shock multipliers).
  for (const f of w.firms) {
    if (f.status !== "active") continue;
    // Supply-share agreements + integrated upstream assets both cut the input bill.
    const costReduction = Math.min(0.5, (agEff.unitCostReduction.get(f.id) ?? 0) + verticalCostReduction(f, c, round));
    const { unitCost } = computeUnitCost(f, c, costReduction, shock.perFirm.get(f.id)?.cost_multiplier ?? 1);
    f.unit_cost = unitCost;
  }

  // Step 6.5: production. Effective capacity (after shocks + coordination restraint)
  // caps how much each firm can brew this round; the run-rate lever chooses how hard
  // to run. Carried inventory + production = the sellable supply fed to the demand
  // step. In legacy mode (inventory disabled) production = full effective capacity and
  // nothing carries, so sellable supply == effective capacity — identical to before.
  const firmsById = new Map(w.firms.map((f) => [f.id, f]));
  const inv = invCfg(c);
  const effectiveCap = (id: FirmId): number => {
    const f = firmsById.get(id)!;
    const restraint = agEff.capacityRestraint.get(id) ?? 0;
    const capMult = shock.perFirm.get(id)?.capacity_multiplier ?? 1;
    // Owned facilities (MOD-B11) add capacity additively, subject to the same shock /
    // coordination multipliers as the base cap stock.
    return Math.max(0, (f.cap + facilityCapacity(f, c, round)) * (1 - restraint) * capMult);
  };
  const prodByFirm = new Map<FirmId, number>();
  const sellableByFirm = new Map<FirmId, number>();
  for (const f of w.firms) {
    if (f.status !== "active") continue;
    const effCap = effectiveCap(f.id);
    const invBeginUnits = inv.enabled ? f.inventory_units ?? 0 : 0;
    let qProd: number;
    if (inv.enabled) {
      const rr = decisions.get(f.id)?.run_rate;
      // Missing ⇒ default to full capacity; provided ⇒ clamp into [0, max_run_rate].
      const runRate = rr == null || !Number.isFinite(rr) ? 1 : Math.max(0, Math.min(rr, inv.max_run_rate));
      qProd = runRate * effCap;
    } else {
      qProd = effCap; // legacy: produce to capacity, nothing carried
    }
    prodByFirm.set(f.id, qProd);
    sellableByFirm.set(f.id, invBeginUnits + qProd);
  }

  // Step 6.6: PR events (MOD-A04). Proactive plays add a fast-decaying brand spike;
  // negative PR can fire (blunted by T_emp). The spike feeds the brand utility term.
  const prRes = resolvePrEvents(w, decisions, c, round);
  events.push(...prRes.events);

  // Step 7: demand, shares, quantities. Consumer drift (MOD-A08) evolves the
  // segment taste coefficients deterministically with the round index.
  const betaDeltas = computeBetaDeltas(c, round);
  if (c.modules?.consumerDrift?.enabled && round === 1) {
    events.push("MARKET SHIFT: consumer tastes are evolving — quality is gaining ground in the mainstream");
  }
  const mods: DemandModifiers = {
    extraBrand: (id, seg) => (agEff.extraBrand.get(id)?.get(seg) ?? 0) + (prRes.spikeByFirm.get(id) ?? 0) + rndFirstMoverBonus(w, c, id, seg, round),
    segmentAlphaDelta: (seg) => alphaDelta.get(seg) ?? 0,
    // Shock demand multiplier × the public-good regional-marketing bonus.
    segmentDemandMultiplier: (seg) => (shock.segmentDemandMultiplier.get(seg) ?? 1) * (1 + (pgRes.demandBonus.get(seg) ?? 0)),
    sellableSupply: (id) => sellableByFirm.get(id) ?? 0,
    // Consumer drift + the public-good quality-certification βq lift + MOD-A09
    // fired regulations (quality-standards βq lift, ad-restrictions βb cut).
    segmentBetaDelta: (seg) => {
      const d = betaDeltas.get(seg) ?? zeroBetaDelta();
      const qBonus = (pgRes.betaQBonus.get(seg) ?? 0) + (betaQModDelta.get(seg) ?? 0);
      const bDelta = betaBModDelta.get(seg) ?? 0;
      return qBonus || bDelta ? { q: d.q + qBonus, p: d.p, b: d.b + bDelta } : d;
    },
  };
  // Geography (MOD-B01/B02): with markets on, resolve demand per market and
  // aggregate; otherwise the single home-market path (identical to v1). FX is
  // advanced first (no-op unless international is on). `perFirmSegs` is the
  // aggregated per-firm per-segment view; revenue/qSold/dist+entry costs are
  // unified so the finance + scoring steps below are market-agnostic.
  updateFxRates(w, c);
  const geoOn = !!c.modules?.geography?.enabled;
  const revenueByFirm = new Map<FirmId, number>();
  const qSoldByFirm = new Map<FirmId, number>();
  const geoOpexByFirm = new Map<FirmId, number>(); // distribution + tariff + entry (→ opex)
  let perFirmSegs: Map<FirmId, Record<SegmentId, SegmentResult>>;
  let segTotals: Map<SegmentId, number>;
  let marketBreakdown: Map<FirmId, Record<string, { revenue: number; q_sold: number; entered: boolean }>> | null = null;
  if (geoOn) {
    const geo = resolveGeography(w, decisions, c, sellableByFirm, mods);
    events.push(...geo.events);
    perFirmSegs = geo.perFirm;
    segTotals = geo.segmentTotals;
    marketBreakdown = geo.marketBreakdown;
    for (const f of w.firms) {
      if (f.status !== "active") continue;
      revenueByFirm.set(f.id, geo.revenueByFirm.get(f.id) ?? 0);
      qSoldByFirm.set(f.id, geo.qSoldByFirm.get(f.id) ?? 0);
      geoOpexByFirm.set(f.id, (geo.distCostByFirm.get(f.id) ?? 0) + (geo.entryCostByFirm.get(f.id) ?? 0));
    }
  } else {
    const demand = resolveDemand(w, decisions, c, mods);
    perFirmSegs = demand.perFirm;
    segTotals = demand.segmentTotals;
    for (const f of w.firms) {
      if (f.status !== "active") continue;
      const segs = demand.perFirm.get(f.id) ?? {};
      let rev = 0, q = 0;
      for (const r of Object.values(segs)) { rev += r.revenue; q += r.q_sold; }
      revenueByFirm.set(f.id, rev);
      qSoldByFirm.set(f.id, q);
    }
  }
  for (const f of w.firms) {
    if (f.status !== "active") continue;
    // Learning accrues to output produced (you learn by brewing), or sold in legacy.
    f.cum_output += inv.enabled ? (prodByFirm.get(f.id) ?? 0) : (qSoldByFirm.get(f.id) ?? 0);
  }

  // Step 8 (+9): statements, cash, balance sheet; cash-hit damage flows through here.
  // Inventory accounting (weighted-average cost) sits here: produced output is
  // capitalized into stock, COGS expenses what sold, spoilage writes off the rest.
  const finByFirm = new Map<FirmId, ReturnType<typeof buildStatements>>();
  const invByFirm = new Map<FirmId, InventoryFlow | null>();
  for (const f of w.firms) {
    if (f.status !== "active") continue;
    const d = decisions.get(f.id)!;
    const revenue = revenueByFirm.get(f.id) ?? 0;
    const qSold = qSoldByFirm.get(f.id) ?? 0;

    let cogs: number;
    let spoilage = 0;
    let invValueBegin = 0;
    let invValueEnd = 0;
    let holdingCost = 0;
    let flow: InventoryFlow | null = null;
    if (inv.enabled) {
      flow = computeInventory(f.inventory_units ?? 0, f.inventory_value ?? 0, prodByFirm.get(f.id) ?? 0, f.unit_cost, qSold, inv.spoilage_rate);
      cogs = flow.cogs;
      spoilage = flow.spoilage_cost;
      invValueBegin = flow.value_begin;
      invValueEnd = flow.value_end;
      holdingCost = inv.holding_cost_per_unit * (f.inventory_units ?? 0);
    } else {
      cogs = f.unit_cost * qSold; // legacy: cost of what sold, nothing carried
    }

    const fin = buildStatements({
      firm: f, revenue, cogs, spoilage, inventoryValueBegin: invValueBegin, inventoryValueEnd: invValueEnd,
      // Vertical purchases (MOD-B06) are capitalized through the capex channel:
      // cash swaps into PP&E without adding brewing capacity.
      invest: { Q: d.invest_Q, B: d.invest_B, T_emp: d.invest_T_emp, T_inv: d.invest_T_inv, T_gov: d.invest_T_gov, process: d.invest_process, cap: d.invest_cap + (assetsRes.capexByFirm.get(f.id) ?? 0) + (facRes.capexByFirm.get(f.id) ?? 0) },
      financing: { debt_draw: d.debt_draw, debt_repay: d.debt_repay, equity_raise: d.equity_raise, dividend: d.dividend },
      extraOpex: (agRes.extraOpex.get(f.id) ?? 0) + (d.buy_info ? c.information.cost : 0) + holdingCost + (prRes.costByFirm.get(f.id) ?? 0) + (sustRes.costByFirm.get(f.id) ?? 0) + (pgRes.costByFirm.get(f.id) ?? 0) + (geoOpexByFirm.get(f.id) ?? 0) + (rndRes.costByFirm.get(f.id) ?? 0) + (assetsRes.opexByFirm.get(f.id) ?? 0) + (loRes.costByFirm.get(f.id) ?? 0) + (facRes.opexByFirm.get(f.id) ?? 0),
      cashHit: shock.perFirm.get(f.id)?.cash_hit ?? 0,
      spreadReduction: reputationSpread(f, c),
      regBurdenReduction: verticalRegRelief(f, c, round),
      round,
      instruments: { draw_convertible: nn(d.draw_convertible ?? 0), draw_rbf: nn(d.draw_rbf ?? 0) },
      config: c,
    });
    f.cash = fin.next.cash;
    f.debt = fin.next.debt;
    f.paid_in_capital = fin.next.paid_in_capital;
    f.retained_earnings = fin.next.retained_earnings;
    f.ppe_book = fin.next.ppe_book;
    f.convertible_note = fin.next.convertible_note;
    f.rbf_outstanding = fin.next.rbf_outstanding;
    f.rbf_principal = fin.next.rbf_principal;
    events.push(...fin.events);
    f.inventory_units = flow ? flow.end : 0;
    f.inventory_value = flow ? flow.value_end : 0;
    f.ni_history.push(fin.pnl.net_income);
    finByFirm.set(f.id, fin);
    invByFirm.set(f.id, flow);
    // Banked-path firms accrue risk-free interest on parked capital (§8.4).
  }
  for (const f of w.firms) {
    if (f.status === "exited_banked" && f.banked_cash > 0) f.banked_cash *= 1 + c.finance.r_f;
  }

  // Step 9.5: M&A (MOD-B07) — bids on distressed rivals settle after the books are
  // closed; an acquired firm is out before exits are processed.
  events.push(...resolveMa(w, decisions, c));

  // Step 10: solvency / exit / investor elections.
  const coverageByFirm = new Map<FirmId, number>();
  const valuationByFirm = new Map<FirmId, number>();
  const sharesByFirm = new Map<FirmId, Map<SegmentId, number>>();
  for (const id of participants) {
    const f = firmsById.get(id)!;
    coverageByFirm.set(id, finByFirm.get(id)?.cost_of_capital.coverage ?? 999);
    valuationByFirm.set(id, firmValuation(f, c));
    const m = new Map<SegmentId, number>();
    const segs = perFirmSegs.get(id) ?? {};
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
    const segMap = perFirmSegs.get(id) ?? {};
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
      state: { cash: f.cash, cap: f.cap, Q: f.Q, B: f.B, T_emp: f.T_emp, T_inv: f.T_inv, T_gov: f.T_gov, process: f.process, cum_output: f.cum_output, debt: f.debt, equity: fin.balance_sheet.equity, inventory_units: f.inventory_units, reputation: f.reputation ?? 0, water_efficiency: f.water_efficiency ?? 0, rnd_progress: f.rnd_progress ?? 0 },
      scorecard_raw: sc.raw, scorecard_norm: sc.norm, scorecard_cumulative: sc.cumulative,
      distinctiveness: distinct.get(id) ?? null,
      valuation: valuationByFirm.get(id) ?? 0,
      info_purchased: d.buy_info,
      inventory: (() => {
        const fl = invByFirm.get(id);
        return fl ? { begin: fl.begin, produced: fl.produced, sold: fl.sold, spoiled: fl.spoiled, end: fl.end, turnover: fl.turnover } : null;
      })(),
      markets: marketBreakdown?.get(id) ?? null,
      events: [],
    };
  });

  const market = w.segments.map((s) => ({ segment: s.id, D: s.D, total_q: segTotals.get(s.id) ?? 0, active: s.active }));

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
