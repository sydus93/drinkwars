/**
 * MOD-A02 · Industry public goods / collective action. Firms voluntarily
 * contribute to industry-level goods each round; contributions are private costs,
 * benefits are non-excludable. Each good keeps a decaying pool (so sustained
 * funding matters); once the pool clears a threshold the shared benefit scales
 * with it. Three benefit types route through existing mechanics:
 *   - demand:           a per-segment demand multiplier bonus
 *   - quality:          a per-segment βq lift (industry quality certification)
 *   - water_resilience: industry-wide extra mitigation on the water shock
 *
 * The classic free-rider tension is intact: the benefit is shared, the cost is
 * yours. Contributions are expensed (operating opex) so the §7.2 invariants hold.
 */
import type { Config, FirmDecision, FirmId, SegmentId, WorldState } from "../types.js";

export interface PublicGoodsOutcome {
  costByFirm: Map<FirmId, number>;
  demandBonus: Map<SegmentId, number>; // applied as ×(1 + bonus) on segment demand
  betaQBonus: Map<SegmentId, number>; // additive βq
  waterMitigation: number; // industry-wide extra water-shock mitigation
  events: string[];
}

const empty = (): PublicGoodsOutcome => ({ costByFirm: new Map(), demandBonus: new Map(), betaQBonus: new Map(), waterMitigation: 0, events: [] });

export function resolvePublicGoods(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config): PublicGoodsOutcome {
  const cfg = c.modules?.publicGoods;
  const out = empty();
  if (!cfg?.enabled) return out;

  world.public_good_pools ??= {};
  const activeSegs = world.segments.filter((s) => s.active).map((s) => s.id);

  for (const good of cfg.goods) {
    // Aggregate this round's voluntary contributions.
    let total = 0;
    for (const f of world.firms) {
      if (f.status !== "active") continue;
      const amt = Math.max(0, decisions.get(f.id)?.public_good_contributions?.[good.id] ?? 0);
      if (amt > 0) {
        total += amt;
        out.costByFirm.set(f.id, (out.costByFirm.get(f.id) ?? 0) + amt);
      }
    }
    const prevPool = world.public_good_pools[good.id] ?? 0;
    const pool = prevPool * (1 - cfg.decay) + total;
    world.public_good_pools[good.id] = pool;

    const active = pool >= good.threshold;
    if (active && prevPool < good.threshold && good.threshold > 0) {
      out.events.push(`GUILD: the industry "${good.id.replace(/_/g, " ")}" fund reaches its threshold — the benefit is live`);
    }
    const effect = active ? good.max_effect * (pool / (pool + good.halfsat)) : 0;
    if (effect <= 0) continue;

    const segs = good.segments?.length ? good.segments : activeSegs;
    if (good.benefit === "demand") for (const s of segs) out.demandBonus.set(s, (out.demandBonus.get(s) ?? 0) + effect);
    else if (good.benefit === "quality") for (const s of segs) out.betaQBonus.set(s, (out.betaQBonus.get(s) ?? 0) + effect);
    else if (good.benefit === "water_resilience") out.waterMitigation += effect;
  }
  return out;
}
