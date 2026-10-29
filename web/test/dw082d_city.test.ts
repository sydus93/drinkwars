import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameView } from "../src/game/controller.js";
import type { TeamPlanSeat } from "../src/game/multiplayer.js";
import { buildKey, overruledBuilds, teammateBuilds } from "../src/game/cityActions.js";
import { dropsTheirs } from "../src/lib/reconcile.js";

// DW-082d (playtest 10-27): the CEO cancelled the CMO's build for an empty COO desk, but the CMO's map
// still drew it as breaking ground and held its parcel, so it could be neither re-sited nor taken back.
// The map now marks a build this seat sent that the team plan doesn't carry, and names whose call stands.
// DW-082e (playtest 10-28): builds are one lever, so a build sent AFTER the CEO's cancel waits for the CEO
// too — it read "cancelled it". Each mark now says whether the CEO's word came before or after this seat's.

const taproom = { type: "taproom", location: "downtown", market: "home", lot: "dt_a" };
const BF = "build_facilities";
const seat = (o: Partial<TeamPlanSeat>): TeamPlanSeat => ({ name: "", role: null, desk: null, submitted: true, me: false, updated_at: 1, partial: {}, ...o });
const view = (seats: TeamPlanSeat[], composed: Record<string, unknown> | null): GameView =>
  ({ teamPlan: { seats, composed, locked: false } } as unknown as GameView);
const gus = (o: Partial<TeamPlanSeat> = {}) => seat({ name: "Gus", role: "cmo", desk: "commercial", me: true, partial: { build_facilities: [taproom] } as never, touched: [BF], touched_at: { [BF]: 100 }, ...o });
const fay = seat({ name: "Fay", role: "ceo", desk: "all", partial: { build_facilities: [] } as never, touched: [BF], touched_at: { [BF]: 200 } });

test("a build the CEO cancelled is marked on the proposer's map, credited to the CEO", () => {
  const lost = overruledBuilds(view([gus(), fay], { build_facilities: [] }));
  assert.deepEqual([...lost.keys()], [buildKey(taproom)]);
  const why = lost.get(buildKey(taproom));
  assert.equal(why?.who?.name, "Fay");
  assert.equal(why?.kind, "ceo");
  assert.equal(why?.waiting, false, "the CEO's word came after Gus's — she cancelled it");
});

test("a build sent AFTER the CEO's word is waiting on the CEO, not cancelled by them (DW-082e)", () => {
  const why = overruledBuilds(view([gus({ touched_at: { [BF]: 300 } }), fay], { build_facilities: [] })).get(buildKey(taproom));
  assert.equal(why?.kind, "ceo");
  assert.equal(why?.waiting, true);
});

test("still in the plan, not yet sent, solo play or no plan yet: nothing is marked", () => {
  assert.equal(overruledBuilds(view([gus(), fay], { build_facilities: [taproom] })).size, 0, "the plan carries it");
  assert.equal(overruledBuilds(view([gus({ submitted: false }), fay], { build_facilities: [] })).size, 0, "queued, not sent");
  assert.equal(overruledBuilds(view([gus(), fay], null)).size, 0, "no composed plan yet");
  assert.equal(overruledBuilds({} as GameView).size, 0, "solo");
});

test("the builds desk's chair outranks the CEO when they changed it; a silent chair is named as the CEO's 'unless'", () => {
  const coo = seat({ name: "Cy", role: "coo", desk: "operations", partial: { build_facilities: [] } as never, touched: [BF], touched_at: { [BF]: 150 } });
  const both = overruledBuilds(view([gus(), fay, coo], { build_facilities: [] })).get(buildKey(taproom));
  assert.equal(both?.who?.name, "Cy");
  assert.equal(both?.kind, "chair");
  const silent = seat({ name: "Cy", role: "coo", desk: "operations", partial: {} as never, touched: [] });
  const ceoWins = overruledBuilds(view([gus(), fay, silent], { build_facilities: [] })).get(buildKey(taproom));
  assert.equal(ceoWins?.kind, "ceo");
  assert.equal(ceoWins?.chair?.name, "Cy");
});

test("a peer's LATER change is named; with no one's change to point at, the call is unattributed", () => {
  const ben = seat({ name: "Ben", role: "cfo", desk: "finance", partial: { build_facilities: [] } as never, touched: [BF], touched_at: { [BF]: 250 } });
  const why = overruledBuilds(view([gus(), ben], { build_facilities: [] })).get(buildKey(taproom));
  assert.equal(why?.who?.name, "Ben");
  assert.equal(why?.kind, "peer");
  const early = seat({ name: "Ben", role: "cfo", desk: "finance", partial: { build_facilities: [] } as never, touched: [BF], touched_at: { [BF]: 50 } });
  assert.equal(overruledBuilds(view([gus(), early], { build_facilities: [] })).get(buildKey(taproom))?.who, null, "an earlier word isn't what dropped it");
  assert.equal(overruledBuilds(view([gus()], { build_facilities: [] })).get(buildKey(taproom))?.who, null);
});

// Pre-ship review (10-29): DW-082e drew the plan's builds on every map, so a build this seat sent and then WITHDREW came
// back as "a teammate's" (no Withdraw, its lot held) until the next submit.
test("the map draws the plan's builds a teammate carries — never one only this seat sent", () => {
  const brewery = { type: "brewery", location: "southside", market: "home", lot: "ss_b" };
  const keys = (v: GameView) => teammateBuilds(v).map(buildKey);
  assert.deepEqual(keys(view([gus()], { build_facilities: [taproom] })), [], "mine alone: withdrawn, it must go");
  const coo = seat({ name: "Cy", role: "coo", desk: "operations", partial: { build_facilities: [brewery] } as never, touched: [BF] });
  assert.deepEqual(keys(view([gus(), coo], { build_facilities: [brewery] })), [buildKey(brewery)], "a teammate's build is drawn");
  const adopted = seat({ name: "Fay", role: "ceo", desk: "all", partial: { build_facilities: [taproom] } as never, touched: [BF] });
  assert.deepEqual(keys(view([gus(), adopted], { build_facilities: [taproom] })), [buildKey(taproom)], "the CEO took it (Use theirs): it runs on her word");
  const mirror = seat({ name: "Ben", role: "cfo", desk: "finance", partial: { build_facilities: [taproom] } as never, touched: [] });
  assert.deepEqual(keys(view([gus(), mirror], { build_facilities: [taproom] })), [], "an untouched copy of mine isn't a teammate's word");
  assert.deepEqual(keys(view([gus({ submitted: false }), coo], { build_facilities: [taproom, brewery] })), [buildKey(taproom), buildKey(brewery)], "not yet sent: nothing of mine to hide");
});

test("a list that replaces a teammate's drops theirs; a cancel or a superset doesn't count", () => {
  const brewery = { type: "brewery", location: "southside", market: "home", lot: "ss_b" };
  assert.equal(dropsTheirs([brewery], [taproom]), true);
  assert.equal(dropsTheirs([taproom, brewery], [taproom]), false, "theirs is in mine (Use theirs)");
  assert.equal(dropsTheirs([], [taproom]), false, "a cancel says so itself");
  assert.equal(dropsTheirs(5000, 8000), false, "not a list");
});
