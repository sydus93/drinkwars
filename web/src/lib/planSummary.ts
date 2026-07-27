/**
 * Team plan summaries (DW-038) — turn the composed FirmDecision into short, readable
 * per-desk lines for the Round Table review, plus a cash reconciliation so the table
 * can see whether the plan clears the bank before anyone locks it (the "COO and CMO
 * spend, nobody told the CFO" catch). Pure functions over the view — no state.
 */
import type { FirmDecision } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { SEG_LABEL, fmt, humanizeId } from "../labels.js";
import type { CockpitDesk } from "../deskMeta.js";

const money = (n: number) => fmt.money(n);

/** Short human lines for one desk's slice of the composed decision (nonzero levers only). */
export function deskLines(desk: CockpitDesk, d: FirmDecision, view: GameView): string[] {
  const out: string[] = [];
  const activeSegs = view.segments.filter((s) => s.active).map((s) => s.id);
  if (desk === "commercial") {
    const prices = activeSegs.filter((s) => (d.price?.[s] ?? 0) > 0).map((s) => `${SEG_LABEL[s] ?? humanizeId(s)} ${money(d.price[s])}`);
    if (prices.length) out.push(`Price · ${prices.join(" · ")}`);
    const mkts = Object.entries(d.market_presence ?? {}).filter(([, v]) => (v ?? 0) > 0).length;
    if (mkts > 0) out.push(`Selling in ${mkts} market${mkts === 1 ? "" : "s"}`);
    if ((d.invest_B ?? 0) > 0) out.push(`Brand ${money(d.invest_B)}`);
    if (d.pr_action) out.push(`PR: ${humanizeId(String(d.pr_action))}`);
    if (d.buy_info) out.push("Buying market research");
  } else if (desk === "operations") {
    if (d.run_rate != null) out.push(`Run rate ${Math.round(d.run_rate * 100)}%`);
    const inv: string[] = [];
    if ((d.invest_cap ?? 0) > 0) inv.push(`capacity ${money(d.invest_cap)}`);
    if ((d.invest_process ?? 0) > 0) inv.push(`process ${money(d.invest_process)}`);
    if ((d.invest_Q ?? 0) > 0) inv.push(`quality ${money(d.invest_Q)}`);
    if ((d.invest_rnd ?? 0) > 0) inv.push(`R&D ${money(d.invest_rnd ?? 0)}`);
    if (inv.length) out.push(`Invest · ${inv.join(" · ")}`);
    const builds = d.build_facilities ?? [];
    if (builds.length) out.push(`Build ${builds.length}: ${builds.map((b) => humanizeId(b.type)).join(", ")}`);
    const maint = Object.values(d.maintain_facilities ?? {}).reduce((a, v) => a + (v ?? 0), 0);
    if (maint > 0) out.push(`Maintenance ${money(maint)}`);
    const moth = (d.mothball_facilities ?? []).length; const react = (d.reactivate_facilities ?? []).length; const div = (d.divest_facilities ?? []).length;
    if (moth) out.push(`Mothball ${moth}`);
    if (react) out.push(`Reactivate ${react}`);
    if (div) out.push(`Divest ${div}`);
    if ((d.buy_vertical ?? []).length) out.push(`Vertical: ${(d.buy_vertical ?? []).map(humanizeId).join(", ")}`);
  } else if (desk === "people") {
    const hires = (d.hire_roles ?? []).length + (d.hire_employees ?? []).length;
    const bonuses = Object.values(d.hire_bids ?? {}).reduce((a, v) => a + (v ?? 0), 0);
    if (hires) out.push(`Hire ${hires}${bonuses > 0 ? ` (+${money(bonuses)} signing bonuses)` : ""}`);
    const fires = (d.fire_roles ?? []).length + (d.fire_employees ?? []).length;
    if (fires) out.push(`Let go ${fires}`);
    const raises = Object.values(d.raise_employees ?? {}).reduce((a, v) => a + (v ?? 0), 0);
    if (raises > 0) out.push(`Raises ${money(raises)}`);
    if ((d.poach_employees ?? []).length) out.push(`Poach ${(d.poach_employees ?? []).length} (offers ${money((d.poach_employees ?? []).reduce((a, p) => a + (p.offer ?? 0), 0))})`);
    if ((d.invest_T_emp ?? 0) > 0) out.push(`Employee relations ${money(d.invest_T_emp)}`);
  } else if (desk === "finance") {
    if ((d.debt_draw ?? 0) > 0) out.push(`Draw debt ${money(d.debt_draw)}`);
    if ((d.draw_convertible ?? 0) > 0) out.push(`Convertible ${money(d.draw_convertible ?? 0)}`);
    if ((d.draw_rbf ?? 0) > 0) out.push(`Revenue-based ${money(d.draw_rbf ?? 0)}`);
    if ((d.equity_raise ?? 0) > 0) out.push(`Raise equity ${money(d.equity_raise)}`);
    if ((d.debt_repay ?? 0) > 0) out.push(`Repay ${money(d.debt_repay)}`);
    if ((d.dividend ?? 0) > 0) out.push(`Dividend ${money(d.dividend)}`);
    if ((d.invest_T_inv ?? 0) > 0) out.push(`Investor relations ${money(d.invest_T_inv)}`);
  } else if (desk === "strategy") {
    const acts = d.agreement_actions ?? [];
    if (acts.length) out.push(`Alliance moves: ${acts.map((a) => humanizeId(a.type)).join(", ")}`);
    if ((d.lobby_spend ?? 0) > 0) out.push(`Lobby ${money(d.lobby_spend ?? 0)}${d.lobby_initiative ? ` → ${humanizeId(d.lobby_initiative)}` : ""}`);
    if (d.acquisition_bid) out.push(`Acquisition bid ${money(d.acquisition_bid.price)}`);
    const pg = Object.values(d.public_good_contributions ?? {}).reduce((a, v) => a + (v ?? 0), 0);
    if (pg > 0) out.push(`Public goods ${money(pg)}`);
    if ((d.invest_T_gov ?? 0) > 0) out.push(`Government affairs ${money(d.invest_T_gov)}`);
    if (d.exit_action) out.push(`EXIT: ${humanizeId(d.exit_action.path)}${d.exit_action.target_firm ? ` → ${d.exit_action.target_firm}` : ""}`);
  }
  return out;
}

/** Rough cash reconciliation of the composed plan: committed outflows vs financing
 *  inflows vs cash on hand. An ESTIMATE — payroll/opex/COGS aren't included — but it
 *  catches the classic miss: desks committing spend the CFO never financed. */
export function planCash(d: FirmDecision, view: GameView): { out: number; inflow: number; after: number } {
  const facTypes = view.modules?.facilities?.types ?? [];
  const buildCapex = (d.build_facilities ?? []).reduce((a, b) => {
    const t = facTypes.find((x) => x.id === b.type);
    return a + (t?.base_cost ?? 0) + Math.max(0, (b as { bid?: number }).bid ?? 0);
  }, 0);
  const invest = (d.invest_cap ?? 0) + (d.invest_process ?? 0) + (d.invest_Q ?? 0) + (d.invest_B ?? 0)
    + (d.invest_T_emp ?? 0) + (d.invest_T_inv ?? 0) + (d.invest_T_gov ?? 0) + (d.invest_rnd ?? 0) + (d.invest_water_efficiency ?? 0);
  const maint = Object.values(d.maintain_facilities ?? {}).reduce((a, v) => a + (v ?? 0), 0);
  const people = Object.values(d.hire_bids ?? {}).reduce((a, v) => a + (v ?? 0), 0)
    + Object.values(d.raise_employees ?? {}).reduce((a, v) => a + (v ?? 0), 0)
    + (d.poach_employees ?? []).reduce((a, p) => a + (p.offer ?? 0), 0);
  const strat = (d.lobby_spend ?? 0) + (d.acquisition_bid?.price ?? 0)
    + Object.values(d.public_good_contributions ?? {}).reduce((a, v) => a + (v ?? 0), 0);
  const out = buildCapex + invest + maint + people + strat + (d.debt_repay ?? 0) + (d.dividend ?? 0);
  const inflow = (d.debt_draw ?? 0) + (d.equity_raise ?? 0) + (d.draw_convertible ?? 0) + (d.draw_rbf ?? 0);
  const cash = view.own?.cash ?? 0;
  return { out, inflow, after: cash + inflow - out };
}
