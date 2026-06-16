/**
 * MOD-A09 · Regulatory capture / lobbying. A dedicated offensive government-relations
 * lever: a firm directs `lobby_spend` toward a regulation initiative from a fixed
 * config menu. Spend accumulates (decaying each round) into a market-level pool;
 * once it clears the initiative's threshold the regulation fires as an industry
 * event — implemented through the existing `pending_segment_mods` channel, so no
 * new demand/cost plumbing is needed. Rivals can COUNTER-lobby to bleed the pool.
 *
 * The regulation is industry-wide; the strategic play is lobbying for the rule that
 * fits your resource position (a quality leader wants quality standards; a low-brand
 * cost leader wants ad limits) while bearing the cost of influence — heavy offensive
 * lobbying risks a scrutiny fine, scaled down by T_gov. All spend is expensed so the
 * §7.2 finance invariants are untouched.
 */
import type { Config, FirmDecision, FirmId, LobbyingInitiative, RegulationType, SegmentPriceMod, WorldState } from "../types.js";
import { RNG, deriveSeed } from "../rng.js";

export interface LobbyingOutcome {
  costByFirm: Map<FirmId, number>; // offensive + counter spend + any scrutiny fine (→ opex)
  events: string[];
}

const empty = (): LobbyingOutcome => ({ costByFirm: new Map(), events: [] });

export function resolveLobbying(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config, round: number): LobbyingOutcome {
  const cfg = c.modules?.lobbying;
  const out = empty();
  if (!cfg?.enabled) return out;

  world.lobbying_initiatives ??= [];
  const byId = new Map(world.lobbying_initiatives.map((i) => [i.id, i]));
  const ensure = (id: string, regulation: RegulationType): LobbyingInitiative => {
    let it = byId.get(id);
    if (!it) {
      it = { id, regulation, progress: 0, fired: false, fired_round: null };
      world.lobbying_initiatives!.push(it);
      byId.set(id, it);
    }
    return it;
  };
  const add = (m: Map<FirmId, number>, id: FirmId, amt: number) => m.set(id, (m.get(id) ?? 0) + amt);

  // Decay un-fired progress first (sustained funding matters; a stalled push fades).
  for (const it of world.lobbying_initiatives) if (!it.fired) it.progress *= 1 - cfg.decay;

  // Aggregate this round's offensive pushes and defensive counters (firm order).
  const offensiveByFirm = new Map<FirmId, number>();
  for (const f of world.firms) {
    if (f.status !== "active") continue;
    const d = decisions.get(f.id);
    const spend = Math.max(0, d?.lobby_spend ?? 0);
    if (spend <= 0) continue;
    const counterId = d?.lobby_counter ?? null;
    const pushId = d?.lobby_initiative ?? null;
    if (counterId) {
      const ci = cfg.initiatives.find((x) => x.id === counterId);
      if (!ci) continue;
      const it = ensure(ci.id, ci.regulation);
      if (!it.fired) it.progress = Math.max(0, it.progress - spend * cfg.counter_effectiveness);
      add(out.costByFirm, f.id, spend);
    } else if (pushId) {
      const pi = cfg.initiatives.find((x) => x.id === pushId);
      if (!pi) continue;
      const it = ensure(pi.id, pi.regulation);
      if (!it.fired) it.progress += spend;
      add(out.costByFirm, f.id, spend);
      add(offensiveByFirm, f.id, spend);
    }
  }

  // Fire any initiative that cleared its threshold → push the regulation as a
  // duration-bounded segment mod (the effect favors whoever's positioned for it).
  for (const it of world.lobbying_initiatives) {
    if (it.fired) continue;
    const ci = cfg.initiatives.find((x) => x.id === it.id);
    if (!ci || it.progress < ci.threshold) continue;
    it.fired = true;
    it.fired_round = round;
    const segs = ci.segments?.length ? ci.segments : world.segments.filter((s) => s.active).map((s) => s.id);
    const until = round + cfg.duration;
    for (const seg of segs) {
      const mod: SegmentPriceMod = { segment: seg, alpha_delta: 0, until_round: until };
      if (ci.regulation === "quality_standards") mod.beta_q_delta = ci.effect;
      else if (ci.regulation === "ad_restrictions") mod.beta_b_delta = -ci.effect;
      else if (ci.regulation === "craft_promotion") mod.alpha_delta = ci.effect;
      world.pending_segment_mods.push(mod);
    }
    out.events.push(`LOBBYING: a "${ci.label}" regulation passes — it reshapes the ${segs.join(" & ")} market for ${cfg.duration} rounds`);
  }

  // Scrutiny: a heavy offensive lobbyist risks an investigation, scaled down by T_gov.
  const rng = new RNG(deriveSeed(world.seed, round, 41));
  for (const f of world.firms) {
    if (f.status !== "active") continue;
    const off = offensiveByFirm.get(f.id) ?? 0;
    if (off <= 0) continue;
    const exposure = off / (off + cfg.scrutiny_spend_halfsat);
    const prob = (cfg.scrutiny_base_prob * exposure) / (1 + cfg.scrutiny_tgov_k * (f.T_gov ?? 0));
    if (rng.bool(prob)) {
      add(out.costByFirm, f.id, cfg.scrutiny_fine);
      out.events.push(`LOBBYING SCRUTINY: ${f.id} is fined for influence-peddling (−${cfg.scrutiny_fine})`);
    }
  }
  return out;
}
