/**
 * DW-075 parity scenario — a scripted people-heavy game shared by the fixture generator
 * (run ONCE against the pre-DW-075 engine; its output is dw075_baseline.json) and the
 * parity test. The archetype bots play the field; on top, firm 0 staffs up from the talent
 * market every round, firm 1 does the same at a slower pace, firm 0 gives its first hire a
 * raise in round 5, and firm 2 raids firm 0's first hire from round 3 on. laborMarket key
 * hires come from the archetypes themselves (`mp.hire`). Any change to this file
 * invalidates the fixture — regenerate it from a pre-change engine, never from the current one.
 */
import type { Config, FirmDecision, RoundResult, WorldState } from "../../src/types.js";
import { generateHiringMarket } from "../../src/engine/employees.js";
import { BASELINE_ASSIGNMENT, makeProvider } from "../../harness/archetypes.js";

export function dw075Provider(): (world: WorldState, c: Config) => FirmDecision[] {
  const base = makeProvider(BASELINE_ASSIGNMENT);
  return (world, c) => {
    const decs = base(world, c);
    const market = generateHiringMarket(c, world.seed, world.round).slice().sort((a, b) => b.skill - a.skill);
    const f0 = world.firms[0], f1 = world.firms[1], f2 = world.firms[2];
    for (const d of decs) {
      if (d.firm_id === f0.id && f0.status === "active") {
        d.hire_employees = market.slice(0, 2).map((m) => m.id);
        d.hire_bids = { [market[0].id]: 2_000 };
        const first = f0.employees?.[0];
        if (first && world.round === 5) d.raise_employees = { [first.id]: Math.round(first.salary * 1.15) };
      }
      if (d.firm_id === f1.id && f1.status === "active" && world.round % 2 === 0) d.hire_employees = [market[0].id]; // contests firm 0's top pick (no bonus → loses the tie)
      if (d.firm_id === f2.id && f2.status === "active" && world.round >= 3) {
        const tgt = f0.employees?.[0];
        if (tgt) d.poach_employees = [{ firm: f0.id, employee: tgt.id, offer: Math.round(tgt.salary * 1.3) }];
      }
    }
    return decs;
  };
}

/** The numbers the fixture pins: every firm-round's stocks, cash and cumulative score, plus
 *  the final roster/key-hire counts (so a silent departure can't hide behind equal stocks). */
export function dw075Summary(history: RoundResult[], finalWorld: WorldState) {
  return {
    rounds: history.map((r) => r.firm_results.map((f) => [f.state.Q, f.state.B, f.state.process, f.state.T_emp, f.state.T_inv, f.state.T_gov, f.state.cash, f.scorecard_cumulative])),
    events: history.map((r) => r.events.filter((e) => /^(HIRE|SIGNED|OUTBID|CANDIDATE LOST|POACH|DEPARTURE|LAYOFF)/.test(e)).length),
    headcount: finalWorld.firms.map((f) => [(f.employees ?? []).length, (f.key_hires ?? []).length]),
  };
}
