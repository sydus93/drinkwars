import { test } from "node:test";
import assert from "node:assert/strict";
import { composeTeamDecision, ROLE_DESK, type FirmDecision, type SeatPartial } from "drinkwars-engine";
import type { GameView } from "../src/game/controller.js";
import { teamBuildSource, teamEntryNote } from "../src/game/cityActions.js";
import { computeConflicts, holdLever, holdsSent, leverText, offDeskEdits, planDiffs, resetHolds, touchedDates, touchedLevers, wouldSubmit } from "../src/lib/reconcile.js";

// Playtest 10-29 (G1: every chair seated). The COO submitted without touching builds; the CFO entered Cedar Falls on
// the map and sited a build. The CEO's What locks row read "the COO decides" with no button, so she couldn't cancel it —
// yet the merge lets the CEO's word stand over a peer's once the chair stays silent (seats.ts). The map's popover only
// said "answer it on Decide", and the CFO's market entry read as a split nobody typed.
type Rec = Record<string, unknown>;
const brewpub = { type: "taproom", location: "downtown", market: "heartland", lot: "cf_a" };
const canning = { type: "canning_line", location: "industrial", market: "home", lot: "fr_b" };
const standing = { firm_id: "firm_1", price: { mass: 7.65 }, buy_info: false, debt_draw: 0, dividend: 0, equity_raise: 0, build_facilities: [], market_presence: { home: 1, coastal: 0.6 }, agreement_actions: [], exit_action: null } as unknown as FirmDecision;
const seats = [{ role: "ceo", name: "Ana" }, { role: "cfo", name: "Ben" }, { role: "coo", name: "Cy" }, { role: "cmo", name: "Dee" }].map((s) => ({ ...s, partial: null as Rec | null, touched: undefined as string[] | undefined, touched_at: undefined as Record<string, number> | undefined, updated_at: null as number | null }));
let clock = 100, acting = -1;
const parts = (): SeatPartial[] => seats.filter((s) => s.partial).map((s) => ({ desk: ROLE_DESK[s.role], partial: s.partial as Partial<FirmDecision>, touched: s.touched, touched_at: s.touched_at, updated_at: s.updated_at }));
const markets = [{ id: "home", label: "Home region", kind: "home", entered: true }, { id: "coastal", label: "Coastal cities", kind: "domestic", entered: true }, { id: "heartland", label: "Heartland", kind: "domestic", entered: false }];
const view = (me: number): GameView => ({ round: 0, modules: { geography: { enabled: true } }, markets, teamPlan: { locked: false, composed: parts().length ? composeTeamDecision(standing, parts()).decision : null, seats: seats.map((s, i) => ({ name: s.name, role: s.role, desk: ROLE_DESK[s.role], submitted: !!s.partial, me: i === me, updated_at: s.updated_at, partial: s.partial, touched: s.touched, touched_at: s.touched_at })) }, own: { id: "firm_1" }, firms: [] } as unknown as GameView);
const as = (me: number) => { if (acting !== me) resetHolds(); acting = me; };
const submit = (me: number, form: FirmDecision) => { // MultiplayerClient.submit + lifecycle's packTouched
  as(me);
  const v = view(me);
  const slice = wouldSubmit(v, seats[me].role, form, standing);
  const touched = [...new Set([...(seats[me].touched ?? []), ...touchedLevers(slice, standing, 0)!])];
  const dates = touchedDates(v, slice, touched);
  const now = clock++;
  Object.assign(seats[me], { touched, touched_at: Object.fromEntries(touched.map((f) => [f, dates[f] > 0 && dates[f] <= now ? dates[f] : now])), partial: slice as Rec, updated_at: now });
  holdsSent(0);
};
const ANA = 0, BEN = 1, CY = 2, DEE = 3;
const anaForm = { ...standing } as FirmDecision; // Ana never types builds or markets
const enters = { home: 1, coastal: 0.6, heartland: 0.6 };
const plan = () => composeTeamDecision(standing, parts()).decision;
const row = (me: number, form: FirmDecision, f: string) => planDiffs(view(me), seats[me].role, form, standing).rows.find((r) => r.field === f);

// Ben's form as his panel and submit check judge it: the plan mirrored off his desk, plus his map's entry and build
const benQueued = () => ({ ...standing, ...plan(), market_presence: enters, build_facilities: [brewpub] } as FirmDecision);
const offBuild = (me: number, form: FirmDecision) => offDeskEdits(view(me), seats[me].role, form, standing).find((e) => e.field === "build_facilities");

test("the COO stays silent, the CFO enters Cedar Falls and sites a build: the CEO's builds row offers Cancel it", () => {
  submit(CY, { ...standing } as FirmDecision); // Cy updates their desk without touching builds
  // Ben's submit check, before he sends (playtest 10-29: it said "Cy Lindqvist decides — yours is only a suggestion")
  as(BEN);
  const pre = offBuild(BEN, benQueued())!;
  assert.deepEqual([pre.sticks, pre.wins, pre.ownerName], [true, true, "Cy"], "the build goes in unless Cy changes it or the CEO cancels it");
  assert.match(row(BEN, benQueued(), "build_facilities")!.who, /^Not your desk — yours goes in once you submit, unless Cy \(COO\) changes it or the CEO cancels it$/);
  assert.equal(leverText("market_presence", undefined, view(BEN)), "Front Range only", "the firm's plan has — (no markets served set yet)");
  submit(BEN, { ...standing, market_presence: enters, build_facilities: [brewpub] } as FirmDecision);
  assert.deepEqual(plan().build_facilities, [brewpub], "Ben's build is in the plan — the silent chair's 'none' never clears it (DW-071)");
  as(ANA);
  const b = row(ANA, anaForm, "build_facilities")!;
  assert.equal(b.winner, "them");
  assert.match(b.who, /CFO Ben suggested 1 build \(.+\) for the COO's desk \(Cy\) · theirs unless the COO cancels it — Cancel it to drop it/);
  assert.equal(b.action, "cancel", "it read 'the COO decides' with no button");
  const c = computeConflicts(view(ANA), "ceo", anaForm, standing).find((x) => x.field === "build_facilities")!;
  assert.equal(c.cover?.decided, false, "the submit check doesn't say 'Cy decides' either");
});

test("…and the entry reads as one: the markets row names Cedar Falls", () => {
  const m = row(ANA, anaForm, "market_presence")!;
  assert.match(m.who, /CFO Ben suggested Front Range 46% · Harbor City 27% · Cedar Falls 27% \(entering Cedar Falls\) for the CMO's desk \(Dee\) · theirs until the CMO submits/);
  assert.equal(leverText("market_presence", standing.market_presence, view(ANA)), "Front Range 63% · Harbor City 37%", "a form that enters nothing new says nothing extra");
  // the map: whose entry it is, whose call (the CMO's desk), and that the fee is charged once
  const fee = /The entry fee is charged once for the firm, however many of you press Enter\.$/;
  const ceoNote = teamEntryNote(view(ANA), "heartland")!;
  assert.match(ceoNote, /^Ben \(CFO\) is entering it in the team plan, until Dee \(CMO\), whose desk it is, submits — press Enter too to keep it in\. /);
  assert.match(ceoNote, fee);
  assert.match(teamEntryNote(view(CY), "heartland")!, /until Dee \(CMO\), whose desk it is, submits — ask them, or the CEO, to enter it too\./);
  assert.match(teamEntryNote(view(DEE), "heartland")!, /^Ben \(CFO\) proposed entering it\. Markets served is your desk, so your update replaces their proposal — press Enter too to keep it\./, "to the CMO: their update drops it");
  assert.equal(teamEntryNote(view(ANA), "coastal"), null, "already entered: no note");
  assert.equal(teamEntryNote(view(BEN), "heartland"), null, "the seat that entered it sees it entered on its own map");
});

test("the CEO cancels: the plan drops it, her row keeps Use theirs, the CFO's row names her call and the COO's 'unless'", () => {
  as(ANA);
  holdLever(0, "build_facilities");
  submit(ANA, anaForm);
  assert.deepEqual(plan().build_facilities, [], "the CEO's word stands over a peer's once the seated chair stays silent");
  const b = row(ANA, anaForm, "build_facilities")!;
  assert.equal(b.winner, "me");
  assert.match(b.who, /cancelled, unless the COO puts it back/);
  assert.equal(b.action, "take");
  assert.deepEqual(b.restore, [brewpub]);
  as(BEN);
  const benForm = { ...standing, market_presence: plan().market_presence, build_facilities: plan().build_facilities } as FirmDecision; // off their desk, their form mirrors the plan
  const mine = row(BEN, benForm, "build_facilities")!;
  assert.match(mine.who, /You suggested 1 build \(.+\) for the COO's desk; CEO Ana cancelled it — the CEO's word stands unless Cy sets it/);
  // …and with the build still queued on his map (the submit check, his panel)
  const post = offBuild(BEN, benQueued())!;
  assert.deepEqual([post.wins, post.by, post.byCeo, post.byChair, post.gone], [false, "CEO Ana", true, false, true]);
  assert.match(row(BEN, benQueued(), "build_facilities")!.who, /^Not your desk — CEO Ana cancelled it; the CEO's word stands unless Cy \(COO\) changes it$/);
  const src = teamBuildSource(view(ANA), brewpub);
  assert.equal(src.by?.name, "Ben", "the CEO's map names who sent it");
  assert.equal(src.chair, null, "the COO left builds alone");
  assert.equal(src.ceo, true, "…so the popover points the CEO to Cancel it");
});

test("once the COO sets the builds themselves, the chair decides: no button for the CEO, and the map says so", () => {
  as(CY);
  submit(CY, { ...standing, build_facilities: [canning] } as FirmDecision);
  assert.deepEqual(plan().build_facilities, [canning], "the chair's own word outranks the CEO's");
  as(ANA);
  const b = row(ANA, anaForm, "build_facilities")!;
  assert.match(b.who, /COO Cy's desk — they changed it/);
  assert.equal(b.action, undefined, "no Cancel it over the chair's own word");
  assert.equal(computeConflicts(view(ANA), "ceo", anaForm, standing).find((x) => x.field === "build_facilities")?.cover?.decided, true);
  assert.equal(teamBuildSource(view(ANA), canning).chair?.name, "Cy");
  as(BEN);
  assert.deepEqual([offBuild(BEN, benQueued())!.wins, offBuild(BEN, benQueued())!.byChair], [false, true]);
  assert.match(row(BEN, benQueued(), "build_facilities")!.who, /^Not your desk — Cy \(COO\) set it; theirs is used$/);
});

test("a NUMBER suggested for a seated desk is still settled by that chair's silent submit (equity, CFO)", () => {
  seats.forEach((s) => Object.assign(s, { partial: null, touched: undefined, touched_at: undefined, updated_at: null }));
  resetHolds();
  submit(CY, { ...standing, equity_raise: 50_000 } as FirmDecision); // the COO suggests a raise for the CFO's desk
  submit(BEN, { ...standing } as FirmDecision); // the CFO submits without touching it
  assert.equal(plan().equity_raise, 0, "the chair's silent value replaces a peer's number (seats.ts)");
  as(ANA);
  const e = row(ANA, anaForm, "equity_raise")!;
  assert.match(e.who, /the CFO decides/);
  assert.equal(e.action, undefined);
});
