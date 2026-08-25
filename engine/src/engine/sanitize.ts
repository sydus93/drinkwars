/**
 * Decision sanitizer — the engine's input boundary (DW-046).
 *
 * The UI bounds every control and the server trusts the client, so anything that
 * reaches resolveRound is *supposed* to be well-formed. But one NaN in one firm's
 * price is enough to NaN the logit denominator for every firm in the segment, and a
 * live class cannot afford a round that resolves into `$NaN` for the whole market
 * (fuzz harness `npm run fuzz`, adversarial mode, reproduced exactly that before this
 * file existed). So the engine coerces every field it will read into its legal domain
 * *before* any module sees it: numbers finite and non-negative (capped at a large
 * finite ceiling), records keyed by string with finite values, arrays of the right
 * element shape, enums restricted to their vocabularies. Unknown ids are left in —
 * every consumer already ignores an id it cannot resolve — but nothing non-finite,
 * negative, or mistyped survives.
 */
import type { AgreementAction, ExitAction, FirmDecision, FirmId, PrPlayType, SegmentId } from "../types.js";

const MAX = 1e9; // finite ceiling for any single dollar/unit figure — a billion per lever per quarter is "unreal" either way; the cap only keeps the arithmetic finite

/** Finite, non-negative, ≤ hi. Numeric strings coerce ("12" → 12); anything else → 0. */
export function num(x: unknown, hi = MAX): number {
  const v = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v > hi ? hi : v;
}
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 200) : []);
const numRec = (x: unknown, hi = MAX): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isObj(x)) for (const [k, v] of Object.entries(x)) if (k.length <= 200) out[k] = num(v, hi);
  return out;
};
const optNumRec = (x: unknown, hi = MAX): Record<string, number> | undefined => (isObj(x) ? numRec(x, hi) : undefined);
const optStrs = (x: unknown): string[] | undefined => (Array.isArray(x) ? strs(x) : undefined);
const optStr = (x: unknown): string | null => (typeof x === "string" && x.length > 0 && x.length <= 200 ? x : null);
const oneOf = <T extends string>(x: unknown, vocab: readonly T[]): T | null => (typeof x === "string" && (vocab as readonly string[]).includes(x) ? (x as T) : null);

const PR_PLAYS: readonly PrPlayType[] = ["festival", "collab", "viral"];
const AGREEMENT_TYPES = ["form", "defect", "renegotiate", "renegotiate_response", "accept_proposal", "decline_proposal", "counter_proposal"] as const;
const FORMS = ["relational", "formal", "collective"] as const;
const TEMPLATES = ["joint_marketing", "capacity_coordination", "supply_share"] as const;
const EXIT_PATHS = ["bank", "invest", "rebuild"] as const;

/** Coerce a raw decision (anything a client could POST) into a well-formed FirmDecision
 *  for `firmId`. Prices/presence are keyed to `allSegmentIds` only (unknown segments
 *  dropped, missing ones zero-filled — a locked control is 0). */
export function sanitizeDecision(rawIn: unknown, firmId: FirmId, allSegmentIds: SegmentId[]): FirmDecision {
  const raw: Record<string, unknown> = isObj(rawIn) ? rawIn : {};
  const price: Record<SegmentId, number> = {};
  const presence: Record<SegmentId, number> = {};
  const rp = isObj(raw.price) ? raw.price : {};
  const rq = isObj(raw.presence) ? raw.presence : {};
  for (const s of allSegmentIds) {
    price[s] = num(rp[s], 1e6);
    presence[s] = num(rq[s], 1e6);
  }
  const rr = typeof raw.run_rate === "number" || typeof raw.run_rate === "string" ? Number(raw.run_rate) : NaN;

  const d: FirmDecision = {
    firm_id: firmId,
    price, presence,
    run_rate: Number.isFinite(rr) ? Math.min(Math.max(0, rr), 10) : undefined,
    invest_cap: num(raw.invest_cap), invest_process: num(raw.invest_process), invest_Q: num(raw.invest_Q), invest_B: num(raw.invest_B),
    invest_T_emp: num(raw.invest_T_emp), invest_T_inv: num(raw.invest_T_inv), invest_T_gov: num(raw.invest_T_gov),
    debt_draw: num(raw.debt_draw), debt_repay: num(raw.debt_repay), equity_raise: num(raw.equity_raise), dividend: num(raw.dividend),
    buy_info: !!raw.buy_info,
    agreement_actions: sanitizeAgreementActions(raw.agreement_actions),
    exit_action: sanitizeExit(raw.exit_action),
  };
  // Module levers — only materialize the ones the client actually sent (absent ⇒ module default).
  if (raw.pr_action !== undefined) d.pr_action = oneOf(raw.pr_action, PR_PLAYS);
  if (raw.invest_water_efficiency !== undefined) d.invest_water_efficiency = num(raw.invest_water_efficiency);
  if (raw.public_good_contributions !== undefined) d.public_good_contributions = optNumRec(raw.public_good_contributions);
  if (raw.market_presence !== undefined) d.market_presence = optNumRec(raw.market_presence, 1e6);
  if (raw.market_supply !== undefined) d.market_supply = optNumRec(raw.market_supply);
  if (raw.invest_rnd !== undefined) d.invest_rnd = num(raw.invest_rnd);
  if (raw.buy_vertical !== undefined) d.buy_vertical = optStrs(raw.buy_vertical);
  if (raw.hire_roles !== undefined) d.hire_roles = optStrs(raw.hire_roles);
  if (raw.fire_roles !== undefined) d.fire_roles = optStrs(raw.fire_roles);
  if (raw.build_facilities !== undefined) {
    d.build_facilities = Array.isArray(raw.build_facilities)
      ? raw.build_facilities.filter(isObj).filter((b) => typeof b.type === "string").map((b) => ({
          type: b.type as string,
          ...(typeof b.name === "string" ? { name: b.name.slice(0, 80) } : {}),
          ...(typeof b.location === "string" ? { location: b.location } : {}),
          ...(typeof b.market === "string" ? { market: b.market } : {}),
          ...(typeof b.lot === "string" ? { lot: b.lot } : {}),
          ...(b.bid !== undefined ? { bid: num(b.bid) } : {}),
        }))
      : undefined;
  }
  if (raw.maintain_facilities !== undefined) d.maintain_facilities = optNumRec(raw.maintain_facilities);
  if (raw.mothball_facilities !== undefined) d.mothball_facilities = optStrs(raw.mothball_facilities);
  if (raw.reactivate_facilities !== undefined) d.reactivate_facilities = optStrs(raw.reactivate_facilities);
  if (raw.divest_facilities !== undefined) d.divest_facilities = optStrs(raw.divest_facilities);
  if (raw.hire_employees !== undefined) d.hire_employees = optStrs(raw.hire_employees);
  if (raw.hire_bids !== undefined) d.hire_bids = optNumRec(raw.hire_bids);
  if (raw.fire_employees !== undefined) d.fire_employees = optStrs(raw.fire_employees);
  if (raw.raise_employees !== undefined) d.raise_employees = optNumRec(raw.raise_employees);
  if (raw.poach_employees !== undefined) {
    d.poach_employees = Array.isArray(raw.poach_employees)
      ? raw.poach_employees.filter(isObj).filter((p) => typeof p.firm === "string" && typeof p.employee === "string").map((p) => ({ firm: p.firm as string, employee: p.employee as string, offer: num(p.offer) }))
      : undefined;
  }
  if (raw.draw_convertible !== undefined) d.draw_convertible = num(raw.draw_convertible);
  if (raw.draw_rbf !== undefined) d.draw_rbf = num(raw.draw_rbf);
  if (raw.acquisition_bid !== undefined) {
    const b = raw.acquisition_bid;
    d.acquisition_bid = isObj(b) && typeof b.target === "string" && b.target !== firmId && num(b.price) > 0 ? { target: b.target, price: num(b.price) } : null;
  }
  if (raw.lobby_spend !== undefined) d.lobby_spend = num(raw.lobby_spend);
  if (raw.lobby_initiative !== undefined) d.lobby_initiative = optStr(raw.lobby_initiative);
  if (raw.lobby_counter !== undefined) d.lobby_counter = optStr(raw.lobby_counter);
  // App-layer passthrough instruments (§15.2/§15.5): typed but never used in resolution.
  if (isObj(raw.beliefs)) {
    const b = raw.beliefs;
    d.beliefs = {
      ...(Number.isFinite(Number(b.own_rank)) && b.own_rank !== null && b.own_rank !== "" ? { own_rank: Number(b.own_rank) } : {}),
      ...(Number.isFinite(Number(b.market_size)) && b.market_size !== null && b.market_size !== "" ? { market_size: Number(b.market_size) } : {}),
      ...(typeof b.rival_move === "string" ? { rival_move: b.rival_move.slice(0, 500) } : {}),
    };
  }
  if (typeof raw.reflection === "string") d.reflection = raw.reflection.slice(0, 4000);
  return d;
}

function sanitizeAgreementActions(x: unknown): AgreementAction[] {
  if (!Array.isArray(x)) return [];
  const out: AgreementAction[] = [];
  for (const a of x) {
    if (!isObj(a)) continue;
    const type = oneOf(a.type, AGREEMENT_TYPES);
    if (!type) continue;
    const act: AgreementAction = { type };
    if (type === "form") {
      const form = oneOf(a.form, FORMS);
      const template = oneOf(a.template, TEMPLATES);
      if (!form || !template) continue;
      act.form = form; act.template = template;
      act.counterparties = strs(a.counterparties);
      if (typeof a.segment === "string") act.segment = a.segment;
    }
    // Pass the remaining typed fields through untouched only when they are the right shape;
    // clampTerms in coopetition.ts bounds the economics of `terms`.
    if (typeof a.proposal_id === "string") act.proposal_id = a.proposal_id;
    if (typeof a.agreement_id === "string") act.agreement_id = a.agreement_id;
    if (Array.isArray(a.clauses)) act.clauses = a.clauses.filter(isObj) as unknown as AgreementAction["clauses"];
    if (isObj(a.terms)) act.terms = a.terms as AgreementAction["terms"];
    if (isObj(a.proposed_terms)) act.proposed_terms = a.proposed_terms as AgreementAction["proposed_terms"];
    const pt = oneOf(a.proposed_template, TEMPLATES); if (pt) act.proposed_template = pt;
    if (typeof a.proposed_segment === "string" || a.proposed_segment === null) act.proposed_segment = a.proposed_segment as SegmentId | null;
    const resp = oneOf(a.response, ["accept", "reject", "exit"] as const); if (resp) act.response = resp;
    out.push(act);
  }
  return out;
}

function sanitizeExit(x: unknown): ExitAction {
  if (!isObj(x) || x.type !== "voluntary") return null;
  const path = oneOf(x.path, EXIT_PATHS);
  if (!path) return null;
  return {
    type: "voluntary", path,
    ...(typeof x.target_firm === "string" ? { target_firm: x.target_firm } : {}),
    ...(typeof x.reposition_segment === "string" ? { reposition_segment: x.reposition_segment } : {}),
  };
}
