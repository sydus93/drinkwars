/**
 * Multiplayer join + publish tests (application-spec §5, §3.2). Drive the
 * join-by-code flow and the public projection on the in-memory adapter: open
 * slots are claimed by display name, rejoining is idempotent, a full game is
 * rejected, and resolution publishes a member-readable public_round.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "drinkwars-engine/node";
import type { Config, FirmDecision, SegmentId, WorldState } from "drinkwars-engine";
import { GameOrchestrator, InMemoryAdapter } from "../src/index.js";

type Firm = WorldState["firms"][number];

function decide(firm: Firm, activeSegs: SegmentId[], c: Config): FirmDecision {
  const unit = firm.unit_cost > 0 ? firm.unit_cost : c.costs.c_base * 0.85;
  const price: Record<SegmentId, number> = {};
  const presence: Record<SegmentId, number> = {};
  for (const s of c.segments.map((x) => x.id)) {
    price[s] = 0;
    presence[s] = 0;
  }
  for (const s of activeSegs) {
    price[s] = unit * 1.8;
    presence[s] = 1;
  }
  return {
    firm_id: firm.id, price, presence,
    invest_cap: (c.capacity.depreciation * firm.cap) / c.capacity.gain,
    invest_process: 30, invest_Q: 40, invest_B: 40, invest_T_emp: 20, invest_T_inv: 0, invest_T_gov: 0,
    debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0,
    buy_info: false, agreement_actions: [], exit_action: null,
  };
}

test("multiplayer: join by code, claim slots, resolve, publish public_round", async () => {
  const config = loadConfig({ game: { n_rounds: 3, n_firms: 4 } } as never);
  const store = new InMemoryAdapter();
  const orch = new GameOrchestrator(store);
  const code = GameOrchestrator.makeJoinCode();
  assert.equal(code.length, 6);

  // Instructor creates a 4-firm game with empty (claimable) slots + a join code.
  const gameId = await orch.createGame({ config, joinCode: code, teams: [0, 1, 2, 3].map((i) => ({ name: `Open ${i + 1}` })) });

  // Two students join with display names.
  const a = await orch.joinGame(code, "Alice Brewing", "user_alice");
  const b = await orch.joinGame(code, "Bob's Taproom", "user_bob");
  assert.equal(a.gameId, gameId);
  assert.notEqual(a.teamId, b.teamId);
  assert.notEqual(a.firmId, b.firmId);

  // Code lookup + display names persist; rejoin is idempotent.
  assert.equal((await store.getGameByCode(code))?.id, gameId);
  const teamA = await store.getTeam(a.teamId);
  assert.equal(teamA?.name, "Alice Brewing");
  assert.deepEqual(teamA?.member_user_ids, ["user_alice"]);
  assert.equal((await orch.joinGame(code, "Alice Brewing", "user_alice")).teamId, a.teamId);

  // Round 0: both humans submit; the two unclaimed slots zero-fill at resolve.
  const pub = await orch.getPublicState(gameId);
  const segs = pub.segments.filter((s) => s.active).map((s) => s.id);
  for (const j of [a, b]) {
    const view = await orch.getTeamView(gameId, j.teamId);
    assert.ok(view.own, "joined team maps to a firm");
    await orch.submitDecision(gameId, j.teamId, decide(view.own, segs, config));
  }
  await orch.lockRound(gameId);
  const { round, lifecycle } = await orch.resolveRound(gameId);
  assert.equal(round, 0);
  assert.equal(lifecycle, "published");

  // public_round persisted with ranked standings for every firm + a market view.
  const pr = await store.getPublicRound(gameId, 0);
  assert.ok(pr, "public_round persisted at resolution");
  assert.equal(pr!.standings.length, 4, "standings cover all four firms");
  assert.equal(pr!.standings[0].rank, 1);
  assert.ok(pr!.standings.every((s, i) => s.rank === i + 1), "ranks are 1..n in order");
  assert.ok(pr!.market.length >= 1, "market projection present");
  assert.ok(Array.isArray(pr!.events), "events array present");
  assert.equal((await store.getPublicRounds(gameId)).length, 1);
});

test("multiplayer: joining a full game is rejected", async () => {
  const config = loadConfig({ game: { n_rounds: 2, n_firms: 2 } } as never);
  const store = new InMemoryAdapter();
  const orch = new GameOrchestrator(store);
  const code = GameOrchestrator.makeJoinCode();
  await orch.createGame({ config, joinCode: code, teams: [{ name: "A" }, { name: "B" }] });
  await orch.joinGame(code, "P1", "u1");
  await orch.joinGame(code, "P2", "u2");
  await assert.rejects(() => orch.joinGame(code, "P3", "u3"), /full/);
});
