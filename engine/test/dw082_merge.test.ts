/**
 * DW-082 (audit #2, finding 3) + DW-082b (Devin, 10-21): on a desk whose chair is empty, among the
 * specialists the later CHANGE wins (not the later submit — each word carries `touched_at`), and the
 * CEO has the final say: once the CEO changed (or held, or cancelled) the lever, no peer's cover
 * replaces it. Before, a touched lever stayed touched all round and covers were ordered by each seat's
 * latest submit, so any resubmit re-applied an old number over a newer one — and CEO and specialists
 * could trade overrides back and forth until the lock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeTeamDecision, type SeatPartial } from "../src/engine/seats.js";
import type { FirmDecision } from "../src/types.js";

const base = { firm_id: "firm_1", price: { mass: 7.65 }, dividend: 0, build_facilities: [], agreement_actions: [], exit_action: null } as unknown as FirmDecision;
// The CMO chair is empty: the CEO, the CFO and the COO may all cover its price.
const ceo = (price: number, at: Record<string, number> | undefined, upd: number, touched = ["price"]): SeatPartial =>
  ({ desk: "all", partial: { ...base, price: { mass: price } }, touched, touched_at: at, updated_at: upd });
const peer = (desk: "finance" | "operations", price: number, at: number, upd = at, extra: Record<string, unknown> = {}, touched = ["price"]): SeatPartial =>
  ({ desk, partial: { price: { mass: price }, ...extra }, touched, touched_at: Object.fromEntries(touched.map((f) => [f, f === "price" ? at : upd])), updated_at: upd });

test("between specialists the later change wins — and an unrelated resubmit keeps the lever's old date", () => {
  const cfoLater = composeTeamDecision(base, [peer("finance", 7, 1, 3, { dividend: 40_000 }, ["price", "dividend"]), peer("operations", 8, 2)]);
  assert.deepEqual(cfoLater.decision.price, { mass: 8 }, "the CFO re-sent its price at 3 but changed it at 1: the COO's change at 2 is newer");
  assert.equal(cfoLater.decision.dividend, 40_000, "the CFO's new dividend still lands");
});

test("the CEO has the final say on an empty desk: a specialist's later cover does not replace the CEO's change", () => {
  const c = composeTeamDecision(base, [ceo(9, { price: 1 }, 1), peer("finance", 7, 2)]);
  assert.deepEqual(c.decision.price, { mass: 9 });
  assert.equal(c.from.price, 0);
});

test("a CEO who never changed the lever doesn't take it: an untouched resubmit leaves the cover (DW-080)", () => {
  const c = composeTeamDecision(base, [ceo(7.65, { dividend: 3 }, 3, ["dividend"]), peer("finance", 7, 2)]);
  assert.deepEqual(c.decision.price, { mass: 7 });
});

test("slices without dates (stored before DW-082) keep the old rule exactly — the later submit wins", () => {
  const old = composeTeamDecision(base, [ceo(9, undefined, 1), { ...peer("finance", 7, 2), touched_at: undefined }]);
  assert.deepEqual(old.decision.price, { mass: 7 }, "no CEO-final for old slices: Sprint-1 replays compose as they always did");
});

test("Cancel it: the CEO's held 'none' over a teammate's build for an empty chair cancels it — and a later re-queue doesn't undo that", () => {
  const cmo = (at: number): SeatPartial => ({ desk: "commercial", partial: { build_facilities: [{ type: "taproom", location: "downtown" }] } as Partial<FirmDecision>, touched: ["build_facilities"], touched_at: { build_facilities: at }, updated_at: at });
  const ceoNone: SeatPartial = { desk: "all", partial: { ...base, build_facilities: [] }, touched: ["build_facilities"], touched_at: { build_facilities: 5 }, updated_at: 5 };
  assert.deepEqual(composeTeamDecision(base, [cmo(4), ceoNone]).decision.build_facilities, []);
  assert.deepEqual(composeTeamDecision(base, [cmo(6), ceoNone]).decision.build_facilities, [], "the CEO's word is final; the CMO's re-queue is a suggestion");
});
