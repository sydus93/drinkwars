import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "drinkwars-engine/node";
import { GameOrchestrator } from "../src/lifecycle.js";
import { InMemoryAdapter } from "../src/adapters/memory.js";
import type { StorageAdapter } from "../src/types.js";

// DW-072 #5 hardening (from the 2026-10-04 review): the instructor's Decisions view must show
// what lock WILL run, work for solo games, and stay cheap — the panel polls it during a round.

/** Count store reads by method (writes pass through uncounted). */
function counting(store: InMemoryAdapter): { store: StorageAdapter; reads: Record<string, number>; total: () => number } {
  const reads: Record<string, number> = {};
  const proxy = new Proxy(store, {
    get(t, k: string) {
      const v = (t as unknown as Record<string, unknown>)[k];
      if (typeof v !== "function" || !/^get/.test(k)) return typeof v === "function" ? v.bind(t) : v;
      return (...a: unknown[]) => { reads[k] = (reads[k] ?? 0) + 1; return (v as (...x: unknown[]) => unknown).apply(t, a); };
    },
  }) as unknown as StorageAdapter;
  return { store: proxy, reads, total: () => Object.values(reads).reduce((a, b) => a + b, 0) };
}

async function classGame(mode: "team" | "solo", nFirms = 8) {
  const config = loadConfig({ game: { n_firms: nFirms, n_rounds: 5 } } as never);
  const mem = new InMemoryAdapter();
  const c = counting(mem);
  const orch = new GameOrchestrator(c.store, (() => { let t = 1000; return () => (t += 10); })(), { botFillEmptySlots: true });
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: mode, teams: Array.from({ length: nFirms }, (_, i) => ({ name: `F${i + 1}` })) });
  const teams = await mem.getTeams(gameId);
  return { config, mem, c, orch, code, gameId, teams };
}

test("read budget: 7 seated firms × 5 chairs + 1 NPC costs ≤ 13 reads, in round 0 and round 1", async () => {
  const { c, orch, code, gameId, teams, mem } = await classGame("team");
  const roles = ["ceo", "cmo", "coo", "cfo", "chro"];
  for (let i = 0; i < 7; i++) for (const r of roles) await orch.joinGame(code, `${r}${i}`, `u-${i}-${r}`, { teamId: teams[i].id, role: r });
  for (let i = 0; i < 7; i++) await orch.submitMemberDecision(gameId, teams[i].id, `u-${i}-cfo`, { debt_draw: 100 }, "cfo", ["debt_draw"]);
  const measure = async () => { for (const k of Object.keys(c.reads)) delete c.reads[k]; await orch.getTeamDecisions(gameId); return c.total(); };
  const r0 = await measure();
  assert.ok(r0 <= 13, `round 0: ${r0} reads ${JSON.stringify(c.reads)}`);
  await orch.lockRound(gameId); await orch.resolveRound(gameId); await orch.advanceRound(gameId);
  for (let i = 0; i < 7; i++) await orch.submitMemberDecision(gameId, teams[i].id, `u-${i}-cfo`, { debt_draw: 100 }, "cfo", ["debt_draw"]);
  const r1 = await measure();
  assert.ok(r1 <= 13, `round 1: ${r1} reads ${JSON.stringify(c.reads)}`);
  void mem;
});

test("'will run' is composed live from the seats shown, even when the stored record lags them", async () => {
  const { orch, code, gameId, teams, mem } = await classGame("team", 3);
  await orch.joinGame(code, "Cee", "u-ceo", { teamId: teams[0].id, role: "ceo" });
  await orch.joinGame(code, "Fin", "u-cfo", { teamId: teams[0].id, role: "cfo" });
  const standing = (await orch.getStandingDecision(gameId, teams[0].id))!;
  await orch.submitMemberDecision(gameId, teams[0].id, "u-ceo", { ...standing }, "ceo", []);
  // A CFO slice that landed after the last compose read (two submits racing): row exists, record lags.
  await mem.upsertMemberDecision({ game_id: gameId, round: 0, team_id: teams[0].id, user_id: "u-cfo", desk: "finance", partial: { debt_draw: 500, _touched: ["debt_draw"] } as never, submitted: true, updated_at: 5000 });
  assert.equal((await mem.getDecision(gameId, 0, teams[0].id))!.decision.debt_draw, 0, "precondition: the stored record missed it");
  const t = (await orch.getTeamDecisions(gameId)).teams.find((x) => x.teamId === teams[0].id)!;
  assert.equal(t.composed?.debt_draw, 500, "the panel shows what lock will run");
  await orch.lockRound(gameId);
  assert.equal((await mem.getDecision(gameId, 0, teams[0].id))!.decision.debt_draw, 500, "…and lock does run it");
  const after = (await orch.getTeamDecisions(gameId)).teams.find((x) => x.teamId === teams[0].id)!;
  assert.equal(after.composed?.debt_draw, 500);
  assert.equal(after.locked, true);
});

test("solo games: a player who submitted shows as submitted, with their decision as the slice", async () => {
  const { orch, code, gameId, teams } = await classGame("solo", 3);
  await orch.joinGame(code, "Ana", "u-ana", { teamId: teams[0].id });
  const standing = (await orch.getStandingDecision(gameId, teams[0].id))!;
  await orch.submitDecision(gameId, teams[0].id, { ...standing, invest_Q: 12_000 });
  const v = await orch.getTeamDecisions(gameId);
  const t = v.teams.find((x) => x.teamId === teams[0].id)!;
  assert.equal(v.firmMode, "solo");
  assert.equal(t.seats.length, 1);
  assert.equal(t.seats[0].submitted, true);
  assert.equal(t.seats[0].partial?.invest_Q, 12_000);
  assert.equal(t.composed?.invest_Q, 12_000);
});

test("a moved or removed member's slice is neither shown nor composed", async () => {
  const { orch, code, gameId, teams } = await classGame("team", 3);
  await orch.joinGame(code, "Cee", "u-ceo", { teamId: teams[0].id, role: "ceo" });
  await orch.joinGame(code, "Fin", "u-cfo", { teamId: teams[0].id, role: "cfo" });
  await orch.submitMemberDecision(gameId, teams[0].id, "u-cfo", { debt_draw: 700 }, "cfo", ["debt_draw"]);
  await orch.removeMember(gameId, teams[0].id, "u-cfo");
  const t = (await orch.getTeamDecisions(gameId)).teams.find((x) => x.teamId === teams[0].id)!;
  assert.equal(t.seats.length, 1);
  assert.ok(!t.composed || (t.composed.debt_draw ?? 0) === 0);
});
