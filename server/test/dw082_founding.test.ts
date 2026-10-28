import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "drinkwars-engine/node";
import { GameOrchestrator, InMemoryAdapter } from "../src/index.js";

// DW-082c (audit #10) — the founding moment (the CEO names the brewery, picks its colour and mark)
// happens once per FIRM, not once per device. A CEO who came back through Join, on a new device or
// the same one, was shown it again with the default colour and mark, and going on re-styled the
// firm for the whole class. The server now keeps a founded firm's name and style.
const orchestrator = () => {
  const config = loadConfig({ game: { n_firms: 3, n_rounds: 4 } } as never);
  const store = new InMemoryAdapter();
  return { config, store, orch: new GameOrchestrator(store, () => 1000, { botFillEmptySlots: true }) };
};

test("a pre-seated CEO founds the firm once; joining again keeps its name, colour and mark", async () => {
  const { config, store, orch } = orchestrator();
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", teams: [{ name: "Firm 1" }, { name: "Firm 2" }, { name: "Firm 3" }] });
  const [ana] = await orch.provisionRoster([{ external_id: "ana01", name: "Ana" }]);
  await orch.applySeatPlan(gameId, [{ external_id: "ana01", team: "Group 1", role: "ceo" }]);
  assert.equal((await orch.seatOf(gameId, ana.user_id))?.founded, false, "seated by the plan, not yet founded");
  await orch.joinGame(code, "", ana.user_id, { teamName: "Sediment Co.", style: { color: "#4f5a9a", emblem: "e-anchor" } });
  const seat = (await orch.seatOf(gameId, ana.user_id))!;
  assert.equal(seat.founded, true);
  await orch.joinGame(code, "", ana.user_id, { teamName: "Group 1", style: { color: "#c0703a", emblem: "e-hops" } }); // the old screen's defaults
  const t = (await store.getTeam(seat.teamId))!;
  assert.deepEqual([t.name, t.color, t.emblem], ["Sediment Co.", "#4f5a9a", "e-anchor"]);
});

test("a solo player who joins again keeps the firm's colour and mark", async () => {
  const { config, store, orch } = orchestrator();
  const code = GameOrchestrator.makeJoinCode();
  await orch.createGame({ config, joinCode: code, firmMode: "solo", teams: [{ name: "S1" }, { name: "S2" }, { name: "S3" }] });
  const [cy] = await orch.provisionRoster([{ external_id: "cy03", name: "Cy" }]);
  const first = await orch.joinGame(code, "Cy", cy.user_id, { style: { color: "#1f8c93", emblem: "e-star" } });
  await orch.joinGame(code, "Cy", cy.user_id, { style: { color: "#c0703a", emblem: "e-hops" } });
  const t = (await store.getTeam(first.teamId))!;
  assert.deepEqual([t.color, t.emblem], ["#1f8c93", "e-star"]);
});
