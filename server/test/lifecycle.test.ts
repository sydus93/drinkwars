/**
 * Orchestration tests (application-spec §5, §3). Drive the lifecycle on the
 * in-memory adapter: state-machine transitions + guards, non-submission
 * zero-fill, append-only immutability, locked-decision rejection, replay
 * determinism (§3.3), and consent capture (§18).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "drinkwars-engine/node";
import { initGame, resolveRound } from "drinkwars-engine";
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

test("non-submission is flagged, and the firm still resolves", async () => {
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
  assert.ok(firmRounds.some((r) => r.firm_id === skippedFirm), "a filled-in firm still resolves");
});

test("a resolved round is append-only (cannot be re-resolved)", async () => {
  const { config, orch, gameId, teamRecords } = await setup();
  await submitAll(orch, gameId, teamRecords, config);
  await orch.lockRound(gameId);
  await orch.resolveRound(gameId);
  // Lifecycle guard blocks a second resolve...
  await assert.rejects(() => orch.resolveRound(gameId), LifecycleError);
});

test("in-memory adapter rejects re-writing an append-only row (0008 rule: identical re-writes pass, resolved rounds are frozen)", async () => {
  const { store, gameId } = await setup();
  const ws = (await store.getWorldState(gameId, 0))!;
  await store.appendWorldState({ ...ws, created_at: ws.created_at + 1 }); // a retried resolve: same row, new created_at
  await store.appendWorldState({ ...ws, state: { ...ws.state, live_triggers: ["water"] } }); // pending round: gamemaster edit
  await store.setGameLifecycle(gameId, "open", 1); // round 0 is now history
  await assert.rejects(() => store.appendWorldState({ ...ws, state: { ...ws.state, live_triggers: [] } }), /append-only/);
  const rr = { game_id: gameId, round: 0, result: { x: 1 } as never, created_at: 1 };
  await store.appendRoundResult(rr);
  await store.appendRoundResult({ ...rr, created_at: 2 });
  await assert.rejects(() => store.appendRoundResult({ ...rr, result: { x: 2 } as never }), /append-only/);
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

test("gamemaster (DW-037): planted shocks land on the timeline, fire on schedule, and live triggers arm", async () => {
  const { config, store, orch, gameId, teamRecords } = await setup();

  // The forward schedule is readable and carries the config's catalog.
  const t0 = await orch.getTimeline(gameId);
  assert.equal(t0.round, 0);
  assert.ok(t0.catalog.some((c) => c.id === "water"), "catalog lists the configured shock types");

  // Plant a harvest failure on round 1 at a chosen severity; it lands locked.
  const planted = await orch.scheduleShock(gameId, { type_id: "harvest", round: 1, magnitude: 0.4, duration: 1 });
  assert.ok(planted.locked && !planted.fired && planted.round === 1);
  const t1 = await orch.getTimeline(gameId);
  assert.ok(t1.timeline.some((s) => s.id === planted.id), "planted shock is on the schedule");

  // It can be removed while unfired… then re-planted for the real test.
  await orch.unscheduleShock(gameId, planted.id);
  assert.ok(!(await orch.getTimeline(gameId)).timeline.some((s) => s.id === planted.id));
  const again = await orch.scheduleShock(gameId, { type_id: "harvest", round: 1, magnitude: 0.4, duration: 1 });

  // Arm a live trigger for round 0 as well: the water shock fires when THIS round resolves.
  const armed = await orch.setLiveTrigger(gameId, "water", true);
  assert.deepEqual(armed, ["water"]);

  // Round 0 resolves: the live trigger fires (and clears); round 1 resolves: the planted shock fires.
  await submitAll(orch, gameId, teamRecords, config);
  await orch.lockRound(gameId);
  await orch.resolveRound(gameId);
  const r0 = (await store.getRoundResult(gameId, 0))!;
  assert.ok(r0.result.events.some((e) => /live-triggered/.test(e)), "live trigger fires on resolve");
  await orch.advanceRound(gameId);
  assert.deepEqual((await orch.getTimeline(gameId)).liveTriggers, [], "live trigger clears after firing");

  await submitAll(orch, gameId, teamRecords, config);
  await orch.lockRound(gameId);
  await orch.resolveRound(gameId);
  const r1 = (await store.getRoundResult(gameId, 1))!;
  assert.ok(r1.result.events.some((e) => /SHOCK.*harvest/i.test(e)), "planted shock fires on its round");
  const after = await orch.getTimeline(gameId);
  assert.ok(after.timeline.find((s) => s.id === again.id)?.fired, "planted shock is marked fired");
  await assert.rejects(() => orch.unscheduleShock(gameId, again.id), /already fired/, "fired shocks are immutable");
  // DW-066 (mirrors migration 0008): resolved rounds' world states are frozen; only the pending
  // round's record takes gamemaster edits.
  const cur = (await store.getLatestWorldState(gameId))!;
  await assert.rejects(() => store.updateWorldState(gameId, 0, cur.state), /already resolved/);
  await store.updateWorldState(gameId, cur.round, cur.state);

  // Guard: can't plant into the past or beyond the season.
  await orch.advanceRound(gameId);
  await assert.rejects(() => orch.scheduleShock(gameId, { type_id: "harvest", round: 0 }), /not schedulable/);
  await assert.rejects(() => orch.scheduleShock(gameId, { type_id: "harvest", round: 99 }), /not schedulable/);
});

test("DW-066: a resolve that dies half-way can be re-run — twice-written fill-ins and appends are idempotent", async () => {
  const { store, orch, gameId } = await setup();
  // One human submits; the other firms are NPC / no-show fill-ins (every class game has some).
  const teams = await store.getTeams(gameId);
  await orch.submitDecision(gameId, teams[0].id, { ...(await orch.getStandingDecision(gameId, teams[0].id))!, invest_Q: 5 });
  await orch.lockRound(gameId);
  // Die AFTER the world state + fill-ins are written, before the round result lands.
  const real = store.appendRoundResult.bind(store);
  let dieOnce = true;
  (store as any).appendRoundResult = async (rec: any) => { if (dieOnce) { dieOnce = false; throw new Error("edge function timed out"); } return real(rec); };
  await assert.rejects(() => orch.resolveRound(gameId), /timed out/);
  assert.equal((await store.getGame(gameId))!.lifecycle, "locked", "the catch puts the round back where the instructor can act");
  assert.ok(await store.getWorldState(gameId, 1), "the first attempt already appended round 1's world state");
  // Retry resolve: same inputs → identical writes; the fill-in rows from attempt 1 must not be re-upserted.
  const r = await orch.resolveRound(gameId);
  assert.equal(r.lifecycle, "published");
  assert.equal((await store.getGame(gameId))!.current_round, 1);
  assert.ok(await store.getRoundResults(gameId).then((x) => x.length === 1));
  // And the DW-046 `force` path (process died while still "resolving"): re-run from that mark.
  await orch.advanceRound(gameId);
  await orch.lockRound(gameId);
  await store.setGameLifecycle(gameId, "resolving", 1);
  await assert.rejects(() => orch.resolveRound(gameId), /not locked/);
  assert.equal((await orch.resolveRound(gameId, { force: true })).lifecycle, "published");
});

test("DW-072 #8: a game with instructor-fired shocks replays end to end (planted + removed + live trigger)", async () => {
  const { config, store, orch, gameId, teamRecords } = await setup();
  // Round 0: arm a live water trigger. Round 1: plant a harvest shock for round 2, and remove one
  // engine-rolled shock if any is still pending.
  await orch.setLiveTrigger(gameId, "water", true);
  for (let r = 0; r < config.game.n_rounds; r++) {
    if (r === 1) {
      await orch.scheduleShock(gameId, { type_id: "harvest", round: 2, magnitude: 0.5, duration: 1 });
      const pending = (await orch.getTimeline(gameId)).timeline.find((s) => !s.fired && !s.locked && s.round >= 1);
      if (pending) await orch.unscheduleShock(gameId, pending.id);
    }
    await submitAll(orch, gameId, teamRecords, config);
    await orch.lockRound(gameId);
    await orch.resolveRound(gameId);
    if (r < config.game.n_rounds - 1) await orch.advanceRound(gameId);
  }
  const rep = await orch.replay(gameId);
  assert.deepEqual(rep.mismatches, [], "replay reproduces every round incl. the instructor-fired shocks");
  assert.ok(rep.ok);
  assert.ok(rep.interventions.some((i) => i.round === 0 && i.liveTriggers.includes("water")), "the live trigger is reported");
  assert.ok(rep.interventions.some((i) => i.round === 1 && i.added.some((s) => s.type_id === "harvest")), "the planted shock is reported");

  // And the test is meaningful: a config-only chain (the pre-DW-072 replay) diverges.
  let world = initGame(config);
  let diverged = false;
  for (const rr of await store.getRoundResults(gameId)) {
    const { world: next, result } = resolveRound(world, (await store.getDecisions(gameId, rr.round)).map((d) => d.decision), config);
    for (const fr of result.firm_results) {
      const s = rr.result.firm_results.find((x) => x.firm_id === fr.firm_id)!;
      if (Math.abs(s.state.cash - fr.state.cash) > 1e-6) diverged = true;
    }
    world = next;
  }
  assert.ok(diverged, "without the overlay the shocks are lost and the replay diverges");
});

test("DW-072 #8: replay does NOT wave through a stored shock no instructor action could produce", async () => {
  const { config, store, orch, gameId, teamRecords } = await setup();
  for (let r = 0; r < config.game.n_rounds; r++) {
    await submitAll(orch, gameId, teamRecords, config);
    await orch.lockRound(gameId);
    await orch.resolveRound(gameId);
    if (r < config.game.n_rounds - 1) await orch.advanceRound(gameId);
  }
  assert.ok((await orch.replay(gameId)).ok, "clean game replays");
  // Corrupt an engine-rolled shock IN PLACE in a stored round (what an engine bug in the
  // schedule, or a damaged row, would look like). The overlay must not launder it into "ok".
  let tampered = false;
  for (let r = 0; r < config.game.n_rounds && !tampered; r++) {
    // Reach past the adapter: resolved rounds are append-only through its API (as on Postgres).
    for (const ws of (store as unknown as { worldStates: Map<string, { game_id: string; round: number; state: { shock_timeline?: { locked?: boolean; magnitude?: number }[] } }> }).worldStates.values()) {
      const sh = ws.game_id === gameId && ws.round === r ? ws.state.shock_timeline?.find((s) => !s.locked) : undefined;
      if (sh) { sh.magnitude = (sh.magnitude ?? 0) * 3 + 0.1; tampered = true; }
    }
  }
  assert.ok(tampered, "fixture must roll at least one engine shock, or this test proves nothing");
  const rep = await orch.replay(gameId);
  assert.equal(rep.ok, false, "an in-place schedule change is a mismatch");
  assert.ok(rep.mismatches.some((m) => /shock/.test(m)));
});
