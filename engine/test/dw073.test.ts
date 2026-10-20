import { test } from "node:test";
import assert from "node:assert/strict";
import { composeTeamDecision, mergeMemberDecisions, sameLever, seatTouched, type SeatPartial } from "../src/engine/seats.js";
import type { FirmDecision } from "../src/types.js";

// DW-073 — a specialist's UNTOUCHED lever (equal to the standing plan) no longer erases the CEO's
// deliberate entry. Shapes taken from Sprint 1 (game 42b80c61): firm 1's COO shipped the
// standing $25,600 maintenance capex and the CFO shipped $0 borrowing every round, and both
// beat the CEO's tanks / loans because the desk owner always won.

const standing = (): FirmDecision => ({
  firm_id: "firm_1", price: { mass: 6 }, presence: { mass: 1 }, run_rate: 1,
  invest_cap: 25_600, invest_process: 0, invest_Q: 10_000, invest_B: 0, invest_T_emp: 6_000, invest_T_inv: 0, invest_T_gov: 0,
  debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null,
  hire_roles: [], build_facilities: [],
});
const ceo = (p: Partial<FirmDecision>, t = 3): SeatPartial => ({ role: "ceo", partial: { ...standing(), ...p }, updated_at: t });
const coo = (p: Partial<FirmDecision> = {}, t = 2): SeatPartial => ({ role: "coo", partial: { presence: { mass: 1 }, run_rate: 1, invest_cap: 25_600, invest_process: 0, invest_Q: 10_000, build_facilities: [], ...p }, updated_at: t });
const cfo = (p: Partial<FirmDecision> = {}, t = 1): SeatPartial => ({ role: "cfo", partial: { debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, invest_T_inv: 0, ...p }, updated_at: t });

test("Sprint-1 firm 1: untouched COO / CFO slices no longer erase the CEO's tanks, loan and equity", () => {
  const m = mergeMemberDecisions(standing(), [ceo({ invest_cap: 435_000, debt_draw: 100_000, equity_raise: 300_000 }), coo(), cfo()]);
  assert.equal(m.invest_cap, 435_000);
  assert.equal(m.debt_draw, 100_000);
  assert.equal(m.equity_raise, 300_000);
});

test("in either submission order", () => {
  for (const [tc, to, tf] of [[1, 2, 3], [3, 2, 1], [2, 3, 1]]) {
    const m = mergeMemberDecisions(standing(), [ceo({ invest_cap: 435_000 }, tc), coo({}, to), cfo({}, tf)]);
    assert.equal(m.invest_cap, 435_000, `order ceo@${tc} coo@${to} cfo@${tf}`);
  }
});

test("a specialist who CHANGES their own lever still wins over the CEO, in either order", () => {
  for (const [tc, to] of [[1, 2], [2, 1]]) {
    const m = mergeMemberDecisions(standing(), [ceo({ invest_cap: 435_000 }, tc), coo({ invest_cap: 90_000 }, to)]);
    assert.equal(m.invest_cap, 90_000);
  }
});

test("firm 3: the CHRO's untouched employee-relations spend keeps the CEO's raise", () => {
  const chro: SeatPartial = { role: "chro", partial: { invest_T_emp: 6_000, hire_roles: [] }, updated_at: 5 };
  const m = mergeMemberDecisions(standing(), [ceo({ invest_T_emp: 20_000 }, 1), chro]);
  assert.equal(m.invest_T_emp, 20_000);
});

test("untouched owner + no CEO entry = the standing plan (nothing fabricated)", () => {
  const m = mergeMemberDecisions(standing(), [coo(), cfo()]);
  assert.equal(m.invest_cap, 25_600);
  assert.equal(m.debt_draw, 0);
});

test("a PEER's suggestion on a seated desk still loses to the chair (DW-052 unchanged)", () => {
  // CFO suggests quality spend on the COO's desk; the COO submits, untouched → the COO's word stands.
  const cfoSugg = cfo({ invest_Q: 50_000 } as Partial<FirmDecision>, 5);
  assert.equal(mergeMemberDecisions(standing(), [coo({}, 1), cfoSugg]).invest_Q, 10_000);
  // …but the CEO's entry beats a later peer suggestion when the chair left it untouched.
  assert.equal(mergeMemberDecisions(standing(), [ceo({ invest_Q: 30_000 }, 1), coo({}, 2), cfoSugg]).invest_Q, 30_000);
  // and a silent chair lets the suggestion trade, as before.
  assert.equal(mergeMemberDecisions(standing(), [cfoSugg]).invest_Q, 50_000);
});

test("DW-071 still holds: an empty one-shot list never erases a teammate's real request", () => {
  const chro: SeatPartial = { role: "chro", partial: { hire_roles: [] }, updated_at: 9 };
  const m = mergeMemberDecisions(standing(), [ceo({ hire_roles: ["brewmaster"] }, 1), chro]);
  assert.deepEqual(m.hire_roles, ["brewmaster"]);
});

test("provenance names the seat each lever came from (base = absent)", () => {
  const seats = [ceo({ invest_cap: 435_000, dividend: 5_000 }), coo({ invest_Q: 40_000 }), cfo({ dividend: 0 })];
  const { from } = composeTeamDecision(standing(), seats);
  assert.equal(from.invest_cap, 0, "CEO");
  assert.equal(from.invest_Q, 1, "COO changed it");
  assert.equal(from.dividend, 0, "CFO left it at standing → CEO");
  assert.equal(from.debt_repay, 2, "nobody changed it → the chair's submitted value stands");
  assert.equal(composeTeamDecision(standing(), [coo()]).from.debt_draw, undefined, "no seat set it → base");
});

test("sameLever: the one equality — empties equal, cents equal, key order irrelevant", () => {
  assert.ok(sameLever(0, undefined));
  assert.ok(sameLever([], null));
  assert.ok(sameLever({ a: 0 }, {}));
  assert.ok(sameLever(25_600.001, 25_600));
  assert.ok(sameLever({ mass: 6, niche: 9 }, { niche: 9, mass: 6 }));
  assert.ok(!sameLever(25_600, 25_601));
  // DW-076: list levers are sets — a queue rebuilt from a stored slice in another order is unchanged.
  assert.ok(sameLever(["fac_1", "fac_2"], ["fac_2", "fac_1"]));
  assert.ok(sameLever([{ type: "taproom", location: "downtown", market: "home", lot: "l2" }, { type: "bottle_shop", location: "riverside", market: "home" }], [{ market: "home", location: "riverside", type: "bottle_shop" }, { lot: "l2", market: "home", type: "taproom", location: "downtown" }]));
  assert.ok(!sameLever(["fac_1"], ["fac_1", "fac_2"]));
});

// DW-074 — explicit touched lists. The slice says which levers the seat actually changed; the
// merge no longer has to infer it from values.
test("touched: a chair that changed a lever and then put it BACK still holds it against the CEO", () => {
  // COO moved tanks to 90k, resubmitted at the standing 25.6k: sticky "touched" keeps it theirs.
  const held: SeatPartial = { ...coo({ invest_cap: 25_600 }), touched: ["invest_cap"] };
  assert.equal(mergeMemberDecisions(standing(), [ceo({ invest_cap: 435_000 }), held]).invest_cap, 25_600);
  // The same value with an EMPTY touched list is "no change from me" → the CEO's stands.
  const left: SeatPartial = { ...coo({ invest_cap: 25_600 }), touched: [] };
  assert.equal(mergeMemberDecisions(standing(), [ceo({ invest_cap: 435_000 }), left]).invest_cap, 435_000);
});

test("touched: the list outranks the value — a differing but untouched own-desk value yields", () => {
  // e.g. a stale form: the COO's slice carries 30k they never typed this round.
  const stale: SeatPartial = { ...coo({ invest_cap: 30_000 }), touched: [] };
  assert.equal(mergeMemberDecisions(standing(), [ceo({ invest_cap: 435_000 }), stale]).invest_cap, 435_000);
  // …and with no CEO entry to yield to, the chair's submitted value stands as before.
  assert.equal(mergeMemberDecisions(standing(), [stale]).invest_cap, 30_000);
});

test("touched: an untouched CEO value never displaces an untouched chair", () => {
  // A CEO form that is merely stale (differs from standing, nothing typed) is not a decision.
  const ceoStale: SeatPartial = { ...ceo({ invest_cap: 99_000 }), touched: [] };
  const cooLeft: SeatPartial = { ...coo(), touched: [] };
  assert.equal(mergeMemberDecisions(standing(), [ceoStale, cooLeft]).invest_cap, 25_600);
  const ceoTyped: SeatPartial = { ...ceo({ invest_cap: 99_000 }), touched: ["invest_cap"] };
  assert.equal(mergeMemberDecisions(standing(), [ceoTyped, cooLeft]).invest_cap, 99_000);
});

test("touched: mixed deploy — a legacy slice (no list) merges with a new one", () => {
  const legacyCeo = ceo({ invest_cap: 435_000, debt_draw: 100_000 }); // inferred: differs from standing
  const newCfo: SeatPartial = { ...cfo(), touched: [] };
  const m = mergeMemberDecisions(standing(), [legacyCeo, coo(), newCfo]);
  assert.equal(m.invest_cap, 435_000);
  assert.equal(m.debt_draw, 100_000);
  assert.ok(seatTouched(legacyCeo, "invest_cap", standing()));
  assert.ok(!seatTouched(coo(), "invest_cap", standing()));
});

test("touched: a chair's deliberate $0 beats the CEO's number", () => {
  // The case value-inference could never express: the CFO decides NOT to borrow.
  const cfoNo: SeatPartial = { ...cfo({ debt_draw: 0 }), touched: ["debt_draw"] };
  assert.equal(mergeMemberDecisions(standing(), [ceo({ debt_draw: 100_000 }), cfoNo]).debt_draw, 0);
});

test("touched: the chair can decline a teammate's suggested hire — an explicit 'none' clears it", () => {
  const sugg: SeatPartial = { role: "cfo", partial: { hire_roles: ["brewmaster"] }, touched: ["hire_roles"], updated_at: 1 };
  const declines: SeatPartial = { role: "chro", partial: { hire_roles: [] }, touched: ["hire_roles"], updated_at: 2 };
  const blank: SeatPartial = { role: "chro", partial: { hire_roles: [] }, touched: [], updated_at: 2 };
  assert.deepEqual(mergeMemberDecisions(standing(), [sugg, declines]).hire_roles, []);
  assert.deepEqual(mergeMemberDecisions(standing(), [sugg, blank]).hire_roles, ["brewmaster"], "an untouched blank still never erases it (DW-071)");
});
