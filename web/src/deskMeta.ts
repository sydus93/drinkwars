/**
 * Teams-mode L1 — the desk cockpit content model (DW-031).
 *
 * A "cockpit" is the per-role experience layered above the desk-filtered DecisionForm:
 * each C-suite seat should feel native to the sub-discipline a student walks in with
 * (Finance → CFO, Marketing → CMO, Ops/People → COO, Strategy/Gov → Corp-Dev, GM → CEO).
 *
 * This file is PURE: personas (static) + metric selectors that read `GameView` and return
 * display-ready signals/metrics. No engine change — every number comes from data the engine
 * already emits (`view.ownResult`, `view.firms`, `view.own`). Keyed to the FOCUSED DESK (the
 * thing that actually filters the levers), because the shipped partition is 4 desks while the
 * C-suite is 5 roles (CHRO shares the ops desk; the relations desk = corporate-dev/external).
 * `seatRole` drives the "you hold this seat" framing in the UI, not the persona selection.
 */
import type { GameView, FirmSnapshot } from "./game/controller.js";
import { fmt, SEG_TAG } from "./labels.js";

export type CockpitDesk = "all" | "commercial" | "operations" | "people" | "finance" | "strategy";
export type Tone = "good" | "watch" | "risk" | "neutral";

export interface CockpitPersona {
  desk: CockpitDesk;
  title: string; // "Chief Financial Officer"
  short: string; // "CFO"
  discipline: string; // the concentration a student brings
  charter: string; // one-line mandate
  accent: string; // css var, matches the desk filter chip
  briefingRole?: "cfo" | "cmo" | "coo" | "ceo"; // MOD-B05 intel to surface, if any
}

/** A "your mandate this round" callout: what to watch / your job, with a plain read. */
export interface Signal { label: string; value: string; tone: Tone; read: string }
/** A teaching-facing metric: firm value vs the field, with a "what this means" hint. */
export interface Metric { label: string; value: string; field?: string; tone: Tone; hint: string }

export const PERSONAS: Record<CockpitDesk, CockpitPersona> = {
  all: {
    desk: "all", title: "Founder · Whole firm", short: "GM", discipline: "General management",
    charter: "Wear every hat — integrate all five desks into one coherent bet, then commit.",
    accent: "var(--color-inksoft)", briefingRole: "ceo",
  },
  commercial: {
    desk: "commercial", title: "Chief Marketing Officer", short: "CMO", discipline: "Marketing · Consumer behavior",
    charter: "Win demand: price, brand, and the segments you fight for. Find where customers pay.",
    accent: "var(--color-copper)", briefingRole: "cmo",
  },
  operations: {
    desk: "operations", title: "Chief Operating Officer", short: "COO", discipline: "Operations · Supply chain",
    charter: "Make and deliver at the lowest sustainable cost — capacity, process, quality, facilities.",
    accent: "var(--color-aero)", briefingRole: "coo",
  },
  people: {
    desk: "people", title: "Chief People Officer", short: "CHRO", discipline: "People · Org behavior · Sustainability",
    charter: "Build the organization: staff it, keep it, and turn morale and trust into productivity.",
    accent: "var(--color-gold)",
  },
  finance: {
    desk: "finance", title: "Chief Financial Officer", short: "CFO", discipline: "Finance · Accounting",
    charter: "Steward the balance sheet: financing, capital structure, dividends, and the investor relationship.",
    accent: "var(--color-hop)", briefingRole: "cfo",
  },
  strategy: {
    desk: "strategy", title: "Chief Executive · Strategy", short: "CEO", discipline: "Strategy · Business & government",
    charter: "Shape the game outside the firm — alliances, deals, regulation, and when to exit.",
    accent: "var(--color-plum)", briefingRole: "ceo",
  },
};

// ── field-benchmark helpers ────────────────────────────────────────────────
const active = (view: GameView): FirmSnapshot[] => view.firms.filter((f) => f.status === "active");
const rivals = (view: GameView): FirmSnapshot[] => active(view).filter((f) => !f.isYou);
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Field median of a rival metric (empty field → 0). */
const fieldMed = (view: GameView, pick: (f: FirmSnapshot) => number): number => median(rivals(view).map(pick));
/** Tone from a value vs a benchmark, `higherBetter` flips the sense. `band` = the "watch" gap. */
const cmpTone = (v: number, bench: number, higherBetter: boolean, band = 0.1): Tone => {
  if (!isFinite(v) || bench === 0) return "neutral";
  const rel = (v - bench) / Math.abs(bench);
  const good = higherBetter ? rel > band : rel < -band;
  const bad = higherBetter ? rel < -band : rel > band;
  return good ? "good" : bad ? "risk" : "watch";
};

/** Total units sold / desired this round (0 pre-resolution). */
function volumes(view: GameView): { sold: number; desired: number } {
  const r = view.ownResult;
  if (!r) return { sold: 0, desired: 0 };
  let sold = 0, desired = 0;
  for (const s of Object.values(r.segments)) { sold += s.q_sold; desired += s.q_desired; }
  return { sold, desired };
}

// ── the mandate ("your job this round") ────────────────────────────────────
export function cockpitSignals(desk: CockpitDesk, view: GameView): Signal[] {
  const r = view.ownResult;
  const out: Signal[] = [];
  const round = Math.min(view.round + 1, view.nRounds);

  if (desk === "finance") {
    if (r) {
      const { coverage, leverage, credit_rationed } = r.cost_of_capital;
      const covTone: Tone = coverage >= 3 ? "good" : coverage >= 1.5 ? "watch" : "risk";
      out.push({ label: "Interest coverage", value: `${coverage.toFixed(1)}×`, tone: covTone,
        read: covTone === "risk" ? "Thin. Under 1.5× the bank moves you onto the penalty grid and the spread widens the further cover falls. De-lever or earn back the cover." : "EBIT ÷ interest. Comfortable room to service debt." });
      const levMed = fieldMed(view, (f) => f.leverage);
      out.push({ label: "Leverage vs field", value: `${leverage.toFixed(2)}×`, tone: cmpTone(leverage, levMed, false, 0.2),
        read: `Field runs ≈${levMed.toFixed(2)}×. ${leverage > levMed * 1.2 ? "You're the stretched one at the table — borrowing gets pricier." : "You have borrowing headroom the field doesn't."}` });
      if (credit_rationed) out.push({ label: "Credit", value: "Rationed", tone: "risk", read: "Lenders are capping new debt. This round leans on cash or equity, not more borrowing." });
    }
    // cross-desk handoff: what the round is asking the balance sheet to fund
    out.push({ label: "Funding the round", value: fmt.money(view.own.cash), tone: view.own.cash < 300 ? "risk" : "neutral",
      read: "Capex (COO), hiring (People), and marketing (CMO) all draw here. Set the envelope before they overspend it." });
  }

  if (desk === "operations") {
    const { sold, desired } = volumes(view);
    if (r && view.own.cap > 0) {
      const util = sold / view.own.cap;
      const utilTone: Tone = util >= 0.95 ? "watch" : util >= 0.7 ? "good" : "risk";
      out.push({ label: "Capacity utilization", value: fmt.pct(util), tone: utilTone,
        read: util >= 0.95 ? "You're near the ceiling — demand you can't serve is lost margin. A build needs CFO cash and lands next round." : util < 0.7 ? "Idle tanks you're still paying upkeep on. Grow demand (CMO) or trim/mothball." : "Healthy headroom without paying for idle capacity." });
      const gap = desired - sold;
      if (gap > sold * 0.05) out.push({ label: "Unserved demand", value: fmt.int(gap), tone: "risk", read: "Buyers wanted more than you could make. This is the cost of under-building — flag capex to the CFO." });
    }
    const ucMed = fieldMed(view, (f) => f.unitCost);
    out.push({ label: "Unit cost vs field", value: fmt.price(view.own.unit_cost), tone: cmpTone(view.own.unit_cost, ucMed, false, 0.08),
      read: `Field ≈${fmt.price(ucMed)}. Process + learning + scale drive this down; morale (People) moves productivity.` });
    if (view.inventoryEnabled && r?.inventory) out.push({ label: "Inventory turnover", value: `${r.inventory.turnover.toFixed(1)}×`, tone: r.inventory.turnover < 1 ? "watch" : "good", read: "Sold ÷ average on-hand. Low turns = cash tied up in kegs and spoilage risk." });
  }

  if (desk === "commercial") {
    const you = view.firms.find((f) => f.isYou);
    const segs = view.segments.filter((s) => s.active);
    // headline segment = where you have the most share to win/defend
    const primary = segs.map((s) => ({ id: s.id, mine: you?.shareBySeg?.[s.id] ?? 0, lead: Math.max(0, ...rivals(view).map((f) => f.shareBySeg?.[s.id] ?? 0)) }))
      .sort((a, b) => (b.mine + b.lead) - (a.mine + a.lead))[0];
    if (primary) {
      const behind = primary.lead > primary.mine;
      out.push({ label: `${SEG_TAG[primary.id] ?? primary.id} share`, value: fmt.pct(primary.mine), tone: behind ? "watch" : "good",
        read: behind ? `Field leader holds ${fmt.pct(primary.lead)} here. Close it with price, brand, or a sharper position — not all three at once.` : "You lead this segment. Defend the position; don't over-invest to pad a lead." });
    }
    const bMed = fieldMed(view, (f) => f.B);
    out.push({ label: "Brand vs field", value: view.own.B.toFixed(0), tone: cmpTone(view.own.B, bMed, true, 0.1),
      read: `Field ≈${bMed.toFixed(0)}. Brand is a stock — it decays without investment and can't be bought in one round.` });
    if (r?.distinctiveness) out.push({ label: "Distinctiveness", value: r.distinctiveness.nearest_neighbor.toFixed(2), tone: "neutral",
      read: "Distance to your nearest rival on the strategy map. Too crowded → price war; too far → no buyers. Aim for the underserved-but-real niche." });
    const { sold, desired } = volumes(view);
    if (desired > sold * 1.05) out.push({ label: "Demand vs supply", value: "capacity-bound", tone: "watch", read: "You're selling everything you can make — more demand-building only helps if the COO adds capacity." });
    if (view.own.pr_cooldown_until != null && view.own.pr_cooldown_until > view.round) out.push({ label: "PR play", value: `ready ~r${view.own.pr_cooldown_until + 1}`, tone: "neutral", read: "On cooldown. A well-timed PR event lifts demand beyond price and brand — save it for a moment that matters." });
    else out.push({ label: "PR play", value: "ready", tone: "good", read: "Available. Turn a community or sustainability move into a demand driver, not just goodwill." });
  }

  if (desk === "people") {
    const empMed = fieldMed(view, (f) => f.T_emp);
    out.push({ label: "Employee relations", value: view.own.T_emp.toFixed(0), tone: cmpTone(view.own.T_emp, empMed, true, 0.15),
      read: `Field ≈${empMed.toFixed(0)}. Morale feeds productivity — a happy crew brews cheaper, and that lands on the COO's unit cost.` });
    const you = view.firms.find((f) => f.isYou);
    const roster = you?.employees ?? [];
    if (roster.length) {
      const avgSat = roster.reduce((a, e) => a + e.satisfaction, 0) / roster.length;
      const atRisk = roster.filter((e) => e.satisfaction < 0.45).length;
      out.push({ label: "Crew satisfaction", value: fmt.pct(avgSat), tone: avgSat < 0.45 ? "risk" : avgSat < 0.6 ? "watch" : "good",
        read: atRisk > 0 ? `${atRisk} on staff are unhappy enough to be poachable — a rival's offer could walk them out the door.` : "Your crew is content; rivals will find them expensive to lure away." });
    } else {
      out.push({ label: "Headcount", value: "0", tone: "watch", read: "No named staff yet. Hiring skilled brewers beats raw capital investment for quality — recruit before rivals do." });
    }
    out.push({ label: "Poach exposure", value: roster.length ? "watch the market" : "—", tone: "neutral", read: "The talent market is two-way: you can lure a rival's people, and they can lure yours. Retention (raises, morale) is cheaper than re-hiring." });
  }

  if (desk === "strategy") {
    const govMed = fieldMed(view, (f) => f.T_gov);
    out.push({ label: "Regulator standing", value: view.own.T_gov.toFixed(0), tone: cmpTone(view.own.T_gov, govMed, true, 0.15),
      read: `Field ≈${govMed.toFixed(0)}. Goodwill with regulators lowers scrutiny risk and strengthens your hand in lobbying fights.` });
    if (view.agreements.length) out.push({ label: "Active pacts", value: String(view.agreements.length), tone: "neutral", read: "Alliances move fast but invite defection. Contingent clauses and reputation are your enforcement, not trust." });
    if (view.lobbyInitiatives.length) out.push({ label: "Regulation in play", value: String(view.lobbyInitiatives.length), tone: "watch", read: "A rule is moving through the docket. Push, counter, or let it ride — each shifts who the market favors." });
    const wounded = rivals(view).filter((f) => f.distressRounds > 0).length;
    if (wounded > 0) out.push({ label: "M&A openings", value: `${wounded} distressed`, tone: "neutral", read: "A bleeding rival is a cheap acquisition — capacity and share without building. Time the bid before someone else does." });
  }

  if (desk === "all") {
    const myRank = view.standings.findIndex((s) => s.isYou) + 1;
    out.push({ label: "Standing", value: myRank > 0 ? `#${myRank} of ${view.standings.length}` : "—", tone: myRank === 1 ? "good" : myRank > 0 && myRank <= view.standings.length / 2 ? "watch" : "neutral",
      read: "Scored on advantage sustained across the whole season, not a final-round spike. Consistency compounds." });
    if (r) {
      const sc = r.scorecard_norm;
      const weakest = (Object.entries(sc) as [string, number][]).sort((a, b) => a[1] - b[1])[0];
      out.push({ label: "Weakest scorecard leg", value: `${weakest[0]} (${weakest[1].toFixed(2)})`, tone: weakest[1] < 0 ? "risk" : "watch",
        read: "The four legs — financial, market, intangible, stakeholder — are your four officers. A lopsided firm loses to a balanced one. Allocate to the gap." });
    }
    out.push({ label: "This round", value: `R${round}/${view.nRounds}`, tone: "neutral", read: "Read each officer's mandate below, then allocate: whose ask earns the capital this round?" });
  }

  // MOD-B05 role intel — a briefing line, when the module is on
  const brief = PERSONAS[desk].briefingRole && view.briefings.find((b) => b.role === PERSONAS[desk].briefingRole);
  if (brief && brief.lines.length) out.push({ label: "Intel", value: brief.title.replace(/ briefing.*/, ""), tone: "neutral", read: brief.lines[0] });

  return out;
}

// ── teaching metrics (firm value vs field — "compare and contrast") ─────────
export function cockpitMetrics(desk: CockpitDesk, view: GameView): Metric[] {
  const r = view.ownResult;
  const you = view.firms.find((f) => f.isYou);
  const out: Metric[] = [];

  if (desk === "finance" && r) {
    const cc = r.cost_of_capital;
    out.push({ label: "Coverage (EBIT/int)", value: `${cc.coverage.toFixed(1)}×`, tone: cc.coverage >= 3 ? "good" : cc.coverage >= 1.5 ? "watch" : "risk", hint: "Can operating profit cover the interest? Below ~1.5× is fragile." });
    out.push({ label: "Leverage", value: `${cc.leverage.toFixed(2)}×`, field: `field ${fieldMed(view, (f) => f.leverage).toFixed(2)}×`, tone: cmpTone(cc.leverage, fieldMed(view, (f) => f.leverage), false, 0.2), hint: "Debt ÷ equity. Cheap growth until a shock — then it amplifies losses." });
    out.push({ label: "Cost of debt", value: fmt.pct1(cc.r_debt), tone: "neutral", hint: "Your marginal borrowing rate — rises with leverage and thin coverage." });
    out.push({ label: "Net income", value: fmt.signed(r.pnl.net_income), field: `field ${fmt.money(fieldMed(view, (f) => f.netIncome))}`, tone: r.pnl.net_income >= 0 ? "good" : "risk", hint: "Accrual profit — not cash. A profitable firm can still run out of money." });
  }

  if (desk === "operations") {
    const { sold, desired } = volumes(view);
    const util = view.own.cap > 0 ? sold / view.own.cap : 0;
    if (r) out.push({ label: "Utilization", value: fmt.pct(util), tone: util >= 0.95 ? "watch" : util >= 0.7 ? "good" : "risk", hint: "Units sold ÷ capacity. Near 100% = lost sales; low = idle upkeep." });
    out.push({ label: "Unit cost", value: fmt.price(view.own.unit_cost), field: `field ${fmt.price(fieldMed(view, (f) => f.unitCost))}`, tone: cmpTone(view.own.unit_cost, fieldMed(view, (f) => f.unitCost), false, 0.08), hint: "All-in cost per drink. Learning + process + scale drive it down." });
    // learning and process are MULTIPLIERS on c_base (1.00 = no saving yet), so adding them and
    // printing the sum as a negative was arithmetic nonsense — a firm with no experience and no
    // process investment read "−2.00". The honest figure is the $/drink the two take out of the
    // cost actually charged: unit_cost / (learning·process) is what the drink would have cost
    // without them, so the difference is the saving. (DW-056)
    if (r) {
      const cb = r.cost_buildup;
      const combined = cb.learning * cb.process;
      const saved = combined > 0 ? r.unit_cost / combined - r.unit_cost : 0;
      out.push({
        label: "Learning + process",
        value: saved > 0.005 ? `−${fmt.price(saved)}` : "—",
        tone: saved > 0.005 ? "good" : "neutral",
        hint: saved > 0.005
          ? `Experience and process investment take ${fmt.price(saved)} out of every drink (${fmt.pct(1 - combined)} off the recipe cost) — path-dependent, compounds.`
          : "Nothing yet. Experience accumulates with every drink brewed; process investment compounds on top of it.",
      });
    }
    out.push({ label: "Capacity", value: fmt.int(view.own.cap), field: `field ${fmt.int(fieldMed(view, (f) => f.cap))}`, tone: "neutral", hint: "Your ceiling on units this round. Builds take a round to come online." });
    if (view.inventoryEnabled && r?.inventory) out.push({ label: "Inventory turns", value: `${r.inventory.turnover.toFixed(1)}×`, tone: r.inventory.turnover < 1 ? "watch" : "good", hint: "Higher = less cash frozen in stock and less spoilage." });
  }

  if (desk === "commercial") {
    for (const s of view.segments.filter((x) => x.active)) {
      const mine = you?.shareBySeg?.[s.id] ?? 0;
      const lead = Math.max(0, ...rivals(view).map((f) => f.shareBySeg?.[s.id] ?? 0));
      out.push({ label: `${SEG_TAG[s.id] ?? s.id} share`, value: fmt.pct(mine), field: `leader ${fmt.pct(lead)}`, tone: mine >= lead ? "good" : mine >= lead * 0.6 ? "watch" : "risk", hint: "Your slice of this segment vs the strongest rival in it." });
    }
    out.push({ label: "Brand stock", value: view.own.B.toFixed(0), field: `field ${fieldMed(view, (f) => f.B).toFixed(0)}`, tone: cmpTone(view.own.B, fieldMed(view, (f) => f.B), true), hint: "A durable demand driver — decays without upkeep." });
    if (r?.distinctiveness) out.push({ label: "Nearest rival", value: r.distinctiveness.nearest_neighbor.toFixed(2), tone: "neutral", hint: "Strategy-map distance. The inverted-U: distinct enough to matter, not so far there's no market." });
  }

  if (desk === "people") {
    out.push({ label: "Employee relations", value: view.own.T_emp.toFixed(0), field: `field ${fieldMed(view, (f) => f.T_emp).toFixed(0)}`, tone: cmpTone(view.own.T_emp, fieldMed(view, (f) => f.T_emp), true, 0.15), hint: "Feeds productivity and resilience — morale shows up in the COO's unit cost." });
    const roster = you?.employees ?? [];
    if (roster.length) {
      const avgSat = roster.reduce((a, e) => a + e.satisfaction, 0) / roster.length;
      const avgSkill = roster.reduce((a, e) => a + e.skill, 0) / roster.length;
      out.push({ label: "Crew satisfaction", value: fmt.pct(avgSat), tone: avgSat < 0.45 ? "risk" : avgSat < 0.6 ? "watch" : "good", hint: "Below ~45% and rivals can poach them. Retention beats re-hiring." });
      out.push({ label: "Avg skill", value: avgSkill.toFixed(2), tone: "neutral", hint: "Skilled brewers convert to quality more efficiently than raw capital." });
    }
    out.push({ label: "Headcount", value: String(roster.length), field: `field ${Math.round(median(rivals(view).map((f) => f.employees.length)))}`, tone: "neutral", hint: "Named staff on the payroll — human capital vs the field." });
  }

  if (desk === "strategy") {
    out.push({ label: "Regulator trust", value: view.own.T_gov.toFixed(0), field: `field ${fieldMed(view, (f) => f.T_gov).toFixed(0)}`, tone: cmpTone(view.own.T_gov, fieldMed(view, (f) => f.T_gov), true, 0.15), hint: "Goodwill that lowers scrutiny and strengthens lobbying." });
    if (view.own.reputation) out.push({ label: "Reputation", value: view.own.reputation.toFixed(0), tone: "neutral", hint: "Built by honoring pacts; lowers your cost of capital." });
    out.push({ label: "Active pacts", value: String(view.agreements.length), tone: "neutral", hint: "Alliances in force — fast capability, defection risk." });
    out.push({ label: "Valuation", value: fmt.money(you?.valuation ?? 0), field: `field ${fmt.money(fieldMed(view, (f) => f.valuation))}`, tone: cmpTone(you?.valuation ?? 0, fieldMed(view, (f) => f.valuation), true), hint: "What an acquirer would reference — the M&A and control lens." });
  }

  if (desk === "all" && r) {
    const sc = r.scorecard_norm;
    out.push({ label: "Financial", value: sc.financial.toFixed(2), tone: sc.financial >= 0 ? "good" : "risk", hint: "CFO's leg — value creation vs cost of capital." });
    out.push({ label: "Market", value: sc.market.toFixed(2), tone: sc.market >= 0 ? "good" : "risk", hint: "CMO's leg — share and demand strength." });
    // Student-facing labels per the scoring-layer spec §8: say what the component
    // DOES, not what it is — engine keys stay generic.
    out.push({ label: "Preparedness", value: sc.intangible.toFixed(2), tone: sc.intangible >= 0 ? "good" : "risk", hint: "Preparedness for the future — quality, brand, process capital." });
    out.push({ label: "Standing", value: sc.stakeholder.toFixed(2), tone: sc.stakeholder >= 0 ? "good" : "risk", hint: "Stakeholder standing — employee, investor, regulator trust." });
    out.push({ label: "Valuation", value: fmt.money(you?.valuation ?? 0), field: `field ${fmt.money(fieldMed(view, (f) => f.valuation))}`, tone: cmpTone(you?.valuation ?? 0, fieldMed(view, (f) => f.valuation), true), hint: "The single integrative number — sustained advantage capitalized." });
  }

  return out;
}
