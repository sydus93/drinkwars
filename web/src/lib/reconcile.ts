/**
 * Reconcile (DW-050) — surface CEO ↔ specialist disagreements on a team firm BEFORE the
 * lock composes the plan. The merge rule (engine/seats.ts) is: the CEO's whole-firm
 * submission lays down first, each specialist overrides their own desk. So a CEO who set
 * the dividend to $40k while the CFO submitted $0 is silently overruled — correct, but a
 * surprise if nobody talked. This is pure computation over the view + the current form;
 * acknowledgements live in this browser for the round (they're a "we talked" note, not
 * game state). Only levers a seat actually set (≠ undefined) count, and a CEO value equal
 * to the firm's standing plan is treated as "not deliberately set" — the CEO's form
 * submits every lever, so without that guard every specialist edit would flag.
 */
import type { FirmDecision } from "drinkwars-engine";
import { composeTeamDecision, DESK_LEVERS, ROLE_DESK, sameLever, type Composition, type SeatPartial } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import type { TeamPlanSeat } from "../game/multiplayer.js";
import { fmt, humanizeId, marketName, SEG_LABEL } from "../labels.js";

export const SEAT_LABEL: Record<string, string> = { ceo: "CEO", cfo: "CFO", cmo: "CMO", coo: "COO", chro: "CHRO" };

export interface Conflict {
  field: keyof FirmDecision;
  label: string;
  /** the other party */
  who: string; // display name
  whoRole: string; // "ceo" | "cfo" …
  theirs: unknown;
  mine: unknown;
  /** who the merge favours */
  winner: "me" | "them";
  key: string; // stable ack key (round + field + both values)
  /** DW-051: they set a lever on a desk that isn't theirs. Empty desk (no ownerName) = a
   *  cover — among non-owners the latest deliberate change wins (DW-080: resubmitting without
   *  touching the lever leaves it in place; change it or Keep mine to overrule). Seated desk (ownerName) = a suggestion — the seated chair's own submission wins
   *  (DW-052); it only trades if that chair stays silent all round. */
  cover?: { desk: string; ownerName?: string | null; ownerSubmitted?: boolean; sticks?: boolean };
  /** DW-052: another SPECIALIST set this lever on MY desk — a suggestion to me. I win. */
  suggestion?: boolean;
  /** DW-073: the CEO changed a lever on MY desk that I left at last round's value — the CEO's
   *  change stands unless I set my own number. */
  untouched?: boolean;
}

/** The slice a SPECIALIST's submit sends — the ONE implementation, used by the real submit
 *  (MultiplayerClient) and by every preview (Reconcile card, commit dial), so a preview can never
 *  price a different slice than the one that lands. Own-desk levers always; off-desk levers only
 *  as deliberate covers (≠ the firm's plan right now); a cover sent earlier this round is re-sent
 *  while the plan still equals it — the server REPLACES the seat's slice on every submit (DW-052)
 *  — and forgotten once someone has overruled it. Returns the covers to remember. */
export function specialistSlice(form: FirmDecision, own: ReadonlySet<string>, plan: Record<string, unknown> | null, priorCovers: Record<string, unknown>, deliberate?: ReadonlySet<string>): { slice: Partial<FirmDecision>; covers: Record<string, unknown> } {
  const src = form as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const covers: Record<string, unknown> = {};
  for (const k of Object.keys(src)) {
    if (k === "firm_id") continue;
    if (own.has(k)) { out[k] = src[k]; continue; }
    if ((deliberate ? deliberate.has(k) : true) && (!plan || !(k in plan) || !same(src[k], plan[k]))) { out[k] = src[k]; covers[k] = src[k]; continue; }
    if (k in priorCovers && plan && same(plan[k], priorCovers[k])) { out[k] = priorCovers[k]; covers[k] = priorCovers[k]; }
  }
  return { slice: out as Partial<FirmDecision>, covers };
}

/** What this seat's submit would send right now: the CEO sends the whole form; a specialist
 *  sends specialistSlice (covers already on the server = the off-desk keys of its stored slice). */
export function wouldSubmit(view: GameView, seatRole: string, form: FirmDecision, standing: FirmDecision | null | undefined): Partial<FirmDecision> {
  const desk = ROLE_DESK[seatRole] ?? "all";
  if (desk === "all") return form;
  const own = new Set<string>(DESK_LEVERS[desk] as string[]);
  const plan = (view.teamPlan?.composed ?? standing ?? null) as unknown as Record<string, unknown> | null;
  const stored = (view.teamPlan?.seats.find((s) => s.me)?.partial ?? {}) as Record<string, unknown>;
  const prior: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stored)) if (!own.has(k) && k !== "firm_id" && v !== undefined) prior[k] = v;
  return specialistSlice(form, own, plan, prior).slice;
}

// ── DW-074: which levers this seat has changed ──────────────────────────────
// "Keep mine" on a lever the player left at last round's value: an explicit hold, so a chair can
// stand on the existing number against the CEO's change without retyping it. Per browser until
// submitted; the server then keeps it for the round (touched is sticky there).
const held = new Map<number, Set<string>>();
export const isHeld = (round: number, f: string) => held.get(round)?.has(f) ?? false;
export const resetHolds = () => held.clear(); // a new game session in the same tab starts clean
export const holdLever = (round: number, f: string) => { (held.get(round) ?? held.set(round, new Set()).get(round)!).add(f); };
/** The levers this slice CHANGED — differs from the firm's standing plan, or explicitly held.
 *  Sent with every submit; the merge trusts it over the values. Undefined without a standing
 *  plan to compare against (the server then infers it, exactly as for an older client). */
export function touchedLevers(slice: Partial<FirmDecision>, standing: FirmDecision | null | undefined, round: number): string[] | undefined {
  if (!standing) return undefined;
  const src = slice as unknown as Record<string, unknown>;
  const base = standing as unknown as Record<string, unknown>;
  const out = new Set<string>(held.get(round) ?? []);
  for (const k of Object.keys(src)) if (k !== "firm_id" && !same(src[k], base[k])) out.add(k);
  return [...out];
}

/** DW-073: the engine's own merge over the standing plan, with every teammate's submitted slice
 *  and this seat's CURRENT form. `when` places this seat in the submission order: "now" = as if
 *  submitted this instant (the commit dial: what the plan becomes if I brew now); "asSubmitted" =
 *  at this seat's last real submit, or before everyone if it hasn't (the Reconcile card: an
 *  empty-chair cover sent after my last submit IS winning, and the card must say so). */
export function teamOutcome(view: GameView, seatRole: string | null | undefined, form: FirmDecision | null, standing: FirmDecision | null | undefined, when: "now" | "asSubmitted" = "now"): (Composition & { seats: SeatPartial[]; meIdx: number; refs: (TeamPlanSeat | null)[] }) | null {
  const plan = view.teamPlan;
  if (!plan || !seatRole || !form || !standing) return null;
  const seats: SeatPartial[] = [];
  const refs: (TeamPlanSeat | null)[] = []; // DW-077: seats[i] ↔ the plan seat it came from (null = me)
  for (const s of plan.seats) {
    if (s.me || !s.partial) continue;
    seats.push({ desk: (s.desk ?? (s.role ? ROLE_DESK[s.role] ?? "all" : "all")) as SeatPartial["desk"], partial: s.partial, updated_at: s.updated_at, touched: s.touched });
    refs.push(s);
  }
  const meIdx = seats.length;
  const myAt = when === "now" ? Number.MAX_SAFE_INTEGER : (plan.seats.find((s) => s.me)?.updated_at ?? 0);
  const slice = wouldSubmit(view, seatRole, form, standing);
  // What the server will hold after my submit: what I've changed now, plus what it already kept.
  const touched = [...new Set([...(plan.seats.find((x) => x.me)?.touched ?? []), ...(touchedLevers(slice, standing, view.round) ?? [])])];
  seats.push({ desk: ROLE_DESK[seatRole] ?? "all", partial: slice, updated_at: myAt, touched });
  refs.push(null);
  return { ...composeTeamDecision({ ...standing, firm_id: form.firm_id }, seats), seats, meIdx, refs };
}

/** One-shot transaction levers: the standing plan deliberately zeroes them each round, and
 *  the server's zero-fill doesn't even carry their keys — so `plan[f] === undefined` means
 *  "none planned", NOT "not a lever in this game". A build/hire/poach set against an absent
 *  key IS a real edit (DW-052 — the CEO never saw a teammate's facility build because of
 *  this). Continuous/weight levers (price, presence, run_rate, market weights) keep the
 *  strict guard: their form defaults ride along and are not decisions.
 */
const ONE_SHOT = new Set(["build_facilities", "maintain_facilities", "mothball_facilities", "reactivate_facilities", "divest_facilities", "buy_vertical", "hire_roles", "fire_roles", "hire_employees", "hire_bids", "fire_employees", "raise_employees", "poach_employees", "invest_rnd", "invest_water_efficiency", "acquisition_bid", "agreement_actions", "lobby_spend", "lobby_initiative", "lobby_counter", "exit_action", "public_good_contributions", "market_supply", "draw_convertible", "draw_rbf", "pr_action", "buy_info"]);
/** Does the firm's plan meaningfully speak to this lever? (see ONE_SHOT) */
const planCarries = (plan: FirmDecision | null | undefined, f: keyof FirmDecision): boolean =>
  plan != null && (plan[f] !== undefined || ONE_SHOT.has(f as string));

const MONEY = new Set(["invest_cap", "invest_process", "invest_Q", "invest_B", "invest_T_emp", "invest_T_inv", "invest_T_gov", "invest_rnd", "invest_water_efficiency", "debt_draw", "debt_repay", "equity_raise", "dividend", "draw_convertible", "draw_rbf", "lobby_spend"]);

// DW-073: ONE equality and ONE precedence rule, both from the engine (seats.ts) — the card
// asks the same function the server merges with, so it can never promise a different winner.
export const same = sameLever;
/** DW-071: mirrors the server merge (engine seats.ts) — an EMPTY collection is "no request", so
 *  it never overrides a teammate's non-empty one. No conflict to show either way: the request
 *  goes through, and telling the CEO "theirs ([]) will be used" was false (and "Take theirs"
 *  would have dropped a real hire). */
const blankOverReal = (blank: unknown, real: unknown): boolean => {
  const coll = (v: unknown) => Array.isArray(v) ? v.length === 0 : v !== null && typeof v === "object" && Object.keys(v as object).length === 0;
  return coll(blank) && real != null && typeof real === "object" && !coll(real);
};
const empty = (v: unknown): boolean => sameLever(v, null);
/** DW-081: market research is a team purchase — any chair buys it for the firm and none can veto it
 *  (engine seats.ts rule 4), so it is never a disagreement to reconcile. */
const TEAM_BUY = "buy_info";
/** Who bought this round's research for the team (the first buyer), or null. */
export function researchBuyer(view: GameView): string | null {
  const s = (view.teamPlan?.seats ?? []).filter((x) => x.partial?.buy_info === true && (x.touched ? x.touched.includes(TEAM_BUY) : true)).sort((a, b) => (a.updated_at ?? 0) - (b.updated_at ?? 0))[0];
  return s ? (s.me ? "you" : `${SEAT_LABEL[s.role ?? ""] ?? ""} ${s.name}`.trim()) : null;
}

export function fmtLever(field: string, v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return MONEY.has(field) ? fmt.money(v) : field === "run_rate" ? `${Math.round(v * 100)}%` : String(Math.round(v * 100) / 100);
  if (typeof v === "string") return humanizeId(v);
  if (Array.isArray(v)) return v.length === 0 ? "none" : `${v.length}: ${v.slice(0, 3).map((x) => typeof x === "string" ? humanizeId(x) : humanizeId(String((x as { type?: string; id?: string; employee?: string })?.type ?? (x as { id?: string })?.id ?? (x as { employee?: string })?.employee ?? "item"))).join(", ")}${v.length > 3 ? "…" : ""}`;
  if (typeof v === "object") {
    const ents = Object.entries(v as Record<string, unknown>).filter(([, x]) => !empty(x));
    if (!ents.length) return "none";
    // Capacity allocation is relative weights (the engine normalises them): show the split, never raw weights.
    if (field === "presence") return shareText(ents, (k) => SEG_LABEL[k] ?? humanizeId(k));
    const num = (x: number) => field === "price" ? `$${x.toFixed(2)}` : MONEY.has(field) ? fmt.money(x) : String(Math.round(x * 100) / 100);
    return ents.slice(0, 4).map(([k, x]) => `${SEG_LABEL[k] ?? humanizeId(k)} ${typeof x === "number" ? num(x) : String(x)}`).join(" · ") + (ents.length > 4 ? " …" : "");
  }
  return String(v);
}

/** Relative weights → whole percents that sum to 100 (largest remainder): "Lagers & Light 28% · Craft Premium 72%". */
export function shareText(ents: [string, unknown][], name: (k: string) => string): string {
  const w = ents.map(([k, x]) => [k, Math.max(0, Number(x) || 0)] as const).filter(([, x]) => x > 0);
  const tot = w.reduce((s, [, x]) => s + x, 0);
  if (!tot) return "none";
  const raw = w.map(([, x]) => (x / tot) * 100);
  const pct = raw.map(Math.floor);
  let left = 100 - pct.reduce((s, x) => s + x, 0);
  for (const [, i] of raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])) if (left-- > 0) pct[i]++;
  return w.map(([k], i) => `${name(k)} ${pct[i]}%`).join(" · ");
}

const LABEL: Record<string, string> = {
  price: "Prices", presence: "Capacity allocation", pr_action: "PR action", market_presence: "Markets served", market_supply: "Market allocation", buy_info: "Market research", invest_B: "Brand spend",
  run_rate: "Run rate", invest_cap: "Capacity capex", invest_process: "Process", invest_Q: "Quality", invest_rnd: "R&D", build_facilities: "Build facilities", maintain_facilities: "Maintenance", mothball_facilities: "Mothball", reactivate_facilities: "Reactivate", divest_facilities: "Divest", buy_vertical: "Vertical assets", invest_water_efficiency: "Water efficiency",
  hire_roles: "Key hires", fire_roles: "Let go (roles)", hire_employees: "Hires", hire_bids: "Signing bonuses", fire_employees: "Let go", raise_employees: "Raises", poach_employees: "Poach offers", invest_T_emp: "Employee relations",
  debt_draw: "Draw debt", debt_repay: "Repay debt", equity_raise: "Raise equity", dividend: "Dividend", draw_convertible: "Convertible", draw_rbf: "Revenue-based financing", invest_T_inv: "Investor relations",
  public_good_contributions: "Public goods", acquisition_bid: "Acquisition bid", agreement_actions: "Agreements", lobby_spend: "Lobbying", lobby_initiative: "Lobby initiative", lobby_counter: "Counter-lobby", exit_action: "Exit action", invest_T_gov: "Government relations",
};
export const leverLabel = (f: string) => LABEL[f] ?? humanizeId(f);
export const DESK_OWNER: Record<string, string> = { commercial: "CMO", operations: "COO", people: "CHRO", finance: "CFO", strategy: "CEO" };
/** Which desk (and so which chair) owns a lever. */
export const leverDesk = (f: string): string => (Object.entries(DESK_LEVERS).find(([, fs]) => (fs as string[]).includes(f))?.[0]) ?? "strategy";

/** DW-051: a lever value in words a student recognises — candidate/employee NAMES, facility
 *  type labels, market names — instead of ids like "cand_2_3". Falls back to fmtLever. */
export function leverText(field: string, v: unknown, view: GameView): string {
  const cand = (id: string) => view.hiringMarket?.find((c) => c.id === id)?.name ?? humanizeId(id);
  const emp = (id: string) => view.own.employees?.find((e) => e.id === id)?.name ?? humanizeId(id);
  const facType = (t: string) => view.modules?.facilities?.types.find((x) => x.id === t)?.label ?? humanizeId(t);
  const list = (xs: string[], noun: string) => xs.length === 0 ? "none" : `${xs.length} ${noun}${xs.length === 1 ? "" : "s"} (${xs.slice(0, 3).join(", ")}${xs.length > 3 ? ", …" : ""})`;
  if (Array.isArray(v)) {
    if (field === "hire_employees") return list(v.map((x) => cand(String(x))), "hire");
    if (field === "fire_employees") return list(v.map((x) => emp(String(x))), "dismissal");
    if (field === "hire_roles") return list(v.map((x) => humanizeId(String(x))), "key hire");
    if (field === "fire_roles") return list(v.map((x) => humanizeId(String(x))), "role cut");
    if (field === "build_facilities") return list(v.map((b) => facType(String((b as { type?: string })?.type ?? ""))), "build");
    if (field === "poach_employees") return list(v.map((x) => { const p = x as { firm?: string; employee?: string; offer?: number }; const name = view.firms.find((f) => f.firm_id === p.firm)?.employees.find((e) => e.id === p.employee)?.name ?? humanizeId(String(p.employee)); return `${name} @ ${fmt.money(p.offer ?? 0)}`; }), "poach offer");
    if (/facilities$/.test(field)) return list(v.map((x) => { const f = view.own.facilities?.find((y) => y.id === x); return f ? facType(f.type) : humanizeId(String(x)); }), "site");
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const ents = Object.entries(v as Record<string, unknown>).filter(([, x]) => !empty(x));
    if (field === "raise_employees") return ents.length ? `${ents.length} raise${ents.length === 1 ? "" : "s"} (${ents.slice(0, 3).map(([k, x]) => `${emp(k)} +${fmt.money(Number(x))}`).join(", ")})` : "none";
    if (field === "hire_bids") return ents.length ? ents.slice(0, 3).map(([k, x]) => `${cand(k)} ${fmt.money(Number(x))}`).join(", ") : "none";
    if (field === "maintain_facilities") return ents.length ? `${fmt.money(ents.reduce((s, [, x]) => s + Number(x), 0))} across ${ents.length} site${ents.length === 1 ? "" : "s"}` : "none";
    if (field === "market_presence" || field === "market_supply") {
      const mk = (id: string) => { const m = view.markets?.find((x) => x.id === id) as { label?: string; name?: string } | undefined; return marketName(id, m?.label ?? m?.name); };
      if (!ents.length) return "home only";
      // presence = relative weights (the split across markets); supply = explicit units per market
      return field === "market_presence" ? shareText(ents, mk) : ents.map(([k, x]) => `${mk(k)} ${fmt.int(Number(x))}`).join(" · ");
    }
  }
  return fmtLever(field, v);
}

/** Conflicts between this seat and the rest of the firm, given the CURRENT form values. */
export function computeConflicts(view: GameView, seatRole: string | null | undefined, mine: FirmDecision | null, standing: FirmDecision | null | undefined): Conflict[] {
  const plan = view.teamPlan;
  if (!plan || !seatRole || !mine) return [];
  const myDesk = ROLE_DESK[seatRole] ?? "all";
  const out: Conflict[] = [];
  const round = view.round;
  // DW-073: who wins is never re-derived here — it is read off the engine's merge of the team's
  // slices with this form submitted now. The rules below only decide WHICH rows are worth showing.
  const outcome = teamOutcome(view, seatRole, mine, standing, "asSubmitted");
  // Provenance, not value: when my form already mirrors a teammate's cover, the values match but
  // the plan still holds THEIR submission until I submit after them.
  const winnerOf = (f: keyof FirmDecision): "me" | "them" => {
    if (!outcome) return "me";
    const i = outcome.from[f];
    return i === undefined ? (same(outcome.decision[f], mine[f]) ? "me" : "them") : i === outcome.meIdx ? "me" : "them";
  };
  const push = (field: keyof FirmDecision, who: string, whoRole: string, theirs: unknown, winner: "me" | "them", extra: Partial<Conflict> = {}) =>
    out.push({ field, label: leverLabel(field), who, whoRole, theirs, mine: mine[field], winner, key: `${round}:${field}:${JSON.stringify(theirs ?? null)}:${JSON.stringify(mine[field] ?? null)}`, ...extra });
  if (myDesk === "all") {
    // CEO: a specialist's value on their own desk that differs from my form. If they CHANGED it,
    // theirs wins; if they left it at last round's value, mine wins and there's nothing to raise.
    for (const s of plan.seats) {
      if (s.me || !s.partial || !s.role) continue;
      const desk = ROLE_DESK[s.role];
      if (!desk || desk === "all") continue;
      for (const f of DESK_LEVERS[desk]) {
        const theirs = s.partial[f];
        if (theirs === undefined || f === TEAM_BUY) continue;
        if (blankOverReal(theirs, mine[f])) continue; // DW-071: my request stands
        if (same(theirs, mine[f])) continue;
        const w = winnerOf(f);
        if (w === "me" && same(theirs, standing?.[f])) continue; // they left it alone — my change stands
        push(f, s.name, s.role, theirs, w);
      }
      // DW-051 covers + DW-052 suggestions: a value they set on a desk that isn't theirs
      // (deliberately — ≠ the standing plan). Empty desk: later non-owner word wins, so it
      // goes through unless I submit after them. Seated desk: that chair's officer wins —
      // it's a suggestion, and it only trades if the officer stays silent.
      for (const [d, fields] of Object.entries(DESK_LEVERS) as [string, (keyof FirmDecision)[]][]) {
        if (d === desk) continue;
        const owner = plan.seats.find((o) => !o.me && o !== s && o.role && ROLE_DESK[o.role] === d);
        for (const f of fields) {
          const theirs = s.partial[f];
          // shown even when my form already mirrors it — the point is that the CEO NOTICES
          // (levers the standing plan doesn't carry AND aren't one-shots — e.g. market weights
          // with geography off — are form defaults riding along in their slice, not a decision)
          if (theirs === undefined || f === TEAM_BUY || !planCarries(standing, f) || same(theirs, standing?.[f])) continue;
          if (owner && same(theirs, owner.partial?.[f])) continue; // matches the owner's own word — nothing to flag
          const winner = winnerOf(f);
          // sticks: a build / hire / offer survives the seated chair's silent submit — its untouched "none"
          // never clears a real request (DW-071); a price or a number is replaced by it (seats.ts)
          out.push({ field: f, label: leverLabel(f), who: s.name, whoRole: s.role, theirs, mine: mine[f], winner, key: `${round}:${f}:cover:${JSON.stringify(theirs ?? null)}:${JSON.stringify(mine[f] ?? null)}`, cover: { desk: d, ownerName: owner?.name ?? null, ownerSubmitted: !!owner?.partial, sticks: ONE_SHOT.has(f as string) && theirs !== null && typeof theirs === "object" } });
        }
      }
    }
  } else {
    // Specialist: the CEO's deliberately-set value on MY desk that differs from my form → I win.
    const ceo = plan.seats.find((s) => !s.me && s.role && (ROLE_DESK[s.role] ?? "all") === "all" && s.partial);
    if (ceo?.partial) {
      for (const f of DESK_LEVERS[myDesk]) {
        const theirs = ceo.partial[f];
        if (theirs === undefined || f === TEAM_BUY) continue;
        if (same(theirs, standing?.[f])) continue; // CEO left it at the standing plan
        if (blankOverReal(mine[f], theirs)) continue; // DW-071: my blank doesn't cancel the CEO's request — no false "yours wins"
        if (same(theirs, mine[f])) continue;
        // DW-073: left at last round's value → the CEO's change stands; changed → mine does.
        const w = winnerOf(f);
        push(f, ceo.name, ceo.role ?? "ceo", theirs, w, w === "them" ? { untouched: true } : {});
      }
    }
    // DW-052: another SPECIALIST's value on MY desk — a routed suggestion ("raise equity?").
    // Their slice only carries off-desk levers they deliberately set, so presence = intent.
    // I win at lock; the row exists so the suggestion is never silently ignored.
    for (const s of plan.seats) {
      if (s.me || !s.partial || !s.role) continue;
      const d = ROLE_DESK[s.role] ?? "all";
      if (d === "all" || d === myDesk) continue;
      for (const f of DESK_LEVERS[myDesk]) {
        const theirs = s.partial[f];
        if (theirs === undefined || f === TEAM_BUY || same(theirs, standing?.[f])) continue;
        if (!same(theirs, mine[f])) out.push({ field: f, label: leverLabel(f), who: s.name, whoRole: s.role, theirs, mine: mine[f], winner: winnerOf(f), key: `${round}:${f}:sugg:${JSON.stringify(theirs ?? null)}:${JSON.stringify(mine[f] ?? null)}`, suggestion: true });
      }
    }
  }
  return out;
}

/** DW-050: levers a SPECIALIST edited outside their own desk — they don't apply at lock (the
 *  CEO / that desk's officer owns them). Compared against the firm's current plan (composed,
 *  else standing) so the card can say what IS being charged / spent. */
/** A specialist's value on a desk that isn't theirs. `ownerName` = the seated chair that owns
 *  it (null = empty chair); `applies`: the chair is empty, so — among non-owners the later
 *  submission wins — this seat's value goes through at lock unless the CEO submits after. */
export interface OffDeskEdit { field: keyof FirmDecision; label: string; mine: unknown; firm: unknown; deskOwner: string; ownerName: string | null; ceoSeated: boolean; applies: boolean }
export function offDeskEdits(view: GameView, seatRole: string | null | undefined, mine: FirmDecision | null, standing: FirmDecision | null | undefined): OffDeskEdit[] {
  if (!view.teamPlan || !seatRole || !mine) return [];
  const myDesk = ROLE_DESK[seatRole] ?? "all";
  if (myDesk === "all") return [];
  const firm = (view.teamPlan.composed ?? standing) as FirmDecision | null | undefined;
  if (!firm) return [];
  const own = new Set<string>(DESK_LEVERS[myDesk] as string[]);
  const out: OffDeskEdit[] = [];
  const ceoSeated = view.teamPlan.seats.some((s) => s.role && (ROLE_DESK[s.role] ?? "all") === "all");
  for (const [desk, fields] of Object.entries(DESK_LEVERS) as [string, (keyof FirmDecision)[]][]) {
    if (desk === myDesk) continue;
    const seated = view.teamPlan.seats.find((s) => !s.me && s.role && ROLE_DESK[s.role] === desk);
    for (const f of fields) {
      // continuous/weight levers the firm's plan doesn't carry (e.g. market weights with
      // geography off) have nothing to disagree with — the form's default is not an edit.
      // One-shot levers (builds, hires, poaches — see ONE_SHOT) ARE edits even against an
      // absent key: absent just means "none planned" (DW-052).
      if (own.has(f as string) || f === TEAM_BUY || mine[f] === undefined || !planCarries(firm, f)) continue;
      if (!same(mine[f], firm[f])) out.push({ field: f, label: leverLabel(f), mine: mine[f], firm: firm[f], deskOwner: DESK_OWNER[desk], ownerName: seated?.name ?? null, ceoSeated, applies: !seated });
    }
  }
  return out;
}

// ── acknowledgements ("we talked it out") — per browser, per round ──────────
const acked = new Set<string>();
export const ackConflict = (c: Conflict) => acked.add(c.key);
export const isAcked = (c: Conflict) => acked.has(c.key);
export const openConflicts = (cs: Conflict[]) => cs.filter((c) => !isAcked(c));

// ── DW-077: the commit panel's "what locks" rows ─────────────────────────────
/** One lever where this seat's form and the plan that will lock disagree (or where a teammate's
 *  entry is the one the plan credits). `locks` is the engine's composed value with this form as
 *  last submitted; `who` is the reason in words; `winner` is provenance, never re-derived. */
export interface PlanDiff {
  field: keyof FirmDecision;
  label: string;
  /** what the engine locks for this lever right now (my form at my last submit's place in line) */
  locks: unknown;
  /** what this form has */
  mine: unknown;
  winner: "me" | "them";
  /** WHO DECIDES — the whole reason */
  who: string;
  /** the same, short enough for an input caption or the phone sheet */
  whoShort: string;
  /** the CEO's entry for this lever on MY desk ("Take the CEO's numbers" adopts it) */
  ceoValue?: unknown;
  /** on my own desk — "Keep mine" can hold it */
  ownDesk: boolean;
  /** a teammate's word on a desk whose chair is empty or hasn't submitted — the CEO's "Keep mine" can hold their own number against it (DW-080) */
  cover?: boolean;
  /** yours wins, but only once you submit (a hold or an edit the server hasn't seen) */
  pending: boolean;
  /** this seat changed (or held) the lever this round — else its form just carries last round's value */
  changed: boolean;
  /** still follows a teammate AFTER this seat submits now (the submit label's count) */
  follows: boolean;
}
export interface PlanDiffs { rows: PlanDiff[]; follow: number }
const NO_DIFFS: PlanDiffs = { rows: [], follow: 0 };
const SKIP_DIFF = new Set<string>(["firm_id", "reflection", "beliefs", TEAM_BUY]);

/** The rows of the commit panel's differs block. Reuses computeConflicts (CEO ↔ my desk, peer
 *  suggestions, empty-chair covers) and offDeskEdits (my own off-desk entries) for their per-row
 *  semantics, then adds any lever where the engine's merge still differs from this form (a seated
 *  teammate's changed lever seen from a specialist's chair, a blank that cannot clear a request,
 *  a value carried from last round). Winner and LOCKS come from `composeTeamDecision` only. */
export function planDiffs(view: GameView, seatRole: string | null | undefined, form: FirmDecision | null, standing: FirmDecision | null | undefined): PlanDiffs {
  const plan = view.teamPlan;
  if (!plan || !seatRole || !form || !standing) return NO_DIFFS;
  const me = plan.seats.find((s) => s.me);
  // A seat that has submitted sees the plan as the server holds it (a teammate's later cover IS
  // winning — "theirs, unless you submit again"); a seat that hasn't yet sees what its first
  // submit produces (its own cover for an empty chair lands — "yours, and the CEO will see it").
  const outcome = teamOutcome(view, seatRole, form, standing, me?.submitted ? "asSubmitted" : "now");
  const after = teamOutcome(view, seatRole, form, standing, "now");
  if (!outcome || !after) return NO_DIFFS;
  const myDesk = ROLE_DESK[seatRole] ?? "all";
  const isCeo = myDesk === "all";
  const stored = (me?.partial ?? null) as Record<string, unknown> | null;
  const storedTouched = me?.touched ?? [];
  const F = form as unknown as Record<string, unknown>;
  const T = (f: string, v: unknown) => leverText(f, v, view);
  const seatName = (s: { role?: string | null; name: string }) => `${SEAT_LABEL[s.role ?? ""] ?? (s.role ?? "").toUpperCase()} ${s.name}`.trim();
  const chairOf = (desk: string) => plan.seats.find((s) => !s.me && s.role && ROLE_DESK[s.role] === desk);
  const winnerOf = (f: keyof FirmDecision): "me" | "them" => {
    const i = outcome.from[f];
    return i === undefined ? (same(outcome.decision[f], F[f as string]) ? "me" : "them") : i === outcome.meIdx ? "me" : "them";
  };
  const follows = (f: keyof FirmDecision) => !same(after.decision[f], F[f as string]);
  // pending: the server hasn't seen it yet — a hold, an edit since the last submit, or no submit at all
  const pendingOf = (f: string, winner: "me" | "them") =>
    winner === "me" && (!me?.submitted || (isHeld(view.round, f) && !storedTouched.includes(f)) || (stored != null && f in stored && !same(stored[f], F[f])));
  // what this seat has changed this round, exactly as its submit will report it (teamOutcome's touched)
  const changed = new Set([...storedTouched, ...(touchedLevers(wouldSubmit(view, seatRole, form, standing), standing, view.round) ?? [])]);
  const rows = new Map<string, PlanDiff>();
  const add = (field: keyof FirmDecision, winner: "me" | "them", who: string, whoShort: string, extra: Partial<PlanDiff> = {}) => {
    const f = String(field);
    rows.set(f, { field, label: leverLabel(f), locks: outcome.decision[field], mine: F[f], winner, who, whoShort, ownDesk: !isCeo && leverDesk(f) === myDesk, pending: pendingOf(f, winner), changed: changed.has(f), follows: follows(field), ...extra });
  };

  // 1. The conflicts the Reconcile card used to list — same rows, same winners.
  for (const c of computeConflicts(view, seatRole, form, standing)) {
    const f = c.field;
    const theirs = T(String(f), c.theirs);
    const w = winnerOf(f); // provenance from THIS outcome (computeConflicts judged "as submitted")
    const they = seatName({ role: c.whoRole, name: c.who });
    const mirrored = same(outcome.decision[f], F[String(f)]); // my form already carries the plan's value
    if (c.suggestion) {
      add(f, w, w === "me" ? `${they} suggested ${theirs} for your desk; yours is used` : `${they} suggested ${theirs} for your desk; leave it alone and it trades, or Keep mine to decline`, w === "me" ? `instead of ${they}'s suggestion` : `${they}'s suggestion`);
    } else if (c.cover) {
      // A teammate's entry on a desk that isn't theirs: shown even when my form mirrors it — the
      // point is that the CEO NOTICES who set what for an empty chair (DW-051/052).
      const deskLbl = DESK_OWNER[c.cover.desk] ?? c.cover.desk;
      if (c.cover.ownerName) {
        // a seated chair that hasn't submitted: a peer's suggestion trades until that chair submits; the
        // CEO's own change (or Keep mine) stands unless the chair changes the lever itself (seats.ts)
        const open = !c.cover.ownerSubmitted;
        const tail = !open ? `the ${deskLbl} decides` : w === "me" ? `yours, unless the ${deskLbl} changes it` : c.cover.sticks ? `theirs unless the ${deskLbl} cancels it` : `theirs until the ${deskLbl} submits`;
        add(f, w, `${they} suggested ${theirs} for the ${deskLbl}'s desk (${c.cover.ownerName}) · ${tail}${open && w === "them" ? " — change it, or Keep mine, to use yours" : ""}`, `${they} suggests · ${tail}`, { cover: open });
      } else {
        // A cover my form already mirrors locks at my number either way — a notice, not a warning
        // (DW-080: it stays the teammate's word until I change or hold the lever, which only
        // matters if they change it again — then the row comes back as theirs).
        const shown = mirrored ? "me" : w;
        const tail = shown === "them" ? "theirs — change it, or Keep mine, to use yours" : mirrored ? "it's in your form, so yours carries it" : "yours — you changed it";
        add(f, shown, `${they} set this for the empty ${deskLbl} desk · ${tail}`, `${they} covers the empty ${deskLbl} chair`, { cover: true });
      }
    } else if (isCeo) {
      // a seated teammate's OWN lever: a notification to the CEO (DW-060), never approve/deny
      add(f, w, w === "them" ? `${they}'s desk — they changed it` : `${they}'s desk — yours is used`, `${they}'s desk`);
    } else {
      // the CEO's entry on MY desk (DW-073): untouched → the CEO's change stands; changed → mine
      add(f, w, w === "them" ? "CEO changed this; you left it at last round's value" : `CEO set ${theirs}. You changed it, so yours is used${pendingOf(String(f), w) ? " once you submit" : ""}`, w === "them" ? "CEO changed it; you left it" : `CEO set ${theirs}`, { ceoValue: c.theirs });
    }
  }
  // 2. My own entries on desks that aren't mine (DW-050): a cover for an empty chair, or a suggestion.
  for (const e of offDeskEdits(view, seatRole, form, standing)) {
    if (rows.has(String(e.field))) continue;
    const w = winnerOf(e.field);
    const who = e.applies
      ? (w === "me" ? `Not your desk — the ${e.deskOwner} chair is empty, so yours is used${e.ceoSeated ? " and the CEO will see it" : ""}` : `Not your desk — the ${e.deskOwner} chair is empty; the plan holds a later entry · theirs, unless you submit again`)
      : `Not your desk — ${e.ownerName} (${e.deskOwner}) decides; yours is only a suggestion`;
    add(e.field, w, who, "not your desk");
  }
  // 3. Anything else the merge still prices differently from this form.
  const keys = isCeo ? (Object.keys(F) as (keyof FirmDecision)[]) : (Object.keys(wouldSubmit(view, seatRole, form, standing)) as (keyof FirmDecision)[]);
  for (const f of keys) {
    const k = String(f);
    if (SKIP_DIFF.has(k) || rows.has(k) || !planCarries(standing, f) || same(outcome.decision[f], F[k])) continue;
    const i = outcome.from[f];
    const author = i === undefined ? undefined : outcome.refs[i];
    if (i === outcome.meIdx) continue; // mine — then it cannot differ
    if (!author) { add(f, "them", "Carried from last round — a blank entry does not clear it", "carried from last round"); continue; }
    const they = seatName(author);
    const aDesk = author.desk ?? (author.role ? ROLE_DESK[author.role] ?? "all" : "all");
    const desk = leverDesk(k);
    const touched = author.touched ? author.touched.includes(k) : !same((author.partial as Record<string, unknown>)[k], (standing as unknown as Record<string, unknown>)[k]);
    if (aDesk === desk) add(f, "them", `${they}'s desk — ${touched ? "they changed it" : "their entry stands"}`, `${they}'s desk`);
    else if (!isCeo && desk === myDesk) add(f, "them", aDesk === "all" ? "CEO changed this; you left it at last round's value" : `${they} suggested this for your desk; leave it alone and it trades, or Keep mine to decline`, aDesk === "all" ? "CEO changed it; you left it" : `${they}'s suggestion`, aDesk === "all" ? { ceoValue: (author.partial as Record<string, unknown>)[k] } : {});
    else {
      const chair = chairOf(desk);
      const deskLbl = DESK_OWNER[desk] ?? desk;
      if (chair?.submitted && aDesk === "all") add(f, "them", `CEO changed this; ${chair.name} left it at last round's value`, "CEO changed it");
      else add(f, "them", `${they} covers the ${chair ? "" : "empty "}${deskLbl} chair${chair ? ` until ${chair.name} submits` : ""} · theirs — change it, or Keep mine, to use yours`, `${they} covers the ${deskLbl} chair`, { cover: true }); // DW-080: a chair that hasn't spoken yet — the CEO's Keep mine holds against it too
    }
  }
  const out = [...rows.values()];
  return { rows: out, follow: out.filter((r) => r.follows).length };
}
