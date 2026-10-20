import { test } from "node:test";
import assert from "node:assert/strict";
import { composeTeamDecision, DESK_LEVERS, ROLE_DESK, sameLever, type SeatPartial } from "drinkwars-engine";
import type { FirmDecision } from "drinkwars-engine";
import type { GameView } from "../src/game/controller.js";
import { computeConflicts, planDiffs, teamOutcome, touchedLevers, wouldSubmit } from "../src/lib/reconcile.js";

// "The card and the engine agree" (DW-059's standing obligation, DW-074). The Reconcile card and
// the commit dial are the only place a student learns whose number will trade. Here a tiny model
// of the server (the engine's merge + the sticky touched list, exactly as lifecycle.ts keeps it)
// plays thousands of random team rounds, and after every submit the client-side previews are
// held to what that server actually stored:
//   • the dial's plan BEFORE a submit  = the composed plan AFTER it
//   • every card row's "yours / theirs will be used" = the seat the stored plan credits
//   • DW-077: every commit-panel row's LOCKS value = the stored plan's value, and every row
//     that says "yours is used" is credited to that seat by the engine's provenance
//   • submitting again without touching anything changes nothing

const rng = (seed: number) => () => { // mulberry32
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
type Rec = Record<string, unknown>;
const NUM = ["invest_cap", "invest_Q", "invest_B", "invest_T_emp", "invest_T_inv", "debt_draw", "equity_raise", "dividend", "invest_rnd", "lobby_spend"];
const LIST = ["hire_roles", "build_facilities"];
const POOL = [...NUM, ...LIST, "price", "buy_info"];
const deskOf = (f: string) => Object.entries(DESK_LEVERS).find(([, fs]) => (fs as string[]).includes(f))![0];
const val = (r: () => number, f: string): unknown =>
  NUM.includes(f) ? Math.round(r() * 5) * 10_000 : LIST.includes(f) ? (r() < 0.4 ? [] : ["x" + Math.floor(r() * 3)]) : f === "price" ? { mass: 5 + Math.floor(r() * 4) } : r() < 0.5;

interface Stored { role: string; name: string; partial: Rec | null; touched?: string[]; updated_at: number | null }

class Firm {
  seats: Stored[];
  clock = 100;
  constructor(public standing: FirmDecision, roles: string[]) { this.seats = roles.map((role) => ({ role, name: role.toUpperCase(), partial: null, updated_at: null })); }
  private parts(): { idx: number[]; parts: SeatPartial[] } {
    const idx: number[] = [], parts: SeatPartial[] = [];
    this.seats.forEach((s, i) => { if (s.partial) { idx.push(i); parts.push({ desk: ROLE_DESK[s.role] ?? "all", partial: s.partial as Partial<FirmDecision>, updated_at: s.updated_at, touched: s.touched }); } });
    return { idx, parts };
  }
  composed(): FirmDecision | null { const { parts } = this.parts(); return parts.length ? composeTeamDecision(this.standing, parts).decision : null; }
  /** which seat (index into this.seats) the stored plan credits for a lever; null = standing */
  credit(f: string): number | null { const { idx, parts } = this.parts(); const k = composeTeamDecision(this.standing, parts).from[f as keyof FirmDecision]; return k === undefined ? null : idx[k]; }
  view(me: number): GameView {
    return { round: 0, teamPlan: { locked: false, composed: this.composed(), seats: this.seats.map((s, i) => ({ name: s.name, role: s.role, desk: ROLE_DESK[s.role] ?? "all", submitted: !!s.partial, me: i === me, updated_at: s.updated_at, partial: s.partial as Partial<FirmDecision> | null, touched: s.touched })) } } as unknown as GameView;
  }
  /** What MultiplayerClient.submit + lifecycle.submitMemberDecision do, minus the network. */
  submit(me: number, form: FirmDecision) {
    const s = this.seats[me];
    const slice = wouldSubmit(this.view(me), s.role, form, this.standing) as Rec;
    const touched = touchedLevers(slice as Partial<FirmDecision>, this.standing, 0)!;
    s.touched = [...new Set([...(s.touched ?? []), ...touched])].sort();
    s.partial = slice;
    s.updated_at = this.clock++;
  }
  /** A seat's form as the app shows it: own desk free, other desks mirroring the firm's plan, plus the
   *  occasional deliberate off-desk edit. The CEO's form is all its own — it copies nobody (DW-081). */
  form(r: () => number, me: number, prev?: FirmDecision): FirmDecision {
    const s = this.seats[me];
    const desk = ROLE_DESK[s.role] ?? "all";
    const plan = (this.composed() ?? this.standing) as unknown as Rec;
    const out: Rec = { ...(prev as unknown as Rec ?? this.standing) };
    for (const f of POOL) {
      const mine = desk === "all" || deskOf(f) === desk;
      if (mine) { if (r() < 0.3) out[f] = val(r, f); }
      else out[f] = r() < 0.08 ? val(r, f) : plan[f];
    }
    return out as unknown as FirmDecision;
  }
}

function makeFirm(seed: number) {
  const r = rng(seed);
  const standing = { firm_id: "firm_1", agreement_actions: [], exit_action: null } as unknown as Rec;
  for (const f of POOL) if (!LIST.includes(f)) standing[f] = val(r, f);
  const roles = ["ceo", "cmo", "coo", "chro", "cfo"].filter((x) => r() < (x === "ceo" ? 0.85 : 0.6));
  if (roles.length < 2) roles.push(roles.includes("cfo") ? "coo" : "cfo");
  return { r, firm: new Firm(standing as unknown as FirmDecision, roles) };
}

const N = 1500;

test(`dial, card and stored plan agree across ${N} random team rounds`, () => {
  let rows = 0, submits = 0, diffRows = 0;
  for (let c = 0; c < N; c++) {
    const { r, firm } = makeFirm(c);
    const forms: (FirmDecision | undefined)[] = firm.seats.map(() => undefined);
    for (let step = 0; step < 6; step++) {
      const me = Math.floor(r() * firm.seats.length);
      const role = firm.seats[me].role;
      const form = (forms[me] = firm.form(r, me, forms[me]));
      const tag = `case ${c} step ${step} (${role})`;

      // 1. the commit dial's plan, before submitting…
      const dial = teamOutcome(firm.view(me), role, form, firm.standing, "now")!.decision as unknown as Rec;
      firm.submit(me, form);
      submits++;
      // …is the plan the server holds after.
      const stored = firm.composed() as unknown as Rec;
      for (const f of POOL) assert.ok(sameLever(dial[f], stored[f]), `${tag}: dial priced ${f}=${JSON.stringify(dial[f])}, server composed ${JSON.stringify(stored[f])}`);

      // 2. every row every seat's card now shows names the seat the stored plan credits.
      firm.seats.forEach((s, i) => {
        if (!forms[i]) return;
        const myForm = forms[i]!;
        // a seat's card speaks about its form as last submitted (or as it would submit now)
        for (const row of computeConflicts(firm.view(i), s.role, myForm, firm.standing)) {
          rows++;
          const f = String(row.field);
          if (!s.partial) continue; // not yet submitted: the row is a forecast, checked by (1) when they do
          if (!sameLever((wouldSubmit(firm.view(i), s.role, myForm, firm.standing) as Rec)[f], (s.partial as Rec)[f])) continue; // form moved since their submit
          const credit = firm.credit(f);
          if (row.winner === "me") assert.ok(credit === i || sameLever(stored[f], (myForm as unknown as Rec)[f]), `${tag}: ${s.role}'s card says "yours" for ${f}, but the plan holds ${JSON.stringify(stored[f])} from ${credit === null ? "standing" : firm.seats[credit].role}`);
          else assert.ok(credit !== i, `${tag}: ${s.role}'s card says "theirs" for ${f}, but the plan credits ${s.role}`);
        }
        // DW-077: the commit panel's differs block — LOCKS is the engine's value, "yours" is provenance.
        const pd = planDiffs(firm.view(i), s.role, myForm, firm.standing);
        assert.ok(pd.follow <= pd.rows.length);
        for (const row of pd.rows) {
          diffRows++;
          const f = String(row.field);
          assert.ok(row.who.length > 0 && row.whoShort.length > 0, `${tag}: ${s.role}'s row for ${f} has no WHO DECIDES text`);
          if (!s.partial) continue; // not yet submitted: a forecast, checked by (1) when they do
          if (!sameLever((wouldSubmit(firm.view(i), s.role, myForm, firm.standing) as Rec)[f], (s.partial as Rec)[f])) continue; // form moved since their submit
          assert.ok(sameLever(row.locks, stored[f]), `${tag}: ${s.role}'s panel says ${f} LOCKS at ${JSON.stringify(row.locks)}, but the server composed ${JSON.stringify(stored[f])}`);
          const credit = firm.credit(f);
          if (row.winner === "me") assert.ok(credit === i || sameLever(stored[f], (myForm as unknown as Rec)[f]), `${tag}: ${s.role}'s panel says "yours is used" for ${f}, but the plan holds ${JSON.stringify(stored[f])} from ${credit === null ? "standing" : firm.seats[credit].role}`);
          else {
            assert.ok(credit !== i, `${tag}: ${s.role}'s panel says a teammate's number locks ${f}, but the plan credits ${s.role}`);
            assert.ok(!sameLever(stored[f], (myForm as unknown as Rec)[f]) || /cover|empty|not your desk|suggest/i.test(row.who), `${tag}: ${s.role}'s panel lists ${f} as a teammate's number, yet the plan equals the form and it is not a cover notice: "${row.who}"`);
          }
          if (row.ceoValue !== undefined) assert.ok(s.role !== "ceo" && firm.seats.some((x) => x.role === "ceo" && x.partial && sameLever((x.partial as Rec)[f], row.ceoValue)), `${tag}: ${s.role}'s row for ${f} offers a CEO value the CEO never submitted`);
        }
      });

      // 3. resubmitting the same form is a no-op.
      const before = JSON.stringify(firm.composed());
      firm.submit(me, form);
      assert.equal(JSON.stringify(firm.composed()), before, `${tag}: an unchanged resubmit moved the plan`);
    }
  }
  assert.ok(rows > 2000 && submits === N * 6, `too few card rows exercised (${rows})`);
  assert.ok(diffRows > 2000, `too few commit-panel rows exercised (${diffRows})`);
});

test("the Sprint-1 screen: the CEO's dial and card tell the truth about untouched chairs", () => {
  const standing = { firm_id: "firm_1", price: { mass: 6 }, invest_cap: 25_600, invest_Q: 0, debt_draw: 0, equity_raise: 0, dividend: 0, invest_T_inv: 0, agreement_actions: [], exit_action: null } as unknown as FirmDecision;
  const firm = new Firm(standing, ["ceo", "coo", "cfo"]);
  firm.submit(1, standing); // COO submits the desk as seeded
  firm.submit(2, standing); // CFO too
  const ceoForm = { ...standing, invest_cap: 435_000, debt_draw: 100_000 } as FirmDecision;
  const dial = teamOutcome(firm.view(0), "ceo", ceoForm, standing, "now")!.decision;
  assert.equal(dial.invest_cap, 435_000);
  assert.equal(dial.debt_draw, 100_000);
  assert.deepEqual(computeConflicts(firm.view(0), "ceo", ceoForm, standing), [], "nothing to reconcile: the chairs left those levers alone");
  firm.submit(0, ceoForm);
  assert.equal(firm.composed()!.invest_cap, 435_000);
  // The COO's card now says the CEO's change stands, and offers the hold.
  const cooRows = computeConflicts(firm.view(1), "coo", standing, standing);
  const row = cooRows.find((x) => x.field === "invest_cap")!;
  assert.equal(row.winner, "them");
  assert.equal(row.untouched, true);
  // DW-077: the COO's commit panel says the same, in the design's words, and the submit label counts it.
  // (a specialist's form mirrors the firm's plan on every desk that isn't theirs — Play.tsx)
  const cooForm = { ...standing, debt_draw: 100_000 } as FirmDecision;
  const pd = planDiffs(firm.view(1), "coo", cooForm, standing);
  const prow = pd.rows.find((x) => x.field === "invest_cap")!;
  assert.equal(prow.winner, "them");
  assert.equal(prow.locks, 435_000);
  assert.equal(prow.ceoValue, 435_000);
  assert.match(prow.who, /CEO changed this; you left it at last round's value/);
  assert.equal(pd.follow, 1, "the COO's submit label counts one lever that follows the CEO");
  // The CEO's panel: nothing differs — the chairs left those levers alone, so the CEO's numbers lock.
  assert.deepEqual(planDiffs(firm.view(0), "ceo", ceoForm, standing).rows, []);
  // The CFO changes the dividend: their own change wins, the CEO's entry is named, nothing follows.
  const cfoForm = { ...standing, invest_cap: 435_000, dividend: 20_000 } as FirmDecision;
  firm.submit(0, { ...ceoForm, dividend: 5_000 } as FirmDecision);
  const cfoRows = planDiffs(firm.view(2), "cfo", cfoForm, standing);
  const div = cfoRows.rows.find((x) => x.field === "dividend")!;
  assert.equal(div.winner, "me");
  assert.equal(div.locks, 20_000);
  assert.match(div.who, /CEO set \$5,000\. You changed it, so yours is used/);
  assert.equal(cfoRows.rows.filter((x) => x.winner === "them").length, 1, "debt_draw still follows the CEO (the CFO left it alone)");
  assert.equal(cfoRows.follow, 1);
});
