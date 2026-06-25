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
}

export interface CityActions {
  markets: string[]; // markets you commit capacity to this round (always includes "home")
  builds: CityBuildOrder[]; // facilities queued this round
  mothballs: string[]; // facility ids to mothball
  reactivations: string[]; // facility ids to reactivate
  maintain: Record<string, number>; // facility id → maintenance $ this round
}

/** Fresh actions for a round — seeded with the markets you already operate in. */
export const emptyCityActions = (view: GameView): CityActions => ({
  markets: Array.from(new Set(["home", ...(view.own.markets_entered ?? ["home"])])),
  builds: [],
  mothballs: [],
  reactivations: [],
  maintain: {},
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
    if (t) cap += t.capacity_contribution * capMult(f.location_id) * (f.condition ?? 1);
  }
  return cap;
}

/** Fold City View actions + lifted talent raids into a round decision. This is the SINGLE
 *  source of truth used BOTH for the projected-cash readout in the Decide tab AND at submit —
 *  so entering a market or siting a facility on the City View tab always shows up in projected
 *  cash, and nothing is double-counted. With no cityActions (geography off / multiplayer) it
 *  collapses to the draft (plus poaches), preserving prior behavior. */
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
    build_facilities: [...(base.build_facilities ?? []), ...cityActions.builds],
    market_presence: marketPresenceFrom(view, cityActions.markets),
    mothball_facilities: [...(base.mothball_facilities ?? []), ...cityActions.mothballs],
    reactivate_facilities: [...(base.reactivate_facilities ?? []), ...cityActions.reactivations],
    maintain_facilities: { ...(base.maintain_facilities ?? {}), ...cityActions.maintain },
  };
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
