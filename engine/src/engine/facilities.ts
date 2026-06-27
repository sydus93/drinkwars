/**
 * MOD-B11 · Facilities — named physical capacity assets.
 *
 * Additive + gated. A build is a CAPITALIZED capex (cash → PP&E through the existing
 * capex channel, so the §7.2 invariants hold) for an asset that comes online after
 * `build_rounds` and ADDS its `capacity_contribution` to effective cap, scaled by
 * condition. The fixed cost and any maintenance spend are opex. Condition decays each
 * round (slower the more you maintain) and scales the capacity the facility actually
 * delivers; mothballing parks it (no cost, no capacity). With the module off there are
 * no facilities and the engine is identical to the pre-module game.
 *
 * The capacity contribution is delivered explicitly here (via `facilityCapacity`),
 * NOT through the cap-stock investment pipeline — so the capex capitalization and the
 * capacity gain are not double-counted (the capex channel only touches PP&E/finance,
 * never the cap stock). Same shape as engine/assets.ts (vertical assets / key hires).
 */
import type { Config, FacilityTypeConfig, FirmDecision, FirmId, FirmState, WorldState } from "../types.js";

export interface FacilitiesOutcome {
  capexByFirm: Map<FirmId, number>; // builds (capitalized into PP&E)
  opexByFirm: Map<FirmId, number>; // fixed cost + maintenance (expensed)
  brandByFirm: Map<FirmId, number>; // district brand draw (added to the B stock this round)
  salvageByFirm: Map<FirmId, number>; // divest proceeds (cash in, book-neutral PP&E reduction)
  events: string[];
}

/** Producer/retail spectrum accessors. production_capacity is the tank capacity (producer role);
 *  retail_draw is the local demand/brand pull + catchment weight (retail role). capacity_contribution
 *  is the deprecated single-scalar field, read as a production_capacity fallback for legacy overrides. */
export const prodCapOf = (t: FacilityTypeConfig): number => t.production_capacity ?? t.capacity_contribution ?? 0;
export const retailOf = (t: FacilityTypeConfig): number => t.retail_draw ?? 0;
/** Reference retail intensity (a taproom): brand draw + catchment weight scale relative to this. */
export const RETAIL_REF = 40;

const typeOf = (c: Config, id: string): FacilityTypeConfig | undefined =>
  c.modules?.facilities?.types.find((t) => t.id === id);

const districtOf = (c: Config, locationId?: string) =>
  locationId ? c.modules?.facilities?.districts?.find((d) => d.id === locationId) : undefined;

/** Rent multiplier on fixed cost from the facility's district (1 when none/unset). */
const rentMult = (c: Config, locationId?: string): number => districtOf(c, locationId)?.rent_mult ?? 1;

/** Capacity multiplier from the facility's district (1 when none/unset) — industrial
 *  yards run hot, cramped downtown space delivers less. */
const capacityMult = (c: Config, locationId?: string): number => districtOf(c, locationId)?.capacity_mult ?? 1;

/** How condition scales delivered capacity: a derelict facility still runs at half,
 *  a pristine one at full. Keeps a neglected asset a drag, not a cliff. */
const conditionFactor = (cond: number): number => 0.5 + 0.5 * Math.max(0, Math.min(1, cond));

/** Effective capacity contributed by a firm's online, active facilities (0 when off). */
export function facilityCapacity(f: FirmState, c: Config, round: number): number {
  if (!c.modules?.facilities?.enabled) return 0;
  let cap = 0;
  for (const fac of f.facilities ?? []) {
    if (!fac.active || round < fac.online_round) continue;
    const t = typeOf(c, fac.type);
    if (t) cap += prodCapOf(t) * conditionFactor(fac.condition) * capacityMult(c, fac.location_id);
  }
  return cap;
}

export function resolveFacilities(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config, round: number): FacilitiesOutcome {
  const out: FacilitiesOutcome = { capexByFirm: new Map(), opexByFirm: new Map(), brandByFirm: new Map(), salvageByFirm: new Map(), events: [] };
  const cfg = c.modules?.facilities;
  if (!cfg?.enabled) return out;
  const salvageFrac = Math.max(0, cfg.salvage_fraction ?? 0.5);

  // Phase 2 spatial siting: a lot (parcel) holds at most one facility. Seed occupancy from
  // existing facilities, then claim lots as we build this round so two can't share a parcel.
  const occupied = new Map<string, Set<string>>(); // market id → occupied lot ids
  const claim = (mk: string, lot: string) => { let s = occupied.get(mk); if (!s) { s = new Set(); occupied.set(mk, s); } s.add(lot); };
  for (const f of world.firms) for (const fac of f.facilities ?? []) if (fac.lot_id) claim(fac.market_id ?? "home", fac.lot_id);
  const lotsOf = (mk: string) => c.modules?.geography?.markets.find((m) => m.id === mk)?.lots ?? [];

  // Site competition: when more than one active firm bids for the same FREE parcel this round,
  // the highest bid wins it; the losers' builds for that parcel are dropped (no capex) with a
  // notice. Ties keep firm order (deterministic). The winner pays its bid as a lease premium.
  const bidsByLot = new Map<string, { firmId: FirmId; bid: number }[]>();
  for (const f of world.firms) {
    if (f.status !== "active") continue;
    for (const b of decisions.get(f.id)?.build_facilities ?? []) {
      if (!b.lot) continue;
      const mk = b.market ?? "home";
      if (occupied.get(mk)?.has(b.lot)) continue; // already held by an existing facility — not contestable
      const key = `${mk}::${b.lot}`;
      const arr = bidsByLot.get(key) ?? [];
      arr.push({ firmId: f.id, bid: Math.max(0, b.bid ?? 0) });
      bidsByLot.set(key, arr);
    }
  }
  const lotWinner = new Map<string, FirmId>();
  for (const [key, bids] of bidsByLot) {
    if (bids.length <= 1) continue; // uncontested
    lotWinner.set(key, bids.reduce((a, x) => (x.bid > a.bid ? x : a), bids[0]).firmId);
  }

  for (const f of world.firms) {
    if (f.status !== "active") continue;
    f.facilities ??= [];
    const d = decisions.get(f.id);
    let capex = 0;
    let opex = 0;
    let brand = 0;
    let salvage = 0;

    // ---- Divest (sell/demolish) — processed BEFORE build so the freed lot is available the
    // same round (a relocate = divest + build elsewhere). Recovers salvage_fraction × build cost
    // × condition in cash (book-neutral PP&E reduction handled in finance), and frees the parcel. ----
    for (const id of d?.divest_facilities ?? []) {
      const idx = f.facilities.findIndex((x) => x.id === id);
      if (idx < 0) continue;
      const fac = f.facilities[idx];
      const t = typeOf(c, fac.type);
      const proceeds = t ? Math.round(salvageFrac * t.base_cost * conditionFactor(fac.condition)) : 0;
      salvage += proceeds;
      if (fac.lot_id) occupied.get(fac.market_id ?? "home")?.delete(fac.lot_id); // return the parcel to the lease pool
      f.facilities.splice(idx, 1);
      out.events.push(`FACILITY DIVESTED: ${f.id} sells off ${(fac.name || t?.label || "a facility").toLowerCase()}${proceeds > 0 ? ` (recovers ${proceeds})` : ""}`);
    }

    // ---- Build (capitalized; comes online after build_rounds) ----
    for (const b of d?.build_facilities ?? []) {
      const t = typeOf(c, b.type);
      if (!t) continue;
      // Don't silently swallow a build the player queued: surface why it didn't happen so a
      // paid market-entry without a resulting site isn't a mystery.
      if (cfg.max_facilities > 0 && f.facilities.length >= cfg.max_facilities) {
        out.events.push(`BUILD BLOCKED: ${f.id} is at its facility cap (${cfg.max_facilities}) — ${t.label.toLowerCase()} not built`);
        continue;
      }
      if (f.cash < t.base_cost) {
        out.events.push(`BUILD BLOCKED: ${f.id} can't fund a ${t.label.toLowerCase()} (needs ${Math.round(t.base_cost)})`);
        continue; // can't finance the build this round
      }
      const id = `fac_${round}_${f.facilities.length}`;
      // Tag the facility with the market/city it's sited in (MOD-B01). Defaults to "home"
      // when geography is on so home-only builds still place correctly on the City View.
      const market_id = b.market ?? (c.modules?.geography?.enabled ? "home" : undefined);
      let location_id = b.location ?? cfg.districts?.[0]?.id;
      let lot_id: string | undefined;
      // Phase 2: if a specific parcel was chosen, validate it (exists, unlocked, free) and let
      // the lot's district drive rent/zoning/capacity/brand. No lot ⇒ legacy district-only build.
      if (b.lot) {
        const mk = market_id ?? "home";
        const lot = lotsOf(mk).find((L) => L.id === b.lot);
        if (!lot) { out.events.push(`BUILD BLOCKED: ${f.id} — parcel ${b.lot} not found in ${mk}`); continue; }
        if (round < (lot.unlock_round ?? 0)) { out.events.push(`BUILD BLOCKED: ${f.id} — that parcel isn't available yet`); continue; }
        const winner = lotWinner.get(`${mk}::${b.lot}`);
        if (winner && winner !== f.id) { out.events.push(`OUTBID: ${f.id} lost a contested parcel in ${mk} to a higher bid`); continue; }
        if (occupied.get(mk)?.has(b.lot)) { out.events.push(`BUILD BLOCKED: ${f.id} — that parcel is already taken`); continue; }
        if (winner === f.id && (b.bid ?? 0) > 0) { opex += Math.max(0, b.bid ?? 0); out.events.push(`PARCEL WON: ${f.id} wins a contested parcel in ${mk} (${Math.round(Math.max(0, b.bid ?? 0))} premium)`); }
        lot_id = lot.id;
        location_id = lot.district;
        claim(mk, lot.id);
      }
      f.facilities.push({
        id, type: t.id, name: (b.name ?? "").trim() || t.label,
        built_round: round, online_round: round + t.build_rounds,
        condition: 1, active: true, location_id, market_id, lot_id,
      });
      capex += t.base_cost;
      out.events.push(`FACILITY BUILT: ${f.id} breaks ground on a ${t.label.toLowerCase()} (online in ${t.build_rounds} round${t.build_rounds === 1 ? "" : "s"})`);
    }

    // ---- Mothball / reactivate ----
    for (const id of d?.mothball_facilities ?? []) {
      const fac = f.facilities.find((x) => x.id === id);
      if (fac) fac.active = false;
    }
    for (const id of d?.reactivate_facilities ?? []) {
      const fac = f.facilities.find((x) => x.id === id);
      if (fac) fac.active = true;
    }

    // ---- Per-facility upkeep: fixed cost + maintenance + condition + brand draw ----
    for (const fac of f.facilities) {
      if (!fac.active) continue; // mothballed: no cost, no brand draw, condition holds
      const t = typeOf(c, fac.type);
      if (!t) continue;
      opex += Math.round(t.fixed_cost * rentMult(c, fac.location_id));
      const spend = Math.max(0, d?.maintain_facilities?.[fac.id] ?? 0);
      opex += spend;
      // Condition: decays by the type rate, restored by maintenance; clamped to [0,1].
      fac.condition = Math.max(0, Math.min(1, fac.condition - t.condition_decay + spend * t.maintenance_effect));
      // District brand draw (foot traffic + visibility): only once online, scaled by condition AND
      // by the facility's RETAIL intensity — a downtown taproom draws full brand, a back-of-house
      // production brewery downtown draws none (brand is a retail phenomenon, not a brewing one).
      if (round >= fac.online_round) {
        const retailFactor = Math.min(1.5, retailOf(t) / RETAIL_REF);
        brand += (districtOf(c, fac.location_id)?.brand_boost ?? 0) * retailFactor * conditionFactor(fac.condition);
      }
    }

    if (capex > 0) out.capexByFirm.set(f.id, capex);
    if (opex > 0) out.opexByFirm.set(f.id, opex);
    if (brand > 0) out.brandByFirm.set(f.id, brand);
    if (salvage > 0) out.salvageByFirm.set(f.id, salvage);
  }
  return out;
}
