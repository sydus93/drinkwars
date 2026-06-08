/**
 * Shock system (§9). A scheduled, editable timeline rolled at init from config
 * distributions (§9.1); a live-trigger path (§9.2); resilience differentiation
 * via the process stock + T_emp (§9.4, addendum's water mechanic — no new state
 * variable); and the two endogenous rules (§9.3): antitrust and distress dumping.
 */
import type { Config, FirmId, FirmState, ScheduledShock, ShockEffect, SegmentId, WorldState } from "../types.js";
import { RNG, deriveSeed } from "../rng.js";

/** Resilience mitigation fraction for a firm (process capability + T_emp), capped. */
export function resilienceMitigation(firm: FirmState, c: Config): number {
  const h = c.shocks.resilience_halfsat;
  const fromProcess = c.shocks.resilience_process_k * (firm.process / (firm.process + h));
  const fromEmp = c.shocks.resilience_temp_k * (firm.T_emp / (firm.T_emp + h));
  return Math.min(c.shocks.max_mitigation, fromProcess + fromEmp);
}

/** Roll the shock timeline (§9.1). Deterministic given the base seed. */
export function rollTimeline(c: Config, seed: number): ScheduledShock[] {
  const rng = new RNG(deriveSeed(seed, 0, 777));
  const out: ScheduledShock[] = [];
  let seq = 0;
  for (const t of c.shocks.types) {
    for (let r = t.earliest_round; r <= t.latest_round; r++) {
      if (rng.bool(t.prob_per_round)) {
        out.push({
          id: `s_${t.id}_${seq++}`,
          type_id: t.id,
          kind: t.kind,
          target: t.target,
          round: r,
          magnitude: Math.max(0, rng.normal(t.magnitude_mean, t.magnitude_sd)),
          signaling: t.signaling,
          resilience_mitigated: t.resilience_mitigated,
          duration: t.duration,
          locked: false,
          fired: false,
        });
      }
    }
  }
  return out;
}

export interface ShockOutcome {
  perFirm: Map<FirmId, ShockEffect>;
  segmentDemandMultiplier: Map<SegmentId, number>;
  events: string[];
}

/**
 * Evaluate timed/triggered shocks and endogenous rules for the current round.
 * Mutates `world` for fired flags and antitrust agreement constraints. Returns
 * per-firm effects (applied in §13 steps 6–9) and segment demand multipliers.
 */
export function computeShockEffects(world: WorldState, c: Config, coordinationUnits: number): ShockOutcome {
  const round = world.round;
  const rng = new RNG(deriveSeed(world.seed, round, 13));
  const activeFirms = world.firms.filter((f) => f.status === "active");
  const perFirm = new Map<FirmId, ShockEffect>();
  for (const f of activeFirms) perFirm.set(f.id, { firm_id: f.id, cost_multiplier: 1, capacity_multiplier: 1, cash_hit: 0 });
  const segMult = new Map<SegmentId, number>(world.segments.map((s) => [s.id, 1]));
  const events: string[] = [];

  // Gather shocks active this round: scheduled (within [round, round+duration)) + live triggers.
  const active: { kind: ScheduledShock["kind"]; target: SegmentId | "all"; magnitude: number; resilience: boolean; label: string }[] = [];
  for (const s of world.shock_timeline) {
    const isActive = round >= s.round && round < s.round + s.duration;
    if (!isActive) continue;
    if (round === s.round && !s.fired) {
      s.fired = true;
      events.push(`SHOCK fired: ${s.type_id} (${s.kind}, mag ${s.magnitude.toFixed(2)}, ${s.signaling})`);
    }
    active.push({ kind: s.kind, target: s.target, magnitude: s.magnitude, resilience: s.resilience_mitigated, label: s.type_id });
  }
  for (const typeId of world.live_triggers) {
    const t = c.shocks.types.find((x) => x.id === typeId);
    if (!t) continue;
    active.push({ kind: t.kind, target: t.target, magnitude: t.magnitude_mean, resilience: t.resilience_mitigated, label: `${typeId}(live)` });
    events.push(`SHOCK live-triggered: ${typeId}`);
  }

  // Apply effects.
  for (const s of active) {
    if (s.kind === "demand_drop" || s.kind === "demand_boost") {
      const factor = s.kind === "demand_drop" ? 1 - s.magnitude : 1 + s.magnitude;
      for (const seg of world.segments) {
        if (s.target === "all" || s.target === seg.id) segMult.set(seg.id, (segMult.get(seg.id) ?? 1) * factor);
      }
      continue;
    }
    for (const f of activeFirms) {
      const eff = perFirm.get(f.id)!;
      const mit = s.resilience ? resilienceMitigation(f, c) : 0;
      const m = s.magnitude * (1 - mit);
      if (s.kind === "cost_spike") eff.cost_multiplier *= 1 + m;
      else if (s.kind === "capacity_hit") eff.capacity_multiplier *= Math.max(0, 1 - m);
      else if (s.kind === "cash_hit") eff.cash_hit += m * Math.max(0, f.cash);
    }
  }

  // Endogenous antitrust (§9.3, §11.4): visible coordination → investigation risk, scaled by T_gov.
  if (coordinationUnits >= c.coopetition.antitrust_coordination_threshold) {
    const implicatedAgreements = world.agreements.filter((a) => a.active && (a.template === "capacity_coordination" || a.form === "collective"));
    const implicatedFirms = [...new Set(implicatedAgreements.flatMap((a) => a.signatories))].filter((id) => world.firms.find((f) => f.id === id && f.status === "active"));
    const meanTgov = implicatedFirms.length ? implicatedFirms.reduce((acc, id) => acc + (world.firms.find((f) => f.id === id)?.T_gov ?? 0), 0) / implicatedFirms.length : 0;
    const at = c.shocks.endogenous.antitrust;
    const prob = (at.base_prob * Math.min(2, coordinationUnits / c.coopetition.antitrust_coordination_threshold)) / (1 + at.tgov_k * meanTgov);
    if (rng.bool(prob)) {
      for (const id of implicatedFirms) {
        const eff = perFirm.get(id);
        if (eff) eff.cash_hit += at.penalty_cash;
      }
      for (const a of implicatedAgreements) a.constrained_until_round = round + at.penalty_constrain_rounds;
      events.push(`ANTITRUST investigation triggered (coordination=${coordinationUnits}); ${implicatedFirms.length} firms fined, ${implicatedAgreements.length} pacts constrained`);
    }
  }

  return { perFirm, segmentDemandMultiplier: segMult, events };
}
