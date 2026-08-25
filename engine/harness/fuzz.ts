/**
 * Invariant fuzzer — hunts "unreal situations". Drives games under three decision
 * regimes and asserts physical/accounting invariants on every round:
 *   chaos      — a mixed field: adaptive bots, random-but-plausible humans, no-shows.
 *   adversarial— garbage inputs a buggy/malicious client could POST (NaN, negatives,
 *                strings, huge, unknown ids). The engine must neither throw nor leak
 *                a non-finite number into any result (one NaN in a logit denominator
 *                would break the market for every firm in a live class).
 * Run: npm run fuzz            (DW_MODULES=full npm run fuzz for the classroom preset)
 *      FUZZ_SEEDS=40 FUZZ_MODE=adversarial npm run fuzz
 */
import type { Config, FirmDecision, FirmState, WorldState } from "../src/types.js";
import { ADAPTIVE_LEANS, decideAdaptive, generateHiringMarket, initGame, resolveRound, roundIsScored } from "../src/index.js";
import { configWithSeed } from "./run.js";

type Mode = "chaos" | "adversarial";
const MODE = (process.env.FUZZ_MODE ?? "both") as Mode | "both";
const SEEDS = Number(process.env.FUZZ_SEEDS ?? 24);
const NF = 8;

// Tiny deterministic PRNG for the fuzzer's own choices (independent of the engine RNG).
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const GARBAGE: unknown[] = [NaN, Infinity, -Infinity, -1, -1e9, 1e12, 1e308, "abc", "12", null, undefined, {}, [], true, -0, 1e-9];

function plausible(r: () => number, f: FirmState, w: WorldState, c: Config): FirmDecision {
  const segs = w.segments.map((s) => s.id);
  const price: Record<string, number> = {}, presence: Record<string, number> = {};
  for (const s of segs) { price[s] = 1 + r() * 40; presence[s] = r() < 0.2 ? 0 : r() * 3; }
  const cash = Math.max(0, f.cash);
  const m = c.modules;
  const d: FirmDecision = {
    firm_id: f.id, price, presence,
    run_rate: r() < 0.5 ? undefined : r() * 1.2,
    invest_cap: r() < 0.5 ? 0 : r() * cash * 0.4, invest_process: r() * cash * 0.1, invest_Q: r() * cash * 0.15, invest_B: r() * cash * 0.15,
    invest_T_emp: r() * 5000, invest_T_inv: r() * 5000, invest_T_gov: r() * 5000,
    debt_draw: r() < 0.6 ? 0 : r() * 200_000, debt_repay: r() < 0.7 ? 0 : r() * f.debt, equity_raise: r() < 0.9 ? 0 : r() * 100_000, dividend: r() < 0.9 ? 0 : r() * 30_000,
    buy_info: r() < 0.2, agreement_actions: [], exit_action: null,
  };
  if (m?.prEvents?.enabled && r() < 0.3) d.pr_action = pick(r, ["festival", "collab", "viral"] as const);
  if (m?.sustainability?.enabled && r() < 0.3) d.invest_water_efficiency = r() * 20_000;
  if (m?.rndRace?.enabled && r() < 0.4) d.invest_rnd = r() * 30_000;
  if (m?.geography?.enabled && r() < 0.5) { d.market_presence = {}; for (const mk of m.geography.markets) d.market_presence[mk.id] = r() < 0.5 ? 0 : r(); }
  if (m?.verticalIntegration?.enabled && r() < 0.15) d.buy_vertical = [pick(r, m.verticalIntegration.assets).id];
  if (m?.laborMarket?.enabled && r() < 0.2) d.hire_roles = [pick(r, m.laborMarket.roles).id];
  if (m?.laborMarket?.enabled && r() < 0.1 && f.key_hires.length) d.fire_roles = [f.key_hires[0].role];
  if (m?.facilities?.enabled && r() < 0.25) d.build_facilities = [{ type: pick(r, m.facilities.types).id, location: pick(r, m.facilities.districts ?? []).id ?? "downtown" }];
  if (m?.facilities?.enabled && f.facilities?.length) {
    const fac = pick(r, f.facilities);
    if (r() < 0.2) d.maintain_facilities = { [fac.id]: r() * 5000 };
    if (r() < 0.1) d.mothball_facilities = [fac.id];
    if (r() < 0.1) d.reactivate_facilities = [fac.id];
    if (r() < 0.05) d.divest_facilities = [fac.id];
  }
  if (m?.employees?.enabled) {
    const mk = generateHiringMarket(c, w.seed, w.round);
    if (mk.length && r() < 0.35) { const cnd = pick(r, mk); d.hire_employees = [cnd.id]; if (r() < 0.5) d.hire_bids = { [cnd.id]: r() * 10_000 }; }
    if (f.employees?.length && r() < 0.1) d.fire_employees = [pick(r, f.employees).id];
    if (f.employees?.length && r() < 0.1) { const e = pick(r, f.employees); d.raise_employees = { [e.id]: e.salary * (1 + r() * 0.3) }; }
    const rivals = w.firms.filter((x) => x.id !== f.id && x.employees?.length);
    if (rivals.length && r() < 0.1) { const rv = pick(r, rivals); const e = pick(r, rv.employees!); d.poach_employees = [{ firm: rv.id, employee: e.id, offer: e.salary * 1.3 }]; }
  }
  if (m?.financialInstruments?.enabled) { if (r() < 0.15) d.draw_convertible = r() * 100_000; if (r() < 0.15) d.draw_rbf = r() * 100_000; }
  if (m?.ma?.enabled && r() < 0.1) { const t = pick(r, w.firms.filter((x) => x.id !== f.id)); if (t) d.acquisition_bid = { target: t.id, price: r() * 400_000 }; }
  if (m?.lobbying?.enabled && r() < 0.15) { d.lobby_spend = r() * 30_000; d.lobby_initiative = pick(r, m.lobbying.initiatives).id; }
  if (m?.publicGoods?.enabled && r() < 0.3) { d.public_good_contributions = {}; for (const g of m.publicGoods.goods) d.public_good_contributions[g.id] = r() * 20_000; }
  return d;
}

/** Take a plausible decision and corrupt several fields with garbage. */
function adversarial(r: () => number, f: FirmState, w: WorldState, c: Config): FirmDecision {
  const d = plausible(r, f, w, c) as unknown as Record<string, unknown>;
  const numericKeys = ["invest_cap", "invest_process", "invest_Q", "invest_B", "invest_T_emp", "invest_T_inv", "invest_T_gov", "debt_draw", "debt_repay", "equity_raise", "dividend", "run_rate", "invest_rnd", "invest_water_efficiency", "draw_convertible", "draw_rbf", "lobby_spend"];
  const n = 1 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) (d as Record<string, unknown>)[pick(r, numericKeys)] = pick(r, GARBAGE);
  // Corrupt nested records.
  const price = d.price as Record<string, unknown>; const presence = d.presence as Record<string, unknown>;
  if (r() < 0.5) price[pick(r, Object.keys(price))] = pick(r, GARBAGE);
  if (r() < 0.5) presence[pick(r, Object.keys(presence))] = pick(r, GARBAGE);
  if (r() < 0.3) price["bogus_segment"] = 12;
  if (r() < 0.2) d.price = pick(r, GARBAGE);
  if (r() < 0.2) d.presence = pick(r, GARBAGE);
  if (r() < 0.3) d.market_presence = { home: pick(r, GARBAGE), nowhere: 1 };
  if (r() < 0.3) d.market_supply = { home: pick(r, GARBAGE), nowhere: 1e9 };
  if (r() < 0.3) d.hire_bids = { nobody: pick(r, GARBAGE) };
  if (r() < 0.3) d.raise_employees = { nobody: pick(r, GARBAGE), ...(f.employees?.[0] ? { [f.employees[0].id]: pick(r, GARBAGE) } : {}) };
  if (r() < 0.3) d.maintain_facilities = { nothing: pick(r, GARBAGE), ...(f.facilities?.[0] ? { [f.facilities[0].id]: pick(r, GARBAGE) } : {}) };
  if (r() < 0.3) d.public_good_contributions = { regional_marketing: pick(r, GARBAGE), water_commons: pick(r, GARBAGE) };
  if (r() < 0.3) d.build_facilities = [{ type: "castle", location: "moon" }, { type: "taproom", location: "downtown", bid: pick(r, GARBAGE) as number }];
  if (r() < 0.3) d.acquisition_bid = { target: pick(r, [f.id, "firm_999", "", w.firms[0]?.id]), price: pick(r, GARBAGE) as number };
  if (r() < 0.3) d.poach_employees = [{ firm: "firm_999", employee: "x", offer: pick(r, GARBAGE) as number }];
  if (r() < 0.3) d.hire_employees = ["ghost"]; if (r() < 0.2) d.fire_employees = ["ghost"];
  if (r() < 0.3) d.mothball_facilities = ["ghost"]; if (r() < 0.2) d.divest_facilities = ["ghost"];
  if (r() < 0.2) d.buy_vertical = ["ghost"]; if (r() < 0.2) d.hire_roles = ["ghost"]; if (r() < 0.2) d.fire_roles = ["ghost"];
  if (r() < 0.2) d.pr_action = "riot"; if (r() < 0.2) d.lobby_initiative = "ghost";
  if (r() < 0.2) d.agreement_actions = [{ type: "form", template: "ghost", counterparties: ["firm_999"] }, { type: "accept_proposal", proposal_id: "ghost" }, { type: "defect", agreement_id: "ghost" }, pick(r, GARBAGE)];
  if (r() < 0.1) d.exit_action = { type: "voluntary", path: "invest", target_firm: "firm_999" };
  if (r() < 0.1) d.exit_action = { type: "voluntary", path: "rebuild", reposition_segment: "bogus" };
  return d as unknown as FirmDecision;
}

// ---- invariants -----------------------------------------------------------------
function walk(x: unknown, path: string, out: string[], depth = 0) {
  if (depth > 8) return;
  if (typeof x === "number") { if (!Number.isFinite(x)) out.push(`${path}=${x}`); return; }
  if (Array.isArray(x)) { x.forEach((v, i) => walk(v, `${path}[${i}]`, out, depth + 1)); return; }
  if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) walk(v, `${path}.${k}`, out, depth + 1);
}

interface Finding { key: string; detail: string; }
function check(w: WorldState, prevW: WorldState, res: ReturnType<typeof resolveRound>["result"], prevRes: ReturnType<typeof resolveRound>["result"] | null, c: Config, out: Finding[]) {
  const nonfinite: string[] = [];
  walk(res, "result", nonfinite);
  walk(w.firms, "world.firms", nonfinite);
  walk(w.segments, "world.segments", nonfinite);
  for (const p of nonfinite.slice(0, 5)) out.push({ key: "nonfinite:" + p.replace(/\[\d+\]/g, "[]").replace(/firm_\d+/g, "firm").split("=")[0], detail: `r${res.round} ${p}` });

  const bySeg = new Map<string, { share: number; q: number }>();
  for (const fr of res.firm_results) {
    const f = w.firms.find((x) => x.id === fr.firm_id)!;
    const startStatus = prevW.firms.find((x) => x.id === fr.firm_id)?.status;
    for (const [seg, sr] of Object.entries(fr.segments)) {
      if (sr.share < -1e-9 || sr.share > 1 + 1e-9) out.push({ key: "share_range", detail: `r${res.round} ${fr.firm_id} ${seg} share=${sr.share}` });
      if (sr.q_sold < -1e-6) out.push({ key: "q_sold_neg", detail: `r${res.round} ${fr.firm_id} ${seg} q=${sr.q_sold}` });
      if (sr.price < 0) out.push({ key: "price_neg", detail: `r${res.round} ${fr.firm_id} ${seg} p=${sr.price}` });
      const agg = bySeg.get(seg) ?? { share: 0, q: 0 }; agg.share += sr.share; agg.q += sr.q_sold; bySeg.set(seg, agg);
      if (startStatus !== "active" && (sr.q_sold > 1e-6 || sr.revenue > 1e-6)) out.push({ key: "dead_firm_sells", detail: `r${res.round} ${fr.firm_id} status=${startStatus} sold ${sr.q_sold}` });
    }
    if (fr.state.inventory_units < -1e-6) out.push({ key: "inventory_neg", detail: `r${res.round} ${fr.firm_id} inv=${fr.state.inventory_units}` });
    if (fr.state.cap < -1e-6) out.push({ key: "cap_neg", detail: `r${res.round} ${fr.firm_id} cap=${fr.state.cap}` });
    if (fr.state.debt < -1e-6) out.push({ key: "debt_neg", detail: `r${res.round} ${fr.firm_id} debt=${fr.state.debt}` });
    for (const k of ["Q", "B", "T_emp", "T_inv", "T_gov", "process"] as const) if ((fr.state as Record<string, number>)[k] < -1e-6) out.push({ key: `${k}_neg`, detail: `r${res.round} ${fr.firm_id} ${k}=${(fr.state as Record<string, number>)[k]}` });
    if (fr.pnl.revenue < -1e-6) out.push({ key: "revenue_neg", detail: `r${res.round} ${fr.firm_id} rev=${fr.pnl.revenue}` });
    if (fr.pnl.cogs < -1e-6) out.push({ key: "cogs_neg", detail: `r${res.round} ${fr.firm_id} cogs=${fr.pnl.cogs}` });
    if (fr.inventory && (fr.inventory.end < -1e-6 || fr.inventory.sold > fr.inventory.begin + fr.inventory.produced + 1e-6)) out.push({ key: "inventory_flow", detail: `r${res.round} ${fr.firm_id} ${JSON.stringify(fr.inventory)}` });
    if (f.employees) for (const e of f.employees) if (!(e.salary >= 0)) out.push({ key: "salary_bad", detail: `r${res.round} ${fr.firm_id} ${e.id} salary=${e.salary}` });
    if (fr.status === "active" && f.status !== "active") out.push({ key: "status_mismatch", detail: `r${res.round} ${fr.firm_id} res=${fr.status} world=${f.status}` });
    // Bridge closure: on scored rounds, bars sum to Δcumulative.
    const prev = prevRes?.firm_results.find((x) => x.firm_id === fr.firm_id);
    if (fr.scorecard_bridge && prev && fr.status === "active" && prev.status === "active") {
      const b = fr.scorecard_bridge; const sum = b.financial + b.market + b.intangible + b.stakeholder + b.terminal;
      const delta = fr.scorecard_cumulative - prev.scorecard_cumulative;
      if (Math.abs(sum - delta) > 1e-6) out.push({ key: "bridge_open", detail: `r${res.round} ${fr.firm_id} sum=${sum.toFixed(5)} delta=${delta.toFixed(5)}` });
    }
    if (fr.scored !== roundIsScored(c, res.round)) out.push({ key: "scored_flag", detail: `r${res.round} ${fr.firm_id} scored=${fr.scored}` });
    if (fr.status !== "active" && !(fr.scorecard_cumulative === prev?.scorecard_cumulative || prev == null)) { /* dead firms may freeze; informational */ }
  }
  for (const m of res.market) {
    const agg = bySeg.get(m.segment);
    if (m.active && agg && agg.share > 1 + 1e-6) out.push({ key: "share_sum_gt1", detail: `r${res.round} ${m.segment} Σshare=${agg.share.toFixed(4)}` });
    if (m.active && m.D <= 0) out.push({ key: "demand_nonpos", detail: `r${res.round} ${m.segment} D=${m.D}` });
    if (m.active && m.total_q > m.D * 1.0001 + 1) out.push({ key: "sold_gt_demand", detail: `r${res.round} ${m.segment} q=${m.total_q.toFixed(0)} D=${m.D.toFixed(0)}` });
    if (!m.active && agg && agg.q > 1e-6) out.push({ key: "sold_in_inactive_segment", detail: `r${res.round} ${m.segment} q=${agg.q}` });
  }
  const seg = w.segments.find((s) => s.id === "frontier");
  const emerge = c.segments.find((s) => s.id === "frontier")?.emerge_round ?? 0;
  if (seg && seg.active && res.round < emerge && !res.events.some((e) => /R&D|frontier|FRONTIER|emerg/i.test(e)) && !prevW.segments.find((s) => s.id === "frontier")?.active) {
    out.push({ key: "frontier_early_silent", detail: `r${res.round} frontier active before emerge_round ${emerge} with no event` });
  }
}

function runFuzz(mode: Mode, preset: string | undefined, seed: number, findings: Map<string, { n: number; ex: string; seeds: Set<number> }>, throws: string[]) {
  const c = configWithSeed(seed, { game: { n_firms: NF, n_rounds: 16 } } as never);
  const r = mulberry(seed * 7919 + (mode === "chaos" ? 1 : 2));
  let w = initGame(c);
  let prevRes: ReturnType<typeof resolveRound>["result"] | null = null;
  for (let round = 0; round < c.game.n_rounds; round++) {
    const decisions: FirmDecision[] = [];
    w.firms.forEach((f, i) => {
      if (f.status !== "active") return;
      const roll = r();
      if (mode === "chaos") {
        if (roll < 0.5) decisions.push(decideAdaptive(ADAPTIVE_LEANS[i % ADAPTIVE_LEANS.length], f, w, c));
        else if (roll < 0.85) decisions.push(plausible(r, f, w, c));
        // else no-show: omitted
      } else {
        if (roll < 0.35) decisions.push(decideAdaptive(ADAPTIVE_LEANS[i % ADAPTIVE_LEANS.length], f, w, c));
        else if (roll < 0.5) decisions.push(plausible(r, f, w, c));
        else if (roll < 0.95) decisions.push(adversarial(r, f, w, c));
      }
    });
    if (mode === "adversarial" && r() < 0.1) decisions.push({ firm_id: "firm_999" } as FirmDecision); // stranger
    if (mode === "adversarial" && r() < 0.1 && decisions.length) decisions.push(decisions[0]); // duplicate
    const prevW = w;
    let out: ReturnType<typeof resolveRound>;
    try { out = resolveRound(w, decisions, c); }
    catch (e) {
      throws.push(`${preset ?? "base"}/${mode} seed ${seed} r${round}: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
      if (process.env.FUZZ_DEBUG && !(globalThis as Record<string, unknown>).__dumpedThrow) {
        (globalThis as Record<string, unknown>).__dumpedThrow = true;
        const m = String(e instanceof Error ? e.message : e).match(/firm_\d+/)?.[0];
        console.log(`THROW-DEBUG seed ${seed} r${round} ${m}:`, JSON.stringify(decisions.filter((d) => d.firm_id === m), (k, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v)));
        const f = w.firms.find((x) => x.id === m);
        console.log("  status:", f?.status, "reentry", f?.reentry_count, "cooldown", f?.cooldown_until_round, "paid_in", f?.paid_in_capital, "re", f?.retained_earnings, "banked", f?.banked_cash, "conv", JSON.stringify(f?.convertible_note), "rbf", f?.rbf_outstanding, f?.rbf_principal, "holdings", f?.holdings?.length, "acq", f?.acquisitions_made);
        console.log("  others mentioning:", JSON.stringify(decisions.filter((d) => JSON.stringify(d).includes(m ?? "@@")).map((d) => ({ id: d.firm_id, acq: d.acquisition_bid, poach: d.poach_employees, exit: d.exit_action, agr: d.agreement_actions }))));
        console.log("  prev events:", JSON.stringify(prevRes?.events.filter((e) => e.includes(m ?? "@@"))));
        console.log("  state:", JSON.stringify({ cash: f?.cash, debt: f?.debt, ppe: f?.ppe_book, inv: f?.inventory_units, invv: f?.inventory_value, facilities: f?.facilities?.map((x) => ({ id: x.id, type: x.type, active: x.active })), employees: f?.employees?.length }));
      }
      return;
    }
    const local: Finding[] = [];
    check(out.world, prevW, out.result, prevRes, c, local);
    if (process.env.FUZZ_DEBUG && local.some((f) => f.key.startsWith("nonfinite")) && !(globalThis as Record<string, unknown>).__dumped) {
      (globalThis as Record<string, unknown>).__dumped = true;
      console.log(`DEBUG ${preset ?? "base"}/${mode} seed ${seed} r${round}:`, local.slice(0, 6).map((f) => f.detail));
      console.log(JSON.stringify(decisions, (k, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v)).slice(0, 6000));
      for (const fr of out.result.firm_results) console.log("  ", fr.firm_id, fr.status, "raw", JSON.stringify(fr.scorecard_raw), "cash", fr.state.cash, "debt", fr.state.debt, "eq", fr.state.equity, "ni", fr.pnl.net_income, "rev", fr.pnl.revenue);
    }
    for (const f of local) { const k = `${preset ?? "base"}/${mode}:${f.key}`; const cur = findings.get(k) ?? { n: 0, ex: f.detail, seeds: new Set() }; cur.n++; cur.seeds.add(seed); findings.set(k, cur); }
    w = out.world; prevRes = out.result;
  }
}

const findings = new Map<string, { n: number; ex: string; seeds: Set<number> }>();
const throws: string[] = [];
const modes: Mode[] = MODE === "both" ? ["chaos", "adversarial"] : [MODE];
const preset = process.env.DW_MODULES;
for (const mode of modes) for (let s = 1; s <= SEEDS; s++) runFuzz(mode, preset, s, findings, throws);
console.log(`fuzz ${preset ?? "base"} · ${modes.join("+")} · ${SEEDS} seeds × ${NF} firms × 16 rounds`);
if (throws.length) { console.log(`\nTHROWS (${throws.length}) — a resolve that throws blocks the round in class:`); for (const t of throws.slice(0, 12)) console.log("  " + t); }
if (findings.size === 0 && throws.length === 0) console.log("  clean — no invariant violations");
for (const [k, v] of [...findings.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k}  ×${v.n} (${v.seeds.size} seeds)  e.g. ${v.ex}`);
process.exit(findings.size || throws.length ? 1 : 0);
