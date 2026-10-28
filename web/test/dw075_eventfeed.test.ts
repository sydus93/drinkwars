import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEvents } from "../src/components/eventFeed.js";

// DW-075: the departure lines may now carry what the person took with them. The feed must keep
// parsing both the extended and the pre-DW-075 forms (an old game's history replays the latter).
test("DW-075: extended DEPARTURE/POACHED lines parse, and the bare lines still do", () => {
  const ev = parseEvents([
    "DEPARTURE: Hana B. quits Copper & Cask — morale ran out; took 5 quarters of built-up loyalty (+38% contribution)",
    "DEPARTURE: Hana B. quits Copper & Cask — morale ran out",
    "POACHED: a rival hires Owen H. away from Copper & Cask — took 3 quarters of built-up loyalty (+21% contribution)",
    "POACHED: a rival hires Owen H. away from Copper & Cask",
    "POACHED: Bitter Root lures Lena R. away from Copper & Cask — took 1 quarter of built-up loyalty (+9% contribution)",
    "DEPARTURE: Copper & Cask's head brewer leaves for another job — took 4 quarters of built-up tenure (+30% bonus)",
    "DEPARTURE: Copper & Cask's head brewer leaves for another job",
  ], "Copper & Cask");
  assert.equal(ev.length, 7);
  assert.equal(ev[0].title, "Employee quits"); assert.match(String(ev[0].body), /5 quarters of built-up loyalty \(\+38% contribution\)/); assert.ok(ev[0].mine);
  assert.equal(ev[1].title, "Employee quits"); assert.doesNotMatch(String(ev[1].body), /loyalty/);
  assert.equal(ev[2].title, "Talent poached"); assert.match(String(ev[2].body), /3 quarters .*\+21%/);
  assert.equal(ev[3].title, "Talent poached"); assert.doesNotMatch(String(ev[3].body), /quarters/);
  assert.equal(ev[4].title, "Talent raid"); assert.match(String(ev[4].body), /^Bitter Root lured Lena R\. away from Copper & Cask, taking 1 quarter of/);
  assert.equal(ev[5].title, "Key hire leaves"); assert.match(String(ev[5].body), /4 quarters of built-up tenure \(\+30% on their bonus\)/);
  assert.equal(ev[6].title, "Key hire leaves"); assert.doesNotMatch(String(ev[6].body), /tenure/);
  for (const e of ev) assert.doesNotMatch(String(e.body), /^(DEPARTURE|POACHED):/, "no raw prefix leaks");
});

// DW-082d: a build names its market (geography on), shown as the map's city; a line without one still reads.
test("DW-082d: two builds in one round say which city each went to", () => {
  const ev = parseEvents([
    "FACILITY BUILT: Barrel & Vine breaks ground on a taproom in Home region (online in 1 round)",
    "FACILITY BUILT: Barrel & Vine breaks ground on a taproom in Heartland (online in 1 round)",
    "FACILITY BUILT: Hop Theory breaks ground on a nano brewery (online in 1 round)",
  ], "Barrel & Vine");
  assert.equal(ev.find((e) => e.mine)?.body, "You broke ground on a taproom in Front Range (online in 1 round) and a taproom in Cedar Falls (online in 1 round).");
  assert.equal(ev.find((e) => e.title === "Hop Theory")?.body, "Broke ground on a nano brewery (online in 1 round).");
});
