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
import { prodCapOf, retailOf } from "./facilities.js";

export interface GeoOutcome {
  perFirm: Map<FirmId, Record<SegmentId, SegmentResult>>; // aggregated across markets (by segment)
  segmentTotals: Map<SegmentId, number>;
  revenueByFirm: Map<FirmId, number>; // FX-adjusted, summed across markets
  qSoldByFirm: Map<FirmId, number>;
  distCostByFirm: Map<FirmId, number>; // distribution + tariff (→ opex)
  entryCostByFirm: Map<FirmId, number>; // one-time market-entry cost (→ opex)
  // Per market: revenue/units, plus the trade-flow read for the lane viz — producer capacity sited
  // here (`produced`), units sold here (`q_sold`), their balance (`net`), and any inbound shipment
  // lanes (the shortfall, from the nearest base). `consumed` == q_sold.
  marketBreakdown: Map<FirmId, Record<string, { revenue: number; q_sold: number; entered: boolean; bySeg: Record<SegmentId, { q_sold: number; share: number; price: number }>; produced: number; net: number; lanes: { origin_market: string; units: number; cost: number }[] }>>;
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
  const typeRetail = (id: string) => { const t = c.modules?.facilities?.types.find((x) => x.id === id); return t ? retailOf(t) : 0; };
  // Crowding is a RETAIL phenomenon — taprooms/shops competing for the same drinkers. Only retail
  // sites participate (a back-of-house production brewery neither draws foot traffic nor crowds it),
  // each weighted by its retail intensity. A pure-producer firm has no retail sites → no location term.
  const sites: { firmId: FirmId; x: number; y: number; cap: number }[] = [];
  for (const f of activeFirms) {
    for (const fac of f.facilities ?? []) {
      if (!fac.active || round < fac.online_round) continue;
      if ((fac.market_id ?? "home") !== market.id) continue;
      const retail = typeRetail(fac.type);
      if (retail <= 0) continue; // non-retail (pure production) facilities don't draw or crowd
      const L = fac.lot_id ? coordOf.get(fac.lot_id) : undefined;
      if (!L) continue; // legacy/un-sited facilities have no position → no catchment effect
      sites.push({ firmId: f.id, x: L.x, y: L.y, cap: retail });
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

  // Phase 3 trade. A market is a PRODUCTION BASE (a shipping origin) only where the firm has online
  // PRODUCER capacity — a taproom that brews a little produces a little, not a full base; a retail-only
  // outpost (bottle shop) is no base at all. Home is always a base (the original cap stock). Shipping
  // is priced on the SHORTFALL only: units sold in a market beyond what's produced locally there, moved
  // from the nearest other base. So a small local producer cuts (not zeros) the bill, and the
  // taproom-in-Shanghai bug — where any facility zeroed all shipping to a region — is gone.
  const condF = (cond: number) => 0.5 + 0.5 * Math.max(0, Math.min(1, cond));
  const capMultOf = (loc?: string) => c.modules?.facilities?.districts?.find((d) => d.id === loc)?.capacity_mult ?? 1;
  const typeProd = (id: string) => { const t = c.modules?.facilities?.types.find((x) => x.id === id); return t ? prodCapOf(t) : 0; };
  const localProd = new Map<FirmId, Map<string, number>>(); // (firm → market → online producer capacity there)
  const baseMarkets = new Map<FirmId, Set<string>>(); // markets the firm can ship FROM
  for (const f of activeFirms) {
    const byMk = new Map<string, number>([["home", f.cap]]); // the base cap stock sits at home
    const bases = new Set<string>(["home"]);
    for (const fac of f.facilities ?? []) {
      if (!fac.active || world.round < fac.online_round) continue;
      const p = typeProd(fac.type) * condF(fac.condition) * capMultOf(fac.location_id);
      if (p <= 0) continue; // retail-only facility: not a production base
      const mk = fac.market_id ?? "home";
      byMk.set(mk, (byMk.get(mk) ?? 0) + p);
      bases.add(mk);
    }
    localProd.set(f.id, byMk);
    baseMarkets.set(f.id, bases);
  }
  const geoOf = (id: string) => markets.find((mm) => mm.id === id)?.geo;
  const geoDist = (a?: [number, number], b?: [number, number]) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0);
  const shipRate = c.modules?.geography?.shipping?.rate_per_unit_distance ?? 0;
  // Shipping PLAN to serve `soldInM` units in market m: the shortfall beyond local production,
  // shipped from the nearest OTHER base, priced per unit × distance. Returns the lane (origin +
  // units + cost) so the UI can draw it; `cost` is identical to the prior cost-only path (replay
  // determinism preserved).
  const shipPlanTo = (firmId: FirmId, m: MarketConfig, soldInM: number): { units: number; origin: string | null; cost: number } => {
    if (shipRate <= 0 || soldInM <= 0) return { units: 0, origin: null, cost: 0 };
    const shortfall = Math.max(0, soldInM - (localProd.get(firmId)?.get(m.id) ?? 0));
    if (shortfall <= 0) return { units: 0, origin: null, cost: 0 };
    let best = Infinity;
    let origin: string | null = null;
    for (const b of baseMarkets.get(firmId) ?? []) { if (b === m.id) continue; const dd = geoDist(geoOf(b), m.geo); if (dd < best) { best = dd; origin = b; } }
    return { units: shortfall, origin, cost: shipRate * shortfall * (Number.isFinite(best) ? best : 0) };
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
      // Phase 3: ship only the shortfall not produced locally, from the nearest other base.
      const plan = shipPlanTo(f.id, m, mQ);
      const shipping = plan.cost;
      out.revenueByFirm.set(f.id, (out.revenueByFirm.get(f.id) ?? 0) + mRevenue);
      out.qSoldByFirm.set(f.id, (out.qSoldByFirm.get(f.id) ?? 0) + mQ);
      out.distCostByFirm.set(f.id, (out.distCostByFirm.get(f.id) ?? 0) + tariff + distribution + shipping);
      // Per-market trade flow for the lane viz: producer capacity sited here vs units sold here, and
      // the inbound shipment lane (shortfall from the nearest base) when local supply falls short.
      const producedHere = localProd.get(f.id)?.get(m.id) ?? 0;
      out.marketBreakdown.get(f.id)![m.id] = {
        revenue: mRevenue, q_sold: mQ, entered: m.kind === "home" || f.markets_entered.includes(m.id), bySeg,
        produced: producedHere, net: producedHere - mQ,
        lanes: plan.units > 0 && plan.origin ? [{ origin_market: plan.origin, units: plan.units, cost: plan.cost }] : [],
      };
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
