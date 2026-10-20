import { test } from "node:test";
import assert from "node:assert/strict";
import { composeTeamDecision, ROLE_DESK, type FirmDecision, type SeatPartial } from "drinkwars-engine";
import type { GameView } from "../src/game/controller.js";
import { computeConflicts, planDiffs, researchBuyer, touchedLevers, wouldSubmit } from "../src/lib/reconcile.js";

// DW-081 — the 10-19 playtest. The CFO typed $9.99 for Craft Premium (the seated CMO hadn't submitted)
// and bought market research. The CEO's form COPIED both: "Yours is used: … $9.99" for a price the CEO
// never touched, "the CEO says yes too" on research, and once the CMO submitted $8.50 the copy stopped
// and the stale $9.99 sat in the CEO's boxes as "You typed". The CEO's form now copies nobody (Play.tsx);
// here the panel rows it then shows are held to the words a student needs.
type Rec = Record<string, unknown>;
const standing = { firm_id: "firm_1", price: { mass: 7.65, niche: 7.65 }, buy_info: false, invest_T_inv: 0, dividend: 0, agreement_actions: [], exit_action: null } as unknown as FirmDecision;
const seats = [{ role: "ceo", name: "Ana" }, { role: "cfo", name: "Ben" }, { role: "cmo", name: "Dee" }, { role: "chro", name: "Eli" }].map((s) => ({ ...s, partial: null as Rec | null, touched: undefined as string[] | undefined, updated_at: null as number | null }));
let clock = 100;
const parts = (): SeatPartial[] => seats.filter((s) => s.partial).map((s) => ({ desk: ROLE_DESK[s.role], partial: s.partial as Partial<FirmDecision>, touched: s.touched, updated_at: s.updated_at }));
const view = (me: number): GameView => ({ round: 0, teamPlan: { locked: false, composed: parts().length ? composeTeamDecision(standing, parts()).decision : null, seats: seats.map((s, i) => ({ name: s.name, role: s.role, desk: ROLE_DESK[s.role], submitted: !!s.partial, me: i === me, updated_at: s.updated_at, partial: s.partial, touched: s.touched })) } }) as unknown as GameView;
const submit = (me: number, form: FirmDecision) => { // what MultiplayerClient.submit + the server keep
  const slice = wouldSubmit(view(me), seats[me].role, form, standing);
  seats[me].touched = [...new Set([...(seats[me].touched ?? []), ...touchedLevers(slice, standing, 0)!])];
  seats[me].partial = slice as Rec;
  seats[me].updated_at = clock++;
};
const CEO = 0, CFO = 1, CMO = 2, CHRO = 3;
const row = (me: number, form: FirmDecision, f: string) => planDiffs(view(me), seats[me].role, form, standing).rows.find((r) => r.field === f);

test("a CFO's price for a seated CMO who hasn't submitted: the CEO's untouched form reads it as THEIRS, with Keep mine", () => {
  submit(CFO, { ...standing, price: { mass: 7.65, niche: 9.99 }, buy_info: true } as FirmDecision);
  const r = row(CEO, standing, "price")!; // the CEO never touched price — its form keeps last round's
  assert.equal(r.winner, "them");
  assert.equal(r.changed, false, "the panel says 'Your form', not 'You typed'");
  assert.equal(r.cover, true, "the CEO can Keep mine against a peer's suggestion");
  assert.match(r.who, /CFO Ben suggested .*9\.99 for the CMO's desk \(Dee\) · theirs until the CMO submits — change it, or Keep mine/);
  assert.deepEqual(r.locks, { mass: 7.65, niche: 9.99 });
});

test("the CMO's own price before submitting: 'yours … once you submit', instead of the CFO's suggestion", () => {
  const r = row(CMO, { ...standing, price: { mass: 7.65, niche: 8.5 } } as FirmDecision, "price")!;
  assert.equal(r.winner, "me");
  assert.equal(r.pending, true, "nothing the CMO typed is on the plan until they submit");
  assert.equal(r.whoShort, "instead of CFO Ben's suggestion");
});

test("after the CMO submits $8.50, the CEO's panel credits the CMO — the CEO's boxes still hold the CEO's own numbers", () => {
  submit(CMO, { ...standing, price: { mass: 7.65, niche: 8.5 } } as FirmDecision);
  const r = row(CEO, standing, "price")!;
  assert.equal(r.winner, "them");
  assert.deepEqual(r.locks, { mass: 7.65, niche: 8.5 });
  assert.deepEqual(r.mine, standing.price, "no stale $9.99 in the CEO's form");
  assert.match(r.who, /CMO Dee's desk — they changed it/);
  assert.equal(r.changed, false);
});

test("market research is the team's purchase: bought by the CFO, it stands through the CMO's submit and is nobody's conflict", () => {
  assert.equal(view(CEO).teamPlan!.composed!.buy_info, true, "the CMO's untouched 'no' did not cancel it");
  assert.equal(researchBuyer(view(CEO)), "CFO Ben");
  assert.equal(researchBuyer(view(CFO)), "you");
  for (const me of [CEO, CFO, CMO]) {
    const form = { ...standing } as FirmDecision; // no seat's form ticked it but the buyer's
    assert.ok(!planDiffs(view(me), seats[me].role, form, standing).rows.some((x) => x.field === "buy_info"), `${seats[me].role}: no research row`);
    assert.ok(!computeConflicts(view(me), seats[me].role, form, standing).some((x) => x.field === "buy_info"), `${seats[me].role}: no research conflict`);
  }
});

test("a suggested HIRE for a seated CHRO survives that chair's silent submit, so it reads 'unless the CHRO cancels it'", () => {
  submit(CFO, { ...standing, price: { mass: 7.65, niche: 9.99 }, buy_info: true, hire_roles: ["ops_manager"] } as FirmDecision);
  const r = row(CEO, standing, "hire_roles")!;
  assert.equal(r.winner, "them");
  assert.match(r.who, /theirs unless the CHRO cancels it — change it, or Keep mine/);
  submit(CHRO, { ...standing } as FirmDecision); // the CHRO submits without touching hires
  assert.deepEqual(view(CEO).teamPlan!.composed!.hire_roles, ["ops_manager"], "the price would have reverted; the hire stands");
});
