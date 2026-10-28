import { test } from "node:test";
import assert from "node:assert/strict";
import type { FirmDecision } from "drinkwars-engine";
import type { GameView } from "../src/game/controller.js";
import { cityActionsFrom, emptyCityActions, marketPresenceFrom, mergeDecision } from "../src/game/cityActions.js";
import { leverText } from "../src/lib/reconcile.js";

// DW-082 (audit #2, findings 1–2). A new market's foothold was 0.3% once a home brewery stood (the
// capacity term was still at the old toy scale), and Supply & lanes could neither show a carried
// offer nor clear one (an empty drawer fell back to the carried value).

const view = (facilities: unknown[] = []): GameView => ({
  round: 2,
  own: { id: "firm_1", markets_entered: ["home"], facilities },
  modules: { facilities: { enabled: true, types: [{ id: "brewery_small", production_capacity: 48_000 }], districts: [{ id: "industrial", capacity_mult: 1 }] } },
  markets: [{ id: "home", label: "Home" }, { id: "heartland", label: "Heartland" }],
} as unknown as GameView);
const nano = { id: "fac_1", type: "brewery_small", location_id: "industrial", market_id: "home", active: true, online_round: 1, condition: 1 };

test("entering a market with a home brewery standing still routes it a real share", () => {
  const w = marketPresenceFrom(view([nano]), ["home", "heartland"]);
  const share = w.heartland / (w.home + w.heartland);
  assert.ok(share > 0.2 && share < 0.4, `Heartland's foothold ${(share * 100).toFixed(1)}% (was 0.3%)`);
  const bare = marketPresenceFrom(view(), ["home", "heartland"]);
  assert.deepEqual(bare, { home: 1, heartland: 0.6 }, "no facilities: the base anchors, unchanged");
});

test("Supply & lanes: untouched keeps the carried offers; a cleared drawer sends {} (auto); an edit replaces", () => {
  const v = view();
  const form = { firm_id: "firm_1", market_supply: { heartland: 20_000 } } as unknown as FirmDecision;
  const fresh = emptyCityActions(v);
  assert.equal(fresh.supply, null, "a new round's drawer is untouched");
  assert.deepEqual(mergeDecision(v, form, fresh).market_supply, { heartland: 20_000 }, "untouched: the carried offer stands");
  assert.deepEqual(mergeDecision(v, form, { ...fresh, supply: {} }).market_supply, {}, "cleared: all auto — it used to fall back to the carried offer");
  assert.deepEqual(mergeDecision(v, form, { ...fresh, supply: { home: 5_000 } }).market_supply, { home: 5_000 });
});

test("a reload keeps an explicit 0 offer (ships nothing there) and leaves a slice without offers untouched", () => {
  const v = view();
  assert.deepEqual(cityActionsFrom(v, { market_supply: { heartland: 0, home: 300 } }).supply, { heartland: 0, home: 300 });
  assert.equal(cityActionsFrom(v, { price: { mass: 7 } } as Partial<FirmDecision>).supply, null);
});

test("the panel names offers with the rest on auto", () => {
  const v = view();
  assert.equal(leverText("market_supply", {}, v), "auto (split by presence)");
  assert.match(leverText("market_supply", { heartland: 20_000 }, v), /^[A-Z][\w ]+ 20,000 · rest auto$/, "the city name, the units, then the rest on auto");
});
