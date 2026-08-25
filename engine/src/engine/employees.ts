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

const fmNum = (n: number): string => Math.round(n).toLocaleString("en-US");

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

  // ---- Talent competition: a candidate is ONE person. When more than one firm tries
  // to sign the same candidate this round, the higher signing bonus wins them; ties
  // keep firm order (deterministic). Only the winner pays their bonus — same contract
  // as contested parcels in facilities.ts. ----
  const bidsByCand = new Map<string, { firmId: FirmId; bid: number }[]>();
  for (const f of world.firms) {
    if (f.status !== "active") continue;
    const d = decisions.get(f.id);
    const listed = new Set<string>();
    for (const cid of d?.hire_employees ?? []) {
      if (!market.has(cid) || listed.has(cid)) continue;
      listed.add(cid);
      const arr = bidsByCand.get(cid) ?? [];
      arr.push({ firmId: f.id, bid: Math.max(0, Math.round(d?.hire_bids?.[cid] ?? 0)) });
      bidsByCand.set(cid, arr);
    }
  }
  const candWinner = new Map<string, FirmId>();
  for (const [cid, bids] of bidsByCand) {
    if (bids.length <= 1) continue; // uncontested
    candWinner.set(cid, bids.reduce((a, x) => (x.bid > a.bid ? x : a), bids[0]).firmId);
  }

  // ---- Poaching pass: a firm can lure a rival's employee with a better offer.
  // Resolved first so a poached person contributes to their new firm this round.
  // Acceptance rises with the size of the raise and with the target's discontent;
  // the offer must at least beat their current pay. The poacher pays the offer as a
  // one-time signing premium (opex) plus the new salary going forward. ----
  for (const poacher of world.firms) {
    if (poacher.status !== "active") continue;
    for (const p of decisions.get(poacher.id)?.poach_employees ?? []) {
      if (p.firm === poacher.id) continue;
      const target = world.firms.find((x) => x.id === p.firm);
      if (!target?.employees) continue;
      poacher.employees ??= [];
      if (poacher.employees.length >= cfg.max_employees) continue;
      const idx = target.employees.findIndex((e) => e.id === p.employee);
      if (idx < 0) continue;
      const e = target.employees[idx];
      const offer = Math.round(Math.max(0, p.offer));
      if (offer <= e.salary) continue; // must beat current pay to tempt them
      const raiseFactor = (offer - e.salary) / Math.max(1, e.salary);
      const pAccept = Math.min(0.95, (1 - e.satisfaction) * 0.6 + Math.min(0.6, raiseFactor));
      if (!rng.bool(pAccept)) {
        out.events.push(`POACH REBUFFED: ${e.name} spurns ${poacher.id} and stays with ${p.firm}`);
        continue;
      }
      target.employees.splice(idx, 1);
      target.T_emp = Math.max(0, target.T_emp - 1);
      // Employee ids are only unique WITHIN a firm (`emp_<round>_<n>`), so a poached person
      // is re-keyed on arrival — otherwise a later raise/fire by id could hit the wrong person.
      poacher.employees.push({ ...e, id: `${e.id}_via_${p.firm}_${round}`, salary: offer, satisfaction: 0.6, tenure_rounds: 0, hired_round: round });
      out.opexByFirm.set(poacher.id, (out.opexByFirm.get(poacher.id) ?? 0) + offer); // signing premium
      out.events.push(`POACHED: ${poacher.id} lures ${e.name} away from ${p.firm}`);
    }
  }

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

    // ---- Hires from this round's market (contested candidates already adjudicated) ----
    const signed = new Set<string>(); // guards a firm listing the same candidate twice
    for (const cid of d?.hire_employees ?? []) {
      const cand = market.get(cid);
      if (!cand || f.employees.length >= cfg.max_employees || signed.has(cid)) continue;
      const myBid = Math.max(0, Math.round(d?.hire_bids?.[cid] ?? 0));
      const winner = candWinner.get(cid);
      if (winner && winner !== f.id) {
        // Honest loss report: a $0-vs-$0 tie resolves by firm order, not by "a better
        // offer" — say so, and teach the lever (the signing bonus) either way.
        const winBid = Math.max(0, ...(bidsByCand.get(cid) ?? []).filter((x) => x.firmId === winner).map((x) => x.bid));
        out.events.push(winBid > myBid
          ? `OUTBID: ${cand.name} signed with a rival — their signing bonus $${fmNum(winBid)} beat yours ($${fmNum(myBid)})`
          : `CANDIDATE LOST: ${cand.name} took a rival's otherwise-equal offer on a tie-break — a signing bonus would have won them outright`);
        continue;
      }
      signed.add(cid);
      f.employees.push({
        id: `emp_${round}_${f.employees.length}`, name: cand.name, role: cand.role, skill: cand.skill,
        salary: cand.salary, satisfaction: cfg.starting_satisfaction, tenure_rounds: 0, hired_round: round, avatar_seed: cand.avatar_seed,
      });
      if (winner === f.id && myBid > 0) {
        opex += myBid; // one-time signing bonus (opex) — only the contest winner pays
        out.events.push(`SIGNED: ${f.id} wins ${cand.name} in a contested hire ($${fmNum(myBid)} signing bonus)`);
      } else {
        out.events.push(`HIRE: ${f.id} brings on ${cand.name}, a ${roleById.get(cand.role)?.label.toLowerCase() ?? cand.role}`);
      }
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
      // Contribution: skill, scaled by how engaged they are — saturating in the stock
      // it feeds (stock_halfsat), so a staffed-up firm can't compound linearly past
      // the sqrt-concave invest channels (DW-041).
      const cur = f[role.primary_stock as EmployeeStock];
      const sat = cfg.stock_halfsat != null ? cfg.stock_halfsat / (cfg.stock_halfsat + Math.max(0, cur)) : 1;
      f[role.primary_stock as EmployeeStock] = cur + e.skill * role.gain_per_skill * e.satisfaction * sat;
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

    if (opex > 0) out.opexByFirm.set(f.id, (out.opexByFirm.get(f.id) ?? 0) + opex); // add — poaching may have set a signing premium
  }
  return out;
}
