import { test } from "node:test";
import assert from "node:assert/strict";
import { fmt } from "../src/labels.js";
import { fmtLever, shareText } from "../src/lib/reconcile.js";

// DW-079 (playtest 10-15): the "locks at a teammate's number" card and the pre-submit check printed
// the capacity split as raw slider weights ("Lagers & Light 27.598636583011583 · Craft Premium
// 72.40136341698842" against the plan's "1 · 1"), and a loss as "$-167,000".
test("a loss reads −$167,000; a gain keeps its $", () => {
  assert.equal(fmt.money(-167_000), "−$167,000");
  assert.equal(fmt.money(5_000), "$5,000");
  assert.equal(fmt.money(0), "$0");
});

test("capacity allocation shows the split in whole percents, never raw weights", () => {
  assert.equal(fmtLever("presence", { mass: 27.598636583011583, niche: 72.40136341698842 }), "Lagers & Light 28% · Craft Premium 72%");
  assert.equal(fmtLever("presence", { mass: 1, niche: 1 }), "Lagers & Light 50% · Craft Premium 50%");
  assert.equal(fmtLever("presence", { mass: 1, niche: 1, frontier: 1 }), "Lagers & Light 34% · Craft Premium 33% · Non-Alc / Functional 33%", "largest remainder: always sums to 100");
  assert.equal(fmtLever("presence", { mass: 0, niche: 3 }), "Craft Premium 100%");
  assert.equal(shareText([], (k) => k), "none");
});

test("other numeric maps round to cents; prices keep two decimals", () => {
  assert.equal(fmtLever("price", { mass: 7.6549, niche: 8 }), "Lagers & Light $7.65 · Craft Premium $8.00");
  assert.doesNotMatch(fmtLever("some_weights", { mass: 0.123456789 }), /\d\.\d{3,}/);
});
