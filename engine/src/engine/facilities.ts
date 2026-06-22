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
  events: string[];
}

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
    if (t) cap += t.capacity_contribution * conditionFactor(fac.condition) * capacityMult(c, fac.location_id);
  }
  return cap;
}

export function resolveFacilities(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config, round: number): FacilitiesOutcome {
  const out: FacilitiesOutcome = { capexByFirm: new Map(), opexByFirm: new Map(), brandByFirm: new Map(), events: [] };
  const cfg = c.modules?.facilities;
  if (!cfg?.enabled) return out;

  for (const f of world.firms) {
    if (f.status !== "active") continue;
    f.facilities ??= [];
    const d = decisions.get(f.id);
    let capex = 0;
    let opex = 0;
    let brand = 0;

    // ---- Build (capitalized; comes online after build_rounds) ----
    for (const b of d?.build_facilities ?? []) {
      const t = typeOf(c, b.type);
      if (!t || f.facilities.length >= cfg.max_facilities) continue;
      if (f.cash < t.base_cost) continue; // can't finance the build this round
      const id = `fac_${round}_${f.facilities.length}`;
      const location_id = b.location ?? cfg.districts?.[0]?.id;
      f.facilities.push({
        id, type: t.id, name: (b.name ?? "").trim() || t.label,
        built_round: round, online_round: round + t.build_rounds,
        condition: 1, active: true, location_id,
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
      // District brand draw (foot traffic + visibility): only once the facility is online,
      // scaled by condition so a derelict storefront pulls less.
      if (round >= fac.online_round) brand += (districtOf(c, fac.location_id)?.brand_boost ?? 0) * conditionFactor(fac.condition);
    }

    if (capex > 0) out.capexByFirm.set(f.id, capex);
    if (opex > 0) out.opexByFirm.set(f.id, opex);
    if (brand > 0) out.brandByFirm.set(f.id, brand);
  }
  return out;
}
