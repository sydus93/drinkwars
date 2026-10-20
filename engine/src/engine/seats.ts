/**
 * Multi-seat firms (DW-024) — composing ONE FirmDecision from several C-suite seats.
 *
 * A firm can be run by one player (solo) or by a team of players, each holding a
 * specialty seat (CEO / CFO / CMO / COO / CHRO) that owns a "desk" of levers — the same
 * four desks the web's pro-mode filter already uses. Each seat edits only its desk's
 * fields; `mergeMemberDecisions` folds the seats into the single FirmDecision the engine
 * resolves. Pure + deterministic (no clock/RNG), so the server can merge at lock and the
 * web can preview the same result.
 *
 * Coverage is exhaustive: every FirmDecision lever belongs to exactly one desk (verified
 * by a unit test), so no field is ever silently dropped. `firm_id` is identity, always
 * taken from the base decision.
 */
import type { FirmDecision } from "../types.js";

export type SeatDesk = "commercial" | "operations" | "people" | "finance" | "strategy";

/** A role's primary desk. "all" = a generalist seat (CEO / solo controller / a lone
 *  member) that fills every desk, then specialists override their own slice. The CEO
 *  stays generalist (integrator + gap-filler) and owns the `strategy` desk by default —
 *  the corporate-development/external levers no functional specialist holds. (DW-031 L1.5:
 *  the partition is realigned so each desk maps 1:1 to a C-suite discipline — brand sits
 *  with the CMO, investor relations with the CFO, people on their own desk.) */
export const ROLE_DESK: Record<string, SeatDesk | "all"> = {
  cmo: "commercial",
  coo: "operations",
  chro: "people",
  cfo: "finance",
  ceo: "all",
  member: "all",
};

/** Every FirmDecision lever, partitioned across the five role-aligned desks (exactly once
 *  each). `firm_id` is excluded — it's identity, always carried from the base decision. */
export const DESK_LEVERS: Record<SeatDesk, (keyof FirmDecision)[]> = {
  // CMO — go-to-market + the brand stock that demand rides on.
  commercial: ["price", "pr_action", "market_presence", "market_supply", "buy_info", "beliefs", "invest_B", "reflection"],
  // COO — capacity, process, quality, facilities: the making of the product.
  // `presence` is the capacity-allocation divider (DW-062). It sat on the commercial desk while
  // its control renders inside the OPERATIONS card, so the CMO's form — which opens on commercial
  // — never showed it, yet their client still transmitted it every submit (a seat always ships
  // its own-desk levers, seeded from the standing plan). The owner pass runs after the recency
  // pass, so the COO's drag was discarded in BOTH submission orders and the split silently
  // snapped back to last round's. A lever's desk here MUST match the `deskCls(...)` gate its
  // control renders under in web/src/components/DecisionForm.tsx.
  operations: [
    "presence", "run_rate", "invest_water_efficiency", "invest_rnd", "buy_vertical",
    "build_facilities", "maintain_facilities", "mothball_facilities", "reactivate_facilities", "divest_facilities",
    "invest_cap", "invest_process", "invest_Q",
  ],
  // CHRO — the organization: staffing, wages, morale/employee relations.
  people: ["hire_roles", "fire_roles", "hire_employees", "hire_bids", "fire_employees", "raise_employees", "poach_employees", "invest_T_emp"],
  // CFO — capital structure, distributions, and the investor relationship.
  finance: ["draw_convertible", "draw_rbf", "debt_draw", "debt_repay", "equity_raise", "dividend", "invest_T_inv"],
  // CEO / Corporate development — deals, alliances, government affairs, exit.
  strategy: ["public_good_contributions", "acquisition_bid", "agreement_actions", "lobby_spend", "lobby_initiative", "lobby_counter", "exit_action", "invest_T_gov"],
};

/** All lever keys (every desk's fields). Used by the "all" / generalist seat. */
export const ALL_LEVERS: (keyof FirmDecision)[] = [
  ...DESK_LEVERS.commercial, ...DESK_LEVERS.operations, ...DESK_LEVERS.people, ...DESK_LEVERS.finance, ...DESK_LEVERS.strategy,
];

// "Empty" values are all the same absence: 0 / false / "" / [] / {} / null / undefined — so a
// form default of 0 never reads as disagreeing with a plan that omits the lever. Numbers compare
// to the cent. The ONE equality every merge + Reconcile comparison uses (DW-073).
// DW-076: list levers (builds, hires, poach offers, facility ids) are SETS to the engine — the same
// orders in another sequence are the same decision, so a client that rebuilds its queue from the
// stored slice after a reload (City View, poaches) can never register a phantom "changed" lever.
const norm = (v: unknown): unknown => {
  if (v == null || v === false || v === "") return null;
  // round FIRST, then test for zero — float dust (0.001) is the same absence as 0 (DW-080)
  if (typeof v === "number") { const c = Math.round(v * 100) / 100; return c === 0 ? null : c; }
  if (Array.isArray(v)) return v.length ? v.map(norm).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : null;
  if (typeof v === "object") {
    const ents = Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, norm(x)] as const).filter(([, x]) => x !== null).sort(([a], [b]) => a.localeCompare(b));
    return ents.length ? Object.fromEntries(ents) : null;
  }
  return v;
};
export const sameLever = (a: unknown, b: unknown): boolean => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

/** One seat's contribution: the levers it set, plus its role (or an explicit desk). */
export interface SeatPartial {
  role?: string | null;
  desk?: SeatDesk | "all" | null;
  partial: Partial<FirmDecision>;
  /** when this slice was submitted — among non-owners the LATER word wins (DW-051) */
  updated_at?: number | null;
  /** DW-074: the levers this seat actually CHANGED this round (sticky across its resubmits).
   *  A seat ships far more than it decides — its whole desk, seeded from the standing plan —
   *  so presence in `partial` says nothing; this list is the record of intent. Absent (a
   *  slice stored before DW-074, or an older client mid-deploy) ⇒ the merge infers it:
   *  "differs from the standing plan". */
  touched?: readonly string[] | null;
}

/** Did this seat deliberately set lever `f`? The explicit record when the slice carries one,
 *  else inferred against the standing plan (see SeatPartial.touched). */
export const seatTouched = (s: SeatPartial, f: keyof FirmDecision, base: FirmDecision): boolean =>
  s.touched ? s.touched.includes(f as string) : !sameLever(s.partial[f], (base as unknown as Record<string, unknown>)[f as string]);

const deskOf = (s: SeatPartial): SeatDesk | "all" =>
  s.desk ?? (s.role ? ROLE_DESK[s.role] ?? "all" : "all");

/** The composed decision plus, per lever, which seat (index into `seats`) it came from.
 *  A lever absent from `from` kept the base (standing-plan) value. */
export interface Composition { decision: FirmDecision; from: Partial<Record<keyof FirmDecision, number>> }

/**
 * THE precedence rule for team firms — the server's merge, the Reconcile card, the commit
 * dial and the instructor's team view all call this one function, so the card can never tell
 * a student one thing while the engine does another (DW-059's "do this first").
 *
 * Per lever, over `base` (the firm's standing plan — last round's levers carried forward):
 *  1. Non-owners (the CEO / desk "all", and anyone covering a desk that isn't theirs): the
 *     LATER submission wins (DW-051), so a cover for an empty chair lands — but only a word that
 *     was meant: a seat that left the lever alone never erases a teammate's deliberate value
 *     (DW-080). The CEO overrules a cover by changing the lever, or holding it (Keep mine).
 *  2. The desk's own specialist then wins — IF they changed the lever this round (seatTouched).
 *     A lever the specialist left alone means "no change from me": a value the CEO changed
 *     stands instead (DW-073: every specialist submit ships their whole desk, so an untouched
 *     $0 / last-round default silently erased the CEO's tanks, borrowing and equity in all four
 *     rounds of Sprint 1 at one firm). If neither changed it, the specialist's submitted value
 *     stands, as it always did. Only the CEO gets this: a PEER's suggestion on a seated desk
 *     still trades only if that chair stays silent all round (DW-052).
 *  3. An EMPTY collection (no hires, no builds…) never overwrites a real request (DW-071) —
 *     unless the seat set it deliberately (the lever is in its list): the desk's own chair
 *     declining, or the CEO cancelling a teammate's suggestion for an empty desk (DW-080).
 *  4. Market research (`buy_info`) is a TEAM purchase (DW-081): any seat that buys it buys it for
 *     the firm, and no seat vetoes it — the report reaches every desk the moment it lands, and the
 *     server's ratchet keeps it bought all round. Provenance = the first buyer.
 * Pure + deterministic: ties keep input order; stored timestamps order replays exactly.
 */
export function composeTeamDecision(base: FirmDecision, seats: SeatPartial[]): Composition {
  const out = { ...base } as unknown as Record<string, unknown>;
  const from: Record<string, number> = {};
  const lastGeneralist: Record<string, number> = {};
  const owns = (s: SeatPartial, f: keyof FirmDecision): boolean => {
    const desk = deskOf(s);
    return desk !== "all" && (DESK_LEVERS[desk] as (keyof FirmDecision)[]).includes(f);
  };
  const isEmpty = (v: unknown): boolean =>
    Array.isArray(v) ? v.length === 0 : v !== null && typeof v === "object" && Object.keys(v as object).length === 0;
  const put = (f: string, v: unknown, i: number) => {
    if (isEmpty(v) && out[f] !== undefined && !isEmpty(out[f])) return;
    out[f] = v;
    from[f] = i;
  };
  const byTime = seats.map((s, i) => ({ s, i })).sort((a, b) => ((a.s.updated_at ?? 0) - (b.s.updated_at ?? 0)) || (a.i - b.i));
  for (const { s, i } of byTime) {
    for (const f of ALL_LEVERS) {
      if (owns(s, f)) continue;
      const v = s.partial[f];
      if (v === undefined) continue;
      const mine = seatTouched(s, f, base);
      // DW-080: later wins only for a word that was MEANT. A seat that left the lever alone never
      // erases a teammate's deliberate one — a CEO's unchanged resubmit (its form a poll behind)
      // wiped a cover for an empty chair. To overrule a cover the CEO changes it or holds it.
      const held = from[f];
      if (held !== undefined && !mine && seatTouched(seats[held], f, base)) continue;
      // An untouched blank never replaces a real request (DW-071) — but a deliberate "none" does:
      // the CEO cancelling a hire or build a teammate suggested for an empty desk.
      if (isEmpty(v) && !mine && out[f] !== undefined && !isEmpty(out[f])) continue;
      out[f] = v;
      from[f] = i;
      if (deskOf(s) === "all") lastGeneralist[f] = i;
    }
  }
  seats.forEach((s, i) => {
    for (const f of ALL_LEVERS) {
      if (!owns(s, f)) continue;
      const v = s.partial[f];
      if (v === undefined) continue;
      const g = lastGeneralist[f];
      if (g !== undefined && !seatTouched(s, f, base) && seatTouched(seats[g], f, base)) {
        // The owner left it alone and the CEO changed it: the CEO's call stands, even over a
        // later peer suggestion.
        out[f] = seats[g].partial[f];
        from[f] = g;
        continue;
      }
      // An owner's explicit word is final even when it is "none": the chair declining a
      // teammate's suggested hire or build (Keep mine) must be able to clear it. The empty-
      // collection guard exists for UNTOUCHED blanks (DW-071), which never reach here as touched.
      if (s.touched?.includes(f as string)) { out[f] = v; from[f] = i; continue; }
      put(f, v, i);
    }
  });
  const buyer = byTime.find(({ s }) => s.partial.buy_info === true && seatTouched(s, "buy_info", base)); // rule 4
  if (buyer) { out.buy_info = true; from.buy_info = buyer.i; }
  out.firm_id = base.firm_id;
  return { decision: out as unknown as FirmDecision, from: from as Composition["from"] };
}

/** Fold seat partials into the one FirmDecision the engine resolves (see composeTeamDecision). */
export function mergeMemberDecisions(base: FirmDecision, seats: SeatPartial[]): FirmDecision {
  return composeTeamDecision(base, seats).decision;
}
