/**
 * DW-070 — itemized statements. The engine emits opex / cash-flow / debt line items beside the
 * existing totals. Additive only: nothing computed changes, and every line set sums to its total.
 * Plus DW-072 #3: the profitability ratio is clamped once debt + equity ≤ 0.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADAPTIVE_LEANS, OPEX_LINE_KEYS, PRESETS, PROFITABILITY_CLAMP, decideAdaptive, generateHiringMarket, initGame,
  projectHistory, resolveConfig, resolveRound, statementLineGaps,
} from "../src/index.js";
import { modulesOverride } from "../src/config/modules.js";
import { scoreRound, type ScoreSnapshot } from "../src/engine/scoring.js";
import type { Config, FirmDecision, FirmState, ModuleId, RoundResult, WorldState } from "../src/types.js";

const FULL = PRESETS.find((p) => p.id === "full")!.modules as ModuleId[];

/** A firm that spends on every lever it has, every round — so each line gets exercised. */
function spender(f: FirmState, w: WorldState, c: Config, round: number): FirmDecision {
  const m = c.modules!;
  const price = Object.fromEntries(w.segments.map((s) => [s.id, 8 + (round % 3)]));
  const presence = Object.fromEntries(w.segments.map((s) => [s.id, 1]));
  const d: FirmDecision = {
    firm_id: f.id, price, presence,
    invest_cap: round % 2 ? 40_000 : 0, invest_process: 9_000, invest_Q: 21_000, invest_B: 17_000,
    invest_T_emp: 4_000, invest_T_inv: 3_000, invest_T_gov: 2_500,
    debt_draw: round === 1 ? 150_000 : 0, debt_repay: round === 4 ? 30_000 : 0,
    equity_raise: round === 2 ? 60_000 : 0, dividend: round === 6 ? 5_000 : 0,
    buy_info: round % 2 === 0, agreement_actions: [], exit_action: null,
    run_rate: 0.95,
  };
  if (m.prEvents?.enabled && round % 3 === 0) d.pr_action = "festival";
  if (m.sustainability?.enabled) d.invest_water_efficiency = 6_000;
  if (m.rndRace?.enabled) d.invest_rnd = 8_000;
  if (m.verticalIntegration?.enabled && round === 2) d.buy_vertical = [m.verticalIntegration.assets[0].id];
  if (m.laborMarket?.enabled && round === 1) d.hire_roles = [m.laborMarket.roles[0].id];
  if (m.facilities?.enabled && round === 1) d.build_facilities = [{ type: m.facilities.types[0].id, location: m.facilities.districts?.[0]?.id ?? "downtown" }];
  if (m.facilities?.enabled && round === 7 && f.facilities?.length) d.divest_facilities = [f.facilities[0].id];
  if (m.employees?.enabled && round === 1) { const mk = generateHiringMarket(c, w.seed, w.round); if (mk.length) d.hire_employees = [mk[0].id]; }
  if (m.financialInstruments?.enabled && round === 3) { d.draw_convertible = 40_000; d.draw_rbf = 30_000; }
  if (m.lobbying?.enabled && round % 2) { d.lobby_spend = 7_000; d.lobby_initiative = m.lobbying.initiatives[0].id; }
  if (m.publicGoods?.enabled) d.public_good_contributions = Object.fromEntries(m.publicGoods.goods.map((g) => [g.id, 3_000]));
  return d;
}

function play(rounds = 9): { results: RoundResult[]; c: Config } {
  const c = resolveConfig({ ...modulesOverride(FULL), game: { n_firms: 6, n_rounds: rounds } } as never);
  let w = initGame(c);
  const results: RoundResult[] = [];
  for (let r = 0; r < rounds; r++) {
    const ds = w.firms.filter((f) => f.status === "active").map((f, i) =>
      i < 2 ? spender(f, w, c, r) : decideAdaptive(ADAPTIVE_LEANS[i % ADAPTIVE_LEANS.length], f, w, c));
    const out = resolveRound(w, ds, c);
    results.push(out.result);
    w = out.world;
  }
  return { results, c };
}

test("DW-070: every firm × round itemizes, and every line set sums to its total", () => {
  const { results } = play();
  let n = 0;
  for (const res of results) for (const fr of res.firm_results) {
    if (fr.status !== "active" && !fr.pnl.opex_lines) continue; // a firm out before the round has no books
    assert.ok(fr.pnl.opex_lines, `r${res.round} ${fr.firm_id} has opex_lines`);
    assert.ok(fr.cash_flow.cf_lines, `r${res.round} ${fr.firm_id} has cf_lines`);
    assert.ok(fr.balance_sheet.debt_lines, `r${res.round} ${fr.firm_id} has debt_lines`);
    assert.deepEqual(statementLineGaps(fr.pnl, fr.balance_sheet, fr.cash_flow, fr.state.cash), [], `r${res.round} ${fr.firm_id}`); // DW-076: + opening cash ties
    for (const k of Object.keys(fr.pnl.opex_lines!)) assert.ok((OPEX_LINE_KEYS as readonly string[]).includes(k), `known key ${k}`);
    n++;
  }
  assert.ok(n >= 40, `checked ${n} firm-rounds`);
});

test("DW-070: the fixture exercises the levers and modules a class actually spends on", () => {
  const { results } = play();
  const seen = new Set<string>();
  for (const res of results) for (const fr of res.firm_results) {
    for (const [k, v] of Object.entries(fr.pnl.opex_lines ?? {})) if (v) seen.add(`opex.${k}`);
    for (const [s, lines] of Object.entries(fr.cash_flow.cf_lines ?? {})) for (const [k, v] of Object.entries(lines)) if (v) seen.add(`cf.${s}.${k}`);
    for (const [k, v] of Object.entries(fr.balance_sheet.debt_lines ?? {})) if (v) seen.add(`debt.${k}`);
  }
  const want = [
    "opex.quality", "opex.brand", "opex.community", "opex.investor_relations", "opex.regulator_relations", "opex.operations",
    "opex.overhead", "opex.tank_upkeep", "opex.regulatory", "opex.market_research", "opex.sustainability", "opex.public_goods",
    "opex.rnd", "opex.lobbying", "opex.facilities", "opex.staff", "opex.key_hires", "opex.distribution", "opex.pr_events", // inventory_holding: default cost is $0
    "cf.operating.net_income", "cf.operating.depreciation", "cf.investing.tanks", "cf.investing.facilities",
    "cf.financing.debt_draw", "cf.financing.debt_repay", "cf.financing.equity", "cf.financing.convertible_draw", "cf.financing.rbf_draw",
    "debt.bank", "debt.convertible", "debt.rbf",
  ];
  const missing = want.filter((k) => !seen.has(k));
  assert.deepEqual(missing, [], `lines never exercised; seen: ${[...seen].sort().join(", ")}`);
  assert.ok(!seen.has("opex.other"), "the per-module breakdown always accounts for extraOpex");
});

test("DW-070: itemizing is display-only — the base game resolves the same totals", () => {
  // Same seed, same decisions, base game: the lines are present and agree, and the totals are the
  // ones the opex formula has always produced (overhead + tank upkeep + regulatory + levers).
  const c = resolveConfig();
  const w = initGame(c);
  const out = resolveRound(w, w.firms.map((f) => spender(f, w, c, 0)), c);
  for (const fr of out.result.firm_results) {
    const l = fr.pnl.opex_lines!;
    assert.equal(l.quality, 21_000);
    assert.equal(l.overhead, c.finance.fixed_overhead);
    assert.deepEqual(statementLineGaps(fr.pnl, fr.balance_sheet, fr.cash_flow), []);
  }
});

// DW-076: the quarters where opening cash did not tie — cash moves AFTER the books close (an
// acquisition settles, a target is bought out, a rebuilder gets fresh capital) and a divestment's
// proceeds — all itemize, and closing cash + post_close = next round's opening cash for every firm.
test("DW-076: acquisition, buy-out, divestment and rebuild all itemize; opening cash ties", () => {
  const c = resolveConfig({ ...modulesOverride(["ma", "facilities"]), game: { n_firms: 4, n_rounds: 6 } } as never);
  const fac = c.modules!.facilities!;
  const quiet = (f: FirmState, w: WorldState, over: Partial<FirmDecision> = {}): FirmDecision => ({
    firm_id: f.id, price: Object.fromEntries(w.segments.map((s) => [s.id, 8])), presence: Object.fromEntries(w.segments.map((s) => [s.id, s.id === "mass" ? 1 : 0])),
    invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
    debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null, ...over,
  });
  const byId = (w: WorldState, id: string) => w.firms.find((f) => f.id === id)!;
  const res = (r: RoundResult, id: string) => r.firm_results.find((x) => x.firm_id === id)!;
  const tie = (r: RoundResult) => { for (const fr of r.firm_results) assert.deepEqual(statementLineGaps(fr.pnl, fr.balance_sheet, fr.cash_flow, fr.state.cash), [], `r${r.round} ${fr.firm_id}`); };
  let w = initGame(c);
  // Round 0 (the MOD-B07 fixture's shape): firm_2 is deeply distressed and firm_1 buys it while also
  // building the cheapest site (a capex line, and the thing it sells next round); firm_4 rebuilds.
  const cheap = [...fac.types].sort((a, b) => a.base_cost - b.base_cost)[0];
  const t = byId(w, "firm_2"); t.rounds_below_health = 3; t.retained_earnings -= t.cash - 50; t.cash = 50;
  const idle = Object.fromEntries(w.segments.map((s) => [s.id, 0]));
  const other = w.segments.find((s) => s.id !== byId(w, "firm_4").primary_segment)?.id ?? w.segments[0].id;
  let out = resolveRound(w, w.firms.map((f) => quiet(f, w,
    f.id === "firm_1" ? { acquisition_bid: { target: "firm_2", price: 900 }, build_facilities: [{ type: cheap.id, location: fac.districts?.[0]?.id ?? "downtown" }] }
    : f.id === "firm_2" ? { presence: idle }
    : f.id === "firm_4" ? { exit_action: { type: "voluntary", path: "rebuild", reposition_segment: other } } : {})), c);
  tie(out.result); w = out.world;
  const acq = res(out.result, "firm_1"), tgt = res(out.result, "firm_2"), reb = res(out.result, "firm_4");
  assert.ok((acq.cash_flow.cf_lines!.investing.facilities ?? 0) < 0, "the build is a facilities capex line");
  assert.equal(byId(w, "firm_2").status, "acquired");
  assert.equal(acq.cash_flow.cf_lines!.post_close!.acquisition_paid, -900, "price paid, as its own line");
  assert.ok(Math.abs((acq.cash_flow.cf_lines!.post_close!.acquired_cash ?? 0) - tgt.balance_sheet.cash) < 1e-6, "the target's closing cash comes across");
  assert.ok(Math.abs((tgt.cash_flow.cf_lines!.post_close!.sold_to_acquirer ?? 0) + tgt.balance_sheet.cash) < 1e-6, "…and leaves the target's books");
  assert.equal(tgt.state.cash, 0);
  assert.equal(byId(w, "firm_4").status, "exited_rebuilt");
  assert.ok((reb.cash_flow.cf_lines!.post_close!.rebuild_reentry_cost ?? 0) < 0 && reb.cash_flow.cf_lines!.post_close!.rebuild_fresh_capital !== undefined, "rebuild: fresh capital + re-entry cost itemized");
  // Nothing computed moved: the statement totals are the pre-M&A books, exactly as before DW-076 —
  // and the bridge is exact: opening cash = closing + acquired − paid.
  assert.ok(Math.abs(acq.state.cash - (acq.balance_sheet.cash + tgt.balance_sheet.cash - 900)) < 1e-6);
  assert.deepEqual(statementLineGaps(acq.pnl, acq.balance_sheet, { ...acq.cash_flow, cf_lines: { ...acq.cash_flow.cf_lines!, post_close: undefined } }, acq.state.cash).length, 1, "without the post-close lines, opening cash would NOT tie (the pre-DW-076 gap)");
  // Round 1: firm_1 sells the site — proceeds are an investing line, not a post-close one.
  const plant = byId(w, "firm_1").facilities?.[0]; assert.ok(plant, "firm_1 owns a site to divest");
  out = resolveRound(w, w.firms.filter((f) => f.status === "active").map((f) => quiet(f, w, f.id === "firm_1" ? { divest_facilities: [plant!.id] } : {})), c);
  tie(out.result);
  assert.ok((res(out.result, "firm_1").cash_flow.cf_lines!.investing.divestment ?? 0) > 0, "divestment proceeds itemized");
  assert.equal(res(out.result, "firm_1").cash_flow.cf_lines!.post_close, undefined, "no post-close moves this round");
});

test("DW-072 #3: profitability stays bounded once debt + equity ≤ 0 (the firm 1 round)", () => {
  const c = resolveConfig();
  const w = initGame(c);
  const firms = new Map(w.firms.map((f) => [f.id, f]));
  const snap = (id: string, ni: number, ic: number): ScoreSnapshot => ({
    firm_id: id, net_income: ni, invested_capital: ic, coverage: 2, leverage: 1, cash: 200_000, shareSum: 0.3,
    Q: 20, B: 20, T_emp: 10, T_inv: 10, T_gov: 10,
  });
  // Wire round 4, game 42b80c61: firm 1 lost ~$314k with debt + equity at or below zero.
  const snaps = [snap("firm_1", -314_000, -50_000), snap("firm_2", 40_000, 800_000), snap("firm_3", -20_000, 600_000), snap("firm_4", 10_000, 500_000)];
  const out = scoreRound(snaps, c, firms, 0);
  const dos = out.get("firm_1")!;
  const bound = c.scoring.financial_blend.profitability * PROFITABILITY_CLAMP + 10;
  assert.ok(Number.isFinite(dos.raw.financial) && Math.abs(dos.raw.financial) <= bound, `raw financial ${dos.raw.financial}`);
  // Rivals keep their order on profitability instead of collapsing to one value.
  const n2 = out.get("firm_2")!.norm.financial, n3 = out.get("firm_3")!.norm.financial;
  assert.ok(n2 > n3, `firm_2 ${n2} should outscore firm_3 ${n3}`);
});

test("DW-070: the student history carries the viewer's own lines, and only the viewer's", () => {
  const { results } = play(3);
  const hist = projectHistory(results.map((result) => ({ round: result.round, result })), "firm_1");
  for (const h of hist) {
    assert.ok(h.own.pnl?.opex_lines && h.own.cashFlow?.cf_lines && h.own.balance?.debt_lines, `r${h.own.round} own lines present`);
    assert.equal(h.own.pnl!.opex_lines!.quality, 21_000, "firm_1 is the spender");
  }
  // Rival snapshots never carry statements (research gating): only net income, behind `reveal`.
  assert.ok(!JSON.stringify(hist.map((h) => h.field)).includes("opex_lines"));
});
