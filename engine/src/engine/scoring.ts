/**
 * Scoring (§12 + 06_scoring_layer_spec): a sustained balanced scorecard. Each
 * component is normalized within round across active firms, then accumulated
 * (round-average or AUC) so the headline metric rewards sustained advantage and
 * kills the end-game liquidation exploit (§12.1). Within-segment share is summed
 * across segments, so a defensible niche lead counts comparably to mass share.
 *
 * Scoring-layer additions (all no-ops at default config):
 *   §2 accumulation window — drop_first / tail_only rounds resolve and publish but
 *      never enter the running average (`scored: false` on the result).
 *   §3 terminal weight λ — the final round's headline blends the sustained average
 *      with that round's score. Default 0 (pure sustained).
 *   §4 penalty registry — named multipliers on one raw sub-metric each, applied in
 *      RAW space before normalization (ordering matters: penalize, then z-score, so
 *      the penalty competes on the same scale as the underlying performance).
 *   §6 bridge — this round's change in headline score decomposed into per-component
 *      bars that sum to the delta with zero residual (asserted in tests).
 */
import type { Config, FirmId, FirmState, ScoringPenalty } from "../types.js";

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
  /** Metric bag for the penalty registry (§4): numerator/denominator lookups. Only
   *  values the engine already emits — a penalty may not demand new state. */
  metrics?: Record<string, number>;
}

export interface ScoreResult {
  raw: { financial: number; market: number; intangible: number; stakeholder: number };
  norm: { financial: number; market: number; intangible: number; stakeholder: number };
  cumulative: number;
  /** §2: false ⇒ this round did not enter the accumulation window. */
  scored: boolean;
  /** §6: exactly-attributable decomposition of this round's headline delta. */
  bridge: { financial: number; market: number; intangible: number; stakeholder: number; terminal: number };
  /** §4: realized multiplier per enabled penalty (1 = no bite). */
  penalties: Record<string, number>;
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

/** §4: the realized multiplier for one penalty on one firm — 1 when disabled,
 *  unmeasurable, or clean; floors at 1 − max_bite. */
function penaltyMultiplier(p: ScoringPenalty, s: ScoreSnapshot): number {
  const num = s.metrics?.[p.numerator];
  const den = s.metrics?.[p.denominator];
  if (num == null || den == null || !(den > 0)) return 1;
  return 1 - Math.min(Math.max(num / den, 0), p.max_bite);
}

/** §2: does this round enter the accumulation window? */
export function roundIsScored(c: Config, round: number): boolean {
  const win = c.scoring.accumulation_window;
  if (!win) return true;
  if (win.tail_only != null) return round >= c.game.n_rounds - win.tail_only;
  return round >= (win.drop_first ?? 0);
}

/**
 * Score one round. Mutates each active firm's running accumulator (scored rounds
 * only) and returns the per-firm raw + normalized components, the cumulative
 * headline score, the bridge decomposition, and realized penalty multipliers.
 */
export function scoreRound(snaps: ScoreSnapshot[], c: Config, firmsById: Map<FirmId, FirmState>, round = -1): Map<FirmId, ScoreResult> {
  const out = new Map<FirmId, ScoreResult>();
  if (snaps.length === 0) return out;

  // Raw sub-components.
  const profitability = snaps.map((s) => s.net_income / Math.max(s.invested_capital, EPS));
  const soundness = snaps.map((s) => Math.min(s.coverage / c.scoring.healthy_coverage, 1.5) - Math.max(0, s.leverage / c.scoring.healthy_leverage - 1));
  const cashResilience = snaps.map((s) => Math.min(s.cash / c.scoring.cash_safety_threshold, 3));
  const market = snaps.map((s) => s.shareSum);
  const intangible = snaps.map((s) => s.Q + s.B);
  const stakeholder = snaps.map((s) => (s.T_emp + s.T_inv + s.T_gov) / 3);

  // §4: apply enabled penalties in RAW space, before normalization, and record the
  // realized multipliers per firm.
  const series: Record<ScoringPenalty["submetric"], number[]> = {
    profitability, soundness, cash_resilience: cashResilience, market, intangible, stakeholder,
  };
  const realized = snaps.map(() => ({}) as Record<string, number>);
  for (const p of c.scoring.penalties ?? []) {
    if (!p.enabled) continue;
    const arr = series[p.submetric];
    snaps.forEach((s, i) => {
      const mult = penaltyMultiplier(p, s);
      realized[i][p.id] = mult;
      arr[i] *= mult;
    });
  }

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
  const scored = round < 0 ? true : roundIsScored(c, round);
  const isFinal = round === c.game.n_rounds - 1;
  const lambda = c.scoring.terminal_weight ?? 0;

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
      const avg = () => {
        const d = Math.max(1, acc.rounds);
        return { financial: acc.financial / d, market: acc.market / d, intangible: acc.intangible / d, stakeholder: acc.stakeholder / d };
      };
      const prev = avg();
      if (scored) {
        // round_average and auc accumulate the same per-round contribution here;
        // the distinction is whether late rounds weight more (auc weights by round).
        const weight = c.scoring.accumulation === "auc" ? acc.rounds + 1 : 1;
        acc.financial += norm.financial * weight;
        acc.market += norm.market * weight;
        acc.intangible += norm.intangible * weight;
        acc.stakeholder += norm.stakeholder * weight;
        acc.rounds += weight;
      }
      const now = avg();
      const sustained = w.financial * now.financial + w.market * now.market + w.intangible * now.intangible + w.stakeholder * now.stakeholder;
      // §3 terminal blend, final round only. §6 bridge: per-component bars are the
      // weighted change in running average; the terminal bar is the blend's shift
      // away from pure sustained. Bars sum to the headline delta with no residual.
      let cumulative = sustained;
      let terminalBar = 0;
      if (isFinal && lambda > 0) {
        const finalRound = w.financial * norm.financial + w.market * norm.market + w.intangible * norm.intangible + w.stakeholder * norm.stakeholder;
        cumulative = (1 - lambda) * sustained + lambda * finalRound;
        terminalBar = lambda * (finalRound - sustained);
      }
      const bridge = {
        financial: w.financial * (now.financial - prev.financial),
        market: w.market * (now.market - prev.market),
        intangible: w.intangible * (now.intangible - prev.intangible),
        stakeholder: w.stakeholder * (now.stakeholder - prev.stakeholder),
        terminal: terminalBar,
      };
      out.set(s.firm_id, { raw, norm, cumulative, scored, bridge, penalties: realized[i] });
    } else {
      out.set(s.firm_id, { raw, norm, cumulative: 0, scored, bridge: { financial: 0, market: 0, intangible: 0, stakeholder: 0, terminal: 0 }, penalties: realized[i] });
    }
  });

  return out;
}
