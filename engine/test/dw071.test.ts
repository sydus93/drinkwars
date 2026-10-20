/**
 * DW-071 — game-1 fixes: the equity gate, survive-to-win standings, empty one-shot levers in
 * the seat merge, and the failed-hire / departure events.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGame, resolveRound, resolveConfig, equityCapacity, firmValuation, rankStandings, inContention, mergeMemberDecisions } from "../src/index.js";
import { modulesOverride } from "../src/config/modules.js";
import type { Config, FirmDecision, FirmState, WorldState } from "../src/types.js";

const zero = (id: string, w: WorldState): FirmDecision => ({
  firm_id: id,
  price: Object.fromEntries(w.segments.filter((s) => s.active).map((s) => [s.id, 7])),
  presence: {},
  invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
  debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null,
});

const firm = (w: WorldState, id: string): FirmState => w.firms.find((f) => f.id === id)!;
const equityOf = (f: FirmState) => f.paid_in_capital + f.retained_earnings;

test("equity gate: a fresh firm may raise up to half its valuation, and no more", () => {
  const c = resolveConfig();
  const w = initGame(c);
  const f = firm(w, "firm_1");
  const cap = equityCapacity(f, c);
  assert.ok(cap > 0 && Number.isFinite(cap), "a fresh firm is worth something");
  assert.equal(cap, 0.5 * firmValuation(f, c, true));
  const ask = cap * 3;
  const out = resolveRound(w, w.firms.map((x) => (x.id === "firm_1" ? { ...zero(x.id, w), equity_raise: ask } : zero(x.id, w))), c);
  const raised = out.result.firm_results.find((r) => r.firm_id === "firm_1")!.balance_sheet.paid_in - f.paid_in_capital;
  // Net of the issue cost (≥ 5%, priced on the round's investor-trust stock).
  assert.ok(raised <= cap * (1 - c.finance.equity_issue_cost_base) + 1 && raised > cap * 0.85, `raised ${raised}, cap ${cap}`);
  assert.ok(out.result.events.some((e) => e.startsWith("EQUITY: investors fund only") && e.includes("firm_1")));
});

test("equity gate: valuation ≤ 0 closes the equity market (and says so)", () => {
  const c = resolveConfig();
  const w = initGame(c);
  const f = firm(w, "firm_2");
  // Two heavy post-founding losses: the earnings window turns the valuation negative.
  f.ni_history = [-150_000, -400_000, -400_000];
  assert.ok(firmValuation(f, c, true) <= 0);
  assert.equal(equityCapacity(f, c), 0);
  const before = f.paid_in_capital;
  const out = resolveRound(w, w.firms.map((x) => (x.id === "firm_2" ? { ...zero(x.id, w), equity_raise: 500_000 } : zero(x.id, w))), c);
  assert.equal(out.result.firm_results.find((r) => r.firm_id === "firm_2")!.balance_sheet.paid_in, before, "nothing raised");
  assert.ok(out.result.events.some((e) => e.startsWith("EQUITY MARKET CLOSED") && e.includes("firm_2")));
});

test("equity gate: the founding round's planned loss doesn't lock a firm out", () => {
  const c = resolveConfig();
  const f = firm(initGame(c), "firm_1");
  f.ni_history = [-2_000_000]; // only the founding round so far
  assert.ok(firmValuation(f, c) < 0, "the strict valuation would be negative");
  assert.ok(equityCapacity(f, c) > 0, "the gate skips the founding round");
});

test("equity gate: absent from a pre-DW-071 game's config ⇒ no cap, no event", () => {
  const c = resolveConfig();
  delete (c.finance as Partial<Config["finance"]>).equity_gate;
  const w = initGame(c);
  firm(w, "firm_1").ni_history = [-150_000, -400_000, -400_000];
  assert.equal(equityCapacity(firm(w, "firm_1"), c), Infinity);
  const before = firm(w, "firm_1").paid_in_capital;
  const out = resolveRound(w, w.firms.map((x) => (x.id === "firm_1" ? { ...zero(x.id, w), equity_raise: 500_000 } : zero(x.id, w))), c);
  assert.ok(out.result.firm_results.find((r) => r.firm_id === "firm_1")!.balance_sheet.paid_in > before + 400_000);
  assert.ok(!out.result.events.some((e) => e.startsWith("EQUITY")));
});

test("equity gate: the debt cap follows — no pumping equity to unlock 3× more debt", () => {
  const c = resolveConfig();
  const w = initGame(c);
  const f = firm(w, "firm_1");
  f.ni_history = [-150_000, -400_000, -400_000];
  const out = resolveRound(w, w.firms.map((x) => (x.id === "firm_1" ? { ...zero(x.id, w), equity_raise: 4_000_000, debt_draw: 10_000_000 } : zero(x.id, w))), c);
  const bs = out.result.firm_results.find((r) => r.firm_id === "firm_1")!.balance_sheet;
  assert.ok(bs.debt <= c.finance.max_leverage * equityOf(f) + 1, `debt ${bs.debt} vs cap on unpumped equity`);
});

test("survive to win: a bankrupt firm ranks below every firm still trading, whatever its score", () => {
  const rows = [
    { firm_id: "a", status: "bankrupt", scorecard_cumulative: 1.07 },
    { firm_id: "b", status: "active", scorecard_cumulative: 0.23 },
    { firm_id: "c", status: "exited_rebuilt", scorecard_cumulative: -0.1 },
    { firm_id: "d", status: "active", scorecard_cumulative: 0.09 },
    { firm_id: "e", status: "exited_banked", scorecard_cumulative: 0.5 },
  ];
  assert.deepEqual(rankStandings(rows).map((r) => r.firm_id), ["b", "d", "c", "a", "e"]);
  assert.ok(inContention("active") && inContention("exited_rebuilt"));
  assert.ok(!inContention("bankrupt") && !inContention("acquired") && !inContention("exited_invested"));
});

test("seat merge: an untouched (empty) hire list never erases a teammate's hire", () => {
  const base = (): FirmDecision => ({
    firm_id: "firm_5", price: {}, presence: {},
    invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
    debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null,
  });
  // Game 1, one team, r0: the CHRO (desk owner) submitted [] BEFORE the CEO asked for three hires.
  const chro = { desk: "people" as const, partial: { hire_roles: [] }, updated_at: 1 };
  const ceo = { desk: "all" as const, partial: { hire_roles: ["head_brewer", "sales_director", "ops_manager"] }, updated_at: 2 };
  assert.deepEqual(mergeMemberDecisions(base(), [chro, ceo]).hire_roles, ["head_brewer", "sales_director", "ops_manager"]);
  assert.deepEqual(mergeMemberDecisions(base(), [ceo, chro]).hire_roles, ["head_brewer", "sales_director", "ops_manager"], "order-independent");
  // A real choice by the owner still wins.
  const chroPick = { desk: "people" as const, partial: { hire_roles: ["ops_manager"] }, updated_at: 0 };
  assert.deepEqual(mergeMemberDecisions(base(), [chroPick, ceo]).hire_roles, ["ops_manager"]);
  // Nobody asked: the empty value still fills the lever.
  assert.deepEqual(mergeMemberDecisions(base(), [chro]).hire_roles, []);
});

test("labor market: a hire the firm can't pay for reports why; attrition isn't blamed on a rival", () => {
  const c = resolveConfig(modulesOverride(["laborMarket"]));
  const w = initGame(c);
  const poor = firm(w, "firm_1"); // can't cover signing bonus + first salary (books kept balanced)
  poor.retained_earnings -= poor.cash - 1_000;
  poor.cash = 1_000;
  const out = resolveRound(w, w.firms.map((x) => (x.id === "firm_1" ? { ...zero(x.id, w), hire_roles: ["head_brewer"] } : zero(x.id, w))), c);
  assert.ok(out.result.events.some((e) => e.startsWith("HIRE FAILED: firm_1")), out.result.events.join("\n"));
  assert.ok(!out.result.events.some((e) => e.startsWith("HIRE: firm_1")));
  // Run on with a hire in place until someone leaves; the line must not mention a rival.
  let world = resolveRound(w, w.firms.map((x) => (x.id === "firm_2" ? { ...zero(x.id, w), hire_roles: ["head_brewer", "sales_director", "ops_manager"] } : zero(x.id, w))), c).world;
  const departures: string[] = [];
  for (let r = 0; r < 12 && world.firms.some((f) => f.status === "active"); r++) {
    const o = resolveRound(world, world.firms.map((x) => zero(x.id, world)), c);
    departures.push(...o.result.events.filter((e) => /DEPARTURE|POACHED/.test(e)));
    world = o.world;
  }
  // DW-075 may append what the tenure bonus took with them; the rival-free core line is unchanged.
  for (const e of departures) assert.match(e, /^DEPARTURE: .+'s .+ leaves for another job( — took \d+ quarters? of built-up tenure \(\+\d+% bonus\))?$/);
});
