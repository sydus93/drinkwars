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
import { DESK_LEVERS, ROLE_DESK } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { fmt, humanizeId, SEG_LABEL } from "../labels.js";

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
   *  cover — among non-owners the later submission wins, so it goes through unless I submit
   *  after. Seated desk (ownerName) = a suggestion — the seated chair's own submission wins
   *  (DW-052); it only trades if that chair stays silent all round. */
  cover?: { desk: string; ownerName?: string | null; ownerSubmitted?: boolean };
  /** DW-052: another SPECIALIST set this lever on MY desk — a suggestion to me. I win. */
  suggestion?: boolean;
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

// "Empty" values are all the same absence: 0 / false / "" / [] / {} / null / undefined —
// a form default of 0 must not read as disagreeing with a standing plan that omits the lever.
const norm = (v: unknown): unknown => {
  if (v == null || v === false || v === "" || v === 0) return null;
  if (typeof v === "number") return Math.round(v * 100) / 100;
  if (Array.isArray(v)) return v.length ? v.map(norm) : null;
  if (typeof v === "object") {
    const ents = Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, norm(x)] as const).filter(([, x]) => x !== null).sort(([a], [b]) => a.localeCompare(b));
    return ents.length ? Object.fromEntries(ents) : null;
  }
  return v;
};
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const empty = (v: unknown): boolean => v == null || v === 0 || v === false || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && Object.keys(norm(v) as object).length === 0);

export function fmtLever(field: string, v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return MONEY.has(field) ? fmt.money(v) : field === "run_rate" ? `${Math.round(v * 100)}%` : String(Math.round(v * 100) / 100);
  if (typeof v === "string") return humanizeId(v);
  if (Array.isArray(v)) return v.length === 0 ? "none" : `${v.length}: ${v.slice(0, 3).map((x) => typeof x === "string" ? humanizeId(x) : humanizeId(String((x as { type?: string; id?: string; employee?: string })?.type ?? (x as { id?: string })?.id ?? (x as { employee?: string })?.employee ?? "item"))).join(", ")}${v.length > 3 ? "…" : ""}`;
  if (typeof v === "object") {
    const ents = Object.entries(v as Record<string, unknown>).filter(([, x]) => !empty(x));
    if (!ents.length) return "none";
    return ents.slice(0, 4).map(([k, x]) => `${SEG_LABEL[k] ?? humanizeId(k)} ${typeof x === "number" ? (field === "price" ? `$${x.toFixed(2)}` : x) : String(x)}`).join(" · ") + (ents.length > 4 ? " …" : "");
  }
  return String(v);
}

const LABEL: Record<string, string> = {
  price: "Prices", presence: "Channel presence", pr_action: "PR action", market_presence: "Markets served", market_supply: "Market allocation", buy_info: "Market research", invest_B: "Brand spend",
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
      const mk = (id: string) => { const m = view.markets?.find((x) => x.id === id) as { label?: string; name?: string } | undefined; return m?.label ?? m?.name ?? humanizeId(id); };
      return ents.length ? ents.map(([k]) => mk(k)).join(", ") : "home only";
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
  const push = (field: keyof FirmDecision, who: string, whoRole: string, theirs: unknown, winner: "me" | "them") =>
    out.push({ field, label: leverLabel(field), who, whoRole, theirs, mine: mine[field], winner, key: `${round}:${field}:${JSON.stringify(norm(theirs))}:${JSON.stringify(norm(mine[field]))}` });
  if (myDesk === "all") {
    // CEO: every specialist's submitted desk value that differs from my form → they win.
    const myAt = plan.seats.find((s) => s.me)?.updated_at ?? null;
    for (const s of plan.seats) {
      if (s.me || !s.partial || !s.role) continue;
      const desk = ROLE_DESK[s.role];
      if (!desk || desk === "all") continue;
      for (const f of DESK_LEVERS[desk]) {
        const theirs = s.partial[f];
        if (theirs === undefined) continue;
        if (!same(theirs, mine[f])) push(f, s.name, s.role, theirs, "them");
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
          if (theirs === undefined || !planCarries(standing, f) || same(theirs, standing?.[f])) continue;
          if (owner && same(theirs, owner.partial?.[f])) continue; // matches the owner's own word — nothing to flag
          const later = myAt == null || (s.updated_at ?? 0) > myAt;
          const winner: "me" | "them" = owner ? "me" : later ? "them" : "me";
          out.push({ field: f, label: leverLabel(f), who: s.name, whoRole: s.role, theirs, mine: mine[f], winner, key: `${round}:${f}:cover:${JSON.stringify(norm(theirs))}:${JSON.stringify(norm(mine[f]))}`, cover: { desk: d, ownerName: owner?.name ?? null, ownerSubmitted: !!owner?.partial } });
        }
      }
    }
  } else {
    // Specialist: the CEO's deliberately-set value on MY desk that differs from my form → I win.
    const ceo = plan.seats.find((s) => !s.me && s.role && (ROLE_DESK[s.role] ?? "all") === "all" && s.partial);
    if (ceo?.partial) {
      for (const f of DESK_LEVERS[myDesk]) {
        const theirs = ceo.partial[f];
        if (theirs === undefined) continue;
        if (same(theirs, standing?.[f])) continue; // CEO left it at the standing plan
        if (!same(theirs, mine[f])) push(f, ceo.name, ceo.role ?? "ceo", theirs, "me");
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
        if (theirs === undefined || same(theirs, standing?.[f])) continue;
        if (!same(theirs, mine[f])) out.push({ field: f, label: leverLabel(f), who: s.name, whoRole: s.role, theirs, mine: mine[f], winner: "me", key: `${round}:${f}:sugg:${JSON.stringify(norm(theirs))}:${JSON.stringify(norm(mine[f]))}`, suggestion: true });
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
      if (own.has(f as string) || mine[f] === undefined || !planCarries(firm, f)) continue;
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
