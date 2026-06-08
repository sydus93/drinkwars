/**
 * Orchestration tests (application-spec §5, §3). Drive the lifecycle on the
 * in-memory adapter: state-machine transitions + guards, non-submission
 * zero-fill, append-only immutability, locked-decision rejection, replay
 * determinism (§3.3), and consent capture (§18).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "drinkwars-engine/node";
import type { Config, FirmDecision, SegmentId, WorldState } from "drinkwars-engine";
import { GameOrchestrator, InMemoryAdapter, LifecycleError } from "../src/index.js";

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

async function setup(consentAll = false) {
  const config = loadConfig({ game: { n_rounds: 4, n_firms: 4 } } as never);
  const store = new InMemoryAdapter();
  const orch = new GameOrchestrator(store);
  for (let i = 0; i < 4; i++) await store.createUser({ id: `u${i}`, role: "student", email: null, consent: consentAll || i === 0, deid_code: `s${i}` });
  const teams = [0, 1, 2, 3].map((i) => ({ name: `T${i}`, memberUserIds: [`u${i}`] }));
  const gameId = await orch.createGame({ config, teams });
  const teamRecords = await store.getTeams(gameId);
  return { config, store, orch, gameId, teamRecords };
}

async function submitAll(orch: GameOrchestrator, gameId: string, teamRecords: { id: string; firm_id: string }[], config: Config, skip: string[] = []) {
  const pub = await orch.getPublicState(gameId);
  const activeSegs = pub.segments.filter((s) => s.active).map((s) => s.id);
  for (const t of teamRecords) {
    if (skip.includes(t.id)) continue;
    const view = await orch.getTeamView(gameId, t.id);
    if (view.own?.status === "active") await orch.submitDecision(gameId, t.id, decide(view.own, activeSegs, config));
  }
}

test("full lifecycle runs to complete", async () => {
  const { config, orch, gameId, teamRecords } = await setup();
  for (let r = 0; r < config.game.n_rounds; r++) {
    await submitAll(orch, gameId, teamRecords, config);
    await orch.lockRound(gameId);
    const { lifecycle } = await orch.resolveRound(gameId);
    if (lifecycle === "published") await orch.advanceRound(gameId);
  }
  const status = await orch.getStatus(gameId);
  assert.equal(status.lifecycle, "complete");
  assert.equal(status.round, config.game.n_rounds);
});

test("state-machine guards reject out-of-order operations", async () => {
  const { config, orch, gameId, teamRecords } = await setup();
  // Cannot resolve before locking.
  await assert.rejects(() => orch.resolveRound(gameId), LifecycleError);
  // Cannot advance before publishing.
  await assert.rejects(() => orch.advanceRound(gameId), LifecycleError);
  await submitAll(orch, gameId, teamRecords, config);
  await orch.lockRound(gameId);
  // Cannot submit once locked.
  const view = await orch.getTeamView(gameId, teamRecords[0].id);
  await assert.rejects(() => orch.submitDecision(gameId, teamRecords[0].id, decide(view.own!, [], config)), LifecycleError);
  // Cannot lock twice.
  await assert.rejects(() => orch.lockRound(gameId), LifecycleError);
});

test("non-submission is flagged and zero-filled", async () => {
  const { config, store, orch, gameId, teamRecords } = await setup();
  const skipped = teamRecords[2].id;
  await submitAll(orch, gameId, teamRecords, config, [skipped]);
  const nonSubmitters = await orch.lockRound(gameId);
  assert.deepEqual(nonSubmitters, [skipped]);
  await orch.resolveRound(gameId);
  // Every active firm still gets a firm_round row, and the skipper a non-submit telemetry row.
  const firmRounds = await store.getFirmRounds(gameId);
  assert.equal(firmRounds.filter((r) => r.round === 0).length, 4);
  const telemetry = await store.getTelemetry(gameId);
  const skippedFirm = teamRecords[2].firm_id;
  const tel = telemetry.find((t) => t.round === 0 && t.team_id === skipped);
  assert.ok(tel && tel.submitted === false, "skipped team should have a non-submitted telemetry row");
  assert.ok(firmRounds.some((r) => r.firm_id === skippedFirm), "zero-filled firm still resolves");
});

test("a resolved round is append-only (cannot be re-resolved)", async () => {
  const { config, orch, gameId, teamRecords } = await setup();
  await submitAll(orch, gameId, teamRecords, config);
  await orch.lockRound(gameId);
  await orch.resolveRound(gameId);
  // Lifecycle guard blocks a second resolve...
  await assert.rejects(() => orch.resolveRound(gameId), LifecycleError);
});

test("in-memory adapter rejects re-writing an append-only row", async () => {
  const { store, gameId } = await setup();
  const ws = (await store.getWorldState(gameId, 0))!;
  await assert.rejects(() => store.appendWorldState(ws), /append-only/);
});

test("replay reproduces the stored history exactly (§3.3)", async () => {
  const { config, orch, gameId, teamRecords } = await setup();
  for (let r = 0; r < config.game.n_rounds; r++) {
    await submitAll(orch, gameId, teamRecords, config, r === 1 ? [teamRecords[1].id] : []);
    await orch.lockRound(gameId);
    const { lifecycle } = await orch.resolveRound(gameId);
    if (lifecycle === "published") await orch.advanceRound(gameId);
  }
  const replay = await orch.replay(gameId);
  assert.ok(replay.ok, `replay mismatches:\n${replay.mismatches.join("\n")}`);
});

test("consent flows through to firm_round rows (§18)", async () => {
  // Only u0 consents; firm_round consent is team-level (all members must consent).
  const { config, store, orch, gameId, teamRecords } = await setup(false);
  await submitAll(orch, gameId, teamRecords, config);
  await orch.lockRound(gameId);
  await orch.resolveRound(gameId);
  const firmRounds = await store.getFirmRounds(gameId);
  const consentByFirm = new Map(firmRounds.filter((r) => r.round === 0).map((r) => [r.firm_id, r.consent]));
  assert.equal(consentByFirm.get(teamRecords[0].firm_id), true, "u0's team consented");
  assert.equal(consentByFirm.get(teamRecords[1].firm_id), false, "u1's team did not consent");
});

test("team view exposes own firm + standings, not rivals' pending decisions", async () => {
  const { config, store, orch, gameId, teamRecords } = await setup();
  await submitAll(orch, gameId, teamRecords, config);
  // Before resolution, another team's decision exists in storage but is not reachable via a team-facing method.
  const view = await orch.getTeamView(gameId, teamRecords[0].id);
  assert.equal(view.own?.id, teamRecords[0].firm_id);
  // The only decision accessor is storage-level (service/instructor); no team API returns it.
  assert.ok(!("decisions" in view));
});
