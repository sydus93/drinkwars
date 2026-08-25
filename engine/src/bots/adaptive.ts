/**
 * Adaptive (best-response) archetype for the balance harness.
 *
 * Unlike the fixed archetypes, this bot re-plans each round: it forecasts its
 * own logit share in every active segment against the *current* field (rivals'
 * observed Q/B/unit_cost), grid-searches the profit-maximizing price per segment,
 * allocates capacity toward the most profitable segments (diversifying away from
 * crowded ones), invests to reinforce the segments it actually serves, and reads
 * signaled shocks to fund resilience (process + T_emp) ahead of time (§9.4).
 *
 * This is the honest test of whether a "dominant" fixed strategy is a real
 * exploit or just an artifact of bots that can't reposition — when everyone can
 * pile into a lucrative segment, crowding should erode its rents.
 */
import type { Config, FirmDecision, FirmState, PrPlayType, SegmentId, WorldState } from "../types.js";
import { invCfg } from "../engine/inventory.js";
import { firmValuation } from "../engine/finance.js";
import { generateHiringMarket } from "../engine/employees.js";
import { activeMarkets, marketDemandScale } from "../engine/geography.js";
import { facilityCapacity } from "../engine/facilities.js";

export interface Lean {
  id: string;
  bias: { Q: number; B: number; process: number; cap: number; T_emp: number; T_inv: number; T_gov: number };
  cashGuard: number;
  debtDraw: number; // fixed draw appetite when leverage room exists
}

const MARKUP_GRID = [1.3, 1.5, 1.7, 1.9, 2.1, 2.3];
const QUALITY_SEGS = new Set(["niche", "frontier"]);

function estUnit(f: FirmState, c: Config): number {
  return f.unit_cost > 0 ? f.unit_cost : c.costs.c_base * 0.85;
}
function maintenanceCapex(f: FirmState, c: Config): number {
  return (c.capacity.depreciation * f.cap) / Math.max(c.capacity.gain, 1e-6);
}

/** Pick an available, UNCROWDED parcel in a market for a bot's facility — so rivals spread
 *  across the map (and actually feel catchment) instead of all piling into one district.
 *  Prefers the district kind that suits the build, then the least-crowded lot. */
function pickLot(world: WorldState, c: Config, marketId: string, preferKind?: string): string | undefined {
  const lots = c.modules?.geography?.markets.find((m) => m.id === marketId)?.lots ?? [];
  if (!lots.length) return undefined;
  const districts = c.modules?.facilities?.districts ?? [];
  const kindOf = (id: string) => districts.find((d) => d.id === id)?.kind;
  const radius = c.modules?.facilities?.catchment?.radius ?? 5;
  const occupied = new Set<string>();
  const occPts: { x: number; y: number }[] = [];
  for (const fm of world.firms) for (const fac of fm.facilities ?? []) {
    if ((fac.market_id ?? "home") === marketId && fac.lot_id) {
      occupied.add(fac.lot_id);
      const L = lots.find((l) => l.id === fac.lot_id);
      if (L) occPts.push({ x: L.x, y: L.y });
    }
  }
  const avail = lots.filter((L) => (L.unlock_round ?? 0) <= world.round && !occupied.has(L.id));
  if (!avail.length) return undefined;
  const crowd = (L: { x: number; y: number }) => occPts.reduce((a, p) => a + Math.max(0, 1 - Math.hypot(L.x - p.x, L.y - p.y) / radius), 0);
  const score = (L: (typeof avail)[number]) => (preferKind && kindOf(L.district) === preferKind ? 1.2 : 0) - crowd(L);
  return [...avail].sort((a, b) => score(b) - score(a))[0]?.id;
}

/**
 * @param aggression difficulty signal (≈ investScale): >1 ⇒ cutthroat — undercut harder to
 *   contest share head-on rather than retreating into a comfortable differentiated niche.
 */
export function decideAdaptive(lean: Lean, f: FirmState, world: WorldState, c: Config, aggression = 1): FirmDecision {
  const activeSegs = world.segments.filter((s) => s.active);
  const allSegs = world.segments.map((s) => s.id);
  const rivals = world.firms.filter((x) => x.status === "active" && x.id !== f.id);
  const unit = estUnit(f, c);
  // Addressable demand per segment = the markets THIS firm serves (home + entered), each at
  // its own multiplier and growth — the same arena sizes the engine resolves (DW-046).
  // Before, the bot planned against the home figure alone, so in a geography game it
  // under-forecast demand ~2–3× and systematically under-built: the population ran
  // supply-short and a forced overbuilder was rewarded rather than punished.
  const geo = c.modules?.geography;
  const myMarkets = geo?.enabled ? new Set(["home", ...(f.markets_entered ?? [])]) : null;
  const openMarkets = geo?.enabled ? activeMarkets(c, world.round).filter((m) => myMarkets!.has(m.id)) : [];
  const dOf = (sw: { D: number }) => (geo?.enabled ? openMarkets.reduce((a, m) => a + sw.D * marketDemandScale(m, c, world.round), 0) : sw.D);

  // Cutthroat bots undercut harder (extra low-markup rungs) to take share head-on instead of
  // sitting comfortably above the field. Relaxed/competitive keep the standard grid.
  const grid = aggression >= 1.2 ? [1.05, 1.2, 1.35, 1.5, 1.7, 1.9, 2.1] : MARKUP_GRID;

  // Forecast best price + share + profit-density for each active segment.
  type Plan = { seg: SegmentId; price: number; share: number; profit: number };
  const plans: Plan[] = [];
  for (const sw of activeSegs) {
    const sc = c.segments.find((s) => s.id === sw.id)!;
    // Rivals' (fixed) utilities, assuming each prices at a typical markup over its unit cost.
    let rivalExpSum = 0;
    for (const r of rivals) {
      const rUnit = r.unit_cost > 0 ? r.unit_cost : c.costs.c_base * 0.85;
      const rPrice = rUnit * 1.7;
      const u = sc.alpha - sc.beta_p * rPrice + sc.beta_q * r.Q + sc.beta_b * r.B + sc.beta_fit * 0.5;
      rivalExpSum += Math.exp(u);
    }
    const outside = Math.exp(sc.U0);

    let best: Plan = { seg: sw.id, price: unit * 1.7, share: 0, profit: -Infinity };
    for (const mk of grid) {
      const price = unit * mk;
      const u = sc.alpha - sc.beta_p * price + sc.beta_q * f.Q + sc.beta_b * f.B + sc.beta_fit * 0.7;
      const share = Math.exp(u) / (Math.exp(u) + rivalExpSum + outside);
      const qest = Math.min(dOf(sw) * share, f.cap); // if I devoted full cap here
      const profit = qest * (price - unit);
      if (profit > best.profit) best = { seg: sw.id, price, share, profit };
    }
    plans.push(best);
  }

  // Allocate capacity toward profitable segments; diversify (no single seg > 70%).
  const positive = plans.filter((p) => p.profit > 0).sort((a, b) => b.profit - a.profit);
  const chosen = positive.slice(0, 3);
  const presence: Record<SegmentId, number> = {};
  const price: Record<SegmentId, number> = {};
  for (const s of allSegs) {
    presence[s] = 0;
    price[s] = 0;
  }
  if (chosen.length) {
    const totalProfit = chosen.reduce((a, p) => a + p.profit, 0);
    for (const p of chosen) {
      presence[p.seg] = Math.min(0.7, p.profit / totalProfit);
      price[p.seg] = p.price;
    }
  } else {
    // No profitable plan — sit in the least-bad active segment cheaply.
    const fallback = plans.sort((a, b) => b.profit - a.profit)[0];
    if (fallback) {
      presence[fallback.seg] = 1;
      price[fallback.seg] = fallback.price;
    }
  }

  // Run-rate (inventory mode): brew to match forecast demand, lightly shaded down
  // since the per-segment shares above assume full devotion (real fit is split). A
  // best-responder doesn't want to overbrew into spoilage. Ignored when disabled.
  const expectedSold = chosen.reduce((a, p) => {
    const sw = activeSegs.find((s) => s.id === p.seg);
    return a + (sw ? dOf(sw) * p.share : 0);
  }, 0);
  const runRate = chosen.length ? Math.max(0.3, Math.min(1, (0.85 * expectedSold) / Math.max(1, f.cap))) : 0.3;

  // ---- Retrench protocol (DW-041). The engine's covenant tracker (exit.ts) counts a
  // firm below health when cash < safety or coverage < 1; the old bot kept drawing
  // debt, building, and hiring straight through that, so one bad quarter compounded
  // (coverage-penalty interest + idle fixed costs) into certain death. A real operator
  // retrenches: stop expanding, stop drawing, repay, mothball idle plant, and raise
  // equity before the covenant breach — the classroom NPCs should model that. ----
  const distressed = f.rounds_below_health >= 1 || f.cash < 80_000;
  const effCap = f.cap + facilityCapacity(f, c, world.round);
  // Capacity appetite ramps smoothly with forecast utilization: 0 below 55%, full
  // above 90%. A binary gate at 0.85 neutered the scale-leaning personalities in the
  // base game (rank 8.0 every seed) — the ramp keeps expansion alive near the margin
  // while still refusing to build into a sagging forecast.
  const capRamp = Math.max(0, Math.min(1, (expectedSold / Math.max(1, effCap) - 0.55) / 0.35));
  const capTight = expectedSold > 0.75 * effCap; // lumpy facility builds keep a hard floor
  // Revenue forecast for sizing discretionary plays: what the chosen plan expects to
  // bill this round (used instead of cash — cash measures savings, not scale).
  const forecastRev = chosen.reduce((a, p) => {
    const sw = activeSegs.find((s) => s.id === p.seg);
    return a + (sw ? Math.min(dOf(sw) * p.share, effCap) * p.price : 0);
  }, 0);

  // How quality- vs cost-oriented is my chosen allocation?
  const totalPresence = Object.values(presence).reduce((a, b) => a + b, 0) || 1;
  const qualityWeight = chosen.filter((p) => QUALITY_SEGS.has(p.seg)).reduce((a, p) => a + presence[p.seg], 0) / totalPresence;
  const costWeight = 1 - qualityWeight;

  // Shocks now strike unannounced, so prudent rivals keep a STANDING resilience
  // posture once the mid-game shock window opens (~round 5+) rather than reacting
  // to a countdown — the §9.4 preparedness lesson without a telegraph to game.
  const shockSeason = world.round >= 5;
  const resilienceBoost = shockSeason ? 12_000 : 4_000;

  // ---- Expansion-module levers (each gated on its module; lean-differentiated so
  // the field stays heterogeneous: brand bots play PR, cost bots integrate upstream,
  // stakeholder bots fund the guild, aggressive bots expand and hunt M&A). ----
  const mods = c.modules;
  let moduleCash = 0; // up-front cash these plays commit (reserved from the budget)
  // Shared per-round module budget (~40% of cash) so plays stagger over rounds
  // rather than stacking into one round and starving core investment. Sized against
  // the REVENUE forecast, not cash — sizing against cash let a $200k-revenue firm
  // blow $190k of savings on plays in one round, then thermostat into distress
  // (measured 2-cycle, DW-041). A distressed firm makes no new plays at all.
  let moduleBudget = distressed ? 0 : Math.min(0.4 * Math.max(0, f.cash), 30_000 + 0.3 * forecastRev);
  const commit = (cost: number): boolean => {
    if (cost > moduleBudget) return false;
    moduleBudget -= cost;
    moduleCash += cost;
    return true;
  };

  // PR plays — brand-leaning bots, off cooldown, when cash comfortably covers it.
  let prAction: PrPlayType | null = null;
  if (mods?.prEvents?.enabled && lean.bias.B >= 1.2) {
    const offCooldown = f.pr_cooldown_until == null || world.round >= f.pr_cooldown_until;
    if (offCooldown && f.cash > mods.prEvents.cost * 3 && commit(mods.prEvents.cost)) {
      prAction = lean.bias.B >= 2 ? "viral" : "collab";
    }
  }

  // Water efficiency — ops/stakeholder bots keep the drought hedge funded through
  // the shock season (an unpredictable drought rewards standing efficiency).
  let waterInvest = 0;
  if (mods?.sustainability?.enabled && shockSeason && (lean.bias.process >= 1.2 || lean.bias.T_emp >= 1.4) && commit(16_000)) {
    waterInvest = 16_000;
  }

  // Public goods — civic leans contribute; aggressive leans free-ride (the lesson).
  const contributions: Record<string, number> = {};
  if (mods?.publicGoods?.enabled && lean.bias.T_gov >= 0.8 && lean.cashGuard <= 0.45 && f.cash > 160_000) {
    const want = 6_000 + (shockSeason ? 8_000 : 0);
    if (commit(want)) {
      contributions.regional_marketing = 6_000;
      if (shockSeason) contributions.water_commons = 8_000;
    }
  }

  // R&D race — quality leans chase the new category while it's still closed.
  let rndInvest = 0;
  if (mods?.rndRace?.enabled && lean.bias.Q >= 1.2 && world.segments.some((s) => !s.active) && commit(20_000)) {
    rndInvest = 20_000;
  }

  // Geography — expand into the region that suits the lean once cash allows.
  let marketPresence: Record<string, number> | undefined;
  if (mods?.geography?.enabled && world.round >= 2) {
    const markets = mods.geography.markets.filter((m) => m.kind !== "export" || mods.international?.enabled);
    const wantsCheap = lean.bias.process >= 1.8 || lean.bias.cap >= 1.8;
    const target = markets.find((m) => m.kind === "domestic" && (wantsCheap ? m.beta_p_mult > 1 : m.beta_q_mult > 1));
    if (target && f.cash > target.entry_cost + 200_000) {
      const entered = (f.markets_entered ?? ["home"]).includes(target.id);
      if (entered || commit(target.entry_cost)) {
        marketPresence = { home: 0.7, [target.id]: 0.3 };
        // Aggressive, brand-rich bots also probe an export lane when international is on.
        const exp = markets.find((m) => m.kind === "export");
        if (exp && lean.debtDraw >= 64_000 && f.B > 25 && f.cash > target.entry_cost + exp.entry_cost + 280_000) {
          const expEntered = (f.markets_entered ?? []).includes(exp.id);
          if (expEntered || commit(exp.entry_cost)) marketPresence = { home: 0.6, [target.id]: 0.25, [exp.id]: 0.15 };
        }
      }
    }
  }

  // Vertical assets — cost bots buy the supplier; regulator-minded bots buy distribution.
  const buyVertical: string[] = [];
  if (mods?.verticalIntegration?.enabled && (f.vertical_assets ?? []).length < mods.verticalIntegration.max_assets) {
    const ownedIds = new Set((f.vertical_assets ?? []).map((a) => a.id));
    const up = mods.verticalIntegration.assets.find((a) => a.type === "upstream" && !ownedIds.has(a.id));
    const down = mods.verticalIntegration.assets.find((a) => a.type === "downstream" && !ownedIds.has(a.id));
    if (up && (lean.bias.process >= 1.8 || lean.bias.cap >= 1.8) && f.cash > up.cost + 160_000 && commit(up.cost)) {
      buyVertical.push(up.id);
    } else if (down && lean.bias.T_gov >= 1.4 && f.cash > down.cost + 200_000 && commit(down.cost)) {
      buyVertical.push(down.id);
    }
  }

  // Key hires — hire the specialist matching the lean's strongest capability bias.
  const hireRoles: string[] = [];
  if (mods?.laborMarket?.enabled && f.cash > 200_000) {
    const staffed = new Set((f.key_hires ?? []).map((h) => h.role));
    const pref =
      lean.bias.Q >= Math.max(lean.bias.B, lean.bias.process) ? "head_brewer" :
      lean.bias.B >= lean.bias.process ? "sales_director" : "ops_manager";
    const role = mods.laborMarket.roles.find((r) => r.id === pref);
    if (role && !staffed.has(role.id) && commit(role.signing_bonus + role.salary)) {
      hireRoles.push(role.id);
    }
  }

  // Employees (MOD-B12) — rivals staff a small named crew from this round's market so
  // there's real talent to scout and poach in solo play. Cheap, role-matched to the
  // lean, staged to a modest target (the shared market is a menu, not a fixed pool, so
  // this never starves the human's hiring options).
  const hireEmployees: string[] = [];
  // Hire only when the payroll the roster would carry fits the firm's scale — a
  // $200k-revenue firm has no business carrying three $18k salaries (DW-041).
  const payroll = (f.employees ?? []).reduce((a, e) => a + e.salary, 0);
  if (mods?.employees?.enabled && f.cash > 100_000 && payroll < 0.12 * forecastRev) {
    const have = (f.employees ?? []).length;
    const target = Math.min(lean.debtDraw >= 64_000 ? 3 : 2, mods.employees.max_employees);
    if (have < target) {
      const prefStock = lean.bias.Q >= Math.max(lean.bias.B, lean.bias.process) ? "Q" : lean.bias.B >= lean.bias.process ? "B" : "process";
      const market = generateHiringMarket(c, world.seed, world.round).filter((cnd) => cnd.salary <= 0.2 * Math.max(0, f.cash));
      const byRole = market.filter((cnd) => mods.employees!.roles.find((r) => r.id === cnd.role)?.primary_stock === prefStock);
      const pick = byRole[0] ?? [...market].sort((a, b) => a.salary - b.salary)[0];
      if (pick && commit(pick.salary)) hireEmployees.push(pick.id);
    }
  }

  // Facilities (MOD-B11) — rivals put real assets on the city map and now SPREAD: each new site
  // goes to the operating market where the bot has the fewest sites (branch out across cities)
  // and onto an UNCROWDED parcel (so they don't all stack one district + they feel catchment).
  const buildFacilities: { type: string; location?: string; market?: string; lot?: string }[] = [];
  if (mods?.facilities?.enabled) {
    const have = (f.facilities ?? []).length;
    const districts = mods.facilities.districts ?? [];
    const typeById = (id: string) => mods.facilities!.types.find((t) => t.id === id);
    const facCountIn = (m?: string) => (f.facilities ?? []).filter((x) => (x.market_id ?? "home") === (m ?? "home")).length;
    // Operating markets (home + entered + this round's expansion targets); pick the emptiest.
    const operating: (string | undefined)[] = mods.geography?.enabled
      ? Array.from(new Set(["home", ...(f.markets_entered ?? []), ...Object.keys(marketPresence ?? {})]))
      : [undefined];
    const facMarket = [...operating].sort((a, b) => facCountIn(a) - facCountIn(b))[0];
    // Brand-leaning bots favor a downtown taproom (brand draw) once they have a base; otherwise a
    // production brewery in the cheap industrial yards.
    const wantTaproom = lean.bias.B >= 1.2 && have >= 1;
    const buildType = have === 0 ? typeById("brewery_small") ?? mods.facilities.types[0]
      : wantTaproom ? typeById("taproom")
      : typeById("brewery_large") ?? typeById("brewery_small");
    const preferKind = buildType?.id === "taproom" ? "downtown" : "industrial";
    // Pace + reach: a site by r1, a second by r3, then aggressive/scale bots keep expanding.
    const target = lean.debtDraw >= 64_000 || lean.bias.cap >= 1.6 ? 5 : 3;
    const ready = have === 0 ? world.round >= 1 : have === 1 ? world.round >= 3 : world.round >= 5 && world.round % 2 === 1;
    // Capacity discipline (DW-041): after the first site, expand only into demand the
    // forecast supports — a plant built while utilization sags is a stranded asset.
    const demandOk = have === 0 || capTight;
    if (buildType && have < target && ready && demandOk && !distressed && f.cash > buildType.base_cost + 120_000) {
      const lot = mods.geography?.enabled ? pickLot(world, c, facMarket ?? "home", preferKind) : undefined;
      // With geography on, only build if we found a real parcel (lands on the map + feels catchment).
      if (!mods.geography?.enabled || lot) {
        buildFacilities.push({ type: buildType.id, market: facMarket, lot, location: mods.geography?.enabled ? undefined : districts.find((d) => d.kind === preferKind)?.id });
        moduleCash += buildType.base_cost;
      }
    }
  }

  // Revenue financing — a cash-poor but levered-tolerant bot grabs a lifeline.
  let drawRbf = 0;
  if (mods?.financialInstruments?.enabled && f.cash < 60_000 && (f.rbf_outstanding ?? 0) <= 0 && lean.cashGuard >= 0.4) {
    drawRbf = 80_000;
  }

  // M&A — the aggressive lean bids on a distressed rival at a fair-value price.
  let acquisitionBid: { target: string; price: number } | null = null;
  if (mods?.ma?.enabled && lean.debtDraw >= 64_000 && (f.acquisitions_made ?? 0) < mods.ma.max_acquisitions) {
    const prey = rivals
      .filter((r) => r.rounds_below_health >= mods.ma!.min_distress_rounds && r.cash < c.scoring.cash_safety_threshold)
      .sort((a, b) => a.cash - b.cash)[0];
    if (prey) {
      const price = Math.max(20_000, (mods.ma.min_price_fraction + 0.1) * Math.max(0, firmValuation(prey, c)));
      if (f.cash > price + 120_000) acquisitionBid = { target: prey.id, price };
    }
  }

  // Lobbying (MOD-A09) — government-relations-leaning bots push the regulation that
  // suits their lean; a quality leader wants quality standards, a brand-light cost
  // leader wants ad limits, otherwise craft promotion grows the premium segment.
  let lobbySpend = 0;
  let lobbyInitiative: string | null = null;
  if (mods?.lobbying?.enabled && lean.bias.T_gov >= 1.4 && mods.lobbying.initiatives.length && f.cash > 120_000 && commit(16_000)) {
    const wantId =
      lean.bias.Q >= 1.4 ? "quality_standards" :
      lean.bias.B <= 0.6 ? "ad_restrictions" : "craft_promotion";
    const init = mods.lobbying.initiatives.find((i) => i.id === wantId) ?? mods.lobbying.initiatives[0];
    lobbyInitiative = init.id;
    lobbySpend = 16_000;
  }

  const base = 26_000;
  let spend = {
    Q: base * lean.bias.Q * qualityWeight,
    B: base * lean.bias.B * qualityWeight,
    process: base * lean.bias.process * (0.4 + costWeight) + resilienceBoost,
    // Generic capacity gets the same discipline as facilities: expansion scales with
    // how hard the forecast presses on installed capacity; maintenance always funded.
    cap: base * lean.bias.cap * costWeight * capRamp + maintenanceCapex(f, c),
    T_emp: base * lean.bias.T_emp * 0.5 + resilienceBoost * 0.5,
    T_inv: base * lean.bias.T_inv * 0.4,
    T_gov: base * lean.bias.T_gov * 0.4,
  };

  // ---- Retrench actions (DW-041): deleverage, shed idle plant and payroll, and as
  // a last resort raise equity — the moves the covenant runway exists to allow. ----
  let debtRepay = 0;
  let equityRaise = 0;
  let bufferDraw = 0;
  const mothball: string[] = [];
  const reactivate: string[] = [];
  const fireEmployees: string[] = [];
  const equity = f.paid_in_capital + f.retained_earnings;
  // Treasury: rebuild the cash buffer BEFORE the covenant tracker (and the M&A prey
  // filter, both keyed on cash < safety) start counting rounds — lean cash with sound
  // coverage is refinanceable, and sitting on an empty tank made viable firms
  // permanent acquisition prey (30 of 47 removals were takeovers, DW-041).
  if (f.cash < 150_000) {
    if (f.debt / Math.max(equity, 1e-6) < 1.0) bufferDraw = 120_000;
    else equityRaise = 120_000; // dilution beats being counted distressed
  }
  if (distressed) {
    if (f.debt > 0 && f.cash > 160_000) debtRepay = Math.min(f.debt, 0.25 * (f.cash - 160_000));
    if (f.cash < 60_000) equityRaise = Math.max(equityRaise, 150_000); // dilution beats a covenant breach
    // Mothball the worst-condition active facility while capacity far outruns demand
    // (keep at least one site online). No fixed cost, no capacity, reversible.
    const active = (f.facilities ?? []).filter((x) => x.active && world.round >= x.online_round);
    if (active.length > 1 && expectedSold < 0.6 * effCap) {
      mothball.push([...active].sort((a, b) => a.condition - b.condition)[0].id);
    }
    // Payroll discipline: one hire per round goes when the roster outruns the firm
    // (weakest skill first) — salaries are the stickiest opex line in the stack.
    const emps = f.employees ?? [];
    if (emps.length > 1) fireEmployees.push([...emps].sort((a, b) => a.skill - b.skill)[0].id);
  } else {
    // Even healthy, shed the weakest hire when payroll has outrun the revenue base.
    const emps = f.employees ?? [];
    if (emps.length > 1 && payroll > 0.18 * forecastRev) {
      fireEmployees.push([...emps].sort((a, b) => a.skill - b.skill)[0].id);
    }
    // Recovered: bring mothballed plant back once the forecast presses on capacity.
    const dormant = (f.facilities ?? []).filter((x) => !x.active);
    if (dormant.length && capTight) reactivate.push(dormant[0].id);
  }

  // Solvency guard. With inventory enabled, brewing is paid in cash up front
  // (recovered as COGS only when sold), so reserve that production bill before
  // committing the rest of the cash to discretionary investment.
  const total = Object.values(spend).reduce((a, b) => a + b, 0);
  // Draw ceiling 0.5×max (leverage 1.5): the old 0.7× let the levered leans ride at
  // 2.1× where one soft quarter trips the coverage-penalty spread and the interest
  // bill compounds into the covenant (the measured DW-041 death spiral).
  const drawRoom = !distressed && f.debt / Math.max(equity, 1e-6) < c.finance.max_leverage * 0.5;
  const draw = drawRoom ? lean.debtDraw : 0; // bufferDraw stays OUT of the invest budget — it refills the tank
  // Working-capital reserve for the brew bill (inventory mode pays production up front and
  // recovers it as COGS when sold). The FULL bill is reserved deliberately. Known cost
  // (DW-046 audit): leans whose guard × cash never clears the bill invest nothing and decay
  // into cash-rich zombies (Q 1 / B 1 / cap 17k on $500k by r10). Every cheaper reserve
  // tried — 35% of the bill, bill net of forecast revenue, bill paid from unguarded cash
  // first, a 6%-of-cash maintenance floor — was measured to cut full-preset survival from
  // 75% to 50–62% and push HHI past 0.3: the spending room feeds the winner-take-all
  // spiral. Fixing zombies means re-balancing the leans, not the reserve — post-semester.
  const prodReserve = invCfg(c).enabled ? runRate * Math.max(0, f.cap) * unit : 0;
  const guard = distressed ? lean.cashGuard * 0.5 : lean.cashGuard; // half rations under distress
  // NOTE (DW-042): reserves subtract from the guarded budget, not from cash before
  // guarding — tried the latter, and the extra spending room it opened dropped the
  // adaptive field's survival 22 points. The over-reservation IS the safety margin.
  const budget = Math.max(0, Math.max(0, f.cash) * guard - prodReserve - moduleCash - debtRepay) + draw + drawRbf; // treasury raises refill the tank, not the invest budget
  if (total > budget && total > 0) {
    const scale = budget / total;
    spend = Object.fromEntries(Object.entries(spend).map(([k, v]) => [k, v * scale])) as typeof spend;
  }

  // Mutual-consent coopetition: answer alliance overtures addressed to this firm.
  // Deterministic, explainable policy — supply sharing is a plain mutual cost cut
  // (accept); joint marketing pools brand (accept); capacity coordination only makes
  // sense following a BIGGER rival (their restraint props prices more than ours binds
  // us) and is antitrust bait besides, so accept only when the proposer out-scales us.
  // Open renegotiation calls get the same treatment: a cost-cutting or unchanged deal
  // is accepted, anything else rejected — so a human's call never hangs on an NPC.
  const agreementActions: FirmDecision["agreement_actions"] = [];
  for (const p of world.pending_agreements ?? []) {
    if (!p.counterparties.includes(f.id) || p.accepted.includes(f.id)) continue;
    const proposer = world.firms.find((x) => x.id === p.proposer);
    const templateOk = p.template !== "capacity_coordination" || (proposer ? proposer.cap > f.cap : false);
    // Terms check: don't sign a deal whose formation cost falls mostly on us (a
    // cost_split below 0.4 pushes >60% of the tab onto the counterparties).
    const termsOk = (p.terms?.cost_split ?? 1) >= 0.4;
    const ok = templateOk && termsOk;
    agreementActions.push({ type: ok ? "accept_proposal" : "decline_proposal", proposal_id: p.id });
  }
  for (const ag of world.agreements) {
    if (!ag.active || !ag.renegotiation || !ag.signatories.includes(f.id) || ag.renegotiation.caller === f.id) continue;
    const to = ag.renegotiation.proposed_template ?? ag.template;
    const ok = to === "supply_share" || to === ag.template;
    agreementActions.push({ type: "renegotiate_response", agreement_id: ag.id, response: ok ? "accept" : "reject" });
  }

  return {
    firm_id: f.id,
    price,
    presence,
    run_rate: runRate,
    invest_cap: spend.cap,
    invest_process: spend.process,
    invest_Q: spend.Q,
    invest_B: spend.B,
    invest_T_emp: spend.T_emp,
    invest_T_inv: spend.T_inv,
    invest_T_gov: spend.T_gov,
    debt_draw: draw + bufferDraw,
    debt_repay: debtRepay,
    equity_raise: equityRaise,
    dividend: 0,
    buy_info: shockSeason,
    agreement_actions: agreementActions,
    exit_action: null,
    // Expansion-module levers (undefined/empty when the module is off).
    pr_action: prAction,
    invest_water_efficiency: waterInvest,
    public_good_contributions: contributions,
    invest_rnd: rndInvest,
    market_presence: marketPresence,
    buy_vertical: buyVertical,
    hire_roles: hireRoles,
    hire_employees: hireEmployees,
    fire_employees: fireEmployees,
    build_facilities: buildFacilities,
    mothball_facilities: mothball,
    reactivate_facilities: reactivate,
    draw_rbf: drawRbf,
    acquisition_bid: acquisitionBid,
    lobby_spend: lobbySpend,
    lobby_initiative: lobbyInitiative,
  };
}

/** Eight distinct adaptive "personalities" — all best-respond, but with different
 *  investment leanings and risk appetite, so the dominant-strategy detector is
 *  meaningful (distinct strategies) while every agent can reposition. */
export const ADAPTIVE_LEANS: Lean[] = [
  { id: "ad_generalist", bias: { Q: 1, B: 1, process: 1, cap: 1, T_emp: 1, T_inv: 1, T_gov: 1 }, cashGuard: 0.4, debtDraw: 0 },
  { id: "ad_quality", bias: { Q: 2.2, B: 1.2, process: 0.6, cap: 0.6, T_emp: 0.6, T_inv: 0.5, T_gov: 0.5 }, cashGuard: 0.4, debtDraw: 0 },
  { id: "ad_cost", bias: { Q: 0.4, B: 0.4, process: 2.2, cap: 1.8, T_emp: 1.0, T_inv: 0.5, T_gov: 0.5 }, cashGuard: 0.5, debtDraw: 32_000 },
  { id: "ad_brand", bias: { Q: 0.8, B: 2.4, process: 0.6, cap: 0.7, T_emp: 0.6, T_inv: 0.5, T_gov: 0.5 }, cashGuard: 0.4, debtDraw: 0 },
  { id: "ad_stakeholder", bias: { Q: 0.8, B: 0.8, process: 1.2, cap: 0.8, T_emp: 2.0, T_inv: 1.6, T_gov: 1.6 }, cashGuard: 0.4, debtDraw: 0 },
  { id: "ad_aggressive", bias: { Q: 1.2, B: 1.2, process: 1.2, cap: 2.0, T_emp: 0.6, T_inv: 0.6, T_gov: 0.4 }, cashGuard: 0.6, debtDraw: 64_000 },
  { id: "ad_lean_ops", bias: { Q: 0.6, B: 0.6, process: 1.8, cap: 1.0, T_emp: 1.4, T_inv: 0.6, T_gov: 0.6 }, cashGuard: 0.35, debtDraw: 0 },
  // cashGuard 0.25→0.32 (DW-041): at 0.25 this lean chronically under-invested in
  // module games and finished below the fixed-cost floor — cautious, not comatose.
  { id: "ad_conservative", bias: { Q: 0.8, B: 0.8, process: 0.8, cap: 0.7, T_emp: 0.8, T_inv: 0.8, T_gov: 0.8 }, cashGuard: 0.32, debtDraw: 0 },
];
