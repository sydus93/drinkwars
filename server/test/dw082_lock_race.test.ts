import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "drinkwars-engine/node";
import { GameOrchestrator } from "../src/lifecycle.js";
import { InMemoryAdapter } from "../src/adapters/memory.js";

// DW-082 (audit #5) — a submit that races the instructor's Lock. The lock was checked AFTER the seat's
// slice was written, so the student read "Not submitted — the instructor has locked this round" while
// the slice stayed saved: teammates' panels counted it, the locked record didn't, an Unlock revived it.

/** Lands the instructor's Lock in the middle of the next submit (after its open-round check). */
class LockMidSubmit extends InMemoryAdapter {
  hook: (() => Promise<unknown>) | null = null;
  override async getTeam(id: string) {
    const t = await super.getTeam(id);
    const h = this.hook;
    if (h) { this.hook = null; await h(); }
    return t;
  }
}

test("a submit the lock overtakes is refused and leaves the seat's slice as it was", async () => {
  const config = loadConfig({ game: { n_firms: 3, n_rounds: 5 } } as never);
  const store = new LockMidSubmit();
  let now = 1000;
  const orch = new GameOrchestrator(store, () => (now += 10), { botFillEmptySlots: true });
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });
  const team = (await store.getTeams(gameId))[0];
  await orch.joinGame(code, "Fin", "u-cfo", { teamId: team.id, role: "cfo" });
  await orch.submitMemberDecision(gameId, team.id, "u-cfo", { debt_draw: 100 }, "cfo", ["debt_draw"], 0);
  store.hook = () => orch.lockRound(gameId);
  await assert.rejects(orch.submitMemberDecision(gameId, team.id, "u-cfo", { debt_draw: 999 }, "cfo", ["debt_draw"], 0), /locked/);
  const mine = (await store.getMemberDecisions(gameId, 0, team.id)).find((m) => m.user_id === "u-cfo")!;
  assert.equal(mine.partial.debt_draw, 100, "the refused submit wrote nothing");
  const rec = (await store.getDecision(gameId, 0, team.id))!;
  assert.equal(rec.locked, true);
  assert.equal(rec.decision.debt_draw, 100, "what locked is what the seat had sent");
});
