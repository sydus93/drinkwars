import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE_DESK, type FirmDecision } from "drinkwars-engine";
import type { GameView } from "../src/game/controller.js";
import type { TeamPlan } from "../src/game/multiplayer.js";
import { planDiffs, teamOutcome } from "../src/lib/reconcile.js";
import { planTable } from "../src/lib/roundTable.js";

// DW-082 (audit #5): a submit that raced the instructor's Lock can be refused after its slice was saved
// (the server now checks first, which leaves a window of a few store calls). Once the round is locked the
// screens show the record that will run — they used to compose the slices and show the refused number.
const standing = { firm_id: "firm_1", price: { mass: 7.65 }, invest_B: 1_000, agreement_actions: [], exit_action: null } as unknown as FirmDecision;
const record = { ...standing, invest_B: 1_000 } as FirmDecision; // what locked
const plan: TeamPlan = {
  locked: true, composed: record,
  seats: [
    { name: "Fay", role: "ceo", desk: "all", submitted: true, me: true, updated_at: 1, partial: { ...standing }, touched: [] },
    { name: "Gus", role: "cmo", desk: ROLE_DESK.cmo, submitted: true, me: false, updated_at: 9, partial: { invest_B: 7_777 }, touched: ["invest_B"], touched_at: { invest_B: 9 } }, // refused, but saved
  ],
};
const view = { round: 0, teamPlan: plan, own: { id: "firm_1" }, firms: [] } as unknown as GameView;

test("once locked, the panel and the dial show the locked record — not a slice that raced the lock", () => {
  assert.equal(teamOutcome(view, "ceo", standing, standing)!.decision.invest_B, 1_000);
  assert.equal(planDiffs(view, "ceo", standing, standing).rows.find((r) => r.field === "invest_B"), undefined, "the CEO's form matches what runs");
  const gus = planDiffs({ ...view, teamPlan: { ...plan, seats: plan.seats.map((s) => ({ ...s, me: s.name === "Gus" })) } } as GameView, "cmo", { ...standing, invest_B: 7_777 } as FirmDecision, standing);
  const r = gus.rows.find((x) => x.field === "invest_B")!;
  assert.equal(r.locks, 1_000, "Gus sees that his refused number won't run");
  assert.match(r.who, /Locked/);
});

test("once locked, the Round Table's value is the locked record and the refused slice gets no credit", () => {
  const row = planTable(plan, standing).rows.find((x) => x.field === "invest_B")!;
  assert.equal(row.value, 1_000);
  assert.equal(row.author?.name, undefined);
});
