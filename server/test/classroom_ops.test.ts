/**
 * DW-048 classroom operations: unlock, per-chair roster, member remove/move, the standing
 * plan as a draft seed, and the per-round deadline. In-memory adapter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "drinkwars-engine/node";
import { GameOrchestrator, InMemoryAdapter, LifecycleError } from "../src/index.js";

function teamGame() {
  const config = loadConfig({ game: { n_firms: 3, n_rounds: 4 } } as never);
  const store = new InMemoryAdapter();
  const orch = new GameOrchestrator(store, () => 1000, { botFillEmptySlots: true, noShowPolicy: "carry" });
  return { config, store, orch };
}

test("unlock re-opens a locked round; guards elsewhere", async () => {
  const { config, store, orch } = teamGame();
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });
  const [f1] = await store.getTeams(gameId);
  await orch.joinGame(code, "Ana", "u-ana", { teamId: f1.id, role: "ceo" });
  await orch.submitMemberDecision(gameId, f1.id, "u-ana", { invest_Q: 10 }, "ceo");
  await assert.rejects(() => orch.unlockRound(gameId), LifecycleError); // open → cannot unlock
  await orch.lockRound(gameId);
  assert.equal((await orch.getStatus(gameId)).lifecycle, "locked");
  await assert.rejects(() => orch.submitMemberDecision(gameId, f1.id, "u-ana", { invest_Q: 20 }, "ceo"), LifecycleError);
  await orch.unlockRound(gameId);
  assert.equal((await orch.getStatus(gameId)).lifecycle, "open");
  const rec = await store.getDecision(gameId, 0, f1.id);
  assert.equal(rec?.locked, false, "decision row unlocked too");
  await orch.submitMemberDecision(gameId, f1.id, "u-ana", { invest_Q: 20 }, "ceo"); // revisable again
  assert.equal((await store.getDecision(gameId, 0, f1.id))?.decision.invest_Q, 20);
  await orch.lockRound(gameId);
  const r = await orch.resolveRound(gameId);
  assert.equal(r.lifecycle, "published");
  await assert.rejects(() => orch.unlockRound(gameId), LifecycleError); // published → final
});

test("roster shows every chair's submit state; remove drops the slice + frees the seat; move re-seats", async () => {
  const { config, store, orch } = teamGame();
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });
  const [f1, f2] = await store.getTeams(gameId);
  await orch.joinGame(code, "Ana", "u-ana", { teamId: f1.id, role: "ceo" });
  await orch.joinGame(code, "Ben", "u-ben", { teamId: f1.id, role: "cfo" });
  await orch.submitMemberDecision(gameId, f1.id, "u-ben", { debt_draw: 300 }, "cfo");

  let roster = await orch.getRoster(gameId);
  const r1 = roster.find((t) => t.teamId === f1.id)!;
  assert.deepEqual(r1.members.map((m) => [m.name, m.role, m.submitted]), [["Ana", "ceo", false], ["Ben", "cfo", true]]);
  assert.equal((await store.getDecision(gameId, 0, f1.id))?.decision.debt_draw, 300, "Ben's slice composed");

  // Wrong-firm join: remove Ben → his slice must not trade, his chair frees up.
  await orch.removeMember(gameId, f1.id, "u-ben");
  assert.deepEqual((await store.getTeam(f1.id))!.member_user_ids, ["u-ana"]);
  assert.equal(await store.getMemberRole(f1.id, "u-ben"), null);
  assert.equal(await store.getDecision(gameId, 0, f1.id), null, "removed member's slice no longer composes (record dropped)");
  await orch.joinGame(code, "Cy", "u-cy", { teamId: f1.id, role: "cfo" }); // the CFO chair is free again
  await assert.rejects(() => orch.removeMember(gameId, f1.id, "u-ben"), /not on this firm/);

  // Move Cy to F2 as CEO (F2 is empty → founding it keeps the board name).
  await orch.moveMember(gameId, "u-cy", f2.id, "ceo");
  assert.deepEqual((await store.getTeam(f1.id))!.member_user_ids, ["u-ana"]);
  assert.deepEqual((await store.getTeam(f2.id))!.member_user_ids, ["u-cy"]);
  assert.equal(await store.getMemberRole(f2.id, "u-cy"), "ceo");
  // Seat guard on move: Ana holds F1's CEO chair.
  await assert.rejects(() => orch.moveMember(gameId, "u-cy", f1.id, "ceo"), /already taken/);
  // Same-firm move = change chair.
  await orch.moveMember(gameId, "u-cy", f2.id, "cmo");
  assert.equal(await store.getMemberRole(f2.id, "u-cy"), "cmo");
  roster = await orch.getRoster(gameId);
  assert.equal(roster.find((t) => t.teamId === f2.id)!.members[0].role, "cmo");

  // Emptied firm plays as an NPC at lock (no crash, round resolves).
  await orch.removeMember(gameId, f1.id, "u-ana");
  await orch.lockRound(gameId);
  assert.equal((await orch.resolveRound(gameId)).lifecycle, "published");
});

test("solo remove clears the submit flag; move rejected in solo games", async () => {
  const { config, store, orch } = teamGame();
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "solo", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });
  const j = await orch.joinGame(code, "Solo Sam", "u-sam");
  const standing = (await orch.getStandingDecision(gameId, j.teamId))!;
  await orch.submitDecision(gameId, j.teamId, { ...standing, invest_Q: 77 });
  assert.equal((await orch.getRoster(gameId)).find((t) => t.teamId === j.teamId)!.members[0].submitted, true);
  await orch.removeMember(gameId, j.teamId, "u-sam");
  assert.equal(await store.getDecision(gameId, 0, j.teamId), null, "departing solo player takes their decision with them");
  assert.equal((await store.getTeam(j.teamId))!.member_user_ids.length, 0);
  await assert.rejects(() => orch.moveMember(gameId, "u-sam", j.teamId, "ceo"), /team games/);
});

test("standing decision carries last round's plan (the reload draft seed), not house defaults", async () => {
  const { config, store, orch } = teamGame();
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "solo", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });
  const j = await orch.joinGame(code, "Sam", "u-sam");
  const s0 = (await orch.getStandingDecision(gameId, j.teamId))!;
  const seg = Object.keys(s0.price)[0];
  assert.ok(s0.price[seg] > 0 && s0.presence[seg] === 1, "round 0: anchored defaults");
  await orch.submitDecision(gameId, j.teamId, { ...s0, price: { ...s0.price, [seg]: 9.75 }, presence: { ...s0.presence, [seg]: 0 }, invest_B: 123, debt_draw: 500 });
  await orch.lockRound(gameId);
  await orch.resolveRound(gameId);
  await orch.advanceRound(gameId);
  const s1 = (await orch.getStandingDecision(gameId, j.teamId))!;
  assert.equal(s1.price[seg], 9.75, "price carries");
  assert.equal(s1.presence[seg], 0, "withdrawal carries (no silent re-entry)");
  assert.equal(s1.invest_B, 123, "standing investment carries");
  assert.equal(s1.debt_draw, 0, "one-shot transaction resets");
  assert.equal(await orch.getStandingDecision(gameId, "not-a-team"), null);
});

test("deadline is per round: set, read in status, cleared on advance; validated", async () => {
  const { config, store, orch } = teamGame();
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "solo", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });
  assert.equal((await orch.getStatus(gameId)).deadlineAt, null);
  await assert.rejects(() => orch.setDeadline(gameId, -5), LifecycleError);
  await orch.setDeadline(gameId, 1_800_000_000_000);
  assert.equal((await orch.getStatus(gameId)).deadlineAt, 1_800_000_000_000);
  assert.equal((await store.getGame(gameId))!.deadline_at, 1_800_000_000_000);
  await orch.lockRound(gameId);
  await orch.resolveRound(gameId);
  await orch.advanceRound(gameId);
  assert.equal((await orch.getStatus(gameId)).deadlineAt, null, "cleared when the next round opens");
  await orch.setDeadline(gameId, null); // idempotent clear
  assert.equal((await orch.getStatus(gameId)).deadlineAt, null);
});

// ── DW-049: instructor administration — claim codes on the roster, end early, rename, list ──
test("DW-049: roster carries claim codes; end game early; rename; list games", async () => {
  const { store, orch } = teamGame();
  const config = loadConfig({ game: { n_firms: 3, n_rounds: 4 }, modules: { teamRoles: { enabled: true } } } as never);
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });
  const [f1] = await store.getTeams(gameId);
  await orch.joinGame(code, "Ana", "u-ana", { teamId: f1.id, role: "ceo" });
  await orch.joinGame(code, "Ben", "u-ben", { teamId: f1.id, role: "cfo" });
  const roster = await orch.getRoster(gameId);
  const chairs = roster.flatMap((t) => t.members);
  assert.ok(chairs.length > 0);
  assert.ok(chairs.every((m) => typeof m.claim === "string" && m.claim.length >= 6), "every chair has a return code the instructor can re-issue");

  await orch.renameGame(gameId, "  Fall 26 · Section A  ");
  assert.equal((await orch.describeGame(gameId)).title, "Fall 26 · Section A");
  await orch.renameGame(gameId, "   ");
  assert.equal((await orch.describeGame(gameId)).title, null, "blank title clears");

  const desc = await orch.describeGame(gameId);
  assert.equal(desc.firmMode, "team");
  assert.equal(desc.nFirms, roster.length);
  assert.ok(desc.modules.includes("teamRoles"), `enabled modules listed (${desc.modules.join(",")})`);

  const list = await orch.listGames();
  assert.ok(list.some((g) => g.gameId === gameId), "the game appears in the list");
  assert.equal((await orch.listGames(() => false)).length, 0, "ownership filter applies");

  await orch.setDeadline(gameId, Date.now() + 60_000);
  await orch.endGame(gameId);
  const st = await orch.getStatus(gameId);
  assert.equal(st.lifecycle, "complete");
  assert.equal(st.deadlineAt, null, "deadline cleared on end");
  await orch.endGame(gameId); // idempotent
  await assert.rejects(orch.lockRound(gameId), LifecycleError, "no further lifecycle moves");
});

// ── DW-050: pre-seating from a plan; pulse stamp moves only when the view would ──
test("DW-050: seat plan seats provisioned students; join by claim lands in the chair; errors are per-row", async () => {
  const { config, store, orch } = teamGame();
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", teams: [{ name: "Firm 1" }, { name: "Firm 2" }, { name: "Firm 3" }] });
  const prov = await orch.provisionRoster([
    { external_id: "ana01", name: "Ana" }, { external_id: "ben02", name: "Ben" }, { external_id: "cy03", name: "Cy" }, { external_id: "dee04", name: "Dee" },
  ]);
  const r = await orch.applySeatPlan(gameId, [
    { external_id: "ana01", team: "Hop Theory", role: "ceo" },
    { external_id: "ben02", team: "Hop Theory", role: "CFO" }, // case-insensitive chair
    { external_id: "cy03", team: "Barrel & Vine", role: "ceo" },
    { external_id: "nobody", team: "Hop Theory", role: "cmo" }, // not provisioned
    { external_id: "dee04", team: "Hop Theory", role: "cfo" }, // chair taken
  ]);
  assert.equal(r.seated.length, 3);
  assert.deepEqual(r.errors.map((e) => e.external_id), ["nobody", "dee04"]);
  assert.match(r.errors[0].error, /roster/);
  assert.match(r.errors[1].error, /taken/);
  const teams = await store.getTeams(gameId);
  const hop = teams.find((t) => t.name === "Hop Theory")!;
  assert.ok(hop, "an empty firm was claimed and named from the plan");
  assert.equal(hop.member_user_ids.length, 2);
  assert.ok(teams.some((t) => t.name === "Barrel & Vine"));
  assert.ok(teams.some((t) => t.name === "Firm 3"), "the unplanned firm keeps its default name");

  // Ben opens the app with the join code + his claim code and nothing else → his chair.
  const ben = prov.find((p) => p.external_id === "ben02")!;
  const u = await store.getUserByClaim(ben.claim_code);
  const joined = await orch.joinGame(code, "", u!.id, { teamName: "Ben's Rename" }); // a CFO can't rename
  assert.equal(joined.teamId, hop.id);
  assert.equal(joined.role, "cfo");
  assert.equal((await store.getTeam(hop.id))!.name, "Hop Theory");
  const anaU = await store.getUserByClaim(prov.find((p) => p.external_id === "ana01")!.claim_code);
  await orch.joinGame(code, "", anaU!.id, { teamName: "Sediment & Sons" }); // the pre-seated CEO names it on arrival
  assert.equal((await store.getTeam(hop.id))!.name, "Sediment & Sons");
  assert.deepEqual(await orch.seatOf(gameId, u!.id), { teamId: hop.id, team: "Sediment & Sons", role: "cfo" });

  // Re-applying is a no-op; re-planning Ben to Barrel & Vine moves him.
  // Re-pasting the ORIGINAL plan after the CEO renamed the firm resolves by membership — nobody moves.
  const again = await orch.applySeatPlan(gameId, [{ external_id: "ana01", team: "Hop Theory", role: "ceo" }, { external_id: "ben02", team: "Hop Theory", role: "cfo" }]);
  assert.deepEqual(again.seated.map((s) => s.moved), [false, false]);
  assert.equal((await store.getTeams(gameId)).filter((t) => t.member_user_ids.length > 0).length, 2, "no fresh firm was claimed");
  const mv = await orch.applySeatPlan(gameId, [{ external_id: "ben02", team: "Barrel & Vine", role: "coo" }]);
  assert.equal(mv.seated[0].moved, true);
  assert.equal((await orch.seatOf(gameId, u!.id))?.role, "coo");

  // Pulse: unchanged between reads; moves when a seat writes, on lock, on deadline.
  const p0 = await orch.pulse(gameId, hop.id);
  assert.equal((await orch.pulse(gameId, hop.id)).stamp, p0.stamp);
  const ana = await store.getUserByClaim(prov.find((p) => p.external_id === "ana01")!.claim_code);
  await orch.submitMemberDecision(gameId, hop.id, ana!.id, { invest_Q: 5 }, "ceo");
  const p1 = await orch.pulse(gameId, hop.id);
  assert.notEqual(p1.stamp, p0.stamp, "a seat's write moves the stamp");
  await orch.setDeadline(gameId, 5000);
  const p2 = await orch.pulse(gameId, hop.id);
  assert.notEqual(p2.stamp, p1.stamp);
  await orch.lockRound(gameId);
  assert.notEqual((await orch.pulse(gameId, hop.id)).stamp, p2.stamp);
  // Solo games have no chairs to plan.
  const soloId = await orch.createGame({ config, joinCode: GameOrchestrator.makeJoinCode(), firmMode: "solo", teams: [{ name: "S1" }, { name: "S2" }, { name: "S3" }] });
  await assert.rejects(orch.applySeatPlan(soloId, [{ external_id: "ana01", team: "S1", role: "ceo" }]), LifecycleError);
});
