/**
 * MOD-B07 · M&A. A distressed rival (rounds below solvency health ≥ 1) can be
 * acquired instead of bleeding out: the highest valid bid wins, the acquirer pays
 * cash, absorbs a discounted fraction of the target's capacity/brand/quality plus
 * its full cash and debt, and the target leaves the game as "acquired".
 *
 * Balance sheets stay exact: the acquirer's net asset change (target cash + PP&E
 * taken on − price paid) minus the debt assumed flows through retained earnings as
 * an acquisition gain/loss — the standard bargain-purchase / overpayment plug.
 * Runs AFTER the finance step (statements already balanced), so the merger shows
 * on next round's statements; the event log announces it this round.
 */
import type { Config, FirmDecision, FirmId, WorldState } from "../types.js";
import { firmValuation } from "./finance.js";

export function resolveMa(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config): string[] {
  const cfg = c.modules?.ma;
  if (!cfg?.enabled) return [];
  const events: string[] = [];

  // Collect valid bids per target: bidder active & liquid, target active & distressed,
  // price at least the fair-value floor. Highest price per target wins.
  const bids = new Map<FirmId, { bidder: FirmId; price: number }>();
  for (const f of world.firms) {
    if (f.status !== "active") continue;
    const bid = decisions.get(f.id)?.acquisition_bid;
    if (!bid || !Number.isFinite(bid.price) || bid.price <= 0 || bid.target === f.id) continue;
    if ((f.acquisitions_made ?? 0) >= cfg.max_acquisitions) continue; // roll-up cap
    const target = world.firms.find((t) => t.id === bid.target);
    if (!target || target.status !== "active" || target.rounds_below_health < cfg.min_distress_rounds) continue;
    const floor = cfg.min_price_fraction * Math.max(0, firmValuation(target, c));
    if (bid.price < floor || f.cash < bid.price) continue;
    const cur = bids.get(bid.target);
    if (!cur || bid.price > cur.price) bids.set(bid.target, { bidder: f.id, price: bid.price });
  }

  for (const [targetId, { bidder, price }] of bids) {
    const a = world.firms.find((f) => f.id === bidder)!;
    const t = world.firms.find((f) => f.id === targetId)!;
    if (a.status !== "active" || t.status !== "active") continue; // a may itself have been acquired
    const disc = cfg.integration_discount;

    // What the acquirer takes on (integration losses shrink the productive assets).
    const ppeGain = t.ppe_book * disc;
    a.cash += t.cash - price;
    a.cap += t.cap * disc;
    a.Q += t.Q * disc * 0.5; // capabilities transfer at a deeper discount than hardware
    a.B += t.B * disc * 0.5;
    a.ppe_book += ppeGain;
    a.debt += t.debt;
    a.cum_output += t.cum_output * disc;
    a.acquisitions_made = (a.acquisitions_made ?? 0) + 1;
    // Balance the acquirer's books: ΔAssets − ΔLiabilities → retained earnings.
    a.retained_earnings += t.cash - price + ppeGain - t.debt;

    // The target leaves the game with nothing on the books.
    t.status = "acquired";
    t.cash = 0; t.cap = 0; t.debt = 0; t.ppe_book = 0; t.inventory_units = 0; t.inventory_value = 0;
    t.retained_earnings = -t.paid_in_capital; // book equity → 0

    events.push(`ACQUIRED: ${bidder} buys distressed ${targetId} for $${Math.round(price)} (assumes its debt)`);
  }
  return events;
}
