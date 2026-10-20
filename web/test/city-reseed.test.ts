import { test } from "node:test";
import assert from "node:assert/strict";
import type { FirmDecision } from "drinkwars-engine";
import type { GameView } from "../src/game/controller.js";
import { cityActionsFrom, emptyCityActions, marketPresenceFrom, marketsTouched, mergeDecision, keepUntouchedMarkets, poachesFrom } from "../src/game/cityActions.js";

// DW-076 — "reload-then-resubmit drops this round's City View entry / poaches". A reload re-seeds the
// FORM from the seat's stored slice; the City View queue and the poach list must be rebuilt from the
// same slice, so (1) a resubmit sends what the server already holds and (2) a standing-plan value
// never turns into a phantom "markets served" edit.

const view = (over: Partial<GameView["own"]> = {}): GameView => ({
  round: 2,
  own: { id: "firm_1", markets_entered: ["home"], facilities: [], ...over },
  modules: { facilities: { enabled: true, types: [{ id: "taproom", production_capacity: 0 }], districts: [{ id: "downtown", capacity_mult: 1 }] } },
} as unknown as GameView);

const taproom = { type: "taproom", location: "downtown", market: "home", lot: "l3" };

test("a slice this browser sent re-seeds the queue: build, market entry, upkeep, supply, poaches", () => {
  const v = view();
  const entered = marketPresenceFrom(v, ["home", "heartland"]); // what the City View generated at submit
  const stored: Partial<FirmDecision> = { build_facilities: [taproom], market_presence: entered, maintain_facilities: { fac_1: 12 }, market_supply: { home: 300 }, mothball_facilities: ["fac_2"], poach_employees: [{ firm: "firm_2", employee: "e9", offer: 4_000 }] };
  const a = cityActionsFrom(v, stored);
  assert.deepEqual(a.builds, [taproom]);
  assert.deepEqual(a.markets, ["home", "heartland"]);
  assert.ok(marketsTouched(v, a), "the entry this round IS a decision — recomputing presence is right");
  assert.deepEqual(a.maintain, { fac_1: 12 });
  assert.deepEqual(a.supply, { home: 300 });
  assert.deepEqual(a.mothballs, ["fac_2"]);
  assert.deepEqual(poachesFrom(stored), [{ firm: "firm_2", employee: "e9", offer: 4_000 }]);
  // …and the resubmit reproduces the stored slice exactly (the merge is idempotent over it).
  const form = { firm_id: "firm_1", ...stored } as FirmDecision;
  const again = mergeDecision(v, form, a, poachesFrom(stored));
  assert.deepEqual(again.build_facilities, [taproom]);
  assert.deepEqual(again.market_presence, entered);
  assert.deepEqual(again.poach_employees, stored.poach_employees);
  assert.deepEqual(again.market_supply, { home: 300 });
});

test("a standing-plan presence is NOT adopted as a City View edit (no phantom 'markets served')", () => {
  const v = view({ markets_entered: ["home", "heartland"] });
  // Last round's weights (capacity has since changed) — carried forward by the server, chosen by nobody this round.
  const standing = { home: 1.35, heartland: 0.9 };
  const a = cityActionsFrom(v, { market_presence: standing });
  assert.deepEqual(a.markets, emptyCityActions(v).markets);
  assert.ok(!marketsTouched(v, a));
  const form = { firm_id: "firm_1", market_presence: standing } as FirmDecision;
  const sent = keepUntouchedMarkets(v, mergeDecision(v, form, a), form, a);
  assert.deepEqual(sent.market_presence, standing, "the form's value rides through verbatim");
});

test("a presence whose set matches the firm's markets is a no-op; nothing stored → fresh queue", () => {
  const v = view({ markets_entered: ["home", "heartland"] });
  const a = cityActionsFrom(v, { market_presence: marketPresenceFrom(v, ["home", "heartland"]) });
  assert.deepEqual(a, emptyCityActions(v));
  assert.deepEqual(cityActionsFrom(v, null), emptyCityActions(v));
  assert.deepEqual(poachesFrom(null), []);
  // junk never leaks into the queue
  const junk = cityActionsFrom(v, { build_facilities: [{ type: "taproom" }], maintain_facilities: { fac_1: 0 }, poach_employees: [{ firm: "firm_2", employee: "e9", offer: 0 }] } as Partial<FirmDecision>);
  assert.deepEqual(junk.builds, []);
  assert.deepEqual(junk.maintain, {});
});
