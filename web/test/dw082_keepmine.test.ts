import { test } from "node:test";
import assert from "node:assert/strict";
import { composeTeamDecision, ROLE_DESK, type FirmDecision, type SeatPartial } from "drinkwars-engine";
import type { GameView } from "../src/game/controller.js";
import { computeConflicts, holdLever, holdsSent, planDiffs, resetHolds, touchedDates, touchedLevers, unholdLever, wouldSubmit } from "../src/lib/reconcile.js";

// DW-082 — the 10-20 playtest (G2: CEO Fay + CMO Gus, the COO / CFO / CHRO chairs empty). Gus queued a
// build for the empty COO desk and a $20k loan for the empty CFO desk. Fay found no way to undo either:
// Keep mine "can't seem to click it" (judged as last submitted, it flipped no row), the loan only went
// back by submitting 1 and then 0, and after her submit nothing on any screen said what happened.
type Rec = Record<string, unknown>;
const taproom = { type: "taproom", location: "downtown", market: "home" };
const standing = { firm_id: "firm_1", price: { mass: 7.65 }, buy_info: false, debt_draw: 0, dividend: 0, build_facilities: [], agreement_actions: [], exit_action: null } as unknown as FirmDecision;
const seats = [{ role: "ceo", name: "Fay" }, { role: "cmo", name: "Gus" }].map((s) => ({ ...s, partial: null as Rec | null, touched: undefined as string[] | undefined, touched_at: undefined as Record<string, number> | undefined, updated_at: null as number | null }));
let clock = 100, acting = -1;
const parts = (): SeatPartial[] => seats.filter((s) => s.partial).map((s) => ({ desk: ROLE_DESK[s.role], partial: s.partial as Partial<FirmDecision>, touched: s.touched, touched_at: s.touched_at, updated_at: s.updated_at }));
const view = (me: number): GameView => ({ round: 0, teamPlan: { locked: false, composed: parts().length ? composeTeamDecision(standing, parts()).decision : null, seats: seats.map((s, i) => ({ name: s.name, role: s.role, desk: ROLE_DESK[s.role], submitted: !!s.partial, me: i === me, updated_at: s.updated_at, partial: s.partial, touched: s.touched, touched_at: s.touched_at })) }, own: { id: "firm_1" }, firms: [] } as unknown as GameView);
/** each seat is its own browser: holds belong to whoever is acting */
const as = (me: number) => { if (acting !== me) resetHolds(); acting = me; };
const submit = (me: number, form: FirmDecision) => { // MultiplayerClient.submit + lifecycle's packTouched
  as(me);
  const v = view(me);
  const slice = wouldSubmit(v, seats[me].role, form, standing);
  const touched = [...new Set([...(seats[me].touched ?? []), ...touchedLevers(slice, standing, 0)!])];
  const dates = touchedDates(v, slice, touched);
  const now = clock++;
  Object.assign(seats[me], { touched, touched_at: Object.fromEntries(touched.map((f) => [f, dates[f] > 0 && dates[f] <= now ? dates[f] : now])), partial: slice as Rec, updated_at: now });
  holdsSent(0);
};
const FAY = 0, GUS = 1;
const fayForm = { ...standing } as FirmDecision; // Fay never types either lever
const row = (me: number, form: FirmDecision, f: string) => planDiffs(view(me), seats[me].role, form, standing).rows.find((r) => r.field === f);

test("Gus's build and loan for empty chairs read as theirs on Fay's panel, each with its own button", () => {
  submit(FAY, fayForm); // Fay submitted first, untouched — the order that made Keep mine look dead
  submit(GUS, { ...standing, debt_draw: 20_000, build_facilities: [taproom] } as FirmDecision);
  as(FAY);
  const b = row(FAY, fayForm, "build_facilities")!, l = row(FAY, fayForm, "debt_draw")!;
  assert.equal(b.winner, "them");
  assert.match(b.who, /CMO Gus set this for the empty COO desk · theirs — Cancel it to drop it/);
  assert.equal(b.action, "cancel", "Fay has no build of her own: the button cancels Gus's");
  assert.equal(l.winner, "them");
  assert.equal(l.action, "keep");
});

test("Cancel it flips the row at once (and Undo takes it back) — before Fay submits", () => {
  as(FAY);
  holdLever(0, "build_facilities");
  let b = row(FAY, fayForm, "build_facilities")!;
  assert.equal(b.winner, "me");
  assert.equal(b.pending, true);
  assert.match(b.who, /cancelled once you submit/);
  assert.equal(b.action, "undo");
  assert.deepEqual(b.locks, [], "what locks if she submits now: no build");
  assert.equal(computeConflicts(view(FAY), "ceo", fayForm, standing).find((c) => c.field === "build_facilities")?.winner, "me", "the submit check agrees");
  unholdLever(0, "build_facilities");
  b = row(FAY, fayForm, "build_facilities")!;
  assert.equal(b.winner, "them");
  assert.equal(b.action, "cancel");
});

test("Fay cancels the build and keeps her $0 loan: one submit, the plan follows, and her panel says so", () => {
  as(FAY);
  holdLever(0, "build_facilities");
  holdLever(0, "debt_draw");
  submit(FAY, fayForm);
  const plan = composeTeamDecision(standing, parts()).decision;
  assert.deepEqual(plan.build_facilities, []);
  assert.equal(plan.debt_draw, 0, "no submitting 1 and then 0");
  const b = row(FAY, fayForm, "build_facilities")!, l = row(FAY, fayForm, "debt_draw")!;
  assert.match(b.who, /you cancelled it — as CEO you have the final say/);
  assert.equal(b.pending, false);
  assert.match(l.who, /yours — as CEO you have the final say/);
  // DW-082b: Gus's numbers are now suggestions Fay can take in one click
  assert.equal(b.action, "take");
  assert.deepEqual(b.restore, [taproom]);
  assert.equal(l.action, "take");
  assert.equal(l.restore, 20_000);
  // …and an unrelated resubmit leaves both as they are (the holds keep their date)
  submit(FAY, { ...fayForm, dividend: 5_000 } as FirmDecision);
  assert.deepEqual(composeTeamDecision(standing, parts()).decision.build_facilities, []);
});

test("Gus is told the CEO has the final say on both — and gets no button to override her (DW-082b)", () => {
  as(GUS);
  const plan = composeTeamDecision(standing, parts()).decision;
  // his City View still queues the taproom; off his desk his form follows the plan (DW-050) — the loan reads $0
  const gusForm = { ...standing, build_facilities: [taproom], debt_draw: plan.debt_draw } as FirmDecision;
  const b = row(GUS, gusForm, "build_facilities")!, l = row(GUS, gusForm, "debt_draw")!;
  assert.match(b.who, /CEO Fay cancelled it — on an empty desk the CEO has the final say/);
  assert.equal(b.action, undefined);
  assert.match(l.who, /You set .* for the empty CFO desk; CEO Fay changed it — on an empty desk the CEO has the final say/);
  assert.equal(l.action, undefined);
  // re-sending his build changes nothing: the CEO's word stands
  submit(GUS, gusForm);
  assert.deepEqual(composeTeamDecision(standing, parts()).decision.build_facilities, []);
});

test("Fay changes her mind: Use theirs puts Gus's build back in one submit", () => {
  as(FAY);
  const b = row(FAY, fayForm, "build_facilities")!;
  assert.equal(b.action, "take");
  holdLever(0, "build_facilities"); // what DecisionForm's Use theirs does, after copying b.restore into the form
  const form = { ...fayForm, build_facilities: b.restore } as FirmDecision;
  assert.match(row(FAY, form, "build_facilities")!.who, /yours once you submit/);
  submit(FAY, form);
  assert.deepEqual(composeTeamDecision(standing, parts()).decision.build_facilities, [taproom]);
});
