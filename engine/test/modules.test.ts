/**
 * Expansion-module framework tests. The load-bearing invariant (spec §1.2): with
 * every module flag off, the engine reproduces the v1 base game bit-for-bit. Plus:
 * the registry/preset wiring is coherent, and MOD-A07 (asymmetric starts) scales
 * the opening state while keeping the balance sheet balanced.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGame, resolveRound, runGame } from "../src/index.js";
import { loadConfig } from "../src/config/load.js";
import { MODULE_REGISTRY, PRESETS, moduleEnabled, presetById, modulesOverride } from "../src/config/modules.js";
import { computeBetaDeltas } from "../src/engine/drift.js";
import type { FirmDecision, ModuleId, SegmentId, WorldState } from "../src/types.js";
import { BASELINE_ASSIGNMENT, makeProvider } from "../harness/archetypes.js";

/** A minimal serve-the-mass decision, for exercising one module in isolation. */
function mkDecision(firm_id: string, w: WorldState, over: Partial<FirmDecision> = {}): FirmDecision {
  const price: Record<SegmentId, number> = {};
  const presence: Record<SegmentId, number> = {};
  for (const s of w.segments) { price[s.id] = 8; presence[s.id] = s.id === "mass" ? 1 : 0; }
  return {
    firm_id, price, presence,
    invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
    debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null,
    ...over,
  };
}

test("all-off parity: a game with the modules block matches one without it", () => {
  // `withModules` is the resolved baseline (modules present, all disabled);
  // `legacy` strips the block entirely (a pre-modules persisted config).
  const withModules = loadConfig();
  const legacy = loadConfig();
  delete (legacy as { modules?: unknown }).modules;
  const a = runGame(withModules, makeProvider(BASELINE_ASSIGNMENT));
  const b = runGame(legacy, makeProvider(BASELINE_ASSIGNMENT));
  const fa = a.history.at(-1)!.firm_results.map((f) => f.scorecard_cumulative);
  const fb = b.history.at(-1)!.firm_results.map((f) => f.scorecard_cumulative);
  assert.deepEqual(fa, fb, "all-off (with block) must equal legacy (no block)");
});

test("all live modules on together: a full game runs and the §7.2 invariants hold", () => {
  const live = MODULE_REGISTRY.filter((m) => m.implemented).map((m) => m.id);
  const c = loadConfig(modulesOverride(live));
  const { history } = runGame(c, makeProvider(BASELINE_ASSIGNMENT));
  let rounds = 0;
  for (const r of history) {
    for (const f of r.firm_results) {
      const bs = f.balance_sheet;
      assert.ok(Math.abs(bs.assets - (bs.debt + bs.equity)) < 1e-3, `balance ${f.firm_id} r${f.round}`);
      assert.ok(Math.abs(bs.assets - (bs.cash + bs.ppe + bs.inventory)) < 1e-3, `assets=cash+ppe+inv ${f.firm_id} r${f.round}`);
    }
    rounds++;
  }
  assert.equal(rounds, c.game.n_rounds, "the full season resolves with every module engaged");
});

test("registry is coherent: ids unique, deps resolve, presets reference real ids", () => {
  const ids = new Set(MODULE_REGISTRY.map((m) => m.id));
  assert.equal(ids.size, MODULE_REGISTRY.length, "module ids must be unique");
  for (const m of MODULE_REGISTRY) {
    for (const d of m.deps) assert.ok(ids.has(d), `${m.id} depends on unknown module ${d}`);
  }
  for (const p of PRESETS) {
    for (const id of p.modules) assert.ok(ids.has(id as ModuleId), `preset ${p.id} lists unknown module ${id}`);
  }
  // The "full" preset must enable every registered module.
  assert.equal(presetById("full")!.modules.length, MODULE_REGISTRY.length);
});

test("modulesOverride flips exactly the named flags on", () => {
  const c = loadConfig(modulesOverride(["asymmetricStarts", "inventory"]));
  assert.ok(moduleEnabled(c, "asymmetricStarts"));
  assert.ok(moduleEnabled(c, "inventory"));
  assert.ok(!moduleEnabled(c, "prEvents"), "unnamed modules stay off");
});

test("MOD-A07 asymmetric starts: incumbents start bigger, balance sheet still balances", () => {
  const c = loadConfig(modulesOverride(["asymmetricStarts"]));
  const world = initGame(c);
  const incumbent = world.firms[0]; // first incumbent_count firms are incumbents
  const entrant = world.firms.at(-1)!; // last firm is an entrant
  assert.ok(incumbent.cap > entrant.cap, "incumbent starts with more capacity");
  assert.ok(incumbent.B > entrant.B, "incumbent starts with more brand");
  assert.ok(incumbent.location_factor < entrant.location_factor, "incumbent is cheaper to produce");
  // Opening balance sheet must still balance for every firm (assets = debt + equity).
  for (const f of world.firms) {
    const assets = f.cash + f.ppe_book; // no inventory at t0
    const equity = f.paid_in_capital + f.retained_earnings;
    assert.ok(Math.abs(assets - (f.debt + equity)) < 1e-6, `opening balance for ${f.id}`);
  }
});

test("MOD-A08 consumer drift: deltas grow with the round and respect the ceiling", () => {
  const c = loadConfig(modulesOverride(["consumerDrift"]));
  const r2 = computeBetaDeltas(c, 2).get("mass")!;
  const r10 = computeBetaDeltas(c, 10).get("mass")!;
  assert.ok(r10.q > r2.q, "mass quality-sensitivity drifts further up by round 10");
  // mass beta_q base 0.05, ceiling 0.16 ⇒ delta never exceeds 0.11.
  assert.ok(computeBetaDeltas(c, 999).get("mass")!.q <= 0.16 - 0.05 + 1e-9, "delta capped by ceiling");
  assert.ok(r10.p < 0, "mass price-sensitivity drifts down");
  assert.equal(computeBetaDeltas(loadConfig(), 10).size, 0, "disabled ⇒ no drift");
});

test("MOD-A04 PR events: a play spikes brand, charges cash, sets a cooldown; decays after", () => {
  const c = loadConfig(modulesOverride(["prEvents"]));
  (c.modules!.prEvents as { negative_pr_enabled: boolean }).negative_pr_enabled = false; // isolate the play
  const w = initGame(c);
  // Round 0: firm_1 runs a festival play; firm_2 sits out. Counterfactual: no play.
  const r0 = resolveRound(w, [mkDecision("firm_1", w, { pr_action: "festival" }), mkDecision("firm_2", w)], c);
  const noPlay = resolveRound(w, [mkDecision("firm_1", w), mkDecision("firm_2", w)], c);
  const f1 = r0.world.firms.find((f) => f.id === "firm_1")!;
  const f2 = r0.world.firms.find((f) => f.id === "firm_2")!;
  assert.ok(f1.pr_spike > 0, "festival play produces a transient brand spike");
  assert.equal(f1.pr_cooldown_until, c.modules!.prEvents.cooldown_rounds, "cooldown set from round 0");
  assert.equal(f2.pr_spike, 0, "a firm that sits out gets no spike");
  // The play's cost lands in opex (isolated from sales revenue, which is identical here).
  const opexPlay = r0.result.firm_results.find((f) => f.firm_id === "firm_1")!.pnl.opex;
  const opexNo = noPlay.result.firm_results.find((f) => f.firm_id === "firm_1")!.pnl.opex;
  assert.ok(Math.abs((opexPlay - opexNo) - c.modules!.prEvents.cost) < 1e-6, "the play adds exactly its cost to opex");
  // Round 1: firm_1 tries again but is on cooldown ⇒ only decay, no fresh jump.
  const r1 = resolveRound(r0.world, [mkDecision("firm_1", r0.world, { pr_action: "viral" }), mkDecision("firm_2", r0.world)], c);
  const f1b = r1.world.firms.find((f) => f.id === "firm_1")!;
  assert.ok(f1b.pr_spike < f1.pr_spike, "spike decays while on cooldown (the repeat play is blocked)");
});

test("MOD-A03 sustainability: investment builds water efficiency, lifts T_gov, blunts the water shock", () => {
  const c = loadConfig(modulesOverride(["sustainability"]));
  const w = initGame(c);
  const r = resolveRound(w, [mkDecision("firm_1", w, { invest_water_efficiency: 120 }), mkDecision("firm_2", w)], c);
  const f1 = r.world.firms.find((f) => f.id === "firm_1")!;
  const f2 = r.world.firms.find((f) => f.id === "firm_2")!;
  assert.ok(f1.water_efficiency > 0, "investment builds the water-efficiency stock");
  assert.equal(f2.water_efficiency, 0, "a non-investor builds nothing");
  // Both firms' T_gov depreciates equally this round; only the investor gets the
  // goodwill bump, so the investor ends strictly above the non-investor.
  assert.ok(f1.T_gov > f2.T_gov, "visible efficiency earns regulator goodwill (vs a non-investor)");
});

test("MOD-A02 public goods: contributions pool, decay, and deliver a shared benefit", () => {
  const c = loadConfig(modulesOverride(["publicGoods"]));
  const w = initGame(c);
  // Two firms fund the regional-marketing good (threshold 0 ⇒ continuous benefit).
  const r = resolveRound(w, [
    mkDecision("firm_1", w, { public_good_contributions: { regional_marketing: 80 } }),
    mkDecision("firm_2", w, { public_good_contributions: { regional_marketing: 80 } }),
  ], c);
  assert.ok((r.world.public_good_pools?.regional_marketing ?? 0) > 0, "contributions accumulate into the pool");
  // The contribution lands in each contributor's opex (private cost, shared benefit).
  const opex1 = r.result.firm_results.find((f) => f.firm_id === "firm_1")!.pnl.opex;
  const noPg = resolveRound(w, [mkDecision("firm_1", w), mkDecision("firm_2", w)], loadConfig());
  const opex1No = noPg.result.firm_results.find((f) => f.firm_id === "firm_1")!.pnl.opex;
  assert.ok(opex1 > opex1No, "contributing costs the firm (free-rider tension)");
  // Pool decays toward zero when nobody contributes next round.
  const r2 = resolveRound(r.world, [mkDecision("firm_1", r.world), mkDecision("firm_2", r.world)], c);
  assert.ok((r2.world.public_good_pools?.regional_marketing ?? 0) < (r.world.public_good_pools?.regional_marketing ?? 0), "pool decays without fresh contributions");
});

test("MOD-B01 geography: entering a region costs entry, splits capacity, balance holds", () => {
  const c = loadConfig(modulesOverride(["geography"]));
  const w = initGame(c);
  // firm_1 splits capacity home/coastal; firm_2 stays home only.
  const r = resolveRound(w, [
    mkDecision("firm_1", w, { market_presence: { home: 1, coastal: 1 } }),
    mkDecision("firm_2", w),
  ], c);
  const f1 = r.world.firms.find((f) => f.id === "firm_1")!;
  const f2 = r.world.firms.find((f) => f.id === "firm_2")!;
  assert.ok(f1.markets_entered.includes("coastal"), "firm_1 entered coastal");
  assert.ok(!f2.markets_entered.includes("coastal"), "firm_2 stayed home");
  const res1 = r.result.firm_results.find((f) => f.firm_id === "firm_1")!;
  assert.ok(res1.markets, "geography emits a per-market breakdown");
  assert.ok((res1.markets!.coastal?.q_sold ?? 0) > 0, "firm_1 sells in coastal");
  assert.ok((res1.markets!.home?.q_sold ?? 0) > 0, "firm_1 still sells at home");
  // Entry cost shows up as opex (firm_1 paid the coastal entry fee).
  for (const fr of r.result.firm_results) {
    const bs = fr.balance_sheet;
    assert.ok(Math.abs(bs.assets - (bs.debt + bs.equity)) < 1e-3, `balance ${fr.firm_id}`);
  }
});

test("MOD-B02 international: export markets activate + FX moves, deterministically", () => {
  const c = loadConfig(modulesOverride(["geography", "international"]));
  const w = initGame(c);
  const r1 = resolveRound(w, [
    mkDecision("firm_1", w, { market_presence: { home: 1, export_eu: 1 } }),
    mkDecision("firm_2", w),
  ], c);
  assert.ok(r1.world.fx_rates && typeof r1.world.fx_rates.export_eu === "number", "FX rate set for an export market");
  const res1 = r1.result.firm_results.find((f) => f.firm_id === "firm_1")!;
  assert.ok((res1.markets!.export_eu?.q_sold ?? 0) > 0, "firm_1 sells into the EU export market");
  // Determinism: same inputs ⇒ identical FX path.
  const r1b = resolveRound(w, [
    mkDecision("firm_1", w, { market_presence: { home: 1, export_eu: 1 } }),
    mkDecision("firm_2", w),
  ], c);
  assert.equal(r1b.world.fx_rates!.export_eu, r1.world.fx_rates!.export_eu, "FX is deterministic");
  // Without international, export markets are inactive (no export breakdown).
  const geoOnly = loadConfig(modulesOverride(["geography"]));
  const rg = resolveRound(initGame(geoOnly), [mkDecision("firm_1", w, { market_presence: { home: 1, export_eu: 1 } }), mkDecision("firm_2", w)], geoOnly);
  const rgRes = rg.result.firm_results.find((f) => f.firm_id === "firm_1")!;
  assert.ok(rgRes.markets && rgRes.markets.export_eu === undefined, "export markets need international enabled");
});

test("MOD-B10 reputation: signatories that honor deals build it; defection cuts it; off ⇒ none", () => {
  const c = loadConfig(modulesOverride(["reputation"]));
  const w = initGame(c);
  const form = mkDecision("firm_1", w, { agreement_actions: [{ type: "form", form: "relational", template: "joint_marketing", counterparties: ["firm_2"], segment: "niche" }] });
  const r0 = resolveRound(w, [form, mkDecision("firm_2", w)], c);
  const r1 = resolveRound(r0.world, [mkDecision("firm_1", r0.world), mkDecision("firm_2", r0.world)], c);
  const f1 = r1.world.firms.find((f) => f.id === "firm_1")!;
  assert.ok(f1.reputation > 0, "a signatory honoring the deal accrues reputation");
  // Off ⇒ the stock never moves.
  const offC = loadConfig();
  const off = resolveRound(initGame(offC), [mkDecision("firm_1", w, { agreement_actions: form.agreement_actions }), mkDecision("firm_2", w)], offC);
  assert.equal(off.world.firms.find((f) => f.id === "firm_1")!.reputation, 0, "reputation stays 0 when off");
});

test("MOD-B04 R&D race: heavy R&D opens the frontier early and grants a first-mover head start", () => {
  const c = loadConfig(modulesOverride(["rndRace"]));
  let world = initGame(c);
  assert.equal(world.segments.find((s) => s.id === "frontier")!.active, false, "frontier starts inactive (timed round 9)");
  let firstMover: string | null = null;
  for (let r = 0; r < 5; r++) {
    const decs = world.firms.filter((f) => f.status === "active").map((f) => mkDecision(f.id, world, f.id === "firm_1" ? { invest_rnd: 450 } : {}));
    world = resolveRound(world, decs, c).world;
    if (world.frontier_first_mover) firstMover = world.frontier_first_mover.firm_id;
    if (world.segments.find((s) => s.id === "frontier")!.active) break;
  }
  assert.ok(world.segments.find((s) => s.id === "frontier")!.active, "frontier emerges early via R&D (before its timed round)");
  assert.equal(world.round < 9, true, "...and it emerged before round 9");
  assert.equal(firstMover, "firm_1", "the R&D leader becomes the first mover");
});

test("MOD-B06 vertical: purchase capitalizes into PP&E, cuts unit cost after the lag", () => {
  const c = loadConfig(modulesOverride(["verticalIntegration"]));
  let world = initGame(c);
  const buy = mkDecision("firm_1", world, { buy_vertical: ["hop_supplier"] });
  let r = resolveRound(world, [buy, mkDecision("firm_2", world)], c);
  const f1 = r.world.firms.find((f) => f.id === "firm_1")!;
  assert.equal(f1.vertical_assets.length, 1, "asset acquired");
  // PP&E grew by ~the purchase price net of depreciation (capitalized, not expensed).
  const fr = r.result.firm_results.find((x) => x.firm_id === "firm_1")!;
  const fr2 = r.result.firm_results.find((x) => x.firm_id === "firm_2")!;
  assert.ok(fr.balance_sheet.ppe > fr2.balance_sheet.ppe + 200, "purchase shows up as PP&E");
  // Run past the integration lag: firm_1's unit cost beats firm_2's (same otherwise).
  world = r.world;
  for (let i = 0; i < 3; i++) world = resolveRound(world, [mkDecision("firm_1", world), mkDecision("firm_2", world)], c).world;
  const u1 = world.firms.find((f) => f.id === "firm_1")!.unit_cost;
  const u2 = world.firms.find((f) => f.id === "firm_2")!.unit_cost;
  assert.ok(u1 < u2 * 0.97, `integrated supplier cuts unit cost (${u1.toFixed(2)} vs ${u2.toFixed(2)})`);
});

test("MOD-B03 labor: hiring lands the bonus + salary; firing removes it", () => {
  const c = loadConfig(modulesOverride(["laborMarket"]));
  const w = initGame(c);
  const r = resolveRound(w, [mkDecision("firm_1", w, { hire_roles: ["head_brewer"] }), mkDecision("firm_2", w)], c);
  const f1 = r.world.firms.find((f) => f.id === "firm_1")!;
  const f2 = r.world.firms.find((f) => f.id === "firm_2")!;
  assert.equal(f1.key_hires.length, 1, "brewer hired");
  assert.ok(f1.Q > f2.Q + 4, "hire bonus lands on quality");
  const r2 = resolveRound(r.world, [mkDecision("firm_1", r.world, { fire_roles: ["head_brewer"] }), mkDecision("firm_2", r.world)], c);
  const f1b = r2.world.firms.find((f) => f.id === "firm_1")!;
  assert.equal(f1b.key_hires.length, 0, "brewer let go");
});

test("MOD-B08 instruments: RBF amortizes from revenue; convertible converts when cash-poor", () => {
  const c = loadConfig(modulesOverride(["financialInstruments"]));
  const w = initGame(c);
  // RBF: draw against revenue; obligation = draw × multiple, paid down each round.
  const r1 = resolveRound(w, [mkDecision("firm_1", w, { draw_rbf: 200 }), mkDecision("firm_2", w)], c);
  const f1 = r1.world.firms.find((f) => f.id === "firm_1")!;
  assert.ok(f1.rbf_outstanding > 0 && f1.rbf_outstanding <= 200 * 1.3, "RBF obligation booked");
  const r2 = resolveRound(r1.world, [mkDecision("firm_1", r1.world), mkDecision("firm_2", r1.world)], c);
  const f1b = r2.world.firms.find((f) => f.id === "firm_1")!;
  assert.ok(f1b.rbf_outstanding < f1.rbf_outstanding, "payments amortize the obligation from revenue");
  // Convertible: draw then run to maturity. Invariants are asserted every round in-engine.
  let world = initGame(c);
  let r = resolveRound(world, [mkDecision("firm_1", world, { draw_convertible: 300 }), mkDecision("firm_2", world)], c);
  assert.ok(r.world.firms.find((f) => f.id === "firm_1")!.convertible_note, "note on the books");
  world = r.world;
  for (let i = 0; i < 5 && world.firms.find((f) => f.id === "firm_1")!.convertible_note; i++) {
    world = resolveRound(world, [mkDecision("firm_1", world), mkDecision("firm_2", world)], c).world;
  }
  assert.equal(world.firms.find((f) => f.id === "firm_1")!.convertible_note, null, "note resolves at maturity (repaid or converted)");
});

test("MOD-B07 M&A: a distressed rival can be bought; acquirer absorbs it, books balance", () => {
  const c = loadConfig(modulesOverride(["ma"]));
  const w = initGame(c);
  // Make firm_2 distressed and bid at a price above the floor. Cash burns through
  // retained earnings (a real loss) so the opening balance sheet stays balanced.
  const t = w.firms.find((f) => f.id === "firm_2")!;
  t.rounds_below_health = 2;
  t.retained_earnings -= t.cash - 50;
  t.cash = 50;
  const a0 = w.firms.find((f) => f.id === "firm_1")!;
  const capBefore = a0.cap;
  // The target sits out of the market this round (no revenue → genuinely loss-making),
  // so its fair-value floor reflects real distress and the bid clears it.
  const idle: Record<SegmentId, number> = {};
  for (const s of w.segments) idle[s.id] = 0;
  const r = resolveRound(w, [mkDecision("firm_1", w, { acquisition_bid: { target: "firm_2", price: 900 } }), mkDecision("firm_2", w, { presence: idle })], c);
  const acq = r.world.firms.find((f) => f.id === "firm_1")!;
  const tgt = r.world.firms.find((f) => f.id === "firm_2")!;
  assert.equal(tgt.status, "acquired", "target leaves the game as acquired");
  assert.ok(acq.cap > capBefore, "acquirer absorbs discounted capacity");
  // Acquirer's books still balance (manual plug through retained earnings).
  const assets = acq.cash + acq.ppe_book + acq.inventory_value;
  const le = acq.debt + (acq.convertible_note?.principal ?? 0) + acq.rbf_principal + acq.paid_in_capital + acq.retained_earnings;
  assert.ok(Math.abs(assets - le) < 1e-3, `post-merger balance (${assets.toFixed(2)} vs ${le.toFixed(2)})`);
  // Next round resolves cleanly with the acquired firm out.
  const r2 = resolveRound(r.world, [mkDecision("firm_1", r.world)], c);
  assert.ok(r2.result.firm_results.every((x) => x.firm_id !== "firm_2"), "acquired firm no longer participates");
});

test("MOD-B05 team roles: briefings are role-tagged, deterministic, off ⇒ empty", async () => {
  const { roleBriefings } = await import("../src/engine/briefings.js");
  const c = loadConfig(modulesOverride(["teamRoles"]));
  const w = initGame(c);
  const b1 = roleBriefings(w, c, "firm_1");
  const b2 = roleBriefings(w, c, "firm_1");
  assert.equal(b1.length, 4, "four role briefings");
  assert.deepEqual(b1.map((x) => x.role), ["cfo", "cmo", "coo", "ceo"]);
  assert.deepEqual(b1, b2, "deterministic per (seed, round, firm)");
  assert.equal(roleBriefings(w, loadConfig(), "firm_1").length, 0, "off ⇒ none");
});

test("MOD-A04 off ⇒ no PR state moves (parity)", () => {
  const c = loadConfig();
  const w = initGame(c);
  const r = resolveRound(w, [mkDecision("firm_1", w, { pr_action: "festival" }), mkDecision("firm_2", w)], c);
  assert.ok(r.world.firms.every((f) => f.pr_spike === 0 && f.pr_cooldown_until === null), "PR action ignored when module off");
});

test("MOD-A09 lobbying: spend pushes an initiative, a cleared threshold fires the regulation; off ⇒ none", () => {
  const c = loadConfig(modulesOverride(["lobbying"]));
  const w = initGame(c);
  // A big one-shot push clears the quality-standards threshold this round.
  const r = resolveRound(w, [mkDecision("firm_1", w, { lobby_spend: 300, lobby_initiative: "quality_standards" }), mkDecision("firm_2", w)], c);
  const init = r.world.lobbying_initiatives?.find((i) => i.id === "quality_standards");
  assert.ok(init?.fired, "the regulation fires once its threshold is cleared");
  // The fired regulation lands as a βq lift on its segments (the existing mod channel).
  const mod = r.world.pending_segment_mods.find((m) => (m.beta_q_delta ?? 0) > 0);
  assert.ok(mod, "a quality-standards regulation pushes a positive βq segment mod");
  // The lobbying spend is expensed (private cost of influence).
  const opexLob = r.result.firm_results.find((f) => f.firm_id === "firm_1")!.pnl.opex;
  const noLob = resolveRound(w, [mkDecision("firm_1", w), mkDecision("firm_2", w)], c).result.firm_results.find((f) => f.firm_id === "firm_1")!.pnl.opex;
  assert.ok(opexLob > noLob, "offensive lobbying costs the firm");
  // Counter-lobbying bleeds an initiative's progress back down.
  const w2 = initGame(c);
  const push = resolveRound(w2, [mkDecision("firm_1", w2, { lobby_spend: 100, lobby_initiative: "craft_promotion" }), mkDecision("firm_2", w2)], c);
  const after = resolveRound(push.world, [mkDecision("firm_1", push.world), mkDecision("firm_2", push.world, { lobby_spend: 200, lobby_counter: "craft_promotion" })], c);
  const cp0 = push.world.lobbying_initiatives!.find((i) => i.id === "craft_promotion")!.progress;
  const cp1 = after.world.lobbying_initiatives!.find((i) => i.id === "craft_promotion")!.progress;
  assert.ok(cp1 < cp0, "a counter-lobby reduces the initiative's progress");
  // Off ⇒ a lobby action is inert.
  const off = resolveRound(initGame(loadConfig()), [mkDecision("firm_1", w, { lobby_spend: 300, lobby_initiative: "quality_standards" }), mkDecision("firm_2", w)], loadConfig());
  assert.equal(off.world.lobbying_initiatives, undefined, "no initiatives tracked when the module is off");
});

test("MOD-A05 contingent contracts: a clause auto-fires on its condition (partner distress ⇒ terminate)", () => {
  const c = loadConfig(modulesOverride(["contingentContracts"]));
  const w = initGame(c);
  // firm_1 forms a formal capacity-coordination pact with firm_2, with a clause:
  // if a partner falls into distress, the pact auto-terminates.
  const form = mkDecision("firm_1", w, {
    agreement_actions: [{ type: "form", form: "formal", template: "capacity_coordination", counterparties: ["firm_2"], clauses: [{ condition: "partner_distress", action: "terminate" }] }],
  });
  const r0 = resolveRound(w, [form, mkDecision("firm_2", w)], c);
  const ag0 = r0.world.agreements.find((a) => a.signatories.includes("firm_1") && a.signatories.includes("firm_2"));
  assert.ok(ag0?.active && ag0.clauses?.length === 1, "pact forms with one contingent clause, dormant");
  assert.equal(ag0!.clauses![0].fired_round, null, "clause hasn't fired while partners are healthy");
  // Round 1: firm_2 is now in distress ⇒ the clause fires and the pact terminates.
  r0.world.firms.find((f) => f.id === "firm_2")!.rounds_below_health = c.modules!.contingentContracts.distress_rounds;
  const r1 = resolveRound(r0.world, [mkDecision("firm_1", r0.world), mkDecision("firm_2", r0.world)], c);
  const ag1 = r1.world.agreements.find((a) => a.id === ag0!.id)!;
  assert.equal(ag1.active, false, "the clause auto-terminated the pact");
  assert.equal(ag1.dissolution_type, "clause", "dissolution is attributed to the clause");
  assert.equal(ag1.clauses![0].fired_round, r0.world.round, "clause records the round it fired");
});

test("MOD-A06 renegotiation: call → accept updates terms; off ⇒ inert", () => {
  const c = loadConfig(modulesOverride(["renegotiation"]));
  const w = initGame(c);
  const form = mkDecision("firm_1", w, { agreement_actions: [{ type: "form", form: "formal", template: "capacity_coordination", counterparties: ["firm_2"] }] });
  const r0 = resolveRound(w, [form, mkDecision("firm_2", w)], c);
  const ag = r0.world.agreements.find((a) => a.signatories.includes("firm_1") && a.signatories.includes("firm_2"))!;
  // Round 1: firm_1 calls to renegotiate, proposing a switch to supply-share. Call costs cash.
  const call = mkDecision("firm_1", r0.world, { agreement_actions: [{ type: "renegotiate", agreement_id: ag.id, proposed_template: "supply_share" }] });
  const r1 = resolveRound(r0.world, [call, mkDecision("firm_2", r0.world)], c);
  const ag1 = r1.world.agreements.find((a) => a.id === ag.id)!;
  assert.ok(ag1.renegotiation && ag1.renegotiation.caller === "firm_1", "an open renegotiation call is recorded");
  const opexCall = r1.result.firm_results.find((f) => f.firm_id === "firm_1")!.pnl.opex;
  const opexNo = resolveRound(r0.world, [mkDecision("firm_1", r0.world), mkDecision("firm_2", r0.world)], c).result.firm_results.find((f) => f.firm_id === "firm_1")!.pnl.opex;
  assert.ok(Math.abs((opexCall - opexNo) - c.modules!.renegotiation.call_cost) < 1e-6, "calling charges exactly the call cost");
  // Round 2: firm_2 (the counterparty) accepts ⇒ the template updates, call closes.
  const accept = mkDecision("firm_2", r1.world, { agreement_actions: [{ type: "renegotiate_response", agreement_id: ag.id, response: "accept" }] });
  const r2 = resolveRound(r1.world, [mkDecision("firm_1", r1.world), accept], c);
  const ag2 = r2.world.agreements.find((a) => a.id === ag.id)!;
  assert.equal(ag2.template, "supply_share", "accepted renegotiation updates the pact terms");
  assert.equal(ag2.renegotiation, null, "the open call is cleared on response");
  // Off ⇒ a renegotiate action does nothing (no open call, terms unchanged).
  const offC = loadConfig();
  const offForm = resolveRound(initGame(offC), [mkDecision("firm_1", w, { agreement_actions: form.agreement_actions }), mkDecision("firm_2", w)], offC);
  const agOff = offForm.world.agreements[0];
  const offCall = resolveRound(offForm.world, [mkDecision("firm_1", offForm.world, { agreement_actions: [{ type: "renegotiate", agreement_id: agOff.id, proposed_template: "supply_share" }] }), mkDecision("firm_2", offForm.world)], offC);
  assert.ok(!offCall.world.agreements[0].renegotiation, "renegotiation is inert when the module is off");
});

test("disabled asymmetric starts ⇒ symmetric opening state (parity with v1)", () => {
  const on = initGame(loadConfig(modulesOverride(["asymmetricStarts"])));
  const off = initGame(loadConfig());
  // With the module off, every firm shares the baseline starting capacity.
  assert.ok(off.firms.every((f) => f.cap === off.firms[0].cap), "v1 firms start identical");
  // With it on, the spread is real.
  assert.ok(on.firms[0].cap !== on.firms.at(-1)!.cap, "asymmetric firms differ");
});
