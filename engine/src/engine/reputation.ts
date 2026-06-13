/**
 * MOD-B10 · Reputation / credibility. A firm-level stock distinct from brand: where
 * brand moves consumers, reputation moves counterparties and capital. It grows by
 * honoring agreements (being a signatory and not defecting), decays slowly, and
 * drops sharply on a defection. Its one wired effect is a lower cost of capital
 * (a reduction to the endogenous debt spread) — investors trust predictable firms.
 *
 * (The spec also has reputation easing agreement formation and breach penalties;
 * those are left for a later pass to avoid coupling into coopetition resolution.)
 */
import type { Config, FirmDecision, FirmId, FirmState, WorldState } from "../types.js";

/** Spread reduction (in rate points) this firm earns from its reputation. 0 when off. */
export function reputationSpread(firm: FirmState, c: Config): number {
  const r = c.modules?.reputation;
  if (!r?.enabled) return 0;
  const R = firm.reputation ?? 0;
  return r.spread_reduction_max * (R / (R + r.halfsat));
}

/** Advance each firm's reputation stock from this round's agreement behavior.
 *  Mutates the (cloned) firms. A firm "defects" if it submitted a defect action. */
export function updateReputation(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config): void {
  const cfg = c.modules?.reputation;
  if (!cfg?.enabled) return;
  for (const f of world.firms) {
    if (f.status !== "active") continue;
    const defected = (decisions.get(f.id)?.agreement_actions ?? []).some((a) => a.type === "defect");
    const isSignatory = world.agreements.some((a) => a.active && a.signatories.includes(f.id));
    let R = (f.reputation ?? 0) * (1 - cfg.depreciation);
    if (defected) R -= cfg.loss_defect;
    else if (isSignatory) R += cfg.gain_honor;
    f.reputation = Math.max(0, R);
  }
}
