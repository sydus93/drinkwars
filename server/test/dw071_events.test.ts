/**
 * DW-071: a firm's private news (a refused/trimmed equity raise, a hire it couldn't pay for)
 * reaches only that firm's view; everything else stays public.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleEvents } from "../src/names.js";

const EVENTS = [
  "HIRE: firm_1 brings on a head brewer",
  "EQUITY MARKET CLOSED: no investor will fund firm_1's $500,000 raise — its losses have pushed its valuation to zero or below",
  "EQUITY: investors fund only $139,000 of the $1,200,000 firm_2 sought — 50% of its valuation is the most they will buy in a quarter",
  "HIRE FAILED: firm_10 cannot cover a head brewer's $21,600 signing bonus + first salary",
  "FORCED EXIT (bankruptcy): firm_3 (cash $-143,247, coverage -27.13)",
];

test("private news reaches only the firm it names", () => {
  assert.deepEqual(visibleEvents(EVENTS, "firm_1"), [EVENTS[0], EVENTS[1], EVENTS[4]]);
  assert.deepEqual(visibleEvents(EVENTS, "firm_2"), [EVENTS[0], EVENTS[2], EVENTS[4]]);
  assert.deepEqual(visibleEvents(EVENTS, "firm_10"), [EVENTS[0], EVENTS[3], EVENTS[4]], "firm_1 must not match firm_10");
  assert.deepEqual(visibleEvents(EVENTS, null), [EVENTS[0], EVENTS[4]], "a viewer without a firm sees only public news");
});
