import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "drinkwars-engine/node";
import { GameOrchestrator } from "../src/lifecycle.js";
import { InMemoryAdapter } from "../src/adapters/memory.js";

// DW-079 (playtest 10-15). Two firms were both called "Hop Theory" — the class team (its CEO typed
// it) and an unseated house slot (the name pool drew it) — so "Hop Theory broke ground on a nano
// brewery" read as the team repeating an old build. Names are now unique per game; and builds,
// like every one-shot move, provably never repeat on their own.

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

async function teamGame(names: string[], modules: Record<string, unknown> = {}) {
  const config = loadConfig({ game: { n_firms: names.length, n_rounds: 6 }, modules } as never);
  const store = new InMemoryAdapter();
  let now = 1000;
  const orch = new GameOrchestrator(store, () => (now += 10), { botFillEmptySlots: true, noShowPolicy: "carry" });
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", teams: names.map((name) => ({ name })) });
  const teams = await store.getTeams(gameId);
  return { store, orch, gameId, code, teams };
}

test("a student's chosen name beats a house slot's; another student team's name is refused", async () => {
  const { store, orch, gameId, code, teams } = await teamGame(["Group 1", "Group 2", "Hop Theory"]);
  const [g1, g2, house] = teams;
  await orch.joinGame(code, "Ana", "u-ana", { teamId: g1.id, role: "ceo", teamName: "Hop Theory" });
  let now = await store.getTeams(gameId);
  assert.equal(now.find((t) => t.id === g1.id)!.name, "Hop Theory");
  const redrawn = now.find((t) => t.id === house.id)!.name;
  assert.notEqual(key(redrawn), key("Hop Theory"), "the house slot drew a fresh name");
  assert.equal(new Set(now.map((t) => key(t.name))).size, now.length, "every name in the game is distinct");

  // Same name, different case and spacing, from another student team: refused — and not half-joined.
  await assert.rejects(orch.joinGame(code, "Ben", "u-ben", { teamId: g2.id, role: "ceo", teamName: "hop  THEORY" }), /already another team's brewery/);
  assert.equal((await store.getTeams(gameId)).find((t) => t.id === g2.id)!.member_user_ids.length, 0, "the refused founder was not seated");
  await orch.joinGame(code, "Ben", "u-ben", { teamId: g2.id, role: "ceo", teamName: "Barrel & Vine" });
  now = await store.getTeams(gameId);
  assert.equal(now.find((t) => t.id === g2.id)!.name, "Barrel & Vine");
});

test("the pre-seated CEO's founding rename follows the same rule", async () => {
  const { store, orch, gameId, code, teams } = await teamGame(["Group 1", "Group 2", "Sediment Co."]);
  const [g1, g2, house] = teams;
  await orch.joinGame(code, "Ana", "u-ana", { teamId: g1.id, role: "ceo" }); // seated first (as a seat plan would)
  await orch.joinGame(code, "Cy", "u-cy", { teamId: g2.id, role: "ceo", teamName: "Wort & Peace" });
  await orch.joinGame(code, "Ana", "u-ana", { teamId: g1.id, role: "ceo", teamName: "Sediment Co." }); // the founding moment
  const now = await store.getTeams(gameId);
  assert.equal(now.find((t) => t.id === g1.id)!.name, "Sediment Co.");
  assert.notEqual(key(now.find((t) => t.id === house.id)!.name), key("Sediment Co."));
  await assert.rejects(orch.joinGame(code, "Ana", "u-ana", { teamId: g1.id, role: "ceo", teamName: "Wort & Peace" }), /already another team's brewery/);
  assert.equal((await store.getTeams(gameId)).find((t) => t.id === g1.id)!.name, "Sediment Co.", "a refused rename keeps the old name");
});

test("a first-name fallback gets a number instead of blocking the join", async () => {
  const config = loadConfig({ game: { n_firms: 3, n_rounds: 4 } } as never);
  const store = new InMemoryAdapter();
  const orch = new GameOrchestrator(store, () => Date.now(), {});
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "solo", teams: [{ name: "Slot A" }, { name: "Slot B" }, { name: "Slot C" }] });
  await orch.joinGame(code, "Alex", "u-a1");
  await orch.joinGame(code, "Alex", "u-a2");
  const names = (await store.getTeams(gameId)).filter((t) => t.member_user_ids.length).map((t) => t.name).sort();
  assert.deepEqual(names, ["Alex", "Alex 2"]);
});

test("a build fires once: the next round (desk submitted, builds untouched) and a missed round never repeat it", async () => {
  const { store, orch, gameId, code, teams } = await teamGame(["Group 1", "Group 2"], { facilities: { enabled: true } });
  const firm = teams[0];
  await orch.joinGame(code, "Ana", "u-ceo", { teamId: firm.id, role: "ceo" });
  await orch.joinGame(code, "Cy", "u-coo", { teamId: firm.id, role: "coo" });
  const play = async () => { await orch.lockRound(gameId); const { lifecycle } = await orch.resolveRound(gameId, { force: true }); if (lifecycle === "published") await orch.advanceRound(gameId); };

  // Round 1: the COO sites a taproom.
  await orch.submitMemberDecision(gameId, firm.id, "u-coo", { build_facilities: [{ type: "taproom", location: "downtown" }] }, "coo", ["build_facilities"]);
  await play();
  // Round 2: both chairs submit, nobody touches builds.
  const standing = (await orch.getStandingDecision(gameId, firm.id))!;
  assert.deepEqual(standing.build_facilities ?? [], [], "the standing plan carries no build");
  await orch.submitMemberDecision(gameId, firm.id, "u-coo", { invest_cap: standing.invest_cap }, "coo", []);
  await orch.submitMemberDecision(gameId, firm.id, "u-ceo", { ...standing }, "ceo", []);
  await play();
  // Round 3: nobody submits — the firm trades on its standing plan (no-show "carry").
  await play();

  const world = (await store.getLatestWorldState(gameId))!.state;
  const sites = (world.firms.find((f) => f.id === firm.firm_id)!.facilities ?? []).filter((f) => f.type === "taproom");
  assert.equal(sites.length, 1, "exactly one taproom");
  const built = (await store.getRoundResults(gameId)).flatMap((r) => r.result.events).filter((e) => e.startsWith(`FACILITY BUILT: ${firm.firm_id} `));
  assert.equal(built.length, 1, `one FACILITY BUILT event for the team, got: ${JSON.stringify(built)}`);
});
