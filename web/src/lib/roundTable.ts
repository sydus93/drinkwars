/**
 * Round Table rows (DW-076) — the firm's plan as the SERVER holds it, lever by lever, with
 * the engine's own answer to "whose number is this?". Built because in Sprint 1 a CEO
 * submitted tanks, loans and equity four rounds running and nothing told the table that an
 * untouched COO/CFO slice had replaced every one of them. The old board credited a whole
 * desk to "the submitted specialist, else the CEO" — right most of the time, wrong exactly
 * in that case.
 *
 * Same single source of truth as the server merge, the Reconcile card and the instructor's
 * Decisions tab: `composeTeamDecision` (DW-073) and `seatTouched` (DW-074). Pure; the
 * component only formats.
 */
import type { FirmDecision } from "drinkwars-engine";
import { composeTeamDecision, DESK_LEVERS, ROLE_DESK, sameLever, seatTouched, type SeatPartial } from "drinkwars-engine";
import type { TeamPlan, TeamPlanSeat } from "../game/multiplayer.js";
import { leverLabel } from "./reconcile.js";

export type Lever = keyof FirmDecision;
export const TABLE_DESKS = ["commercial", "operations", "people", "finance", "strategy"] as const;
export type TableDesk = (typeof TABLE_DESKS)[number];
/** Free text / forecasts — never trade, never shown as plan rows. */
const SKIP = new Set<string>(["reflection", "beliefs"]);

/** A chair's entry that is NOT what will run — the Sprint-1 failure, made visible to the room. */
export interface UnusedEntry { seat: TeamPlanSeat; value: unknown }

export interface PlanRow {
  field: Lever;
  label: string;
  desk: TableDesk;
  /** what the engine will resolve for this lever */
  value: unknown;
  /** the seat the engine credits, or null = carried from the standing plan (nobody set it) */
  author: TeamPlanSeat | null;
  /** the author CHANGED it this round (vs. submitted it unchanged from the standing plan) */
  authorChanged: boolean;
  /** the desk's own chair submitted this lever UNCHANGED and a CEO entry runs instead */
  chairYielded: TeamPlanSeat | null;
  /** chairs whose changed entry lost */
  unused: UnusedEntry[];
}

export interface PlanTable {
  rows: PlanRow[];
  /** the composed plan the rows describe (server's, or re-merged from the slices) */
  composed: FirmDecision | null;
  /** total entries anyone made that will not run */
  unusedCount: number;
}

const seatPart = (s: TeamPlanSeat): SeatPartial =>
  ({ desk: (s.desk ?? (s.role ? ROLE_DESK[s.role] ?? "all" : "all")) as SeatPartial["desk"], partial: s.partial as Partial<FirmDecision>, updated_at: s.updated_at, touched: s.touched, touched_at: s.touched_at });
const deskOf = (s: TeamPlanSeat): string => s.desk ?? (s.role ? ROLE_DESK[s.role] ?? "all" : "all");

/** Rows for every lever the plan speaks to (a non-empty value, or an entry someone changed). */
export function planTable(plan: TeamPlan | null | undefined, standing: FirmDecision | null | undefined): PlanTable {
  if (!plan) return { rows: [], composed: null, unusedCount: 0 };
  const seats = plan.seats;
  const submitted = seats.filter((s) => s.submitted && s.partial);
  // Without a standing plan (should not happen for a team firm past creation) we can still
  // show the server's composed values, just not who they came from.
  if (!standing) {
    const composed = plan.composed;
    if (!composed) return { rows: [], composed: null, unusedCount: 0 };
    const rows: PlanRow[] = [];
    for (const desk of TABLE_DESKS) for (const f of DESK_LEVERS[desk] as Lever[]) {
      if (SKIP.has(f as string) || sameLever(composed[f], null)) continue;
      rows.push({ field: f, label: leverLabel(f as string), desk, value: composed[f], author: null, authorChanged: false, chairYielded: null, unused: [] });
    }
    return { rows, composed, unusedCount: 0 };
  }
  const parts = submitted.map(seatPart);
  const comp = composeTeamDecision({ ...standing, firm_id: plan.composed?.firm_id ?? standing.firm_id }, parts);
  // DW-082 (audit #5): once the round is locked, the record that will run is the table's value — a slice
  // that raced the lock can sit in the seats without being in it. Credit a seat only if it says the same.
  const lockedRec = plan.locked && plan.composed ? plan.composed : null;
  const changed = (s: TeamPlanSeat, f: Lever) => seatTouched(seatPart(s), f, standing);
  const rows: PlanRow[] = [];
  let unusedCount = 0;
  for (const desk of TABLE_DESKS) {
    for (const f of DESK_LEVERS[desk] as Lever[]) {
      if (SKIP.has(f as string)) continue;
      const value = lockedRec ? lockedRec[f] : comp.decision[f];
      const k = comp.from[f];
      const credited = k === undefined ? null : submitted[k];
      const author = lockedRec && credited && !sameLever((credited.partial as Record<string, unknown>)[f as string], value) ? null : credited;
      const entries = submitted.filter((s) => (s.partial as Record<string, unknown>)[f as string] !== undefined);
      const anyChange = entries.some((s) => changed(s, f));
      if (sameLever(value, null) && !anyChange) continue; // nothing planned, nobody moved it
      const unused = entries
        .filter((s) => s !== author && changed(s, f) && !sameLever((s.partial as Record<string, unknown>)[f as string], value))
        .map((s) => ({ seat: s, value: (s.partial as Record<string, unknown>)[f as string] }));
      unusedCount += unused.length;
      const chair = entries.find((s) => deskOf(s) === desk) ?? null;
      const chairYielded = author && deskOf(author) === "all" && chair && chair !== author && !changed(chair, f) ? chair : null;
      rows.push({ field: f, label: leverLabel(f as string), desk, value, author, authorChanged: !!author && changed(author, f), chairYielded, unused });
    }
  }
  return { rows, composed: lockedRec ?? comp.decision, unusedCount };
}
