import { test } from "node:test";
import assert from "node:assert/strict";
import { marketName } from "../src/labels.js";
import { parseEvents } from "../src/components/eventFeed.js";
import { eventCopy, shockKey } from "../src/lib/eventCopy.js";
import type { GameView, ShockSignal } from "../src/game/controller.js";

// DW-078: a regional drought names the market the way the City View does, and tells each firm
// whether (and how much) it is exposed — the resolver scales the hit by the same production share.
test("marketName maps engine ids and engine labels to the City View's city", () => {
  assert.equal(marketName("heartland"), "Cedar Falls");
  assert.equal(marketName("Heartland"), "Cedar Falls");
  assert.equal(marketName("Coastal cities"), "Harbor City");
  assert.equal(marketName("Home region"), "Front Range");
  assert.equal(marketName("atlantis"), "atlantis");
  assert.equal(marketName("atlantis", "Atlantis"), "Atlantis");
  assert.equal(marketName(undefined), "");
});

test("event lines carry the city name: expansion, and a regional shock with its region field", () => {
  const ev = parseEvents([
    "EXPANSION: Copper & Cask enters Heartland",
    "SHOCK fired: water (cost_spike, mag 0.35, unannounced) in Heartland",
    "SHOCK fired: harvest (cost_spike, mag 0.55, unannounced)",
  ], "");
  assert.match(String(ev[0].body), /expanded into Cedar Falls\./);
  assert.equal(ev[1].region, "Cedar Falls");
  assert.match(String(ev[1].body), /in Cedar Falls/);
  assert.equal(ev[2].region, undefined);
});

const view = { unitCostEst: 2, round: 4, nRounds: 8 } as unknown as GameView;
const drought = (exposure?: number): ShockSignal => ({ typeId: "water", kind: "cost_spike", target: "all", round: 4, roundsAway: 0, active: true, signaled: false, region: "heartland", regionLabel: "Heartland", exposure });

test("regional drought copy: spared, partly exposed, fully exposed, exposure unknown", () => {
  const spared = eventCopy(drought(0), "cfo", view);
  assert.equal(spared.scope, "CEDAR FALLS ONLY");
  assert.match(spared.subline, /producing in Cedar Falls this round\. None of your production is there/);
  assert.match(spared.short, /^No cost hit/);
  assert.match(spared.summary, /\(Cedar Falls producers\)$/);

  const half = eventCopy(drought(0.5), "coo", view);
  assert.match(half.subline, /About 50% of your production is there/);
  const all = eventCopy(drought(1), "coo", view);
  assert.match(all.subline, /All of your production is there/);
  // DW-080: a shock shows as "hits" only once it has fired, so last round's unit cost already carries
  // the (exposure-scaled) spike — the COO's line reads it as-is instead of multiplying it again
  assert.match(half.short, /holds near \$2\.00/);
  assert.match(all.short, /holds near \$2\.00/);
  assert.doesNotMatch(all.short, /\$2\.70/);

  const unknown = eventCopy(drought(undefined), "ceo", view);
  assert.equal(unknown.subline, "It hits breweries producing in Cedar Falls this round.");
});

test("an industry-wide shock is unchanged, and the dismissal key separates regions", () => {
  const wide = eventCopy({ ...drought(), region: undefined, regionLabel: undefined }, "ceo", view);
  assert.equal(wide.scope, "INDUSTRY-WIDE");
  assert.match(wide.subline, /every brewery/);
  assert.notEqual(shockKey(drought()), shockKey({ ...drought(), region: "coastal" }));
  assert.equal(shockKey({ ...drought(), region: undefined }), "water:4:all");
});

test("the projected debrief deck shows events as feed prose, never the engine log line", async () => {
  const { deckEvent } = await import("../src/components/Debrief.js");
  assert.equal(deckEvent("SHOCK fired: water (cost_spike, mag 0.35, unannounced) in Heartland"), "Water shortage in Cedar Falls: input costs spike sharply this round for producers there.");
  assert.equal(deckEvent("EXPANSION: Rival 2 enters Coastal cities  ×2"), "Rival 2 expanded into Harbor City.  ×2");
  assert.match(deckEvent("FACILITY BUILT: Rival 3 breaks ground on a taproom (online in 1 round)"), /^Rival 3 broke ground on a taproom/);
  assert.doesNotMatch(deckEvent("SHOCK fired: harvest (cost_spike, mag 0.55, unannounced)"), /cost_spike|mag 0\.55/);
});
