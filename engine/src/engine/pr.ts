/**
 * MOD-A04 · PR events. Two halves, both resolved here just before demand:
 *
 *  1. Tactical plays (proactive): a firm picks a play type (festival/collab/viral),
 *     pays a cash cost, and gets a transient brand boost that decays fast — tactical
 *     buzz, not the slow compounding of sustained brand investment. Cooldown-gated.
 *  2. Negative PR (reactive): a controversy can fire per firm per round; the brand
 *     damage is blunted by employee trust (T_emp as brand insurance).
 *
 * The transient boost (`pr_spike`) is returned per firm and added to the brand
 * utility term in demand (like a joint-marketing pool). State mutations are on the
 * cloned world; RNG is seeded from (seed, round) so replays reproduce exactly.
 */
import type { Config, FirmDecision, FirmId, WorldState } from "../types.js";
import { RNG, deriveSeed } from "../rng.js";

export interface PrOutcome {
  /** Transient brand boost to apply in demand this round (post-decay, post-play). */
  spikeByFirm: Map<FirmId, number>;
  /** Cash cost of PR plays this round (folded into operating opex). */
  costByFirm: Map<FirmId, number>;
  events: string[];
}

const EMPTY: PrOutcome = { spikeByFirm: new Map(), costByFirm: new Map(), events: [] };

export function resolvePrEvents(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config, round: number): PrOutcome {
  const cfg = c.modules?.prEvents;
  if (!cfg?.enabled) return EMPTY;

  const spikeByFirm = new Map<FirmId, number>();
  const costByFirm = new Map<FirmId, number>();
  const events: string[] = [];
  const rng = new RNG(deriveSeed(world.seed, round, 91));
  const h = c.shocks.resilience_halfsat;

  for (const f of world.firms) {
    if (f.status !== "active") continue;

    // 1. Decay the existing transient spike (fast — tactical buzz fades).
    f.pr_spike = Math.max(0, (f.pr_spike ?? 0) * (1 - cfg.spike_decay_rate));

    // 2. Proactive play, if requested, off cooldown, and affordable.
    const action = decisions.get(f.id)?.pr_action;
    const offCooldown = f.pr_cooldown_until == null || round >= f.pr_cooldown_until;
    if (action && offCooldown && f.cash >= cfg.cost) {
      const bonus = cfg.type_bonus[action] ?? 1;
      f.pr_spike += cfg.spike_magnitude * bonus;
      f.pr_cooldown_until = round + cfg.cooldown_rounds;
      costByFirm.set(f.id, (costByFirm.get(f.id) ?? 0) + cfg.cost);
      const label = action === "festival" ? "a festival sponsorship" : action === "collab" ? "a brewer collaboration" : "a viral label drop";
      events.push(`PR PLAY: ${f.id} ran ${label} — brand buzz surges`);
    }

    // 3. Reactive negative PR — a controversy whose bite T_emp blunts.
    if (cfg.negative_pr_enabled && rng.bool(cfg.negative_pr_probability)) {
      const mit = cfg.negative_pr_t_emp_mitigation * (f.T_emp / (f.T_emp + h));
      const damage = cfg.negative_pr_brand_damage * (1 - mit);
      // Absorb against the transient spike first, then the durable brand stock.
      const fromSpike = Math.min(f.pr_spike, damage);
      f.pr_spike -= fromSpike;
      f.B = Math.max(0, f.B - (damage - fromSpike));
      events.push(`NEGATIVE PR: ${f.id} caught in a controversy (brand −${damage.toFixed(1)}${mit > 0.01 ? ", softened by loyal regulars" : ""})`);
    }

    spikeByFirm.set(f.id, f.pr_spike);
  }

  return { spikeByFirm, costByFirm, events };
}
