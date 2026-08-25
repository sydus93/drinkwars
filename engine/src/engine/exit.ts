/**
 * Exit, re-entry, and operator-to-investor (§8). Forced exit on insolvency
 * (cash ≤ 0 or a sustained solvency-covenant breach) recovers little; a clean
 * voluntary exit recovers more, but recovery decays the longer a bleeding firm
 * waits (§8.1) — so exit timing is a real decision. On voluntary exit a team
 * banks, invests in a survivor at fair value (§7.5), or rebuilds (§8.3/§8.4).
 */
import type { Config, FirmId, FirmState, SegmentId, WorldState } from "../types.js";
import { initFirm } from "./init.js";

const fmNum = (n: number): string => Math.round(n).toLocaleString("en-US"); // comma-grouped for event prose

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
  // A rebuilt firm is a FRESH firm (§8.3): every stock, pipeline, balance-sheet line and
  // every module holding starts over. Before DW-046 this reset only the v1 fundamentals,
  // so a rebuilder carried its inventory, convertible note, RBF, facilities, employees,
  // markets and R&D into the fresh balance sheet — and the §7.2 invariant threw on
  // re-entry ("Balance sheet does not balance"), which would freeze a live round.
  // Build the fresh state with the same constructor a round-0 firm uses and keep only
  // identity, history and the exit-path bookkeeping.
  const fresh = initFirm(f.id, c, f.location_factor);
  const keep: Pick<FirmState, "id" | "status" | "location_factor" | "reentry_count" | "holdings" | "cap_table" | "banked_cash" | "initial_capital" | "score_accum" | "acquisitions_made"> = {
    id: f.id, status: f.status, location_factor: f.location_factor, reentry_count: f.reentry_count,
    holdings: f.holdings, cap_table: f.cap_table, banked_cash: f.banked_cash, initial_capital: f.initial_capital,
    score_accum: f.score_accum, acquisitions_made: f.acquisitions_made,
  };
  Object.assign(f, fresh, keep);
  // Optional module arrays are absent from a fresh state, so Object.assign leaves them —
  // clear them explicitly (plants free their parcels, people leave payroll).
  releaseHoldings(f);
  f.primary_segment = repositionSegment;
  f.cooldown_until_round = round + c.exit.reentry_cooldown_rounds;
}

/** A firm that leaves the game for good (bankruptcy, clean exit, acquisition) releases
 *  what it physically held: its plants free their parcels for the lease pool and its
 *  people leave payroll. Nothing here touches the balance sheet — the firm's books are
 *  frozen at exit and no longer resolved. */
export function releaseHoldings(f: FirmState): void {
  if (f.facilities?.length) f.facilities = [];
  if (f.employees?.length) f.employees = [];
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
      releaseHoldings(f); // liquidation: parcels return to the lease pool, staff leave
      events.push(`FORCED EXIT (bankruptcy): ${f.id} (cash $${fmNum(f.cash)}, coverage ${coverage.toFixed(2)})`);
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
      releaseHoldings(f);
      events.push(`CLEAN EXIT (bank): ${f.id} recovers $${fmNum(net)}`);
    } else if (ea.path === "invest" && ea.target_firm) {
      const target = world.firms.find((x) => x.id === ea.target_firm && x.status === "active");
      const V = input.valuationByFirm.get(ea.target_firm ?? "") ?? 0;
      if (target && V > 0) {
        const stake = Math.min(1, net / V);
        target.cap_table.push({ holder_id: f.id, shares: stake });
        f.holdings.push({ firm_id: target.id, stake_fraction: stake, basis: net });
        f.status = "exited_invested";
        releaseHoldings(f);
        events.push(`EXIT→INVEST: ${f.id} buys ${(stake * 100).toFixed(1)}% of ${target.id} at V=$${fmNum(V)}`);
      } else {
        f.banked_cash += net;
        f.status = "exited_banked";
        releaseHoldings(f);
        events.push(`EXIT→INVEST failed (no valid target); ${f.id} banked $${fmNum(net)}`);
      }
    } else if (ea.path === "rebuild") {
      const reentryCost = c.exit.reentry_cost * Math.pow(c.exit.reentry_cost_escalation, f.reentry_count);
      const known = new Set(world.segments.map((s) => s.id));
      const reposition = ea.reposition_segment != null && known.has(ea.reposition_segment) ? ea.reposition_segment : null;
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
      events.push(`EXIT→REBUILD: ${f.id} repositions to ${reposition ?? "(unset)"}, pays $${fmNum(reentryCost)} (cooldown to r${f.cooldown_until_round})`);
    }
  }

  return { events };
}
