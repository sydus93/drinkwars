/**
 * MOD-A10 · Market conduct & stakeholder backlash.
 *
 * The missing teeth: a firm that DOMINATES the market and GOUGES (steep markup over unit cost)
 * — worse still on THIN QUALITY relative to the field — draws a consumer-protection fine (opex)
 * and brand erosion. Both are blunted by regulatory goodwill (T_gov) and reputation, so the firm
 * that invested in stakeholder relationships weathers scrutiny that hammers the pure
 * profit-maximizer. Computed AFTER demand (real shares/prices known), applied at finance (fine)
 * and to the Brand stock (erosion, felt next round). Off ⇒ no effect (all-off parity holds).
 */
import type { Config, FirmId, WorldState } from "../types.js";

export interface ConductOutcome {
  fineByFirm: Map<FirmId, number>; // consumer-protection fine → opex this round
  brandHitByFirm: Map<FirmId, number>; // brand erosion → subtracted from B (hits next round's demand)
  events: string[];
}

export function computeMarketConduct(
  w: WorldState,
  c: Config,
  qSoldByFirm: Map<FirmId, number>,
  revenueByFirm: Map<FirmId, number>,
): ConductOutcome {
  const out: ConductOutcome = { fineByFirm: new Map(), brandHitByFirm: new Map(), events: [] };
  const cfg = c.modules?.marketConduct;
  if (!cfg?.enabled) return out;
  const active = w.firms.filter((f) => f.status === "active");
  const totalQ = active.reduce((a, f) => a + (qSoldByFirm.get(f.id) ?? 0), 0);
  if (totalQ <= 0) return out;
  const avgQ = active.reduce((a, f) => a + f.Q, 0) / Math.max(1, active.length);

  for (const f of active) {
    const q = qSoldByFirm.get(f.id) ?? 0;
    const share = q / totalQ;
    const domExcess = Math.max(0, share - cfg.dominance_threshold);
    if (domExcess <= 0) continue; // not dominant ⇒ no scrutiny

    const avgPrice = q > 0 ? (revenueByFirm.get(f.id) ?? 0) / q : 0;
    const unit = f.unit_cost > 0 ? f.unit_cost : 1;
    const gouge = Math.max(0, avgPrice / unit - cfg.fair_markup);
    if (gouge <= 0) continue; // dominant but fairly priced ⇒ no backlash

    // Selling below the field's average quality at a steep markup reads as exploitative.
    const qPenalty = avgQ > 0 ? Math.max(0, Math.min(1, (avgQ - f.Q) / avgQ)) : 0;
    let conduct = domExcess * gouge * cfg.sensitivity * (1 + cfg.quality_weight * qPenalty);

    // Stakeholder insurance: regulatory goodwill + reputation blunt the backlash.
    const h = cfg.halfsat;
    const mit = Math.min(cfg.max_mitigation, cfg.tgov_k * (f.T_gov / (f.T_gov + h)) + cfg.rep_k * (f.reputation / (f.reputation + h)));
    conduct *= 1 - mit;
    if (conduct <= 1e-6) continue;

    const fine = Math.min(cfg.fine_cap_frac * Math.max(0, f.cash), conduct * cfg.fine_scale);
    const brandHit = Math.min(f.B, conduct * cfg.brand_scale);
    if (fine > 0) out.fineByFirm.set(f.id, fine);
    if (brandHit > 0) out.brandHitByFirm.set(f.id, brandHit);
    out.events.push(`MARKET CONDUCT: ${f.id} drew a consumer-protection penalty — a dominant position at a steep markup${qPenalty > 0.15 ? " on thin quality" : ""}`);
  }
  return out;
}
