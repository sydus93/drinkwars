/**
 * MOD-B01 geographic expansion + MOD-B02 international markets.
 *
 * The home market is always active. With geography on, domestic regions open up;
 * with international also on, export markets open too. Each market is a separate
 * demand arena (different tastes, brand transfer, demand size) solved by the shared
 * `resolveArena`. Capacity is SPLIT across the markets a firm operates in — entering
 * a region trades home presence for reach. Export markets add an import tariff (a
 * fraction of revenue) and FX exposure (revenue converts at a moving exchange rate).
 *
 * Costs (entry, distribution, tariff) are expensed via operating opex, so the §7.2
 * finance invariants hold unchanged. FX is a deterministic mean-reverting process
 * seeded from (seed, round) so replays reproduce exactly.
 */
import type { Config, FirmDecision, FirmId, MarketConfig, SegmentId, SegmentResult, WorldState } from "../types.js";
import { RNG, deriveSeed } from "../rng.js";
import { resolveArena, type Arena, type DemandModifiers } from "./demand.js";

export interface GeoOutcome {
  perFirm: Map<FirmId, Record<SegmentId, SegmentResult>>; // aggregated across markets (by segment)
  segmentTotals: Map<SegmentId, number>;
  revenueByFirm: Map<FirmId, number>; // FX-adjusted, summed across markets
  qSoldByFirm: Map<FirmId, number>;
  distCostByFirm: Map<FirmId, number>; // distribution + tariff (→ opex)
  entryCostByFirm: Map<FirmId, number>; // one-time market-entry cost (→ opex)
  marketBreakdown: Map<FirmId, Record<string, { revenue: number; q_sold: number; entered: boolean }>>;
  events: string[];
}

/** Markets active this round: home + domestic always; export only with international on. */
export function activeMarkets(c: Config): MarketConfig[] {
  const geo = c.modules?.geography;
  if (!geo?.enabled) return [];
  const intl = !!c.modules?.international?.enabled;
  return geo.markets.filter((m) => m.kind !== "export" || intl);
}

/** Advance the FX rates for export markets (mean-reverting, deterministic). Mutates
 *  world.fx_rates. No-op unless international is on. */
export function updateFxRates(world: WorldState, c: Config): void {
  const intl = c.modules?.international;
  if (!intl?.enabled) return;
  world.fx_rates ??= {};
  const rng = new RNG(deriveSeed(world.seed, world.round, 444));
  for (const m of activeMarkets(c)) {
    if (m.kind !== "export") continue;
    const prev = world.fx_rates[m.id] ?? intl.fx_mean;
    const drift = intl.fx_speed * (intl.fx_mean - prev);
    const shock = rng.normal(0, m.fx_volatility);
    world.fx_rates[m.id] = Math.max(0.3, prev + drift + shock);
  }
}

const fxRateFor = (world: WorldState, c: Config, m: MarketConfig): number =>
  m.kind === "export" ? (world.fx_rates?.[m.id] ?? c.modules?.international?.fx_mean ?? 1) : 1;

/**
 * Resolve demand across every active market and aggregate. `sellableByFirm` is each
 * firm's total sellable supply (capacity or inventory+production); geography splits
 * it across markets by the firm's market-presence weights. Mutates firm
 * `markets_entered` (and charges entry once).
 */
export function resolveGeography(
  world: WorldState,
  decisions: Map<FirmId, FirmDecision>,
  c: Config,
  sellableByFirm: Map<FirmId, number>,
  mod: DemandModifiers,
): GeoOutcome {
  const markets = activeMarkets(c);
  const home = markets.find((m) => m.kind === "home") ?? markets[0];
  const activeFirms = world.firms.filter((f) => f.status === "active");
  const out: GeoOutcome = {
    perFirm: new Map(), segmentTotals: new Map(), revenueByFirm: new Map(), qSoldByFirm: new Map(),
    distCostByFirm: new Map(), entryCostByFirm: new Map(), marketBreakdown: new Map(), events: [],
  };
  for (const f of activeFirms) {
    out.perFirm.set(f.id, {});
    out.marketBreakdown.set(f.id, {});
  }

  // Per firm: which markets it operates in this round + the capacity-split fractions.
  const fracByFirm = new Map<FirmId, Map<string, number>>();
  for (const f of activeFirms) {
    f.markets_entered ??= ["home"];
    const weights = decisions.get(f.id)?.market_presence ?? {};
    // A positive weight on a not-yet-entered market triggers entry (one-time cost).
    for (const m of markets) {
      if (m.kind === "home") continue;
      if ((weights[m.id] ?? 0) > 0 && !f.markets_entered.includes(m.id)) {
        f.markets_entered.push(m.id);
        out.entryCostByFirm.set(f.id, (out.entryCostByFirm.get(f.id) ?? 0) + m.entry_cost);
        out.events.push(`EXPANSION: ${f.id} enters ${m.label}`);
      }
    }
    // Allocation fractions over the markets the firm operates in. Home gets weight 1
    // by default so a firm that sets no weights stays entirely at home (legacy-like).
    const operating = markets.filter((m) => m.kind === "home" || f.markets_entered.includes(m.id));
    const raw = new Map<string, number>();
    let total = 0;
    for (const m of operating) {
      const wRaw = m.kind === "home" ? (weights[m.id] ?? 1) : (weights[m.id] ?? 0);
      const w = Math.max(0, wRaw);
      raw.set(m.id, w);
      total += w;
    }
    const frac = new Map<string, number>();
    // Degenerate (all weights 0) ⇒ everything home.
    if (total <= 0) frac.set(home.id, 1);
    else for (const [id, w] of raw) frac.set(id, w / total);
    fracByFirm.set(f.id, frac);
  }

  // Solve each market and aggregate.
  for (const m of markets) {
    const fx = fxRateFor(world, c, m);
    const arena: Arena = {
      segments: world.segments.map((s) => ({ id: s.id, D: s.D * m.demand_mult, active: s.active })),
      betaMult: { p: m.beta_p_mult, q: m.beta_q_mult, b: m.beta_b_mult },
      brandMult: m.brand_transfer,
      supplyOf: (id) => (sellableByFirm.get(id) ?? 0) * (fracByFirm.get(id)?.get(m.id) ?? 0),
    };
    const res = resolveArena(activeFirms, decisions, c, arena, mod);

    for (const [segId, tot] of res.segmentTotals) out.segmentTotals.set(segId, (out.segmentTotals.get(segId) ?? 0) + tot);

    for (const f of activeFirms) {
      const segs = res.perFirm.get(f.id) ?? {};
      let mRevenueLocal = 0;
      let mQ = 0;
      const agg = out.perFirm.get(f.id)!;
      for (const [segId, r] of Object.entries(segs)) {
        mRevenueLocal += r.revenue;
        mQ += r.q_sold;
        // Aggregate this market's per-segment result into the firm's combined view.
        const prev = agg[segId];
        if (!prev) agg[segId] = { ...r, revenue: r.revenue * fx };
        else {
          prev.q_sold += r.q_sold;
          prev.q_desired += r.q_desired;
          prev.revenue += r.revenue * fx;
        }
      }
      const mRevenue = mRevenueLocal * fx; // FX conversion (home markets fx = 1)
      const tariff = m.tariff_rate * mRevenue;
      const distribution = m.distribution_cost_per_unit * mQ;
      out.revenueByFirm.set(f.id, (out.revenueByFirm.get(f.id) ?? 0) + mRevenue);
      out.qSoldByFirm.set(f.id, (out.qSoldByFirm.get(f.id) ?? 0) + mQ);
      out.distCostByFirm.set(f.id, (out.distCostByFirm.get(f.id) ?? 0) + tariff + distribution);
      out.marketBreakdown.get(f.id)![m.id] = { revenue: mRevenue, q_sold: mQ, entered: m.kind === "home" || f.markets_entered.includes(m.id) };
    }
  }

  // Recompute each aggregated segment's share against the cross-market segment total.
  for (const f of activeFirms) {
    const agg = out.perFirm.get(f.id)!;
    for (const [segId, r] of Object.entries(agg)) {
      const tot = out.segmentTotals.get(segId) ?? 0;
      r.share = tot > 1e-9 ? r.q_sold / tot : 0;
    }
  }
  return out;
}
