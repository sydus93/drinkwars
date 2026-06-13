/**
 * MOD-B04 · R&D & innovation races. Firms invest toward the frontier category; the
 * progress accumulates (sqrt conversion, expensed). The frontier still has its
 * timed/capability emergence, but the first firm whose R&D progress crosses the
 * threshold pulls emergence forward AND earns a temporary first-mover head start
 * (a brand-equivalent bonus in that category for a few rounds). R&D spend is
 * expensed, so the §7.2 finance invariants are untouched.
 */
import type { Config, FirmDecision, FirmId, WorldState } from "../types.js";

export interface RndOutcome {
  costByFirm: Map<FirmId, number>;
  leader: FirmId | null; // firm with the most progress (>0)
  maxProgress: number;
}

/** Accumulate this round's R&D into each firm's progress; return the leader. */
export function resolveRnd(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config): RndOutcome {
  const cfg = c.modules?.rndRace;
  const costByFirm = new Map<FirmId, number>();
  if (!cfg?.enabled) return { costByFirm, leader: null, maxProgress: 0 };
  let leader: FirmId | null = null;
  let maxProgress = 0;
  for (const f of world.firms) {
    if (f.status !== "active") continue;
    const invest = Math.max(0, decisions.get(f.id)?.invest_rnd ?? 0);
    if (invest > 0) {
      f.rnd_progress = (f.rnd_progress ?? 0) + cfg.gain * Math.sqrt(invest);
      costByFirm.set(f.id, invest);
    }
    if ((f.rnd_progress ?? 0) > maxProgress) {
      maxProgress = f.rnd_progress ?? 0;
      leader = f.id;
    }
  }
  return { costByFirm, leader, maxProgress };
}

/** First-mover head start: a brand-equivalent bonus for the firm that opened the
 *  category, in that category, for the configured window. 0 otherwise. */
export function rndFirstMoverBonus(world: WorldState, c: Config, firmId: FirmId, seg: string, round: number): number {
  const cfg = c.modules?.rndRace;
  const fm = world.frontier_first_mover;
  if (!cfg?.enabled || !fm) return 0;
  return fm.firm_id === firmId && fm.segment === seg && round < fm.until_round ? cfg.first_mover_brand_bonus : 0;
}
