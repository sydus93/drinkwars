import { test } from "node:test";
import assert from "node:assert/strict";
import { composeTeamDecision, sameLever, type SeatPartial } from "../src/engine/seats.js";
import type { FirmDecision } from "../src/types.js";

// DW-080 (independent audit, 10-16). Among non-owners the later word wins — but only a word that was
// MEANT: a CEO's unchanged resubmit (its form a poll behind) erased a teammate's cover for an empty
// chair. And a deliberate "none" now clears: with the CHRO chair empty, the CEO could never cancel
// a hire a teammate suggested.
const base = { firm_id: "firm_1", price: { mass: 6 }, presence: { mass: 1 }, invest_cap: 25_600, hire_roles: [] } as unknown as FirmDecision;
const ceo = (t: number, partial: Record<string, unknown>, touched: string[]): SeatPartial => ({ role: "ceo", partial: { ...base, ...partial } as Partial<FirmDecision>, touched, updated_at: t });
const cfo = (t: number, partial: Record<string, unknown>, touched: string[]): SeatPartial => ({ role: "cfo", partial: partial as Partial<FirmDecision>, touched, updated_at: t });

test("a cover for an empty chair survives the CEO's unchanged resubmit", () => {
  // COO chair empty: the CFO covers capacity capex, then the CEO resubmits without touching it
  const d = composeTeamDecision(base, [cfo(1, { invest_cap: 80_000 }, ["invest_cap"]), ceo(2, {}, [])]).decision;
  assert.equal(d.invest_cap, 80_000);
});

test("the CEO still overrules a cover by changing it, or by holding last round's value", () => {
  assert.equal(composeTeamDecision(base, [cfo(1, { invest_cap: 80_000 }, ["invest_cap"]), ceo(2, { invest_cap: 120_000 }, ["invest_cap"])]).decision.invest_cap, 120_000);
  assert.equal(composeTeamDecision(base, [cfo(1, { invest_cap: 80_000 }, ["invest_cap"]), ceo(2, {}, ["invest_cap"])]).decision.invest_cap, 25_600, "a held lever at the standing value");
  // and a later deliberate cover still beats an earlier CEO change (later word wins)
  assert.equal(composeTeamDecision(base, [ceo(1, { invest_cap: 120_000 }, ["invest_cap"]), cfo(2, { invest_cap: 80_000 }, ["invest_cap"])]).decision.invest_cap, 80_000);
});

test("with the CHRO chair empty, the CEO can cancel a teammate's suggested hire — in either order of a deliberate word", () => {
  assert.deepEqual(composeTeamDecision(base, [cfo(1, { hire_roles: ["brewer"] }, ["hire_roles"]), ceo(2, { hire_roles: [] }, ["hire_roles"])]).decision.hire_roles, []);
  assert.deepEqual(composeTeamDecision(base, [ceo(1, { hire_roles: [] }, ["hire_roles"]), cfo(2, { hire_roles: ["brewer"] }, ["hire_roles"])]).decision.hire_roles, ["brewer"], "the later deliberate word");
  // an untouched blank still never wipes a real request (DW-071)
  assert.deepEqual(composeTeamDecision(base, [cfo(1, { hire_roles: ["brewer"] }, ["hire_roles"]), ceo(2, { hire_roles: [] }, [])]).decision.hire_roles, ["brewer"]);
});

test("float dust is the same absence as zero", () => {
  assert.ok(sameLever(0.001, 0));
  assert.ok(sameLever(-0.004, null));
  assert.ok(!sameLever(0.01, 0));
});
