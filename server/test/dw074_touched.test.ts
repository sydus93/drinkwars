import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "drinkwars-engine/node";
import { GameOrchestrator } from "../src/lifecycle.js";
import { InMemoryAdapter } from "../src/adapters/memory.js";

// DW-074 — each seat's slice records which levers it actually changed. Stored inside the jsonb
// partial under a reserved key (no migration), split out again before anything reads it.

async function firmOfThree() {
  const config = loadConfig({ game: { n_firms: 3, n_rounds: 5 } } as never);
  const store = new InMemoryAdapter();
  let now = 1000;
  const orch = new GameOrchestrator(store, () => (now += 10), { botFillEmptySlots: true });
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });
  const firm = (await store.getTeams(gameId))[0];
  await orch.joinGame(code, "Cee", "u-ceo", { teamId: firm.id, role: "ceo" });
  await orch.joinGame(code, "Ops", "u-coo", { teamId: firm.id, role: "coo" });
  await orch.joinGame(code, "Fin", "u-cfo", { teamId: firm.id, role: "cfo" });
  const standing = (await orch.getStandingDecision(gameId, firm.id))!;
  return { store, orch, gameId, firm, standing, code };
}

test("the Sprint-1 shape end to end: untouched chairs submit, the CEO's entries trade", async () => {
  const { orch, gameId, firm, standing } = await firmOfThree();
  // COO and CFO submit their desks exactly as seeded — nothing changed.
  await orch.submitMemberDecision(gameId, firm.id, "u-coo", { invest_cap: standing.invest_cap, invest_Q: 0, invest_process: 0 }, "coo", []);
  await orch.submitMemberDecision(gameId, firm.id, "u-cfo", { debt_draw: 0, equity_raise: 0, dividend: 0, debt_repay: 0 }, "cfo", []);
  await orch.submitMemberDecision(gameId, firm.id, "u-ceo", { ...standing, invest_cap: 435_000, debt_draw: 100_000 }, "ceo", ["invest_cap", "debt_draw"]);
  const plan = await orch.getTeamPlan(gameId, firm.id, "u-ceo");
  assert.equal(plan.composed?.invest_cap, 435_000);
  assert.equal(plan.composed?.debt_draw, 100_000);
});

test("the reserved key never leaks: not into a seat's partial, not into the composed decision", async () => {
  const { orch, store, gameId, firm, standing } = await firmOfThree();
  await orch.submitMemberDecision(gameId, firm.id, "u-coo", { invest_cap: 90_000 }, "coo", ["invest_cap"]);
  const plan = await orch.getTeamPlan(gameId, firm.id, "u-ceo");
  const coo = plan.seats.find((s) => s.role === "coo")!;
  assert.deepEqual(coo.partial, { invest_cap: 90_000 });
  assert.deepEqual(coo.touched, ["invest_cap"]);
  assert.ok(!("_touched" in (plan.composed as object)));
  const inst = (await orch.getTeamDecisions(gameId)).teams.find((t) => t.teamId === firm.id)!;
  assert.deepEqual(inst.seats.find((s) => s.role === "coo")!.touched, ["invest_cap"]);
  assert.ok(!("_touched" in (inst.seats.find((s) => s.role === "coo")!.partial as object)));
  // …and it IS what the store holds (one jsonb key — no column).
  const raw = (await store.getMemberDecisions(gameId, 0, firm.id)).find((m) => m.user_id === "u-coo")!;
  assert.deepEqual((raw.partial as Record<string, unknown>)._touched, ["invest_cap"]);
  void standing;
});

test("a held lever: back at the standing value but still in the list, it stays the chair's — at submit AND at lock", async () => {
  const { orch, store, gameId, firm, standing } = await firmOfThree();
  await orch.submitMemberDecision(gameId, firm.id, "u-coo", { invest_cap: 90_000 }, "coo", ["invest_cap"]);
  // The COO puts it back to the standing value; the client re-sends the list it already holds.
  await orch.submitMemberDecision(gameId, firm.id, "u-coo", { invest_cap: standing.invest_cap }, "coo", ["invest_cap"]);
  await orch.submitMemberDecision(gameId, firm.id, "u-ceo", { ...standing, invest_cap: 435_000 }, "ceo", ["invest_cap"]);
  const plan = await orch.getTeamPlan(gameId, firm.id, "u-ceo");
  assert.equal(plan.composed?.invest_cap, standing.invest_cap, "…and still holds it against the CEO");
  assert.deepEqual(plan.seats.find((s) => s.role === "coo")!.touched, ["invest_cap"]);
  // The instructor's live compose and the lock-time recompose (the merge that actually trades)
  // must use the list too — value inference alone would hand this lever to the CEO.
  const inst = (await orch.getTeamDecisions(gameId)).teams.find((t) => t.teamId === firm.id)!;
  assert.equal(inst.composed?.invest_cap, standing.invest_cap);
  await orch.lockRound(gameId);
  assert.equal((await store.getDecision(gameId, 0, firm.id))!.decision.invest_cap, standing.invest_cap);
});

test("an older client (no touched in the body) still merges: intent inferred from the standing plan", async () => {
  const { orch, gameId, firm, standing } = await firmOfThree();
  await orch.submitMemberDecision(gameId, firm.id, "u-coo", { invest_cap: standing.invest_cap }, "coo");
  await orch.submitMemberDecision(gameId, firm.id, "u-ceo", { ...standing, invest_cap: 435_000 }, "ceo");
  const plan = await orch.getTeamPlan(gameId, firm.id, "u-ceo");
  assert.equal(plan.composed?.invest_cap, 435_000);
  assert.equal(plan.seats.find((s) => s.role === "coo")!.touched, undefined);
});

test("hostile input: junk in `touched`, or a `_touched` smuggled inside the decision, is dropped", async () => {
  const { orch, gameId, firm, standing } = await firmOfThree();
  await orch.submitMemberDecision(gameId, firm.id, "u-cfo", { debt_draw: 0, _touched: ["invest_cap", "debt_draw"] } as never, "cfo", ["not_a_lever", 7, null, "dividend"] as never);
  const plan = await orch.getTeamPlan(gameId, firm.id, "u-ceo");
  const cfo = plan.seats.find((s) => s.role === "cfo")!;
  assert.deepEqual(cfo.touched, ["dividend"]);
  assert.deepEqual(cfo.partial, { debt_draw: 0 });
  void standing;
});

test("a new round starts clean: last round's touched levers do not carry", async () => {
  const { orch, gameId, firm, standing } = await firmOfThree();
  await orch.submitMemberDecision(gameId, firm.id, "u-coo", { invest_cap: 90_000 }, "coo", ["invest_cap"]);
  await orch.lockRound(gameId);
  await orch.resolveRound(gameId);
  const plan = await orch.getTeamPlan(gameId, firm.id, "u-ceo");
  assert.equal(plan.seats.find((s) => s.role === "coo")!.partial, null);
  assert.equal(plan.seats.find((s) => s.role === "coo")!.touched, undefined);
  void standing;
});

test("DW-076: re-joining in a NEW chair drops the old desk's slice (it would merge as untouched off-desk entries)", async () => {
  const { orch, gameId, firm, standing, code } = await firmOfThree();
  await orch.submitMemberDecision(gameId, firm.id, "u-coo", { invest_cap: standing.invest_cap, invest_Q: 0 }, "coo", []);
  await orch.submitMemberDecision(gameId, firm.id, "u-ceo", { ...standing, invest_cap: 435_000 }, "ceo", ["invest_cap"]);
  // The COO's untouched slice yields to the CEO (DW-073) — now they swap to the empty CMO chair…
  await orch.joinGame(code, "Ops", "u-coo", { teamId: firm.id, role: "cmo" });
  const plan = await orch.getTeamPlan(gameId, firm.id, "u-ceo");
  const them = plan.seats.find((s) => s.name === "Ops")!;
  assert.equal(them.role, "cmo");
  assert.equal(them.partial, null, "the operations slice does not follow them to the commercial desk");
  assert.equal(plan.composed?.invest_cap, 435_000, "…and the CEO's tanks still run");
  // Re-joining in the SAME chair keeps the slice (a reload, a second device).
  await orch.submitMemberDecision(gameId, firm.id, "u-cfo", { debt_draw: 50_000 }, "cfo", ["debt_draw"]);
  await orch.joinGame(code, "Fin", "u-cfo", { teamId: firm.id, role: "cfo" });
  assert.equal((await orch.getTeamPlan(gameId, firm.id, "u-ceo")).seats.find((s) => s.role === "cfo")!.partial?.debt_draw, 50_000);
});
