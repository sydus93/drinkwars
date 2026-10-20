import { test } from "node:test";
import assert from "node:assert/strict";
import { composeTeamDecision, type SeatPartial } from "../src/engine/seats.js";
import type { FirmDecision } from "../src/types.js";

// DW-081 (playtest 10-19): market research is a TEAM purchase. The CFO bought it, the panel said
// "the CMO decides — yours is only a suggestion", yet the server's ratchet kept it bought; and the
// CMO's untouched submit could erase it from every preview. Any chair buys it; none vetoes it.
const base = { firm_id: "firm_1", price: { mass: 6 }, buy_info: false } as unknown as FirmDecision;
const seat = (role: string, t: number, partial: Record<string, unknown>, touched: string[]): SeatPartial => ({ role, partial: partial as Partial<FirmDecision>, touched, updated_at: t });

test("a non-CMO's purchase stands, whatever the CMO's silent submit does, in either order", () => {
  const cfoBuys = seat("cfo", 1, { buy_info: true }, ["buy_info"]), cmoSilent = seat("cmo", 2, { buy_info: false, price: { mass: 7 } }, ["price"]);
  assert.equal(composeTeamDecision(base, [cfoBuys, cmoSilent]).decision.buy_info, true);
  assert.equal(composeTeamDecision(base, [{ ...cmoSilent, updated_at: 0 }, cfoBuys]).decision.buy_info, true);
  assert.equal(composeTeamDecision(base, [cfoBuys, seat("ceo", 3, { ...base }, [])]).decision.buy_info, true, "the CEO's untouched form neither buys nor cancels it");
});

test("no chair vetoes it: a deliberate 'no' never cancels a teammate's purchase; the first buyer is credited", () => {
  const c = composeTeamDecision(base, [seat("cmo", 1, { buy_info: false }, ["buy_info"]), seat("coo", 2, { buy_info: true }, ["buy_info"]), seat("cfo", 3, { buy_info: true }, ["buy_info"])]);
  assert.equal(c.decision.buy_info, true);
  assert.equal(c.from.buy_info, 1, "the COO bought it first");
});

test("nobody bought it: the usual rule (the CMO's word, else standing)", () => {
  assert.equal(composeTeamDecision(base, [seat("cfo", 1, { buy_info: false }, [])]).decision.buy_info, false);
  assert.equal(composeTeamDecision({ ...base, buy_info: true } as FirmDecision, [seat("cmo", 1, { buy_info: true }, [])]).decision.buy_info, true, "an untouched carry is not a purchase, but it stands");
});
