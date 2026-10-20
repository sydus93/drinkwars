/**
 * DW-075 · Loyalty dividend (employees) + tenure compounding (laborMarket key hires).
 * The instructor's Sprint-1 finding: losing someone cost only the signing bonus and the empty
 * rounds, keeping someone earned nothing extra. These tests pin (1) bit-for-bit parity with the
 * pre-DW-075 engine when the config blocks are absent or rate 0, (2) the accrual/contribution/
 * shield arithmetic, (3) what a departure says it took, and (4) that a rival never sees loyalty.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initGame, resolveRound, runGame, projectFirms } from "../src/index.js";
import { resolveEmployees } from "../src/engine/employees.js";
import { resolveAssets } from "../src/engine/assets.js";
import { loadConfig } from "../src/config/load.js";
import { modulesOverride } from "../src/config/modules.js";
import type { Config, Employee, FirmDecision, FirmId, WorldState } from "../src/types.js";
import { dw075Provider, dw075Summary } from "./fixtures/dw075_scenario.js";

const BASELINE = JSON.parse(readFileSync(new URL("./fixtures/dw075_baseline.json", import.meta.url), "utf8"));
const peopleCfg = () => loadConfig(modulesOverride(["employees", "laborMarket"]));
const emp = (over: Partial<Employee> = {}): Employee => ({
  id: "emp_0_0", name: "Hana B.", role: "head_brewer", skill: 4, salary: 99_000, satisfaction: 0.8, tenure_rounds: 4, hired_round: 0, avatar_seed: "x", ...over,
});
const zero = (firm_id: FirmId, w: WorldState): FirmDecision => {
  const price: Record<string, number> = {}, presence: Record<string, number> = {};
  for (const s of w.segments) { price[s.id] = 8; presence[s.id] = s.id === "mass" ? 1 : 0; }
  return { firm_id, price, presence, invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0, debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null };
};
/** A world with one planted employee on firm 0 and no distress — so the only moving parts are the ones under test. */
const planted = (c: Config, e: Employee, seed = 7): WorldState => {
  const w = initGame(c);
  w.seed = seed;
  w.firms[0].employees = [e];
  w.firms[0].rounds_below_health = 0;
  return w;
};

test("DW-075 parity: loyalty/tenure blocks ABSENT or rate 0 reproduce the pre-change numbers; defaults ON do not", () => {
  const off = peopleCfg();
  delete off.modules!.employees.loyalty;
  delete off.modules!.laborMarket.tenure_bonus;
  const a = runGame(off, dw075Provider());
  assert.deepEqual(dw075Summary(a.history, a.finalWorld), BASELINE, "blocks absent ⇒ bit-for-bit the fixture (a pre-DW-075 stored config)");

  const zeroed = peopleCfg();
  zeroed.modules!.employees.loyalty = { rate: 0, cap: 1, poach_shield: 0.5 };
  zeroed.modules!.laborMarket.tenure_bonus = { rate: 0, cap: 2 };
  const b = runGame(zeroed, dw075Provider());
  assert.deepEqual(dw075Summary(b.history, b.finalWorld), BASELINE, "rate 0 ⇒ every multiplier is exactly 1");

  const on = runGame(peopleCfg(), dw075Provider()); // sanity: the scenario actually exercises the feature
  assert.notDeepEqual(dw075Summary(on.history, on.finalWorld).rounds, BASELINE.rounds, "defaults ON change the numbers");
  const cap = peopleCfg().modules!.employees.loyalty!.cap;
  assert.ok(on.finalWorld.firms.some((f) => (f.employees ?? []).some((e) => (e.loyalty ?? 0) >= 0.75 * cap)), "someone built real loyalty over the season");
});

test("DW-075 accrual: loyalty grows by rate × (post-drift) satisfaction, weights the unhappy down, and caps", () => {
  const c = peopleCfg();
  c.modules!.employees.loyalty = { rate: 0.1, cap: 1.0, poach_shield: 0.5 };
  // Paid above market ⇒ morale +0.03 this round; tenure 0→1 has no milestone and no poach roll.
  const w = planted(c, emp({ satisfaction: 0.8, tenure_rounds: 0 }));
  resolveEmployees(w, new Map(), c, w.round);
  const e = w.firms[0].employees![0];
  assert.ok(Math.abs(e.loyalty! - 0.1 * 0.83) < 1e-12, `first quarter: 0.1 × 0.83, got ${e.loyalty}`);

  const w2 = planted(c, emp({ satisfaction: 0.2, tenure_rounds: 0 }));
  resolveEmployees(w2, new Map(), c, w2.round);
  assert.ok(Math.abs(w2.firms[0].employees![0].loyalty! - 0.1 * 0.23) < 1e-12, "an unhappy person accrues at a fraction of the pace");

  const w3 = planted(c, emp({ satisfaction: 1, tenure_rounds: 0, loyalty: 0.97 }));
  resolveEmployees(w3, new Map(), c, w3.round);
  assert.equal(w3.firms[0].employees![0].loyalty, 1.0, "capped at cap");

  const w4 = planted(peopleCfg(), emp({ tenure_rounds: 0 }));
  const legacy = peopleCfg(); delete legacy.modules!.employees.loyalty;
  resolveEmployees(w4, new Map(), legacy, w4.round);
  assert.equal(w4.firms[0].employees![0].loyalty, undefined, "block absent ⇒ the field is never written (legacy state shape)");
});

test("DW-075 contribution: the stock gain is multiplied by (1 + loyalty) — a loyal veteran beats a happy newcomer", () => {
  const c = peopleCfg();
  const role = c.modules!.employees.roles.find((r) => r.id === "head_brewer")!;
  const run = (loyalty: number | undefined): number => {
    const w = planted(c, emp({ satisfaction: 0.8, tenure_rounds: 0, loyalty }));
    const q0 = w.firms[0].Q;
    resolveEmployees(w, new Map(), c, w.round);
    return w.firms[0].Q - q0;
  };
  const halfsat = c.modules!.employees.stock_halfsat!;
  const q0 = initGame(c).firms[0].Q;
  const base = 4 * role.gain_per_skill * 0.8 * (halfsat / (halfsat + q0));
  assert.ok(Math.abs(run(undefined) - base) < 1e-12, "no loyalty yet ⇒ the pre-DW-075 gain");
  assert.ok(Math.abs(run(0.5) - base * 1.5) < 1e-12, "loyalty 0.5 ⇒ +50%");
  assert.ok(Math.abs(run(1.0) - base * 2) < 1e-12, "loyalty 1.0 ⇒ ×2");
});

test("DW-075 poach shield: with the same seeded draws, a fully loyal person is poached strictly less often", () => {
  const c = peopleCfg();
  const trial = (loyalty: number): number => {
    let n = 0;
    for (let seed = 1; seed <= 300; seed++) {
      // Low morale (0.2) ⇒ base roll 0.05 × 0.8 = 4%/round; the shield halves it at the cap.
      const w = planted(c, emp({ satisfaction: 0.2, tenure_rounds: 5, loyalty }), seed);
      const out = resolveEmployees(w, new Map(), c, w.round);
      if (out.events.some((e) => e.startsWith("POACHED: a rival hires"))) n++;
    }
    return n;
  };
  const bare = trial(0), loyal = trial(1.0);
  assert.ok(bare > 0, `the unshielded roll fires in a 300-seed sweep (got ${bare})`);
  assert.ok(loyal < bare, `shield lowers the poach count: ${loyal} < ${bare}`);
  assert.ok(loyal <= bare * 0.75, `and by a lot — the threshold halves (${loyal} vs ${bare})`);
});

test("DW-075 poached by a rival: loyalty resets to 0 at the new house and the event names what the victim lost", () => {
  const c = peopleCfg();
  const victim = emp({ satisfaction: 0.5, tenure_rounds: 6, loyalty: 0.7 });
  let moved: Employee | undefined, event = "";
  for (let seed = 1; seed <= 40 && !moved; seed++) {
    const w = planted(c, { ...victim }, seed);
    const a = w.firms[0].id, b = w.firms[1].id;
    const decs = new Map<FirmId, FirmDecision>([[b, { ...zero(b, w), poach_employees: [{ firm: a, employee: victim.id, offer: victim.salary * 3 }] }]]);
    const out = resolveEmployees(w, decs, c, w.round);
    moved = (w.firms[1].employees ?? []).find((e) => e.name === victim.name);
    event = out.events.find((e) => e.startsWith("POACHED:")) ?? "";
  }
  assert.ok(moved, "a 3× offer eventually lands");
  // Loyalty is to the firm, not the person: they arrive at 0, then — like any new hire — accrue
  // their first quarter in the same round (rate × post-drift morale: 0.6 paid above market → 0.63).
  assert.ok(Math.abs(moved!.loyalty! - c.modules!.employees.loyalty!.rate * 0.63) < 1e-12, `restarted from 0, got ${moved!.loyalty}`);
  assert.equal(moved!.tenure_rounds, 1);
  assert.match(event, /^POACHED: firm_\d+ lures Hana B\. away from firm_\d+ — took 6 quarters of built-up loyalty \(\+70% contribution\)$/);
});

test("DW-075 quit event: says what walked out; a person with no loyalty keeps the pre-change line", () => {
  const c = peopleCfg();
  // Paid below market (salary 1) ⇒ −0.06 ⇒ morale 0.01 hits zero ⇒ quits; tenure 4→5.
  const w = planted(c, emp({ salary: 1, satisfaction: 0.01, tenure_rounds: 4, loyalty: 0.38 }));
  const out = resolveEmployees(w, new Map(), c, w.round);
  assert.equal(w.firms[0].employees!.length, 0);
  assert.equal(out.events.find((e) => e.startsWith("DEPARTURE:")), `DEPARTURE: Hana B. quits ${w.firms[0].id} — morale ran out; took 5 quarters of built-up loyalty (+38% contribution)`);

  const w2 = planted(c, emp({ salary: 1, satisfaction: 0.01, tenure_rounds: 4 }));
  const out2 = resolveEmployees(w2, new Map(), c, w2.round);
  assert.equal(out2.events.find((e) => e.startsWith("DEPARTURE:")), `DEPARTURE: Hana B. quits ${w2.firms[0].id} — morale ran out`);
});

test("DW-075 view privacy: tenure + loyalty project for the OWN firm only — never for a rival, even with research", () => {
  const c = peopleCfg();
  const w = planted(c, emp({ loyalty: 0.4 }));
  w.firms[1].employees = [emp({ id: "emp_0_1", name: "Priya K.", loyalty: 0.9 })];
  const me = w.firms[0].id;
  const revealed = projectFirms(w, c, me, [], true, (id) => id);
  const own = revealed.find((f) => f.isYou)!.employees[0];
  assert.equal(own.loyalty, 0.4); assert.equal(own.tenure_rounds, 4);
  const rival = revealed.find((f) => f.firm_id === w.firms[1].id)!.employees[0];
  assert.equal(rival.name, "Priya K.", "research still scouts the rival's roster");
  assert.ok(!("loyalty" in rival) && !("tenure_rounds" in rival), "but not how loyal they are");
  const hidden = projectFirms(w, c, me, [], false, (id) => id);
  assert.equal(hidden.find((f) => f.firm_id === w.firms[1].id)!.employees.length, 0, "no research ⇒ no roster at all");
});

test("DW-075 export: the per-round state carries the people position only when a people module is on", () => {
  const c = peopleCfg();
  const w = planted(c, emp({ loyalty: 0.4 }));
  const r = resolveRound(w, w.firms.map((f) => zero(f.id, w)), c);
  const st = r.result.firm_results.find((f) => f.firm_id === w.firms[0].id)!.state;
  assert.equal(st.headcount, 1);
  assert.ok(st.loyalty_mean! > 0.4 && st.loyalty_mean === st.loyalty_max, "mean/max of the one person after this round's accrual");
  const base = loadConfig();
  const wb = initGame(base);
  const rb = resolveRound(wb, wb.firms.map((f) => zero(f.id, wb)), base);
  assert.ok(!("headcount" in rb.result.firm_results[0].state), "off ⇒ export shape unchanged");
});

test("DW-075 key hires: the flat bonus compounds +rate/quarter to the cap, and ALL of it leaves with the person", () => {
  const c = peopleCfg();
  c.modules!.laborMarket.departure_prob = 0; // deterministic tenure
  c.modules!.laborMarket.tenure_bonus = { rate: 0.1, cap: 1.3 };
  const w = initGame(c);
  const f = w.firms[0];
  f.cash = 1e9;
  const q0 = f.Q;
  const hire = new Map<FirmId, FirmDecision>([[f.id, { ...zero(f.id, w), hire_roles: ["head_brewer"] }]]);
  resolveAssets(w, hire, c, 0);
  assert.ok(Math.abs(f.Q - (q0 + 5)) < 1e-9, "hire round: the flat +5, nothing more");
  for (let r = 1; r <= 5; r++) resolveAssets(w, new Map(), c, r);
  assert.ok(Math.abs(f.Q - (q0 + 5 * 1.3)) < 1e-9, `after 5 quarters: ×min(cap 1.3, 1.5) ⇒ +6.5, got +${(f.Q - q0).toFixed(3)}`);
  assert.equal(f.key_hires[0].tenure_mult, 1.3);
  resolveAssets(w, new Map<FirmId, FirmDecision>([[f.id, { ...zero(f.id, w), fire_roles: ["head_brewer"] }]]), c, 6);
  assert.ok(Math.abs(f.Q - q0) < 1e-9, "let go ⇒ the whole compounded bonus is removed");

  // Attrition names what left: rehire, age three quarters, then force a departure.
  resolveAssets(w, hire, c, 7);
  for (let r = 8; r <= 10; r++) resolveAssets(w, new Map(), c, r);
  c.modules!.laborMarket.departure_prob = 1;
  const out = resolveAssets(w, new Map(), c, 11);
  assert.equal(out.events.find((e) => e.startsWith("DEPARTURE:")), `DEPARTURE: ${f.id}'s head brewer leaves for another job — took 4 quarters of built-up tenure (+30% bonus)`);
  assert.ok(Math.abs(f.Q - q0) < 1e-9, "and the stock is back where it started");

  // Block absent ⇒ the legacy flat bonus, no multiplier written.
  const legacy = peopleCfg(); delete legacy.modules!.laborMarket.tenure_bonus; legacy.modules!.laborMarket.departure_prob = 0;
  const wl = initGame(legacy); wl.firms[0].cash = 1e9;
  resolveAssets(wl, new Map([[wl.firms[0].id, { ...zero(wl.firms[0].id, wl), hire_roles: ["head_brewer"] }]]), legacy, 0);
  for (let r = 1; r <= 5; r++) resolveAssets(wl, new Map(), legacy, r);
  assert.ok(Math.abs(wl.firms[0].Q - (initGame(legacy).firms[0].Q + 5)) < 1e-9);
  assert.equal(wl.firms[0].key_hires[0].tenure_mult, undefined);
});
