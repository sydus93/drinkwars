import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "drinkwars-engine/node";
import { GameOrchestrator } from "../src/lifecycle.js";
import { InMemoryAdapter } from "../src/adapters/memory.js";

// DW-080 (independent audit, 10-16).
async function team() {
  const config = loadConfig({ game: { n_firms: 2, n_rounds: 5 } } as never);
  const store = new InMemoryAdapter();
  let now = 1000;
  const orch = new GameOrchestrator(store, () => (now += 10), { botFillEmptySlots: true });
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", teams: [{ name: "F1" }, { name: "F2" }] });
  const firm = (await store.getTeams(gameId))[0];
  await orch.joinGame(code, "Cee", "u-ceo", { teamId: firm.id, role: "ceo" });
  await orch.joinGame(code, "Fin", "u-cfo", { teamId: firm.id, role: "cfo" });
  await orch.joinGame(code, "Ops", "u-coo", { teamId: firm.id, role: "coo" });
  return { store, orch, gameId, firm };
}

test("a form for a round that has closed is refused — last round's loan never lands in the new round", async () => {
  const { store, orch, gameId, firm } = await team();
  await orch.lockRound(gameId);
  await orch.resolveRound(gameId, { force: true });
  await orch.advanceRound(gameId); // round 1 is open; the CFO's "Before you submit" was still up from round 0
  await assert.rejects(orch.submitMemberDecision(gameId, firm.id, "u-cfo", { debt_draw: 50_000 }, "cfo", ["debt_draw"], 0), /round 1 has already closed/);
  assert.equal((await store.getMemberDecisions(gameId, 1, firm.id)).length, 0, "nothing was written for round 1");
  await assert.rejects(orch.submitDecision(gameId, firm.id, { firm_id: firm.firm_id } as never, "u-ceo", 0), /already closed/, "the solo path checks too");
  await orch.submitMemberDecision(gameId, firm.id, "u-cfo", { debt_draw: 50_000 }, "cfo", ["debt_draw"], 1); // the right round lands
  await orch.submitMemberDecision(gameId, firm.id, "u-cfo", { debt_draw: 60_000 }, "cfo", ["debt_draw"]); // an older client (no round) still lands
  assert.equal((await orch.getTeamPlan(gameId, firm.id, "u-cfo")).composed?.debt_draw, 60_000);
});

test("the team plan is composed live while the round is open, even when the stored record lags its slices", async () => {
  const { store, orch, gameId, firm } = await team();
  await orch.submitMemberDecision(gameId, firm.id, "u-cfo", { debt_draw: 50_000 }, "cfo", ["debt_draw"]);
  // a second seat's slice lands without its compose (two submits racing within one store round-trip)
  await store.upsertMemberDecision({ game_id: gameId, round: 0, team_id: firm.id, user_id: "u-coo", desk: "operations", partial: { invest_cap: 90_000, _touched: ["invest_cap"] } as never, submitted: true, updated_at: 5_000 });
  assert.notEqual((await orch.getTeamPlan(gameId, firm.id, "u-ceo")).composed?.invest_cap, 90_000, "the stored record lags (the race)");
  const standing = await orch.getStandingDecision(gameId, firm.id);
  const plan = await orch.getTeamPlan(gameId, firm.id, "u-ceo", standing);
  assert.equal(plan.composed?.invest_cap, 90_000, "live compose sees the COO's slice");
  assert.equal(plan.composed?.debt_draw, 50_000, "…and keeps the CFO's");
  // once locked, the record (recomposed at lock) is the truth
  await orch.lockRound(gameId);
  const locked = await orch.getTeamPlan(gameId, firm.id, "u-ceo", standing);
  assert.equal(locked.locked, true);
  assert.equal(locked.composed?.invest_cap, 90_000);
});

test("what a firm LOST with a person stays its own: rivals see the poach/departure, not the loyalty cost", async () => {
  const { visibleEvents } = await import("../src/names.js");
  const ev = [
    "POACHED: firm_2 lures Carlos B. away from firm_1 — took 4 quarters of built-up loyalty (+16% contribution)",
    "DEPARTURE: Zoe N. quits firm_1 — morale ran out; took 2 quarters of built-up loyalty (+11% contribution)",
    "DEPARTURE: firm_3's head brewer leaves for another job — took 3 quarters of built-up tenure (+9% bonus)",
  ];
  assert.deepEqual(visibleEvents(ev, "firm_1").slice(0, 2), ev.slice(0, 2), "the firm that lost them sees the cost");
  assert.deepEqual(visibleEvents(ev, "firm_2"), ["POACHED: firm_2 lures Carlos B. away from firm_1", "DEPARTURE: Zoe N. quits firm_1 — morale ran out", "DEPARTURE: firm_3's head brewer leaves for another job"], "the poacher and everyone else see the move only");
  assert.equal(visibleEvents(ev, "firm_3")[2], ev[2], "a key hire's tenure stays with its own firm");
});
