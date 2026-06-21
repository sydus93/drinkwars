/**
 * MOD-B12 · Employees — named human capital.
 *
 * Additive + gated, in the same shape as engine/facilities.ts. A hire adds a
 * per-round salary (opex) and a skill × satisfaction per-round gain to one stock
 * (Q/B/process/T_*). Satisfaction drifts with pay-vs-market, tenure milestones, and
 * firm health; at zero the person quits (a T_emp hit), and the unhappier they are
 * the likelier a rival poaches them. A fresh candidate market is generated
 * deterministically from (seed, round), so the web can show exactly what the engine
 * will accept. Stock gains never touch the balance sheet and salaries are opex, so
 * the §7.2 invariants are preserved. Module off ⇒ no employees ⇒ identical to before.
 */
import type { Candidate, Config, EmployeeStock, FirmDecision, FirmId, WorldState } from "../types.js";
import { RNG, deriveSeed } from "../rng.js";

export interface EmployeesOutcome {
  opexByFirm: Map<FirmId, number>; // salaries (expensed)
  events: string[];
}

const FIRST = ["Marcus", "Priya", "Devon", "Sofia", "Liam", "Aisha", "Noah", "Mei", "Carlos", "Hana", "Owen", "Zoe", "Ibrahim", "Lena", "Theo", "Nadia", "Sam", "Yuki", "Diego", "Ava"];
const LAST_INITIAL = ["A", "B", "C", "D", "F", "G", "H", "K", "L", "M", "N", "P", "R", "S", "T", "V", "W"];

/** The fair (market) salary for a given role/skill — the benchmark satisfaction is judged against. */
const marketRate = (baseSalary: number, skill: number): number => baseSalary * (0.55 + 0.15 * skill);

/** This round's hireable candidates — deterministic, so the engine and the web agree. */
export function generateHiringMarket(c: Config, seed: number, round: number): Candidate[] {
  const cfg = c.modules?.employees;
  if (!cfg?.enabled || !cfg.roles.length) return [];
  const rng = new RNG(deriveSeed(seed, round, 421));
  const out: Candidate[] = [];
  for (let i = 0; i < cfg.market_size; i++) {
    const role = cfg.roles[rng.int(0, cfg.roles.length - 1)];
    const skill = rng.int(1, 5);
    // Salary ask correlates with skill but carries scouting noise → under/overpriced talent.
    const salary = Math.max(4, Math.round(marketRate(role.base_salary, skill) * rng.uniform(0.82, 1.2)));
    const name = `${FIRST[rng.int(0, FIRST.length - 1)]} ${LAST_INITIAL[rng.int(0, LAST_INITIAL.length - 1)]}.`;
    out.push({ id: `cand_${round}_${i}`, name, role: role.id, skill, salary, avatar_seed: `${seed}_${round}_${i}` });
  }
  return out;
}

export function resolveEmployees(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config, round: number): EmployeesOutcome {
  const out: EmployeesOutcome = { opexByFirm: new Map(), events: [] };
  const cfg = c.modules?.employees;
  if (!cfg?.enabled) return out;

  const market = new Map(generateHiringMarket(c, world.seed, round).map((m) => [m.id, m]));
  const roleById = new Map(cfg.roles.map((r) => [r.id, r]));
  const rng = new RNG(deriveSeed(world.seed, round, 422));

  for (const f of world.firms) {
    if (f.status !== "active") continue;
    f.employees ??= [];
    const d = decisions.get(f.id);
    let opex = 0;

    // ---- Layoffs (lose contribution; a morale hit to T_emp + the remaining team) ----
    for (const id of d?.fire_employees ?? []) {
      const i = f.employees.findIndex((e) => e.id === id);
      if (i < 0) continue;
      const e = f.employees[i];
      f.employees.splice(i, 1);
      f.T_emp = Math.max(0, f.T_emp - 1.5);
      for (const r of f.employees) r.satisfaction = Math.max(0, r.satisfaction - 0.05);
      out.events.push(`LAYOFF: ${f.id} lets go a ${roleById.get(e.role)?.label.toLowerCase() ?? e.role}`);
    }

    // ---- Hires from this round's market ----
    for (const cid of d?.hire_employees ?? []) {
      const cand = market.get(cid);
      if (!cand || f.employees.length >= cfg.max_employees || f.employees.some((e) => e.id === cid)) continue;
      f.employees.push({
        id: `emp_${round}_${f.employees.length}`, name: cand.name, role: cand.role, skill: cand.skill,
        salary: cand.salary, satisfaction: cfg.starting_satisfaction, tenure_rounds: 0, hired_round: round, avatar_seed: cand.avatar_seed,
      });
      out.events.push(`HIRE: ${f.id} brings on ${cand.name}, a ${roleById.get(cand.role)?.label.toLowerCase() ?? cand.role}`);
    }

    // ---- Raises (lift satisfaction; the higher salary becomes the opex) ----
    for (const [id, raw] of Object.entries(d?.raise_employees ?? {})) {
      const e = f.employees.find((x) => x.id === id);
      if (!e) continue;
      const ns = Math.round(Math.max(0, raw));
      if (ns > e.salary) {
        e.satisfaction = Math.min(1, e.satisfaction + 0.12 * Math.min(1, (ns - e.salary) / Math.max(1, e.salary)));
        e.salary = ns;
      }
    }

    // ---- Per-round: salary, stock gain, satisfaction drift, departures ----
    const distress = (f.rounds_below_health ?? 0) > 0;
    for (let i = f.employees.length - 1; i >= 0; i--) {
      const e = f.employees[i];
      const role = roleById.get(e.role);
      if (!role) continue;
      opex += e.salary;
      // Contribution: skill, scaled by how engaged they are.
      f[role.primary_stock as EmployeeStock] += e.skill * role.gain_per_skill * e.satisfaction;
      // Satisfaction drift: pay vs market, tenure milestones, firm distress.
      let ds = e.salary >= marketRate(role.base_salary, e.skill) ? 0.03 : -0.06;
      e.tenure_rounds += 1;
      if (e.tenure_rounds === 3 || e.tenure_rounds === 6 || e.tenure_rounds === 10) ds += cfg.tenure_bump;
      if (distress) ds -= 0.05;
      e.satisfaction = Math.max(0, Math.min(1, e.satisfaction + ds));
      // Departures: quit at zero morale, or get poached (likelier the unhappier they are).
      if (e.satisfaction <= 0) {
        f.employees.splice(i, 1);
        f.T_emp = Math.max(0, f.T_emp - 1);
        out.events.push(`DEPARTURE: ${e.name} quits ${f.id} — morale ran out`);
      } else if (e.tenure_rounds > 1 && rng.bool(cfg.poach_base * (1 - e.satisfaction))) {
        f.employees.splice(i, 1);
        f.T_emp = Math.max(0, f.T_emp - 0.5);
        out.events.push(`POACHED: a rival hires ${e.name} away from ${f.id}`);
      }
    }

    if (opex > 0) out.opexByFirm.set(f.id, opex);
  }
  return out;
}
