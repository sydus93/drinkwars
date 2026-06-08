/**
 * Scoring (§12): a sustained balanced scorecard. Each component is normalized
 * within round across active firms, then accumulated (round-average or AUC) so
 * the headline metric rewards sustained advantage and kills the end-game
 * liquidation exploit (§12.1). Within-segment share is summed across segments, so
 * a defensible niche lead counts comparably to mass share.
 */
import type { Config, FirmId, FirmState } from "../types.js";

export interface ScoreSnapshot {
  firm_id: FirmId;
  net_income: number;
  invested_capital: number; // debt + equity
  coverage: number;
  leverage: number;
  cash: number;
  shareSum: number;
  Q: number;
  B: number;
  T_emp: number;
  T_inv: number;
  T_gov: number;
}

export interface ScoreResult {
  raw: { financial: number; market: number; intangible: number; stakeholder: number };
  norm: { financial: number; market: number; intangible: number; stakeholder: number };
  cumulative: number;
}

const EPS = 1e-6;

function normalizeWithin(values: number[], mode: Config["scoring"]["normalization"]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  if (mode === "percentile_within_round") {
    // Rank → centered percentile in [-1, 1].
    const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const out = new Array(n).fill(0);
    order.forEach(([, idx], rank) => {
      out[idx] = (rank / (n - 1)) * 2 - 1;
    });
    return out;
  }
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (sd < EPS) return values.map(() => 0);
  return values.map((v) => (v - mean) / sd);
}

/**
 * Score one round. Mutates each active firm's running accumulator and returns the
 * per-firm raw + normalized components and the cumulative headline score.
 */
export function scoreRound(snaps: ScoreSnapshot[], c: Config, firmsById: Map<FirmId, FirmState>): Map<FirmId, ScoreResult> {
  const out = new Map<FirmId, ScoreResult>();
  if (snaps.length === 0) return out;

  // Raw sub-components.
  const profitability = snaps.map((s) => s.net_income / Math.max(s.invested_capital, EPS));
  const soundness = snaps.map((s) => Math.min(s.coverage / c.scoring.healthy_coverage, 1.5) - Math.max(0, s.leverage / c.scoring.healthy_leverage - 1));
  const cashResilience = snaps.map((s) => Math.min(s.cash / c.scoring.cash_safety_threshold, 3));
  const market = snaps.map((s) => s.shareSum);
  const intangible = snaps.map((s) => s.Q + s.B);
  const stakeholder = snaps.map((s) => (s.T_emp + s.T_inv + s.T_gov) / 3);

  // Within-round normalization.
  const mode = c.scoring.normalization;
  const nProfit = normalizeWithin(profitability, mode);
  const nSound = normalizeWithin(soundness, mode);
  const nCash = normalizeWithin(cashResilience, mode);
  const nMarket = normalizeWithin(market, mode);
  const nIntangible = normalizeWithin(intangible, mode);
  const nStakeholder = normalizeWithin(stakeholder, mode);

  const fb = c.scoring.financial_blend;
  const w = c.scoring.weights;

  snaps.forEach((s, i) => {
    const financialNorm = fb.profitability * nProfit[i] + fb.soundness * nSound[i] + fb.cash_resilience * nCash[i];
    const norm = { financial: financialNorm, market: nMarket[i], intangible: nIntangible[i], stakeholder: nStakeholder[i] };
    const raw = {
      financial: fb.profitability * profitability[i] + fb.soundness * soundness[i] + fb.cash_resilience * cashResilience[i],
      market: market[i],
      intangible: intangible[i],
      stakeholder: stakeholder[i],
    };

    const firm = firmsById.get(s.firm_id);
    if (firm) {
      const acc = firm.score_accum;
      // round_average and auc accumulate the same per-round contribution here;
      // the distinction is whether late rounds weight more (auc weights by round).
      const weight = c.scoring.accumulation === "auc" ? firm.score_accum.rounds + 1 : 1;
      acc.financial += norm.financial * weight;
      acc.market += norm.market * weight;
      acc.intangible += norm.intangible * weight;
      acc.stakeholder += norm.stakeholder * weight;
      acc.rounds += weight;
      const denom = Math.max(1, acc.rounds);
      const cumulative =
        w.financial * (acc.financial / denom) +
        w.market * (acc.market / denom) +
        w.intangible * (acc.intangible / denom) +
        w.stakeholder * (acc.stakeholder / denom);
      out.set(s.firm_id, { raw, norm, cumulative });
    } else {
      out.set(s.firm_id, { raw, norm, cumulative: 0 });
    }
  });

  return out;
}
