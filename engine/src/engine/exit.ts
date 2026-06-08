/**
 * Exit, re-entry, and operator-to-investor (§8). Forced exit on insolvency
 * (cash ≤ 0 or a sustained solvency-covenant breach) recovers little; a clean
 * voluntary exit recovers more, but recovery decays the longer a bleeding firm
 * waits (§8.1) — so exit timing is a real decision. On voluntary exit a team
 * banks, invests in a survivor at fair value (§7.5), or rebuilds (§8.3/§8.4).
 */
import type { Config, FirmId, FirmState, SegmentId, WorldState } from "../types.js";
import { emptyPipeline } from "./stocks.js";

export interface ExitInputs {
  world: WorldState;
  decisions: Map<FirmId, import("../types.js").FirmDecision>;
  config: Config;
  round: number;
  coverageByFirm: Map<FirmId, number>;
  sharesByFirm: Map<FirmId, Map<SegmentId, number>>;
  valuationByFirm: Map<FirmId, number>;
}

function assets(f: FirmState): number {
  return f.cash + f.ppe_book;
}

function resetToFresh(f: FirmState, c: Config, repositionSegment: SegmentId | null, round: number): void {
  const init = c.init;
  f.cash = init.starting_cash;
  f.cap = init.starting_cap;
  f.Q = init.starting_Q;
  f.B = init.starting_B;
  f.T_emp = init.starting_T_emp;
  f.T_inv = init.starting_T_inv;
  f.T_gov = init.starting_T_gov;
  f.process = init.starting_process;
  f.debt = init.starting_debt;
  f.ppe_book = init.starting_cap * c.capacity.book_value_per_unit;
  f.paid_in_capital = f.cash + f.ppe_book - f.debt;
  f.retained_earnings = 0;
  f.cum_output = 0;
  f.unit_cost = 0;
  f.ni_history = [];
  f.rounds_below_health = 0;
  f.pipelines = {
    cap: emptyPipeline(c.capacity.lag),
    Q: emptyPipeline(c.stocks.Q.lag),
    B: emptyPipeline(c.stocks.B.lag),
    T_emp: emptyPipeline(c.stocks.T_emp.lag),
    T_inv: emptyPipeline(c.stocks.T_inv.lag),
    T_gov: emptyPipeline(c.stocks.T_gov.lag),
    process: emptyPipeline(c.costs.process.lag),
  };
  f.primary_segment = repositionSegment;
  f.cooldown_until_round = round + c.exit.reentry_cooldown_rounds;
}

export function processExits(input: ExitInputs): { events: string[] } {
  const { world, decisions, config: c, round } = input;
  const events: string[] = [];
  const cashSafety = c.scoring.cash_safety_threshold;

  const registerDistressDumping = (f: FirmState) => {
    const dd = c.shocks.endogenous.distress_dumping;
    const shares = input.sharesByFirm.get(f.id);
    if (!shares) return;
    for (const [seg, share] of shares) {
      if (share >= dd.min_share_to_trigger) {
        world.pending_segment_mods.push({ segment: seg, alpha_delta: -dd.price_depression, until_round: round + 1 + dd.duration });
        events.push(`DISTRESS DUMPING: ${f.id}'s collapse depresses ${seg} (Δα ${(-dd.price_depression).toFixed(2)}) for ${dd.duration} round(s)`);
      }
    }
  };

  for (const f of world.firms) {
    if (f.status !== "active") continue;

    // Health / covenant tracking (§8.2).
    const coverage = input.coverageByFirm.get(f.id) ?? 999;
    const belowHealth = f.cash < cashSafety || coverage < 1;
    f.rounds_below_health = belowHealth ? f.rounds_below_health + 1 : 0;

    // Forced exit: insolvency or sustained covenant breach.
    const covenantBreach = f.rounds_below_health >= c.finance.solvency_runway_rounds && coverage < 1 && f.cash < cashSafety * 0.5;
    if (f.cash <= 0 || covenantBreach) {
      f.status = "bankrupt";
      events.push(`FORCED EXIT (bankruptcy): ${f.id} (cash ${f.cash.toFixed(0)}, coverage ${coverage.toFixed(2)})`);
      registerDistressDumping(f);
      continue;
    }
  }

  // Voluntary exits / investor elections (§8.1, §8.4) — processed after forced exits
  // so an investor can't buy into a firm that went bankrupt this round.
  for (const f of world.firms) {
    if (f.status !== "active") continue;
    const ea = decisions.get(f.id)?.exit_action;
    if (!ea || ea.type !== "voluntary") continue;

    const recovery = c.exit.base_recovery * assets(f) * Math.pow(1 - c.exit.liquidation_decay, f.rounds_below_health);
    const net = Math.max(0, recovery - f.debt); // creditors paid first

    if (ea.path === "bank") {
      f.banked_cash += net;
      f.status = "exited_banked";
      events.push(`CLEAN EXIT (bank): ${f.id} recovers ${net.toFixed(0)}`);
    } else if (ea.path === "invest" && ea.target_firm) {
      const target = world.firms.find((x) => x.id === ea.target_firm && x.status === "active");
      const V = input.valuationByFirm.get(ea.target_firm ?? "") ?? 0;
      if (target && V > 0) {
        const stake = Math.min(1, net / V);
        target.cap_table.push({ holder_id: f.id, shares: stake });
        f.holdings.push({ firm_id: target.id, stake_fraction: stake, basis: net });
        f.status = "exited_invested";
        events.push(`EXIT→INVEST: ${f.id} buys ${(stake * 100).toFixed(1)}% of ${target.id} at V=${V.toFixed(0)}`);
      } else {
        f.banked_cash += net;
        f.status = "exited_banked";
        events.push(`EXIT→INVEST failed (no valid target); ${f.id} banked ${net.toFixed(0)}`);
      }
    } else if (ea.path === "rebuild") {
      const reentryCost = c.exit.reentry_cost * Math.pow(c.exit.reentry_cost_escalation, f.reentry_count);
      const reposition = ea.reposition_segment ?? null;
      if (reposition !== null && reposition === f.primary_segment) {
        events.push(`REBUILD rejected: ${f.id} must reposition to a different primary segment`);
        continue;
      }
      f.reentry_count += 1;
      resetToFresh(f, c, reposition, round);
      // The re-entry cost is a one-time charge: it must hit cash AND equity, or the
      // balance sheet (§7.2) breaks. Route it through retained earnings.
      f.cash -= reentryCost;
      f.retained_earnings -= reentryCost;
      f.status = "exited_rebuilt"; // re-activates after cooldown (see init/advance)
      events.push(`EXIT→REBUILD: ${f.id} repositions to ${reposition ?? "(unset)"}, pays ${reentryCost.toFixed(0)} (cooldown to r${f.cooldown_until_round})`);
    }
  }

  return { events };
}
