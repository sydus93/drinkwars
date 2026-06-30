import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "drinkwars-engine/node";
import { GameOrchestrator } from "../src/lifecycle.js";
import { InMemoryAdapter } from "../src/adapters/memory.js";

function teamGame() {
  const config = loadConfig({ game: { n_firms: 3, n_rounds: 5 }, modules: { facilities: { enabled: true }, employees: { enabled: true } } as never });
  const store = new InMemoryAdapter();
  const orch = new GameOrchestrator(store, () => 1000, { botFillEmptySlots: true });
  return { config, store, orch };
}

test("multi-seat: CFO + CMO seats merge into one firm decision, then resolve", async () => {
  const { config, store, orch } = teamGame();
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", title: "Capstone · Game 1", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });
  const teams = await store.getTeams(gameId);
  const firm = teams[0];

  // Two students share ONE firm as CFO + CMO.
  const a = await orch.joinGame(code, "Ana", "user-cfo", { teamId: firm.id, role: "cfo" });
  const b = await orch.joinGame(code, "Ben", "user-cmo", { teamId: firm.id, role: "cmo" });
  assert.equal(a.teamId, firm.id);
  assert.equal(b.teamId, firm.id, "second seat joins the SAME firm");
  const after = await store.getTeam(firm.id);
  assert.equal(after!.member_user_ids.length, 2, "two seats on one firm");

  // CFO edits finance; CMO edits commercial. Each only its desk.
  await orch.submitMemberDecision(gameId, firm.id, "user-cfo", { debt_draw: 300, equity_raise: 50 }, "cfo");
  await orch.submitMemberDecision(gameId, firm.id, "user-cmo", { price: { mass: 7 }, presence: { mass: 1 }, buy_info: true }, "cmo");

  // The composed per-team decision carries BOTH seats' slices.
  const merged = await store.getDecision(gameId, 0, firm.id);
  assert.ok(merged, "a composed decision row exists");
  assert.equal(merged!.decision.debt_draw, 300, "CFO's finance slice merged");
  assert.equal(merged!.decision.equity_raise, 50);
  assert.equal((merged!.decision.price as Record<string, number>).mass, 7, "CMO's commercial slice merged");
  assert.equal(merged!.decision.buy_info, true);
  assert.equal(merged!.submitted, true);

  // The round resolves cleanly with the composed decision (+ bot-filled rivals).
  await orch.lockRound(gameId);
  const r = await orch.resolveRound(gameId);
  assert.equal(r.round, 0);
  const results = await store.getRoundResults(gameId);
  assert.equal(results.length, 1);
  assert.equal(results[0].result.firm_results.length, 3, "all 3 firms resolved");

  // Replay determinism still holds with composed decisions.
  const replay = await orch.replay(gameId);
  assert.equal(replay.ok, true, replay.mismatches.join("; "));
});

test("roster provisioning is idempotent by NetID and issues a durable claim code", async () => {
  const { config, store, orch } = teamGame();
  await orch.createGame({ config, joinCode: "AAAAAA", firmMode: "team", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });

  const first = await orch.provisionRoster([{ external_id: "netid_jane", name: "Jane Doe" }], { cohort: "F26-CAP" });
  assert.equal(first.length, 1);
  assert.equal(first[0].existing, false);
  const claim = first[0].claim_code;
  assert.ok(claim && claim.length >= 6);

  // The claim code resolves to the persistent user.
  const byClaim = await store.getUserByClaim(claim);
  assert.ok(byClaim);
  assert.equal(byClaim!.external_id, "netid_jane");
  assert.equal(byClaim!.display_name, "Jane Doe");
  assert.equal(byClaim!.cohort, "F26-CAP");

  // Re-provisioning the same NetID keeps the SAME user + claim (idempotent).
  const again = await orch.provisionRoster([{ external_id: "netid_jane", name: "Jane D." }], {});
  assert.equal(again[0].existing, true);
  assert.equal(again[0].user_id, first[0].user_id);
  assert.equal(again[0].claim_code, claim);
});

test("seats persist a role across rejoins, surface in getTeamSeats, and standings reach my-games", async () => {
  const { config, store, orch } = teamGame();
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", title: "Seat persist", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });
  const teams = await store.getTeams(gameId);
  const firm = teams[0];

  await orch.joinGame(code, "Ana", "u-ana", { teamId: firm.id, role: "cfo" });
  await orch.joinGame(code, "Ben", "u-ben", { teamId: firm.id, role: "cmo" });
  await orch.submitMemberDecision(gameId, firm.id, "u-ana", { debt_draw: 250 }, "cfo");

  // getTeamSeats shows both seats + who has submitted this round.
  const seats = await orch.getTeamSeats(gameId, firm.id);
  assert.equal(seats.length, 2);
  assert.equal(seats.find((s) => s.role === "cfo")?.submitted, true);
  assert.equal(seats.find((s) => s.role === "cmo")?.submitted, false);

  // Rejoin with NO role → the CFO seat is recovered (must NOT fall back to "all").
  const re = await orch.joinGame(code, "Ana", "u-ana");
  assert.equal(re.role, "cfo", "role recovered on rejoin");
  assert.equal(await store.getMemberRole(firm.id, "u-ana"), "cfo");

  // A submit with no role still uses the stored seat (finance), not "all" → it must NOT
  // overwrite Ben's commercial slice.
  await orch.submitMemberDecision(gameId, firm.id, "u-ben", { price: { mass: 9 }, presence: { mass: 1 } }, "cmo");
  await orch.submitMemberDecision(gameId, firm.id, "u-ana", { debt_draw: 400 });
  const merged = await store.getDecision(gameId, 0, firm.id);
  assert.equal(merged!.decision.debt_draw, 400, "CFO's roleless submit still hit finance");
  assert.equal((merged!.decision.price as Record<string, number>).mass, 9, "CMO's commercial slice survived");

  await orch.lockRound(gameId);
  await orch.resolveRound(gameId);
  const mine = await orch.getMyGames("u-ana");
  assert.equal(mine[0].rank !== null, true, "my-games carries a standing after resolve");
  assert.equal(mine[0].nRounds, 5);
});

test("claim-based join links the roster user, and the game shows in 'my games'", async () => {
  const { config, store, orch } = teamGame();
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "solo", title: "Fall 26 · Game 2", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });
  const [student] = await orch.provisionRoster([{ external_id: "netid_li", name: "Li" }], {});

  // The student joins as their persistent roster identity (resolved from the claim code).
  const user = await store.getUserByClaim(student.claim_code);
  await orch.joinGame(code, user!.display_name ?? "Li", user!.id);

  const mine = await orch.getMyGames(user!.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].gameId, gameId);
  assert.equal(mine[0].title, "Fall 26 · Game 2");
  assert.equal(mine[0].nRounds, 5);
});
