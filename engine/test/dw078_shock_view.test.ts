/**
 * DW-078 · A regional shock in the student view. The engine always recorded WHICH market a
 * drought struck (ScheduledShock.region) and scaled each firm's hit by its production share
 * there; the view projection dropped both, so every student read it as industry-wide. These
 * tests pin that the view now carries region + label + the viewing firm's exposure, computed by
 * the resolver's own function, and that nothing changes for an industry-wide shock or a caller
 * that passes no config.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGame, projectShocks } from "../src/index.js";
import { regionExposure } from "../src/engine/shocks.js";
import { loadConfig } from "../src/config/load.js";
import { modulesOverride } from "../src/config/modules.js";
import type { ScheduledShock, WorldState } from "../src/types.js";

const cfg = () => loadConfig(modulesOverride(["geography", "facilities"]));
const shock = (over: Partial<ScheduledShock> = {}): ScheduledShock => ({
  id: "t_water", type_id: "water", kind: "cost_spike", target: "all", round: 3, magnitude: 0.35, signaling: "unannounced",
  resilience_mitigated: true, duration: 2, locked: true, fired: true, ...over,
});
const withShock = (w: WorldState, s: ScheduledShock): WorldState => { w.shock_timeline = [s]; return w; };

test("a regional shock reaches the view with region, the market's label and the firm's exposure", () => {
  const c = cfg();
  const w = withShock(initGame(c), shock({ region: "heartland" }));
  const [v] = projectShocks(w, 3, c, "firm_1");
  assert.equal(v.region, "heartland");
  assert.equal(v.regionLabel, "Heartland");
  // firm_1 brews only at home → none of its production is in the Heartland
  assert.equal(v.exposure, 0);
  assert.equal(v.exposure, regionExposure(w.firms[0], c, "heartland", 3));
});

test("exposure is the resolver's production share: a home-region drought hits a home-only brewer in full", () => {
  const c = cfg();
  const w = withShock(initGame(c), shock({ region: "home" }));
  assert.equal(projectShocks(w, 3, c, "firm_1")[0].exposure, 1);
  // add an online producer facility in the Heartland: the home share drops below 1, the Heartland share rises above 0
  const t = c.modules!.facilities!.types.find((x) => (x.production_capacity ?? x.capacity_contribution ?? 0) > 0)!;
  w.firms[0].facilities = [{ id: "fac_1_0", type: t.id, name: "North", built_round: 0, online_round: 0, condition: 1, active: true, market_id: "heartland" }];
  const home = projectShocks(w, 3, c, "firm_1")[0].exposure!;
  const north = projectShocks(withShock(w, shock({ region: "heartland" })), 3, c, "firm_1")[0].exposure!;
  assert.ok(home > 0 && home < 1, `home share ${home}`);
  assert.ok(Math.abs(home + north - 1) < 1e-9, `shares sum to 1 (${home} + ${north})`);
});

test("no config or no firm ⇒ region and label only; an industry-wide shock carries none of it", () => {
  const c = cfg();
  const w = withShock(initGame(c), shock({ region: "heartland" }));
  const bare = projectShocks(w, 3)[0];
  assert.equal(bare.region, "heartland");
  assert.equal(bare.regionLabel, "heartland"); // no config to look the label up in
  assert.equal(bare.exposure, undefined);
  const wide = projectShocks(withShock(initGame(c), shock()), 3, c, "firm_1")[0];
  assert.deepEqual(Object.keys(wide).sort(), ["active", "kind", "round", "roundsAway", "signaled", "target", "typeId"]);
});
