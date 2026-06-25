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
import type { Config, FirmDecision, FirmId, FirmState, MarketConfig, SegmentId, SegmentResult, WorldState } from "../types.js";
import { RNG, deriveSeed } from "../rng.js";
import { resolveArena, type Arena, type DemandModifiers } from "./demand.js";

export interface GeoOutcome {
  perFirm: Map<FirmId, Record<SegmentId, SegmentResult>>; // aggregated across markets (by segment)
  segmentTotals: Map<SegmentId, number>;
  revenueByFirm: Map<FirmId, number>; // FX-adjusted, summed across markets
  qSoldByFirm: Map<FirmId, number>;
  distCostByFirm: Map<FirmId, number>; // distribution + tariff (→ opex)
  entryCostByFirm: Map<FirmId, number>; // one-time market-entry cost (→ opex)
  marketBreakdown: Map<FirmId, Record<string, { revenue: number; q_sold: number; entered: boolean; bySeg: Record<SegmentId, { q_sold: number; share: number; price: number }> }>>;
  events: string[];
}

/** Markets active this round: home + domestic always; export only with international on
 *  AND once the unlock round is reached. Passing `round` enforces the round-gate; omitting
 *  it (round === undefined) lists every market international *would* open (no round gate). */
export function activeMarkets(c: Config, round?: number): MarketConfig[] {
  const geo = c.modules?.geography;
  if (!geo?.enabled) return [];
  const intl = c.modules?.international;
  // Export ("international") markets surface only when international is enabled AND we've
  // reached export_unlock_round. So they never interfere with single-market / domestic-only
  // games, and don't appear in the interface before the "go global" phase opens.
  const exportsOpen = !!intl?.enabled && (round === undefined || round >= (intl.export_unlock_round ?? 0));
  return geo.markets.filter((m) => m.kind !== "export" || exportsOpen);
}

/** Advance the FX rates for export markets (mean-reverting, deterministic). Mutates
 *  world.fx_rates. No-op unless international is on. */
export function updateFxRates(world: WorldState, c: Config): void {
  const intl = c.modules?.international;
  if (!intl?.enabled) return;
  world.fx_rates ??= {};
  const rng = new RNG(deriveSeed(world.seed, world.round, 444));
  for (const m of activeMarkets(c, world.round)) {
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
 * Phase 2 spatial catchment. Each firm's location-attractiveness utility in a market, from how
 * crowded its online facilities are by competing footprint (rivals weighted 1, its own at
 * `self_weight`). A facility's local score = 1/(1+λ·crowd); the firm's market score is its
 * capacity-weighted average, mapped to ±beta_loc utility (blue-ocean → +, fully crowded → −).
 * Returns an empty map (no effect) unless facilities + a catchment config + market lots exist.
 */
function locUtilForMarket(market: MarketConfig, activeFirms: FirmState[], c: Config, round: number): Map<FirmId, number> {
  const out = new Map<FirmId, number>();
  const cat = c.modules?.facilities?.catchment;
  if (!c.modules?.facilities?.enabled || !cat || !market.lots?.length) return out;
  const coordOf = new Map(market.lots.map((L) => [L.id, L] as const));
  const typeCap = (id: string) => c.modules?.facilities?.types.find((t) => t.id === id)?.capacity_contribution ?? 0;
  // Every online, active, lot-placed facility operating in this market.
  const sites: { firmId: FirmId; x: number; y: number; cap: number }[] = [];
  for (const f of activeFirms) {
    for (const fac of f.facilities ?? []) {
      if (!fac.active || round < fac.online_round) continue;
      if ((fac.market_id ?? "home") !== market.id) continue;
      const L = fac.lot_id ? coordOf.get(fac.lot_id) : undefined;
      if (!L) continue; // legacy/un-sited facilities have no position → no catchment effect
      sites.push({ firmId: f.id, x: L.x, y: L.y, cap: typeCap(fac.type) });
    }
  }
  if (!sites.length) return out;
  const kernel = (d: number) => Math.max(0, 1 - d / cat.radius);
  const acc = new Map<FirmId, { wsum: number; csum: number }>();
  for (let i = 0; i < sites.length; i++) {
    const a = sites[i];
    let crowd = 0;
    for (let j = 0; j < sites.length; j++) {
      if (j === i) continue;
      const b = sites[j];
      const k = kernel(Math.hypot(a.x - b.x, a.y - b.y));
      if (k <= 0) continue;
      crowd += k * (b.firmId === a.firmId ? cat.self_weight : 1);
    }
    const score = 1 / (1 + cat.lambda * crowd);
    const w = a.cap > 0 ? a.cap : 1;
    const e = acc.get(a.firmId) ?? { wsum: 0, csum: 0 };
    e.wsum += score * w;
    e.csum += w;
    acc.set(a.firmId, e);
  }
  for (const [id, e] of acc) {
    const score = e.csum > 0 ? e.wsum / e.csum : 1;
    out.set(id, cat.beta_loc * (2 * score - 1));
  }
  return out;
}

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
  const markets = activeMarkets(c, world.round);
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

  // Phase 3 trade: where each firm PRODUCES (markets with an online active facility) — used to
  // price shipping to where it SELLS. Home counts as a production base (your original brewery).
  const facMarketsByFirm = new Map<FirmId, Set<string>>();
  for (const f of activeFirms) {
    const set = new Set<string>(["home"]);
    for (const fac of f.facilities ?? []) {
      if (fac.active && world.round >= fac.online_round) set.add(fac.market_id ?? "home");
    }
    facMarketsByFirm.set(f.id, set);
  }
  const geoOf = (id: string) => markets.find((mm) => mm.id === id)?.geo;
  const geoDist = (a?: [number, number], b?: [number, number]) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0);
  const shipRate = c.modules?.geography?.shipping?.rate_per_unit_distance ?? 0;
  // Min shipping distance to market m from any of the firm's production bases (0 if it produces in m).
  const shipDistTo = (firmId: FirmId, m: MarketConfig): number => {
    const bases = facMarketsByFirm.get(firmId);
    if (!bases || bases.has(m.id)) return 0;
    let best = Infinity;
    for (const b of bases) best = Math.min(best, geoDist(geoOf(b), m.geo));
    return Number.isFinite(best) ? best : 0;
  };

  // Solve each market and aggregate.
  for (const m of markets) {
    const fx = fxRateFor(world, c, m);
    const locUtilMap = locUtilForMarket(m, activeFirms, c, world.round);
    const arena: Arena = {
      segments: world.segments.map((s) => ({ id: s.id, D: s.D * m.demand_mult * Math.pow(1 + (m.demand_growth ?? 0), world.round), active: s.active })),
      betaMult: { p: m.beta_p_mult, q: m.beta_q_mult, b: m.beta_b_mult },
      brandMult: m.brand_transfer,
      supplyOf: (id) => (sellableByFirm.get(id) ?? 0) * (fracByFirm.get(id)?.get(m.id) ?? 0),
      locUtil: (id) => locUtilMap.get(id) ?? 0,
    };
    const res = resolveArena(activeFirms, decisions, c, arena, mod);

    for (const [segId, tot] of res.segmentTotals) out.segmentTotals.set(segId, (out.segmentTotals.get(segId) ?? 0) + tot);

    for (const f of activeFirms) {
      const segs = res.perFirm.get(f.id) ?? {};
      let mRevenueLocal = 0;
      let mQ = 0;
      const agg = out.perFirm.get(f.id)!;
      const bySeg: Record<SegmentId, { q_sold: number; share: number; price: number }> = {};
      for (const [segId, r] of Object.entries(segs)) {
        mRevenueLocal += r.revenue;
        mQ += r.q_sold;
        // Within-market per-segment standing (for the City View "who leads each segment here" panel).
        const segTot = res.segmentTotals.get(segId) ?? 0;
        bySeg[segId] = { q_sold: r.q_sold, share: segTot > 1e-9 ? r.q_sold / segTot : 0, price: r.price };
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
      // Phase 3: ship from the nearest production base to this market (0 if produced locally).
      const shipping = shipRate * mQ * shipDistTo(f.id, m);
      out.revenueByFirm.set(f.id, (out.revenueByFirm.get(f.id) ?? 0) + mRevenue);
      out.qSoldByFirm.set(f.id, (out.qSoldByFirm.get(f.id) ?? 0) + mQ);
      out.distCostByFirm.set(f.id, (out.distCostByFirm.get(f.id) ?? 0) + tariff + distribution + shipping);
      out.marketBreakdown.get(f.id)![m.id] = { revenue: mRevenue, q_sold: mQ, entered: m.kind === "home" || f.markets_entered.includes(m.id), bySeg };
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
