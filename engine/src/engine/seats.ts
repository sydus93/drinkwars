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

export type SeatDesk = "commercial" | "operations" | "finance" | "relations";

/** A role's primary desk. "all" = a generalist seat (CEO / solo controller / a lone
 *  member) that fills every desk, then specialists override their own slice. */
export const ROLE_DESK: Record<string, SeatDesk | "all"> = {
  cmo: "commercial",
  coo: "operations",
  chro: "operations", // people levers live on the operations desk
  cfo: "finance",
  ceo: "all",
  member: "all",
};

/** Every FirmDecision lever, partitioned across the four desks (exactly once each).
 *  `firm_id` is excluded — it's identity, always carried from the base decision. */
export const DESK_LEVERS: Record<SeatDesk, (keyof FirmDecision)[]> = {
  commercial: ["price", "presence", "pr_action", "market_presence", "market_supply", "buy_info", "beliefs", "reflection"],
  operations: [
    "run_rate", "invest_water_efficiency", "invest_rnd", "buy_vertical", "hire_roles", "fire_roles",
    "build_facilities", "maintain_facilities", "mothball_facilities", "reactivate_facilities", "divest_facilities",
    "hire_employees", "fire_employees", "raise_employees", "poach_employees",
    "invest_cap", "invest_process", "invest_Q", "invest_B", "invest_T_emp", "invest_T_inv", "invest_T_gov",
  ],
  finance: ["draw_convertible", "draw_rbf", "debt_draw", "debt_repay", "equity_raise", "dividend"],
  relations: ["public_good_contributions", "acquisition_bid", "agreement_actions", "lobby_spend", "lobby_initiative", "lobby_counter", "exit_action"],
};

/** All lever keys (every desk's fields). Used by the "all" / generalist seat. */
export const ALL_LEVERS: (keyof FirmDecision)[] = [
  ...DESK_LEVERS.commercial, ...DESK_LEVERS.operations, ...DESK_LEVERS.finance, ...DESK_LEVERS.relations,
];

/** One seat's contribution: the levers it set, plus its role (or an explicit desk). */
export interface SeatPartial {
  role?: string | null;
  desk?: SeatDesk | "all" | null;
  partial: Partial<FirmDecision>;
}

const deskOf = (s: SeatPartial): SeatDesk | "all" =>
  s.desk ?? (s.role ? ROLE_DESK[s.role] ?? "all" : "all");

/**
 * Fold seat partials into one FirmDecision over a base (a complete default — e.g. the
 * zero-fill). Generalist ("all") seats are applied first so specialists win for their
 * own desk; a desk with no seat keeps the base value. Only fields a seat actually set
 * (≠ undefined) overlay, so partial edits never wipe another desk. `firm_id` stays base.
 */
export function mergeMemberDecisions(base: FirmDecision, seats: SeatPartial[]): FirmDecision {
  const out: FirmDecision = { ...base };
  // Generalists (desk "all") first, specialists after — stable so equal-precedence seats
  // keep input order (deterministic for replay).
  const ordered = [...seats].sort((a, b) => Number(deskOf(a) !== "all") - Number(deskOf(b) !== "all"));
  for (const s of ordered) {
    const desk = deskOf(s);
    const fields = desk === "all" ? ALL_LEVERS : DESK_LEVERS[desk];
    for (const f of fields) {
      const v = s.partial[f];
      if (v !== undefined) (out as unknown as Record<string, unknown>)[f as string] = v;
    }
  }
  out.firm_id = base.firm_id;
  return out;
}
