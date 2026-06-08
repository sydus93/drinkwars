/**
 * Demand engine (§5): a per-segment logit attraction model with an outside
 * option, capacity rationing, single-pass redistribution of unmet demand, and a
 * cross-segment substitution term (§5.3) that keeps a thin segment from handing
 * one firm uncontested rents.
 *
 * `presence[s]` is a non-negative weight; normalized across segments it both
 * allocates the firm's capacity (capAlloc = effectiveCap · allocFrac) and drives
 * the βfit utility term — so focus vs breadth is one lever, no extra machinery.
 */
import type { Config, FirmDecision, FirmId, SegmentId, SegmentResult, WorldState } from "../types.js";

export interface DemandModifiers {
  /** Extra brand-equivalent stock for a firm in a segment (joint-marketing pacts). */
  extraBrand: (firmId: FirmId, seg: SegmentId) => number;
  /** Additive change to a segment's α this round (distress dumping). */
  segmentAlphaDelta: (seg: SegmentId) => number;
  /** Multiplier on a segment's demand size D_s (demand shocks). */
  segmentDemandMultiplier: (seg: SegmentId) => number;
  /** A firm's effective capacity this round (after capacity shocks + coordination restraint). */
  effectiveCap: (firmId: FirmId) => number;
}

export interface DemandResult {
  perFirm: Map<FirmId, Record<SegmentId, SegmentResult>>;
  segmentTotals: Map<SegmentId, number>;
}

interface Cell {
  firmId: FirmId;
  utility: number;
  expU: number;
  allocFrac: number;
  price: number;
  capAlloc: number;
  attraction: SegmentResult["attraction"];
}

export function resolveDemand(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config, mod: DemandModifiers): DemandResult {
  const activeFirms = world.firms.filter((f) => f.status === "active");
  const activeSegments = world.segments.filter((s) => s.active);
  const segConfig = new Map(c.segments.map((s) => [s.id, s]));

  // Precompute capacity-allocation fractions per firm (normalized presence).
  const allocFrac = new Map<FirmId, Map<SegmentId, number>>();
  for (const f of activeFirms) {
    const d = decisions.get(f.id);
    const raw = new Map<SegmentId, number>();
    let total = 0;
    for (const s of activeSegments) {
      const p = Math.max(0, d?.presence?.[s.id] ?? 0);
      raw.set(s.id, p);
      total += p;
    }
    const frac = new Map<SegmentId, number>();
    for (const s of activeSegments) frac.set(s.id, total > 0 ? (raw.get(s.id) ?? 0) / total : 0);
    allocFrac.set(f.id, frac);
  }

  // Pass 1: utilities and per-segment best utility (for the substitution term).
  const cells = new Map<SegmentId, Cell[]>();
  const bestU = new Map<SegmentId, number>();
  for (const seg of activeSegments) {
    const sc = segConfig.get(seg.id)!;
    const alpha = sc.alpha + mod.segmentAlphaDelta(seg.id);
    const list: Cell[] = [];
    let best = -Infinity;
    for (const f of activeFirms) {
      const frac = allocFrac.get(f.id)?.get(seg.id) ?? 0;
      if (frac <= 0) continue;
      const d = decisions.get(f.id)!;
      const price = Math.max(0, d.price?.[seg.id] ?? 0);
      const extraBrand = mod.extraBrand(f.id, seg.id);
      const tPrice = -sc.beta_p * price;
      const tQual = sc.beta_q * f.Q;
      const tBrand = sc.beta_b * (f.B + extraBrand);
      const tFit = sc.beta_fit * frac;
      const u = alpha + tPrice + tQual + tBrand + tFit;
      best = Math.max(best, u);
      list.push({
        firmId: f.id,
        utility: u,
        expU: Math.exp(u),
        allocFrac: frac,
        price,
        capAlloc: mod.effectiveCap(f.id) * frac,
        attraction: { alpha, price: tPrice, quality: tQual, brand: sc.beta_b * f.B, fit: tFit, agreement: sc.beta_b * extraBrand },
      });
    }
    cells.set(seg.id, list);
    bestU.set(seg.id, best);
  }

  // Pass 2: shares with substitution-adjusted outside option, then rationing.
  const perFirm = new Map<FirmId, Record<SegmentId, SegmentResult>>();
  const segmentTotals = new Map<SegmentId, number>();
  for (const f of activeFirms) perFirm.set(f.id, {});

  for (const seg of activeSegments) {
    const sc = segConfig.get(seg.id)!;
    const list = cells.get(seg.id)!;
    // Cross-segment substitution: a more attractive neighbor raises this segment's outside option.
    let neighborBest = 0;
    for (const other of activeSegments) {
      if (other.id === seg.id) continue;
      const b = bestU.get(other.id);
      if (b !== undefined && b > neighborBest) neighborBest = b;
    }
    const u0eff = sc.U0 + c.demand.cross_segment_substitution * neighborBest;
    const denom = list.reduce((acc, x) => acc + x.expU, 0) + Math.exp(u0eff);
    const Deff = seg.D * mod.segmentDemandMultiplier(seg.id);

    // Desired quantities and capacity split.
    const constrained: { cell: Cell; sold: number }[] = [];
    const unconstrained: { cell: Cell; sold: number; residual: number; share: number }[] = [];
    let totalUnmet = 0;
    let unconstrainedShareSum = 0;
    for (const x of list) {
      const share = x.expU / denom;
      const qStar = Deff * share;
      if (qStar > x.capAlloc + 1e-9) {
        constrained.push({ cell: x, sold: x.capAlloc });
        totalUnmet += qStar - x.capAlloc;
      } else {
        unconstrained.push({ cell: x, sold: qStar, residual: x.capAlloc - qStar, share });
        unconstrainedShareSum += share;
      }
    }

    // Single-pass redistribution of the non-lost remainder to unconstrained firms.
    const redistributable = (1 - c.demand.unmet_demand_lost_fraction) * totalUnmet;
    if (redistributable > 0 && unconstrainedShareSum > 0) {
      for (const u of unconstrained) {
        const extra = redistributable * (u.share / unconstrainedShareSum);
        u.sold += Math.min(extra, u.residual); // overflow beyond residual capacity is lost
      }
    }

    // Emit results.
    let total = 0;
    const write = (x: Cell, sold: number, share: number) => {
      const result: SegmentResult = {
        price: x.price,
        share,
        q_desired: Deff * share,
        q_sold: Math.max(0, sold),
        revenue: x.price * Math.max(0, sold),
        utility: x.utility,
        attraction: x.attraction,
      };
      perFirm.get(x.firmId)![seg.id] = result;
      total += result.q_sold;
    };
    for (const c2 of constrained) write(c2.cell, c2.sold, c2.cell.expU / denom);
    for (const u of unconstrained) write(u.cell, u.sold, u.share);
    segmentTotals.set(seg.id, total);
  }

  return { perFirm, segmentTotals };
}
