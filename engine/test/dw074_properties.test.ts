import { test } from "node:test";
import assert from "node:assert/strict";
import { composeTeamDecision, mergeMemberDecisions, sameLever, seatTouched, ALL_LEVERS, DESK_LEVERS, ROLE_DESK, type SeatPartial, type SeatDesk } from "../src/engine/seats.js";
import type { FirmDecision } from "../src/types.js";

// DW-074 — the seat merge, attacked with thousands of random teams. Every lever of every case is
// checked against the rule as STATED (an oracle written independently of the two-pass
// implementation), plus the structural invariants no merge may break. Seeded: a failure prints
// the case number, and the same number reproduces it.

const rng = (seed: number) => () => { // mulberry32
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Rec = Record<string, unknown>;
const NUM = ["invest_cap", "invest_process", "invest_Q", "invest_B", "invest_T_emp", "invest_T_inv", "invest_T_gov", "debt_draw", "debt_repay", "equity_raise", "dividend", "run_rate", "invest_rnd", "lobby_spend", "draw_rbf"];
const LIST = ["hire_roles", "build_facilities", "buy_vertical", "fire_roles", "hire_employees"];
const MAP = ["price", "presence", "hire_bids", "maintain_facilities"];
const POOL = [...NUM, ...LIST, ...MAP, "buy_info"];
const deskOfLever = (f: string): SeatDesk => (Object.entries(DESK_LEVERS).find(([, fs]) => (fs as string[]).includes(f))![0]) as SeatDesk;

function value(r: () => number, f: string, allowEmpty = true): unknown {
  if (NUM.includes(f)) return allowEmpty && r() < 0.25 ? 0 : Math.round(r() * 5) * 10_000 + (r() < 0.2 ? 0.004 : 0);
  if (LIST.includes(f)) return allowEmpty && r() < 0.4 ? [] : Array.from({ length: 1 + Math.floor(r() * 2) }, () => (f === "build_facilities" ? { type: "t" + Math.floor(r() * 3) } : "x" + Math.floor(r() * 3)));
  if (MAP.includes(f)) return allowEmpty && r() < 0.3 ? {} : { mass: Math.round(r() * 4) + 1, ...(r() < 0.5 ? { niche: Math.round(r() * 4) } : {}) };
  return r() < 0.5;
}

function makeCase(seed: number) {
  const r = rng(seed);
  const base = { firm_id: "firm_1", agreement_actions: [], exit_action: null } as unknown as Rec;
  for (const f of POOL) if (!LIST.includes(f) || r() < 0.3) base[f] = value(r, f);
  const roles = ["ceo", "cmo", "coo", "chro", "cfo"].filter((x) => r() < (x === "ceo" ? 0.8 : 0.65));
  if (!roles.length) roles.push("cfo");
  const explicit = r() < 0.75; // most cases carry touched lists; the rest exercise the inferred path
  const seats: (SeatPartial & { role: string })[] = roles.map((role) => {
    const desk = ROLE_DESK[role];
    const partial: Rec = {};
    const touched: string[] = [];
    for (const f of POOL) {
      const mine = desk === "all" || deskOfLever(f) === desk;
      if (mine) {
        if (desk !== "all" && r() < 0.1) continue; // a lever the seat's form didn't carry
        const edit = r() < 0.3;
        partial[f] = edit ? value(r, f) : base[f];
        if (edit ? r() < 0.9 : r() < 0.08) touched.push(f); // rarely: a held lever at the standing value
      } else if (r() < 0.07) { partial[f] = value(r, f, false); touched.push(f); } // a cover / suggestion
    }
    const s: SeatPartial & { role: string } = { role, partial: partial as Partial<FirmDecision>, updated_at: Math.floor(r() * 6) };
    if (explicit || r() < 0.3) s.touched = touched;
    return s;
  });
  return { base: base as unknown as FirmDecision, seats };
}

const isEmptyColl = (v: unknown) => (Array.isArray(v) ? v.length === 0 : v !== null && typeof v === "object" && Object.keys(v as object).length === 0);

/** The rule as stated, lever by lever — no shared code with composeTeamDecision's passes. */
function oracle(base: FirmDecision, seats: SeatPartial[], f: string): unknown {
  const b = (base as unknown as Rec)[f];
  const desk = (s: SeatPartial) => s.desk ?? (s.role ? ROLE_DESK[s.role] ?? "all" : "all");
  const has = (s: SeatPartial) => (s.partial as Rec)[f] !== undefined;
  const val = (s: SeatPartial) => (s.partial as Rec)[f];
  const order = seats.map((s, i) => ({ s, i })).sort((x, y) => ((x.s.updated_at ?? 0) - (y.s.updated_at ?? 0)) || x.i - y.i).map((x) => x.s);
  // non-owners, in time order: the later word wins — unless it was left alone and the standing
  // word was meant (DW-080); an untouched empty collection never replaces a real one
  const t = (s: SeatPartial) => seatTouched(s, f as keyof FirmDecision, base);
  if (f === "buy_info" && order.some((s) => val(s) === true && t(s))) return true; // a team purchase: any buyer buys it (DW-081)
  let cur = b;
  let holder: SeatPartial | null = null; // whose value currently stands
  let ceo: SeatPartial | null = null; // the latest CEO whose value actually took
  for (const s of order) {
    if (desk(s) !== "all" && deskOfLever(f) === desk(s)) continue;
    if (!has(s)) continue;
    if (holder && !t(s) && t(holder)) continue;
    if (isEmptyColl(val(s)) && !t(s) && cur !== undefined && !isEmptyColl(cur)) continue;
    cur = val(s);
    holder = s;
    if (desk(s) === "all") ceo = s;
  }
  const owner = seats.find((s) => desk(s) !== "all" && deskOfLever(f) === desk(s) && has(s));
  if (!owner) return cur;
  if (!t(owner) && ceo && t(ceo)) return val(ceo);
  if (owner.touched?.includes(f)) return val(owner); // the chair's explicit word, even "none"
  if (isEmptyColl(val(owner)) && cur !== undefined && !isEmptyColl(cur)) return cur;
  return val(owner);
}

const N = 4000;

test(`merge = the stated rule, on every lever of ${N} random teams`, () => {
  for (let c = 0; c < N; c++) {
    const { base, seats } = makeCase(c);
    const got = mergeMemberDecisions(base, seats) as unknown as Rec;
    for (const f of POOL) assert.deepEqual(got[f], oracle(base, seats, f), `case ${c}, lever ${f}`);
  }
});

test("structural invariants: identity, no stray keys, provenance points at the value", () => {
  const allowed = new Set<string>([...(ALL_LEVERS as string[]), "firm_id"]);
  for (let c = 0; c < N; c++) {
    const { base, seats } = makeCase(c);
    const { decision, from } = composeTeamDecision(base, seats);
    const d = decision as unknown as Rec;
    assert.equal(d.firm_id, "firm_1");
    for (const k of Object.keys(d)) assert.ok(allowed.has(k), `case ${c}: stray key ${k}`);
    for (const f of ALL_LEVERS as string[]) {
      const i = (from as Record<string, number | undefined>)[f];
      if (i === undefined) assert.deepEqual(d[f], (base as unknown as Rec)[f], `case ${c}: ${f} has no source but is not the base value`);
      else assert.deepEqual(d[f], (seats[i].partial as Rec)[f], `case ${c}: ${f} credited to seat ${i} but holds another value`);
    }
  }
});

test("a chair's changed lever always trades (unless it is an empty list against a real request, or a 'no' to research a teammate bought)", () => {
  for (let c = 0; c < N; c++) {
    const { base, seats } = makeCase(c);
    const d = mergeMemberDecisions(base, seats) as unknown as Rec;
    for (const s of seats) {
      const desk = ROLE_DESK[s.role!];
      if (desk === "all") continue;
      for (const f of DESK_LEVERS[desk] as string[]) {
        const v = (s.partial as Rec)[f];
        if (v === undefined || !seatTouched(s, f as keyof FirmDecision, base) || (isEmptyColl(v) && !s.touched?.includes(f))) continue;
        if (f === "buy_info" && v !== true && d[f] === true) continue; // DW-081: no chair vetoes a teammate's purchase
        assert.deepEqual(d[f], v, `case ${c}: ${s.role} changed ${f} and it did not trade`);
      }
    }
  }
});

test("resubmitting the same slices changes nothing; seat array order is irrelevant when times differ", () => {
  for (let c = 0; c < N; c++) {
    const { base, seats } = makeCase(c);
    const once = mergeMemberDecisions(base, seats);
    assert.deepEqual(mergeMemberDecisions(base, [...seats, ...seats.map((s) => ({ ...s }))]), once, `case ${c}: a duplicate submit changed the plan`);
    const timed = seats.map((s, i) => ({ ...s, updated_at: i * 10 + (s.updated_at ?? 0) })); // distinct times
    const a = mergeMemberDecisions(base, timed);
    const b = mergeMemberDecisions(base, [...timed].reverse());
    assert.deepEqual(b, a, `case ${c}: array order changed the plan`);
  }
});

test("an explicit list equal to the inferred one gives the same plan as no list (deploy-safe)", () => {
  for (let c = 0; c < N; c++) {
    const { base, seats } = makeCase(c);
    const bare = seats.map(({ touched: _t, ...s }) => s as SeatPartial);
    // An explicit list can say one thing values cannot — a deliberate "none" — so that case is out of scope here.
    if (bare.some((s) => Object.keys(s.partial).some((f) => isEmptyColl((s.partial as Rec)[f]) && !sameLever((s.partial as Rec)[f], (base as unknown as Rec)[f])))) continue;
    const inferred = bare.map((s) => ({ ...s, touched: Object.keys(s.partial).filter((f) => f !== "firm_id" && !sameLever((s.partial as Rec)[f], (base as unknown as Rec)[f])) }));
    assert.deepEqual(mergeMemberDecisions(base, inferred), mergeMemberDecisions(base, bare), `case ${c}`);
  }
});

test("solo and CEO-only firms: the plan is exactly the CEO's form", () => {
  for (let c = 0; c < 500; c++) {
    const { base, seats } = makeCase(c);
    const ceo = seats.find((s) => s.role === "ceo");
    if (!ceo) continue;
    const d = mergeMemberDecisions(base, [ceo]) as unknown as Rec;
    for (const f of POOL) {
      const v: unknown = (ceo.partial as Rec)[f];
      const b: unknown = (base as unknown as Rec)[f];
      // an UNTOUCHED blank keeps the standing value; a deliberate "none" clears it (DW-080)
      const blank: boolean = isEmptyColl(v) && !seatTouched(ceo, f as keyof FirmDecision, base) && b !== undefined && !isEmptyColl(b);
      assert.deepEqual(d[f], blank ? b : v, `case ${c}: ${f}`);
    }
  }
});
