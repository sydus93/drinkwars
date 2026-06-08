/**
 * Strategic distinctiveness (§15.4). Each active firm-round is a vector in a
 * standardized strategy space; we compute two distinct constructs:
 *   - Mahalanobis distance to the within-round centroid (global rarity, in the
 *     whitened space so correlated levers don't double-count), and
 *   - nearest-neighbor Euclidean distance (local competitive crowding).
 * The covariance is ridge-regularized so the inverse exists at small firm counts.
 */
import type { Config, FirmDecision, FirmId, FirmState, SegmentId } from "../types.js";

const RIDGE = 0.1;

export interface StrategyVector {
  firm_id: FirmId;
  vector: number[];
}

/** The strategy-space coordinates for one firm this round (§15.4). */
export function buildStrategyVector(firm: FirmState, decision: FirmDecision | undefined, segments: SegmentId[], c: Config): number[] {
  const presence = segments.map((s) => Math.max(0, decision?.presence?.[s] ?? 0));
  const totalPresence = presence.reduce((a, b) => a + b, 0) || 1;
  const allocFrac = presence.map((p) => p / totalPresence);
  const servedPrices = segments.map((s) => decision?.price?.[s] ?? 0).filter((_, i) => presence[i] > 0);
  const meanPrice = servedPrices.length ? servedPrices.reduce((a, b) => a + b, 0) / servedPrices.length : 0;
  const equity = firm.paid_in_capital + firm.retained_earnings;
  const leverage = firm.debt / Math.max(equity, 1e-6);
  return [meanPrice, firm.cap, ...allocFrac, firm.Q, firm.B, firm.T_emp, firm.T_inv, firm.T_gov, leverage];
}

function invert(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const a = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const pv = a[col][col];
    for (let j = 0; j < 2 * n; j++) a[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row.slice(n));
}

export function computeDistinctiveness(vectors: StrategyVector[]): Map<FirmId, { mahalanobis: number; nearest_neighbor: number }> {
  const out = new Map<FirmId, { mahalanobis: number; nearest_neighbor: number }>();
  const n = vectors.length;
  if (n < 2) {
    for (const v of vectors) out.set(v.firm_id, { mahalanobis: 0, nearest_neighbor: 0 });
    return out;
  }
  const d = vectors[0].vector.length;
  const X = vectors.map((v) => v.vector);

  // Standardize each dimension within round.
  const mean = new Array(d).fill(0);
  const sd = new Array(d).fill(0);
  for (let j = 0; j < d; j++) {
    let m = 0;
    for (let i = 0; i < n; i++) m += X[i][j];
    m /= n;
    let varr = 0;
    for (let i = 0; i < n; i++) varr += (X[i][j] - m) ** 2;
    mean[j] = m;
    sd[j] = Math.sqrt(varr / n);
  }
  const Z = X.map((row) => row.map((x, j) => (sd[j] > 1e-9 ? (x - mean[j]) / sd[j] : 0)));

  // Covariance (= correlation, since standardized) with ridge regularization.
  const C: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += Z[k][i] * Z[k][j];
      C[i][j] = s / n + (i === j ? RIDGE : 0);
    }
  }
  const Cinv = invert(C);

  for (let k = 0; k < n; k++) {
    // Mahalanobis to centroid (0 in standardized space): sqrt(z^T Cinv z).
    let maha = 0;
    if (Cinv) {
      for (let i = 0; i < d; i++) {
        let acc = 0;
        for (let j = 0; j < d; j++) acc += Cinv[i][j] * Z[k][j];
        maha += Z[k][i] * acc;
      }
    } else {
      for (let i = 0; i < d; i++) maha += Z[k][i] ** 2; // fall back to Euclidean-from-centroid
    }
    maha = Math.sqrt(Math.max(0, maha));

    // Nearest-neighbor Euclidean distance in standardized space.
    let nn = Infinity;
    for (let m = 0; m < n; m++) {
      if (m === k) continue;
      let dist = 0;
      for (let j = 0; j < d; j++) dist += (Z[k][j] - Z[m][j]) ** 2;
      nn = Math.min(nn, Math.sqrt(dist));
    }
    out.set(vectors[k].firm_id, { mahalanobis: maha, nearest_neighbor: Number.isFinite(nn) ? nn : 0 });
  }
  return out;
}
