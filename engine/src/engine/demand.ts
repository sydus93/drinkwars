/**
 * Demand engine (§5): a per-segment logit attraction model with an outside
 * option, capacity rationing, single-pass redistribution of unmet demand, and a
 * cross-segment substitution term (§5.3) that keeps a thin segment from handing
 * one firm uncontested rents.
 *
 * `presence[s]` is a non-negative weight; normalized across segments it both
 * allocates the firm's sellable supply (capAlloc = supply · allocFrac) and drives
 * the βfit utility term — so focus vs breadth is one lever, no extra machinery.
 *
 * The logit/rationing core lives in `resolveArena`, which solves ONE market given
 * its segment demand sizes, coefficient multipliers, brand-transfer multiplier,
 * and a per-firm sellable-supply allocation. `resolveDemand` is the single-market
 * (home) wrapper — its output is identical to the pre-geography engine. MOD-B01
 * geography calls `resolveArena` once per regional market and aggregates.
 */
import type { Config, FirmDecision, FirmId, FirmState, SegmentId, SegmentResult, WorldState } from "../types.js";

export interface DemandModifiers {
  /** Extra brand-equivalent stock for a firm in a segment (joint-marketing pacts, PR buzz). */
  extraBrand: (firmId: FirmId, seg: SegmentId) => number;
  /** Additive change to a segment's α this round (distress dumping). */
  segmentAlphaDelta: (seg: SegmentId) => number;
  /** Multiplier on a segment's demand size D_s (demand shocks, public-good marketing). */
  segmentDemandMultiplier: (seg: SegmentId) => number;
  /** A firm's sellable supply this round: effective capacity (legacy) or
   *  carried inventory + this-round production (inventory mode). Split across
   *  segments by the presence fractions to form each per-segment cap. */
  sellableSupply: (firmId: FirmId) => number;
  /** Additive deltas to a segment's taste coefficients (consumer drift, quality
   *  certification). All-zero ⇒ baseline coefficients. */
  segmentBetaDelta: (seg: SegmentId) => { q: number; p: number; b: number };
}

export interface DemandResult {
  perFirm: Map<FirmId, Record<SegmentId, SegmentResult>>;
  segmentTotals: Map<SegmentId, number>;
}

/** One market to solve: its (effective) segment demand sizes, per-market coefficient
 *  multipliers, brand-transfer multiplier, and each firm's sellable supply here. */
export interface Arena {
  segments: { id: SegmentId; D: number; active: boolean }[];
  betaMult: { p: number; q: number; b: number };
  brandMult: number; // brand transfer in this market (1 = home; <1 = less established)
  supplyOf: (firmId: FirmId) => number;
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

/** Solve one market. Pure given its inputs; the single-market wrapper below and the
 *  geography loop both call this so there is exactly one logit implementation. */
export function resolveArena(activeFirms: FirmState[], decisions: Map<FirmId, FirmDecision>, c: Config, arena: Arena, mod: DemandModifiers): DemandResult {
  const activeSegments = arena.segments.filter((s) => s.active);
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
    // Market coefficient multipliers + drift/quality deltas.
    const bd = mod.segmentBetaDelta(seg.id);
    const betaP = Math.max(0, sc.beta_p * arena.betaMult.p + bd.p);
    const betaQ = Math.max(0, sc.beta_q * arena.betaMult.q + bd.q);
    const betaB = Math.max(0, sc.beta_b * arena.betaMult.b + bd.b);
    const list: Cell[] = [];
    let best = -Infinity;
    for (const f of activeFirms) {
      const frac = allocFrac.get(f.id)?.get(seg.id) ?? 0;
      if (frac <= 0) continue;
      const d = decisions.get(f.id)!;
      const price = Math.max(0, d.price?.[seg.id] ?? 0);
      const brand = arena.brandMult * (f.B + mod.extraBrand(f.id, seg.id));
      const tPrice = -betaP * price;
      const tQual = betaQ * f.Q;
      const tBrand = betaB * brand;
      const tFit = sc.beta_fit * frac;
      const u = alpha + tPrice + tQual + tBrand + tFit;
      best = Math.max(best, u);
      list.push({
        firmId: f.id,
        utility: u,
        expU: Math.exp(u),
        allocFrac: frac,
        price,
        capAlloc: arena.supplyOf(f.id) * frac,
        attraction: { alpha, price: tPrice, quality: tQual, brand: betaB * arena.brandMult * f.B, fit: tFit, agreement: tBrand - betaB * arena.brandMult * f.B },
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
    let unconstrainedExpUSum = 0;
    for (const x of list) {
      const share = x.expU / denom;
      const qStar = Deff * share;
      if (qStar > x.capAlloc + 1e-9) {
        constrained.push({ cell: x, sold: x.capAlloc });
        totalUnmet += qStar - x.capAlloc;
      } else {
        unconstrained.push({ cell: x, sold: qStar, residual: x.capAlloc - qStar, share });
        unconstrainedExpUSum += x.expU;
      }
    }

    // Single-pass redistribution of the non-lost remainder to firms that still
    // have stock. Shoppers turned away from a sold-out firm re-choose by logit
    // attractiveness, with the OUTSIDE OPTION kept in the denominator — so an
    // unappealing lone survivor (e.g. priced absurdly high) attracts almost none
    // of the overflow; it goes to the outside option (lost) instead. (Weighting
    // by expU only among unconstrained firms would hand 100% to a single
    // surviving firm no matter how unattractive — the redistribution bug.)
    const redistributable = (1 - c.demand.unmet_demand_lost_fraction) * totalUnmet;
    const redistribDenom = unconstrainedExpUSum + Math.exp(u0eff);
    if (redistributable > 0 && redistribDenom > 0) {
      for (const u of unconstrained) {
        const extra = redistributable * (u.cell.expU / redistribDenom);
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

/** Single-market (home) demand — the v1 path. Builds one neutral arena over the
 *  world's active segments and solves it. Output is identical to the pre-arena engine. */
export function resolveDemand(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config, mod: DemandModifiers): DemandResult {
  const activeFirms = world.firms.filter((f) => f.status === "active");
  const arena: Arena = {
    segments: world.segments.map((s) => ({ id: s.id, D: s.D, active: s.active })),
    betaMult: { p: 1, q: 1, b: 1 },
    brandMult: 1,
    supplyOf: (id) => mod.sellableSupply(id),
  };
  return resolveArena(activeFirms, decisions, c, arena, mod);
}
