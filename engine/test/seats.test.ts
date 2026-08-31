import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeMemberDecisions, DESK_LEVERS, ALL_LEVERS, ROLE_DESK, type SeatPartial } from "../src/engine/seats.js";
import type { FirmDecision } from "../src/types.js";

/** A fully-populated decision so we can enumerate EVERY FirmDecision key at runtime
 *  (TS interfaces aren't reflectable). Distinct values so we can assert what merges. */
const fullDecision = (firm_id: string): FirmDecision => ({
  firm_id,
  price: { mass: 5 }, presence: { mass: 1 }, run_rate: 0.9, pr_action: null,
  invest_water_efficiency: 1, public_good_contributions: { clean: 2 }, market_presence: { home: 1 },
  market_supply: { home: 10 }, invest_rnd: 3, buy_vertical: ["v1"], hire_roles: ["r1"], fire_roles: ["r2"],
  build_facilities: [{ type: "taproom" }], maintain_facilities: { f1: 5 }, mothball_facilities: ["f2"],
  reactivate_facilities: ["f3"], divest_facilities: ["f4"],
  hire_employees: ["c1"], hire_bids: { c1: 500 }, fire_employees: ["e1"], raise_employees: { e2: 9 }, poach_employees: [{ firm: "x", employee: "e", offer: 1 }],
  draw_convertible: 11, draw_rbf: 12, acquisition_bid: { target: "y", price: 100 },
  lobby_spend: 13, lobby_initiative: "init", lobby_counter: "ctr",
  invest_cap: 20, invest_process: 21, invest_Q: 22, invest_B: 23, invest_T_emp: 24, invest_T_inv: 25, invest_T_gov: 26,
  debt_draw: 30, debt_repay: 31, equity_raise: 32, dividend: 33,
  buy_info: true, agreement_actions: [], exit_action: null,
  beliefs: { own_rank: 1 }, reflection: "note",
});

test("DESK_LEVERS partitions EVERY FirmDecision lever exactly once (no drops, no dupes)", () => {
  const allKeys = Object.keys(fullDecision("firm_1")).filter((k) => k !== "firm_id");
  // No duplicate across desks.
  assert.equal(new Set(ALL_LEVERS).size, ALL_LEVERS.length, "a lever appears in more than one desk");
  // Exact coverage: ALL_LEVERS === every key except firm_id.
  assert.deepEqual([...ALL_LEVERS].sort(), [...allKeys].sort(), "desk levers don't exactly cover FirmDecision");
});

const base = (): FirmDecision => ({
  firm_id: "firm_1", price: {}, presence: {},
  invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
  debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null,
});

test("solo: one generalist seat = its full decision over base (firm_id preserved)", () => {
  const solo = fullDecision("firm_99");
  const merged = mergeMemberDecisions(base(), [{ role: "ceo", partial: solo }]);
  assert.equal(merged.firm_id, "firm_1"); // identity from base, not the seat
  assert.equal(merged.invest_Q, 22);
  assert.equal(merged.debt_draw, 30);
  assert.equal(merged.lobby_spend, 13);
});

test("team: each specialist owns its desk; generalist fills the gaps; specialists win", () => {
  const cfo: SeatPartial = { role: "cfo", partial: { debt_draw: 500, equity_raise: 200, dividend: 0, debt_repay: 0, draw_convertible: 0, draw_rbf: 0 } };
  const cmo: SeatPartial = { role: "cmo", partial: { price: { mass: 7 }, presence: { mass: 2 }, buy_info: true } };
  // CEO tries to set finance + commercial too, but specialists must win for their desks.
  const ceo: SeatPartial = { role: "ceo", partial: { ...fullDecision("z"), debt_draw: 1, price: { mass: 1 }, invest_cap: 77 } };
  const merged = mergeMemberDecisions(base(), [cfo, cmo, ceo]);
  assert.equal(merged.debt_draw, 500, "CFO must win finance over CEO");
  assert.equal(merged.equity_raise, 200);
  assert.deepEqual(merged.price, { mass: 7 }, "CMO must win commercial over CEO");
  assert.equal(merged.buy_info, true);
  assert.equal(merged.invest_cap, 77, "CEO fills operations (no COO seat present)");
  assert.equal(merged.lobby_spend, 13, "CEO fills relations");
});

test("a desk with no seat keeps the base value (nothing fabricated)", () => {
  const cfo: SeatPartial = { role: "cfo", partial: { debt_draw: 99 } };
  const merged = mergeMemberDecisions(base(), [cfo]);
  assert.equal(merged.debt_draw, 99);
  assert.deepEqual(merged.price, {}, "commercial untouched → base");
  assert.equal(merged.invest_cap, 0, "operations untouched → base");
});

test("ROLE_DESK maps the C-suite onto the five role-aligned desks", () => {
  assert.equal(ROLE_DESK.cmo, "commercial");
  assert.equal(ROLE_DESK.cfo, "finance");
  assert.equal(ROLE_DESK.coo, "operations");
  assert.equal(ROLE_DESK.chro, "people"); // people now have their own desk (L1.5)
  assert.equal(ROLE_DESK.ceo, "all");
  assert.equal(DESK_LEVERS.strategy.includes("agreement_actions"), true);
  // L1.5 realignment: brand → commercial, investor relations → finance, people → their desk.
  assert.equal(DESK_LEVERS.commercial.includes("invest_B"), true);
  assert.equal(DESK_LEVERS.finance.includes("invest_T_inv"), true);
  assert.equal(DESK_LEVERS.people.includes("invest_T_emp"), true);
});

test("DW-051 empty-chair cover: owner always wins; among CEO + covering teammates the LATER submission wins", () => {
  const base = fullDecision("firm_1");
  const cfoCover: SeatPartial = { role: "cfo", updated_at: 10, partial: { dividend: 99, invest_Q: 7, price: { mass: 1 } } };
  // nobody else speaks for operations/commercial → the CFO's cover lands (own desk lands too)
  let m = mergeMemberDecisions(base, [cfoCover]);
  assert.equal(m.dividend, 99); assert.equal(m.invest_Q, 7); assert.deepEqual(m.price, { mass: 1 });
  // CEO submitted EARLIER → the later cover wins on the empty desks; the CFO's own desk is untouchable
  const ceoEarly: SeatPartial = { role: "ceo", updated_at: 5, partial: { invest_Q: 50, price: { mass: 4 }, dividend: 0 } };
  m = mergeMemberDecisions(base, [ceoEarly, cfoCover]);
  assert.equal(m.invest_Q, 7); assert.deepEqual(m.price, { mass: 1 }); assert.equal(m.dividend, 99);
  // CEO re-submits LATER → overrules the cover (input order irrelevant)
  const ceoLate: SeatPartial = { ...ceoEarly, updated_at: 20 };
  m = mergeMemberDecisions(base, [cfoCover, ceoLate]);
  assert.equal(m.invest_Q, 50); assert.deepEqual(m.price, { mass: 4 }); assert.equal(m.dividend, 99);
  // the desk owner beats both, whenever they submitted
  const coo: SeatPartial = { role: "coo", updated_at: 1, partial: { invest_Q: 3 } };
  m = mergeMemberDecisions(base, [coo, ceoLate, cfoCover]);
  assert.equal(m.invest_Q, 3); assert.deepEqual(m.price, { mass: 4 });
  // no timestamps → input order (later in the list = later word)
  m = mergeMemberDecisions(base, [{ role: "cfo", partial: { invest_Q: 7 } }, { role: "ceo", partial: { invest_Q: 50 } }]);
  assert.equal(m.invest_Q, 50);
  // a lever nobody touched keeps the base
  assert.equal(m.invest_process, base.invest_process);
});
