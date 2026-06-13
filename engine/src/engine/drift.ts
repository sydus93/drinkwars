/**
 * MOD-A08 · Consumer drift. Segment taste coefficients evolve over the season at
 * a fixed per-round rate, bounded by absolute floors/ceilings. Drift is a pure
 * function of the round index (no RNG, no stored state) so replays stay bit-clean.
 * The engine returns *deltas* relative to the config baseline; the demand step
 * adds them to the base coefficients.
 */
import type { Config, SegmentId } from "../types.js";

export interface BetaDelta {
  q: number; // additive change to beta_q
  p: number; // additive change to beta_p
  b: number; // additive change to beta_b
}

const ZERO: BetaDelta = { q: 0, p: 0, b: 0 };

/** Per-segment coefficient deltas for the current round. Empty when the module is
 *  off (every lookup then returns the zero delta ⇒ baseline demand). */
export function computeBetaDeltas(c: Config, round: number): Map<SegmentId, BetaDelta> {
  const out = new Map<SegmentId, BetaDelta>();
  const drift = c.modules?.consumerDrift;
  if (!drift?.enabled) return out;
  const segCfg = new Map(c.segments.map((s) => [s.id, s]));
  for (const t of drift.tracks) {
    const sc = segCfg.get(t.segment);
    if (!sc) continue;
    const base = t.variable === "beta_q" ? sc.beta_q : t.variable === "beta_p" ? sc.beta_p : sc.beta_b;
    let eff = base + t.delta_per_round * round;
    if (t.floor != null) eff = Math.max(t.floor, eff);
    if (t.ceiling != null) eff = Math.min(t.ceiling, eff);
    eff = Math.max(0, eff); // coefficients never go negative
    const cur = out.get(t.segment) ?? { q: 0, p: 0, b: 0 };
    const key = t.variable === "beta_q" ? "q" : t.variable === "beta_p" ? "p" : "b";
    cur[key] += eff - base;
    out.set(t.segment, cur);
  }
  return out;
}

export const zeroBetaDelta = (): BetaDelta => ({ ...ZERO });
