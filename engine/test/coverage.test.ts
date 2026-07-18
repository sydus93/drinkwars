/**
 * Coverage tests for engine paths the balance sweeps never exercise: the two
 * untested coopetition templates (supply_share, joint_marketing) and the §8
 * exit elections (operator-to-investor, rebuild/re-entry). These drive the code
 * directly so the branches are known-correct before any UI depends on them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGame, resolveRound } from "../src/index.js";
import { loadConfig } from "../src/config/load.js";
import type { FirmDecision, SegmentId, WorldState } from "../src/types.js";

function decision(firm_id: string, world: WorldState, over: Partial<FirmDecision> = {}): FirmDecision {
  const price: Record<SegmentId, number> = {};
  const presence: Record<SegmentId, number> = {};
  for (const s of world.segments) {
    price[s.id] = 8;
    presence[s.id] = s.id === "niche" ? 1 : 0; // default: serve niche
  }
  return {
    firm_id, price, presence,
    invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
    debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0,
    buy_info: false, agreement_actions: [], exit_action: null,
    ...over,
  };
}

test("supply_share agreement lowers signatories' unit cost once accepted (§11.2 + mutual consent)", () => {
  const c = loadConfig();
  const world = initGame(c);
  // Mutual consent: round 0 = firm_1 proposes (a pending overture, NO cost effect yet)…
  const r0 = resolveRound(world, [
    decision("firm_1", world, { agreement_actions: [{ type: "form", form: "formal", template: "supply_share", counterparties: ["firm_2"] }] }),
    decision("firm_2", world),
  ], c);
  const p0 = r0.result.firm_results.find((f) => f.firm_id === "firm_1")!;
  assert.equal(p0.cost_buildup.supply_share, 1, "a mere proposal must have no cost effect");
  assert.equal(r0.world.agreements.length, 0, "no pact binds before acceptance");
  assert.equal(r0.world.pending_agreements?.length, 1, "the overture is pending");
  // …round 1 = firm_2 accepts ⇒ the pact binds and the reduction applies.
  const { result, world: w1 } = resolveRound(r0.world, [
    decision("firm_1", r0.world),
    decision("firm_2", r0.world, { agreement_actions: [{ type: "accept_proposal", proposal_id: r0.world.pending_agreements![0].id }] }),
  ], c);
  const f1 = result.firm_results.find((f) => f.firm_id === "firm_1")!;
  const f3 = result.firm_results.find((f) => f.firm_id === "firm_3")!; // not a signatory
  assert.ok(w1.agreements[0]?.active, "acceptance binds the pact");
  // supply_share factor in the cost build-up is (1 - reduction) < 1 for signatories.
  assert.ok(f1.cost_buildup.supply_share < 1, `signatory should get a cost reduction (got ${f1.cost_buildup.supply_share})`);
  assert.equal(f3.cost_buildup.supply_share, 1, "non-signatory should get no reduction");
});

test("joint_marketing pools brand into a signatory's segment utility once accepted (§11.2)", () => {
  const c = loadConfig();
  const world = initGame(c);
  const r0 = resolveRound(world, [
    decision("firm_1", world, { agreement_actions: [{ type: "form", form: "relational", template: "joint_marketing", counterparties: ["firm_2"], segment: "niche" }] }),
    decision("firm_2", world),
  ], c);
  const { result } = resolveRound(r0.world, [
    decision("firm_1", r0.world),
    decision("firm_2", r0.world, { agreement_actions: [{ type: "accept_proposal", proposal_id: r0.world.pending_agreements![0].id }] }),
  ], c);
  const f1 = result.firm_results.find((f) => f.firm_id === "firm_1")!;
  // The pooled-brand term shows up as the segment's "agreement" attraction component.
  assert.ok(f1.segments.niche.attraction.agreement > 0, "joint-marketing should add pooled brand to niche utility");
});

test("mutual consent: decline kills an overture; unanswered ones lapse; duplicates dedupe", () => {
  const c = loadConfig();
  const world = initGame(c);
  const propose = (w: typeof world) =>
    decision("firm_1", w, { agreement_actions: [{ type: "form", form: "formal", template: "supply_share", counterparties: ["firm_2"] }] });
  // Decline: the overture dies, nothing binds, the proposer paid nothing.
  const a0 = resolveRound(world, [propose(world), decision("firm_2", world)], c);
  const a1 = resolveRound(a0.world, [
    decision("firm_1", a0.world),
    decision("firm_2", a0.world, { agreement_actions: [{ type: "decline_proposal", proposal_id: a0.world.pending_agreements![0].id }] }),
  ], c);
  assert.equal(a1.world.agreements.length, 0, "declined ⇒ no pact");
  assert.equal(a1.world.pending_agreements!.length, 0, "declined ⇒ overture removed");
  // Lapse: two rounds unanswered ⇒ the overture expires on its own.
  const b0 = resolveRound(world, [propose(world), decision("firm_2", world)], c);
  const b1 = resolveRound(b0.world, [decision("firm_1", b0.world), decision("firm_2", b0.world)], c);
  const b2 = resolveRound(b1.world, [decision("firm_1", b1.world), decision("firm_2", b1.world)], c);
  assert.equal(b2.world.pending_agreements!.length, 0, "unanswered overture lapses after its window");
  assert.equal(b2.world.agreements.length, 0, "a lapsed overture never binds");
  // Dedupe: re-sending the same form action every round (a client re-fire) stacks nothing.
  const c0 = resolveRound(world, [propose(world), decision("firm_2", world)], c);
  const c1 = resolveRound(c0.world, [
    propose(c0.world), // duplicate proposal while the first is pending
    decision("firm_2", c0.world, { agreement_actions: [{ type: "accept_proposal", proposal_id: c0.world.pending_agreements![0].id }] }),
  ], c);
  assert.equal(c1.world.agreements.length, 1, "one pact");
  const c2 = resolveRound(c1.world, [propose(c1.world), decision("firm_2", c1.world)], c);
  assert.equal(c2.world.agreements.filter((a) => a.active).length, 1, "an identical active pact dedupes any re-proposal");
  assert.equal(c2.world.pending_agreements!.length, 0, "no shadow proposal accumulates");
});

test("operator-to-investor: voluntary exit buys a stake at fair value (§8.4)", () => {
  // Inventory disabled: this exercises the §8.4 invest election, not production
  // economics — with stock on, the hand-built rivals (zero-fill, price 0) would
  // make firm_1 overproduce and fail the stake-affordability gate.
  const c = loadConfig({ modules: { inventory: { enabled: false } } } as never);
  const world = initGame(c);
  // firm_2 must be a going concern (real price/presence) — a zero-filled dummy sells
  // nothing, and 12× its first-round loss prices its fair value below zero, which
  // correctly forecloses the stake purchase (§7.5). The test targets §8.4, not that.
  const decisions = [
    decision("firm_1", world, { exit_action: { type: "voluntary", path: "invest", target_firm: "firm_2" } }),
    decision("firm_2", world),
  ];
  const { world: next } = resolveRound(world, decisions, c);
  const f1 = next.firms.find((f) => f.id === "firm_1")!;
  const f2 = next.firms.find((f) => f.id === "firm_2")!;
  assert.equal(f1.status, "exited_invested");
  assert.equal(f1.holdings.length, 1);
  assert.equal(f1.holdings[0].firm_id, "firm_2");
  assert.ok(f1.holdings[0].stake_fraction > 0 && f1.holdings[0].stake_fraction <= 1);
  assert.ok(f2.cap_table.some((h) => h.holder_id === "firm_1"), "target cap table should record the new holder");
});

test("rebuild/re-entry resets the firm, sets a cooldown, then re-activates (§8.3)", () => {
  const c = loadConfig();
  let world = initGame(c);
  const decisions = [decision("firm_1", world, { exit_action: { type: "voluntary", path: "rebuild", reposition_segment: "mass" } })];
  const out = resolveRound(world, decisions, c);
  world = out.world;
  const f1 = world.firms.find((f) => f.id === "firm_1")!;
  assert.equal(f1.status, "exited_rebuilt");
  assert.equal(f1.reentry_count, 1);
  assert.equal(f1.primary_segment, "mass");
  assert.equal(f1.cap, c.init.starting_cap, "stocks reset to fresh");
  assert.ok(f1.cooldown_until_round !== null);

  // After the cooldown elapses it re-activates.
  const out2 = resolveRound(world, [], c);
  const f1b = out2.world.firms.find((f) => f.id === "firm_1")!;
  assert.equal(f1b.status, "active", "should re-activate once the cooldown passes");
});

test("rebuild is rejected if it does not reposition to a different segment (§8.3)", () => {
  const c = loadConfig();
  const world = initGame(c);
  // Set firm_1's primary segment, then try to rebuild into the same one.
  world.firms[0].primary_segment = "niche";
  const decisions = [decision("firm_1", world, { exit_action: { type: "voluntary", path: "rebuild", reposition_segment: "niche" } })];
  const { result } = resolveRound(world, decisions, c);
  assert.ok(result.events.some((e) => e.includes("REBUILD rejected")), "same-segment rebuild should be rejected");
});

test("info purchase flag passes through to the results record (§15.7)", () => {
  const c = loadConfig();
  const world = initGame(c);
  const { result } = resolveRound(world, [decision("firm_1", world, { buy_info: true })], c);
  assert.equal(result.firm_results.find((f) => f.firm_id === "firm_1")!.info_purchased, true);
});
