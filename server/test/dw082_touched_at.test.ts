import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "drinkwars-engine/node";
import { GameOrchestrator } from "../src/lifecycle.js";
import { InMemoryAdapter } from "../src/adapters/memory.js";

// DW-082 — each touched lever carries the date of the submit that last CHANGED it (`_touched_at` beside
// `_touched` in the jsonb partial, no migration). The client sends the dates it holds and 0 for what it
// changes now; the server stamps those, and never accepts a date later than the submit itself.
// DW-082b — on an empty chair's desk the CEO has the final say.

async function firm() {
  const config = loadConfig({ game: { n_firms: 3, n_rounds: 5 } } as never);
  const store = new InMemoryAdapter();
  let now = 1000;
  const orch = new GameOrchestrator(store, () => (now += 10), { botFillEmptySlots: true });
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });
  const team = (await store.getTeams(gameId))[0];
  await orch.joinGame(code, "Cee", "u-ceo", { teamId: team.id, role: "ceo" }); // no CMO: the price desk is empty
  await orch.joinGame(code, "Fin", "u-cfo", { teamId: team.id, role: "cfo" });
  await orch.joinGame(code, "Ops", "u-coo", { teamId: team.id, role: "coo" });
  const standing = (await orch.getStandingDecision(gameId, team.id))!;
  const seat = async (u: string) => (await orch.getTeamPlan(gameId, team.id, u)).seats.find((s) => s.me)!;
  const composed = async () => (await store.getDecision(gameId, 0, team.id))!.decision;
  const price = (mass: number) => ({ ...standing.price, mass });
  return { orch, gameId, team, standing, seat, composed, price };
}

test("an unrelated resubmit keeps the price's old date, so a teammate's newer cover stands", async () => {
  const { orch, gameId, team, seat, composed, price } = await firm();
  await orch.submitMemberDecision(gameId, team.id, "u-cfo", { price: price(7) }, "cfo", ["price"], 0, { price: 0 });
  const t1 = (await seat("u-cfo")).touched_at!.price;
  await orch.submitMemberDecision(gameId, team.id, "u-coo", { price: price(8) }, "coo", ["price"], 0, { price: 0 });
  assert.equal((await composed()).price.mass, 8, "the COO's later change wins the empty desk");
  // the CFO changes only the dividend: the client sends the price's stored date and 0 for the dividend
  await orch.submitMemberDecision(gameId, team.id, "u-cfo", { price: price(7), dividend: 40_000 }, "cfo", ["dividend", "price"], 0, { price: t1, dividend: 0 });
  const me = await seat("u-cfo");
  assert.equal(me.touched_at!.price, t1, "an unchanged lever keeps the date of its change");
  assert.ok(me.touched_at!.dividend > t1, "a changed lever is dated by this submit");
  const d = await composed();
  assert.equal(d.price.mass, 8, "the CFO's old price did not come back over the COO's newer one");
  assert.equal(d.dividend, 40_000);
});

test("the CEO's change is final on the empty desk; a later cover is a suggestion", async () => {
  const { orch, gameId, team, standing, composed, price } = await firm();
  await orch.submitMemberDecision(gameId, team.id, "u-cfo", { price: price(7) }, "cfo", ["price"], 0, { price: 0 });
  await orch.submitMemberDecision(gameId, team.id, "u-ceo", { ...standing, price: price(9) }, "ceo", ["price"], 0, { price: 0 });
  await orch.submitMemberDecision(gameId, team.id, "u-coo", { price: price(8.5) }, "coo", ["price"], 0, { price: 0 });
  assert.equal((await composed()).price.mass, 9);
});

test("a date from the future is clamped to the submit; an older client without dates keeps the old rule", async () => {
  const { orch, gameId, team, seat, composed, price } = await firm();
  await orch.submitMemberDecision(gameId, team.id, "u-cfo", { price: price(7) }, "cfo", ["price"], 0, { price: 9e15 });
  const s1 = await seat("u-cfo");
  assert.ok(s1.touched_at!.price <= (s1.updated_at ?? 0), "no lever is dated after the submit that carried it");
  await orch.submitMemberDecision(gameId, team.id, "u-coo", { price: price(8) }, "coo", ["price"], 0);
  await orch.submitMemberDecision(gameId, team.id, "u-cfo", { price: price(7) }, "cfo", ["price"], 0); // no dates: re-dated now
  assert.equal((await composed()).price.mass, 7, "an older client's resubmit re-asserts, as before DW-082");
});
