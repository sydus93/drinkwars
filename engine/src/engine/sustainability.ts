/**
 * MOD-A03 · Sustainability as resilience. A water-efficiency capability stock,
 * built by investment (sqrt conversion, depreciating), that (a) blunts the water
 * shock specifically and (b) earns a little regulator goodwill (T_gov). There is
 * no "sustainability score" divorced from mechanics — every effect routes through
 * an existing fundamental. The spend is expensed (like the other intangible
 * investments), so the §7.2 finance invariants are untouched.
 */
import type { Config, FirmDecision, FirmId, FirmState, WorldState } from "../types.js";

export interface SustainabilityOutcome {
  costByFirm: Map<FirmId, number>; // expensed via operating opex
}

/** Extra water-shock mitigation from a firm's water-efficiency stock (0 when off). */
export function waterEfficiencyMitigation(firm: FirmState, c: Config): number {
  const s = c.modules?.sustainability;
  if (!s?.enabled) return 0;
  const we = firm.water_efficiency ?? 0;
  return s.resilience_k * (we / (we + s.resilience_halfsat));
}

/** Advance each firm's water-efficiency stock from this round's investment and add
 *  the T_gov goodwill bump. Mutates the (cloned) firms; returns the cash cost. */
export function resolveSustainability(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config): SustainabilityOutcome {
  const s = c.modules?.sustainability;
  const costByFirm = new Map<FirmId, number>();
  if (!s?.enabled) return { costByFirm };
  for (const f of world.firms) {
    if (f.status !== "active") continue;
    const invest = Math.max(0, decisions.get(f.id)?.invest_water_efficiency ?? 0);
    // sqrt conversion + depreciation (a no-lag capability stock).
    f.water_efficiency = Math.max(0, (f.water_efficiency ?? 0) * (1 - s.depreciation) + s.gain * Math.sqrt(invest));
    if (invest > 0) {
      f.T_gov += s.t_gov_gain_per_invest; // visible efficiency earns regulator goodwill
      costByFirm.set(f.id, invest);
    }
  }
  return { costByFirm };
}
