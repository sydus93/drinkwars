/**
 * Shared "City View" round actions. The City View (MOD-B01 geography) is an action
 * surface that queues facility builds, market commitments, and facility upkeep into the
 * round decision — exactly like talent raids are lifted to Play. DecisionForm remains the
 * submit hub and merges these in at submit. Keeping the shape + the presence math here lets
 * Play (init/reset), CityView (edit), and DecisionForm (merge) all agree on one source of truth.
 */
import type { FirmDecision } from "drinkwars-engine";
import type { GameView } from "./controller.js";

export interface CityBuildOrder {
  type: string; // FacilityTypeConfig.id
  location: string; // district id
  market: string; // MOD-B01 market/city id
  lot?: string; // Phase 2 parcel id (specific buildable lot)
  bid?: number; // lease premium for a contested parcel — highest bid wins it (site competition)
}

export interface CityActions {
  markets: string[]; // markets you commit capacity to this round (always includes "home")
  builds: CityBuildOrder[]; // facilities queued this round
  mothballs: string[]; // facility ids to mothball
  reactivations: string[]; // facility ids to reactivate
  divests: string[]; // facility ids to sell/demolish (frees the lot, recovers partial book value)
  maintain: Record<string, number>; // facility id → maintenance $ this round
  supply: Record<string, number>; // Stage 2: explicit units to offer per market (overrides the presence split); empty ⇒ presence-weighted
}

/** Fresh actions for a round — seeded with the markets you already operate in. */
export const emptyCityActions = (view: GameView): CityActions => ({
  markets: Array.from(new Set(["home", ...(view.own.markets_entered ?? ["home"])])),
  builds: [],
  mothballs: [],
  reactivations: [],
  divests: [],
  maintain: {},
  supply: {},
});

/** Output (this round's online capacity) the firm has sited in a given market — used to
 *  weight how much supply routes there. Mirrors the engine's facilityCapacity, per market. */
export function capacityInMarket(view: GameView, marketId: string): number {
  const types = view.modules?.facilities?.types ?? [];
  const districts = view.modules?.facilities?.districts ?? [];
  const capMult = (loc?: string) => districts.find((d) => d.id === loc)?.capacity_mult ?? 1;
  let cap = 0;
  for (const f of view.own.facilities ?? []) {
    if (!f.active || view.round < f.online_round) continue;
    if ((f.market_id ?? "home") !== marketId) continue;
    const t = types.find((x) => x.id === f.type);
    if (t) cap += (t.production_capacity ?? t.capacity_contribution ?? 0) * capMult(f.location_id) * (f.condition ?? 1);
  }
  return cap;
}

/** Fold City View actions + lifted talent raids into a round decision. This is the SINGLE
 *  source of truth used BOTH for the projected-cash readout in the Decide tab AND at submit —
 *  so entering a market or siting a facility on the City View tab always shows up in projected
 *  cash, and nothing is double-counted. With no cityActions (geography off / multiplayer) it
 *  collapses to the draft (plus poaches), preserving prior behavior. */
// On a team firm the draft MIRRORS the composed plan — which may already contain the very
// builds still queued in cityActions (submitted last click). The merge must therefore be
// idempotent: union by identity, never concat, or every submit stacks another copy of the
// same facility (and the projected-cash readout digs deeper each click). Two deliberately
// identical orders in one round (same type+district+market+lot+bid) would collapse — give
// the second one a lot or a different bid.
const buildKey = (b: CityBuildOrder) => [b.type, b.location, b.market, b.lot ?? "", b.bid ?? ""].join("|");
export function dedupeBuilds(builds: CityBuildOrder[]): CityBuildOrder[] {
  const seen = new Set<string>();
  return builds.filter((b) => { const k = buildKey(b); if (seen.has(k)) return false; seen.add(k); return true; });
}
const unionIds = (a: string[] | undefined, b: string[]): string[] => Array.from(new Set([...(a ?? []), ...b]));

export function mergeDecision(
  view: GameView,
  draft: FirmDecision,
  cityActions?: CityActions,
  poaches?: { firm: string; employee: string; offer: number }[],
): FirmDecision {
  const base = (poaches ? { ...draft, poach_employees: poaches } : draft) as FirmDecision;
  if (!cityActions) return base;
  return {
    ...base,
    build_facilities: dedupeBuilds([...((base.build_facilities ?? []) as CityBuildOrder[]), ...cityActions.builds]),
    market_presence: marketPresenceFrom(view, cityActions.markets),
    mothball_facilities: unionIds(base.mothball_facilities, cityActions.mothballs),
    reactivate_facilities: unionIds(base.reactivate_facilities, cityActions.reactivations),
    divest_facilities: unionIds(base.divest_facilities, cityActions.divests),
    maintain_facilities: { ...(base.maintain_facilities ?? {}), ...cityActions.maintain },
    // Stage 2: explicit per-market supply overrides the presence split (only when the player set any).
    market_supply: Object.keys(cityActions.supply ?? {}).length ? cityActions.supply : base.market_supply,
  };
}

/** Did the player change the committed-markets set away from what the firm already has?
 *  (The seeded set is not a decision — recomputing presence from it would register a
 *  phantom "markets served" edit on every desk.) */
export function marketsTouched(view: GameView, cityActions: CityActions): boolean {
  const seeded = new Set(emptyCityActions(view).markets);
  const cur = new Set(cityActions.markets);
  return cur.size !== seeded.size || [...cur].some((m) => !seeded.has(m));
}

/** Turn the committed-markets set into engine `market_presence` weights. Home keeps a base
 *  anchor; every market is weighted up by the output you've sited there — so capacity routes
 *  to where you build, and a freshly-entered market still gets a foothold while you build up.
 *  A weight > 0 on a not-yet-entered market is what triggers entry (and its one-time cost). */
export function marketPresenceFrom(view: GameView, markets: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of new Set(["home", ...markets])) {
    const base = id === "home" ? 1.0 : 0.6;
    out[id] = Math.round((base + capacityInMarket(view, id) / 200) * 1000) / 1000;
  }
  return out;
}
