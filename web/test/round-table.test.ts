import { test } from "node:test";
import assert from "node:assert/strict";
import type { FirmDecision } from "drinkwars-engine";
import type { TeamPlan, TeamPlanSeat } from "../src/game/multiplayer.js";
import { planTable } from "../src/lib/roundTable.js";

// DW-076 — the Round Table says what the engine will run and whose number it is. Shapes from
// Sprint 1 (game 42b80c61): firm 1's COO and CFO submitted their desks untouched every round
// and the CEO's tanks / loan / equity never ran; the old board credited the whole desk to the
// specialist and said nothing. Now the CEO's entry runs (DW-073) and the table says why.

const standing = { firm_id: "firm_1", price: { mass: 6 }, run_rate: 1, invest_cap: 25_600, invest_Q: 10_000, invest_process: 0, invest_B: 0, invest_T_emp: 6_000, debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, agreement_actions: [], exit_action: null } as unknown as FirmDecision;
const seat = (name: string, role: string, partial: Record<string, unknown> | null, t: number, touched?: string[], me = false): TeamPlanSeat =>
  ({ name, role, desk: role === "ceo" ? "all" : role === "coo" ? "operations" : role === "cfo" ? "finance" : "commercial", submitted: !!partial, me, updated_at: partial ? t : null, partial: partial as Partial<FirmDecision> | null, touched });
const plan = (seats: TeamPlanSeat[]): TeamPlan => ({ seats, composed: null, locked: false });
const row = (t: ReturnType<typeof planTable>, f: string) => t.rows.find((r) => String(r.field) === f);

test("firm 1: untouched COO/CFO desks yield to the CEO, and the table says so", () => {
  const coo = seat("Ops", "coo", { run_rate: 1, invest_cap: 25_600, invest_Q: 10_000, invest_process: 0 }, 1, [], true);
  const cfo = seat("Fin", "cfo", { debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0 }, 2, []);
  const ceo = seat("Cee", "ceo", { ...standing, invest_cap: 435_000, debt_draw: 100_000, equity_raise: 300_000 }, 3, ["invest_cap", "debt_draw", "equity_raise"]);
  const t = planTable(plan([ceo, coo, cfo]), standing);
  const cap = row(t, "invest_cap")!;
  assert.equal(cap.value, 435_000);
  assert.equal(cap.author, ceo);
  assert.equal(cap.authorChanged, true);
  assert.equal(cap.chairYielded, coo, "the viewer (COO) is told they left it alone");
  assert.deepEqual(cap.unused, [], "an untouched entry is not an 'entry'");
  assert.equal(row(t, "debt_draw")!.author, ceo);
  assert.equal(row(t, "debt_draw")!.chairYielded, cfo);
  assert.equal(row(t, "equity_raise")!.value, 300_000);
  // the chair's untouched quality spend is still credited to the chair (nobody else moved it)
  const q = row(t, "invest_Q")!;
  assert.equal(q.author, coo);
  assert.equal(q.authorChanged, false);
  assert.equal(q.chairYielded, null);
  assert.equal(t.unusedCount, 0);
});

test("a chair who CHANGED the lever wins; the CEO's differing entry shows as ✗ not used", () => {
  const coo = seat("Ops", "coo", { invest_cap: 90_000 }, 1, ["invest_cap"]);
  const ceo = seat("Cee", "ceo", { ...standing, invest_cap: 435_000 }, 3, ["invest_cap"], true);
  const t = planTable(plan([ceo, coo]), standing);
  const cap = row(t, "invest_cap")!;
  assert.equal(cap.value, 90_000);
  assert.equal(cap.author, coo);
  assert.equal(cap.chairYielded, null);
  assert.deepEqual(cap.unused.map((u) => [u.seat.name, u.value]), [["Cee", 435_000]]);
  assert.equal(t.unusedCount, 1);
});

test("a held lever (back at the standing value, still in the touched list) stays the chair's", () => {
  const coo = seat("Ops", "coo", { invest_cap: 25_600 }, 1, ["invest_cap"]);
  const ceo = seat("Cee", "ceo", { ...standing, invest_cap: 435_000 }, 3, ["invest_cap"]);
  const cap = row(planTable(plan([ceo, coo]), standing), "invest_cap")!;
  assert.equal(cap.value, 25_600);
  assert.equal(cap.author, coo);
  assert.equal(cap.authorChanged, true, "a hold is a decision");
  assert.equal(cap.unused[0]?.seat, ceo);
});

test("nobody set it → carried from the standing plan; empty untouched levers are not rows", () => {
  const cfo = seat("Fin", "cfo", { debt_draw: 0 }, 1, []);
  const t = planTable(plan([cfo]), standing);
  const price = row(t, "price")!;
  assert.equal(price.author, null, "carried");
  assert.deepEqual(price.value, { mass: 6 });
  assert.equal(row(t, "debt_draw"), undefined, "a $0 nobody changed is noise");
  assert.equal(row(t, "dividend"), undefined);
  assert.equal(t.rows.length, t.rows.filter((r) => r.value != null).length);
});

test("an unsubmitted seat is not on the table; no standing plan still lists the server's values", () => {
  const coo = seat("Ops", "coo", null, 0, undefined, true);
  const ceo = seat("Cee", "ceo", { ...standing, invest_cap: 435_000 }, 3, ["invest_cap"]);
  assert.equal(row(planTable(plan([ceo, coo]), standing), "invest_cap")!.author, ceo);
  const bare = planTable({ seats: [ceo, coo], composed: { ...standing, invest_cap: 435_000 }, locked: false }, null);
  assert.equal(row(bare, "invest_cap")!.value, 435_000);
  assert.equal(row(bare, "invest_cap")!.author, null);
  assert.equal(planTable(null, standing).rows.length, 0);
});
