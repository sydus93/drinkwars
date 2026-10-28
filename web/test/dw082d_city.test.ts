import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameView } from "../src/game/controller.js";
import type { TeamPlanSeat } from "../src/game/multiplayer.js";
import { buildKey, overruledBuilds } from "../src/game/cityActions.js";

// DW-082d (playtest 10-27): the CEO cancelled the CMO's build for an empty COO desk, but the CMO's map
// still drew it as breaking ground and held its parcel, so it could be neither re-sited nor taken back.
// The map now marks a build this seat sent that the team plan doesn't carry, and names whose call stands.

const taproom = { type: "taproom", location: "downtown", market: "home", lot: "dt_a" };
const seat = (o: Partial<TeamPlanSeat>): TeamPlanSeat => ({ name: "", role: null, desk: null, submitted: true, me: false, updated_at: 1, partial: {}, ...o });
const view = (seats: TeamPlanSeat[], composed: Record<string, unknown> | null): GameView =>
  ({ teamPlan: { seats, composed, locked: false } } as unknown as GameView);
const gus = (o: Partial<TeamPlanSeat> = {}) => seat({ name: "Gus", role: "cmo", desk: "commercial", me: true, partial: { build_facilities: [taproom] } as never, touched: ["build_facilities"], ...o });
const fay = seat({ name: "Fay", role: "ceo", desk: "all", partial: { build_facilities: [] } as never, touched: ["build_facilities"] });

test("a build the CEO cancelled is marked on the proposer's map, credited to the CEO", () => {
  const lost = overruledBuilds(view([gus(), fay], { build_facilities: [] }));
  assert.deepEqual([...lost.keys()], [buildKey(taproom)]);
  assert.equal(lost.get(buildKey(taproom))?.name, "Fay");
});

test("still in the plan, not yet sent, solo play or no plan yet: nothing is marked", () => {
  assert.equal(overruledBuilds(view([gus(), fay], { build_facilities: [taproom] })).size, 0, "the plan carries it");
  assert.equal(overruledBuilds(view([gus({ submitted: false }), fay], { build_facilities: [] })).size, 0, "queued, not sent");
  assert.equal(overruledBuilds(view([gus(), fay], null)).size, 0, "no composed plan yet");
  assert.equal(overruledBuilds({} as GameView).size, 0, "solo");
});

test("on a seated desk the chair's word is named; with no one's change to point at, the call is unattributed", () => {
  const coo = seat({ name: "Cy", role: "coo", desk: "operations", partial: { build_facilities: [] } as never, touched: ["build_facilities"] });
  assert.equal(overruledBuilds(view([gus(), coo], { build_facilities: [] })).get(buildKey(taproom))?.name, "Cy");
  assert.equal(overruledBuilds(view([gus()], { build_facilities: [] })).get(buildKey(taproom)), null);
});
